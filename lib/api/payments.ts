// lib/api/payments.ts
import { query, queryOne, execute, batch, uuid, today } from '../db'
import type { Payment, Bill } from '../types'
import type { PaymentWithBill } from './bills.server'
import {
  generateIdempotencyKey,
  effectiveBillAmount,
  isValidCalendarDate,
} from '../utils'
import { RpcDomainError } from './errors'
import type { MemberContext } from './member-scope'
import { MemberScopeError } from './member-scope'

export async function getPaymentsByBill(billId: string): Promise<Payment[]> {
  const { data, error } = await query<Payment>(
    'SELECT * FROM payments WHERE bill_id = ? ORDER BY paid_at DESC',
    [billId]
  )
  if (error) throw new Error(error.message)
  return data || []
}

export async function createPayment(
  payment: Omit<Payment, 'id' | 'created_at' | 'idempotency_key'>
): Promise<Payment> {
  const id = uuid()
  const key = generateIdempotencyKey()
  const { error } = await execute(
    'INSERT INTO payments (id, bill_id, amount, paid_at, channel, note, idempotency_key) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, payment.bill_id, payment.amount, payment.paid_at, payment.channel || null, payment.note || null, key]
  )
  if (error) throw new Error(error.message)
  const created = await queryOne<Payment>('SELECT * FROM payments WHERE id = ?', [id])
  if (!created.data) throw new Error('还款记录创建失败')
  return created.data
}

/**
 * 成员归属校验：payment -> bill -> card -> holder。
 * 与 member-scope.ts 的 assertBillAccess 同一模式（fail closed，
 * MemberScopeError 由 rpc-dispatch 映射为 403）。放在本文件而非
 * member-scope.ts：member-scope 不在本任务目标清单内，且这里只需一处。
 */
export async function assertPaymentAccess(paymentId: unknown, ctx: MemberContext): Promise<void> {
  if (typeof paymentId !== 'string') throw new MemberScopeError('参数必须是还款记录 ID')
  const { data } = await queryOne<{ holder_id: string }>(
    'SELECT cc.holder_id FROM payments p JOIN bills b ON p.bill_id = b.id JOIN credit_cards cc ON b.card_id = cc.id WHERE p.id = ?',
    [paymentId]
  )
  if (!data || !ctx.holderIds.includes(data.holder_id)) {
    throw new MemberScopeError('无权访问其他成员的还款记录')
  }
}

/**
 * 还款变更（改/删）后的状态落库：变更与状态更新放同一个 batch（D1 隐式事务），
 * 且状态在事务内直接按写入后的 `SUM(payments)` 与最新生效金额/生效到期日计算，
 * 避免读取→batch 窗口内的并发还款或账单改动让预计算的投影状态过期。
 * 口径与 computePaymentDrivenStatus 一致（已还 ≥ 生效金额 − 0.01 即 paid，允许从 paid 回退）。
 * bills 的 sync 触发器（0019 trg_bills_update）会自动补 sync_changes，无需手写。
 */
function withRecalcBillStatus(
  statements: { sql: string; params: unknown[] }[],
  billId: string,
): void {
  statements.push({
    sql: `UPDATE bills SET status = CASE
      WHEN (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE bill_id = ?) >= COALESCE(bill_amount_override, bill_amount) - 0.01
      THEN 'paid'
      WHEN (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE bill_id = ?) > 0
      THEN 'partial'
      WHEN COALESCE(due_date_override, due_date) < ?
      THEN 'overdue'
      ELSE 'unpaid'
    END WHERE id = ?`,
    params: [billId, billId, today(), billId],
  })
}

export interface UpdatePaymentPatch {
  amount?: number
  /** 还款日期，YYYY-MM-DD 真实日历日 */
  paid_at?: string
  channel?: string | null
  note?: string | null
}

/**
 * 编辑单笔还款记录（spec 13 §6.1「还款记录 update/delete」）。
 *
 * 可改 amount / paid_at / channel / note；改后重算所属账单状态。
 * 金额上限在应用层预检：migrations/d1/0022 的 PAYMENT_EXCEEDS_REMAINING
 * 触发器只挂在 BEFORE INSERT 上，UPDATE 不经过它——这里镜像同一上界
 * （生效金额 + 0.01），超限给可读中文错误而不是裸 ABORT。
 * 不改 idempotency_key（幂等键是原始入账通道的契约，编辑不动它）。
 */
export async function updatePayment(paymentId: string, patch: UpdatePaymentPatch): Promise<Payment> {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new RpcDomainError('VALIDATION_FAILED', '缺少合法的编辑参数')
  }
  const hasAnyField =
    patch.amount !== undefined ||
    patch.paid_at !== undefined ||
    patch.channel !== undefined ||
    patch.note !== undefined
  if (!hasAnyField) {
    throw new RpcDomainError('VALIDATION_FAILED', '没有可更新的字段')
  }

  if (patch.amount !== undefined && (!Number.isFinite(patch.amount) || patch.amount <= 0)) {
    throw new RpcDomainError('VALIDATION_FAILED', '还款金额必须是大于 0 的数字')
  }
  if (
    patch.paid_at !== undefined &&
    (typeof patch.paid_at !== 'string' || !isValidCalendarDate(patch.paid_at))
  ) {
    throw new RpcDomainError('VALIDATION_FAILED', '还款日期必须是 YYYY-MM-DD 格式的真实日历日')
  }
  for (const field of ['channel', 'note'] as const) {
    const value = patch[field]
    if (value !== undefined && value !== null && typeof value !== 'string') {
      throw new RpcDomainError('VALIDATION_FAILED', `还款 ${field} 不合法`)
    }
  }

  const { data: payment, error: payErr } = await queryOne<Payment>(
    'SELECT * FROM payments WHERE id = ?',
    [paymentId]
  )
  if (payErr) throw new Error(payErr.message)
  if (!payment) throw new RpcDomainError('NOT_FOUND', '还款记录不存在')

  const { data: bill, error: billErr } = await queryOne<Bill>(
    'SELECT * FROM bills WHERE id = ?',
    [payment.bill_id]
  )
  if (billErr) throw new Error(billErr.message)
  if (!bill) throw new RpcDomainError('NOT_FOUND', '还款记录所属的账单不存在')

  const nextAmount = patch.amount !== undefined ? patch.amount : payment.amount

  // 生效金额上界镜像 0022 触发器：Σpayments 不得超过 COALESCE(override, bill_amount) + 0.01。
  // 仅在金额实际调大时才可能新触犯上界——存量超缴数据（触发器只挂 BEFORE INSERT，
  // updateBillFields 又允许把金额改到低于已还总额）下，只改备注/渠道/还款日期
  // 甚至原额保存都不应被 CONFLICT 拒绝。
  const effectiveAmount = effectiveBillAmount(bill)
  const { data: totalRow, error: totalErr } = await query<{ total: number | null }>(
    'SELECT SUM(amount) AS total FROM payments WHERE bill_id = ?',
    [payment.bill_id]
  )
  if (totalErr) throw new Error(totalErr.message)
  const otherPaid = Number(totalRow?.[0]?.total ?? 0) - payment.amount
  if (nextAmount > payment.amount) {
    if (otherPaid + nextAmount > effectiveAmount + 0.01) {
      // 本笔可改上限与判定条件同容差（生效金额 + 0.01 − 其他还款合计）
      const maxForThisPayment = Math.max(0, effectiveAmount + 0.01 - otherPaid)
      throw new RpcDomainError(
        'CONFLICT',
        `编辑后金额超过该账单剩余可还额度（本笔最多 ¥${maxForThisPayment.toFixed(2)}）`,
      )
    }
  }

  const statements: { sql: string; params: unknown[] }[] = []
  const sets: string[] = []
  const params: unknown[] = []
  if (patch.amount !== undefined) {
    sets.push('amount = ?')
    params.push(patch.amount)
  }
  if (patch.paid_at !== undefined) {
    sets.push('paid_at = ?')
    params.push(patch.paid_at)
  }
  if (patch.channel !== undefined) {
    sets.push('channel = ?')
    params.push(patch.channel)
  }
  if (patch.note !== undefined) {
    sets.push('note = ?')
    params.push(patch.note)
  }
  statements.push({
    sql: `UPDATE payments SET ${sets.join(', ')} WHERE id = ?`,
    params: [...params, paymentId],
  })
  withRecalcBillStatus(statements, bill.id)

  const { error } = await batch(statements)
  if (error) {
    // 0027 trg_payments_guard_overpay_update 在事务内兜底读取→写入窗口中的并发 INSERT：
    // 若调大本笔金额使事务内 Σpayments 越过生效金额 + 0.01，整批回滚并映射为 409 CONFLICT。
    if (error.message.includes('PAYMENT_EXCEEDS_REMAINING')) {
      throw new RpcDomainError('CONFLICT', '还款金额超过该账单剩余应还，请刷新后重试')
    }
    throw new Error(error.message)
  }

  const updated = await queryOne<Payment>('SELECT * FROM payments WHERE id = ?', [paymentId])
  if (!updated.data) throw new Error('还款记录更新失败')
  return updated.data
}

/**
 * 删除单笔还款记录并重算所属账单状态（状态可从 paid 回退）。
 */
export async function deletePayment(paymentId: string): Promise<{ ok: true }> {
  const { data: payment, error: payErr } = await queryOne<Payment>(
    'SELECT * FROM payments WHERE id = ?',
    [paymentId]
  )
  if (payErr) throw new Error(payErr.message)
  if (!payment) throw new RpcDomainError('NOT_FOUND', '还款记录不存在')

  const { data: bill, error: billErr } = await queryOne<Bill>(
    'SELECT * FROM bills WHERE id = ?',
    [payment.bill_id]
  )
  if (billErr) throw new Error(billErr.message)
  if (!bill) throw new RpcDomainError('NOT_FOUND', '还款记录所属的账单不存在')

  const statements: { sql: string; params: unknown[] }[] = [
    { sql: 'DELETE FROM payments WHERE id = ?', params: [paymentId] },
  ]
  withRecalcBillStatus(statements, bill.id)

  const { error } = await batch(statements)
  if (error) throw new Error(error.message)
  return { ok: true }
}

export async function getPaymentsByHolder(holderId: string): Promise<PaymentWithBill[]> {
  const { data, error } = await query(
    `SELECT p.*,
            b.id AS bill_id, b.card_id, b.bill_month, b.bill_amount, b.min_payment,
            b.due_date, b.status AS bill_status, b.created_at AS bill_created_at,
            cc.id AS cc_id, cc.holder_id, cc.card_product_id,
            cc.name_override AS cc_name_override,
            cp.bank_name, cp.card_name, cp.currency
     FROM payments p
     JOIN bills b ON p.bill_id = b.id
     JOIN credit_cards cc ON b.card_id = cc.id
     JOIN card_products cp ON cc.card_product_id = cp.id
     WHERE cc.holder_id = ?
     ORDER BY p.paid_at DESC`,
    [holderId]
  )
  if (error) throw new Error(error.message)
  return (data || []).map((row: Record<string, unknown>) => ({
    ...row,
    bill: {
      id: row.bill_id,
      card_id: row.card_id,
      bill_month: row.bill_month,
      bill_amount: row.bill_amount,
      min_payment: row.min_payment,
      due_date: row.due_date,
      status: row.bill_status,
      created_at: row.bill_created_at,
      credit_cards: {
        id: row.cc_id,
        holder_id: row.holder_id,
        card_product_id: row.card_product_id,
        // 与 lib/api/bills.server.ts 的 withCreditCardProductFields 保持同一优先级：
        // 卡级别覆盖 > 卡产品默认名称。导出的「卡片」列读的就是这里的顶层 card_name。
        name_override: row.cc_name_override ?? undefined,
        card_name: (row.cc_name_override as string) || (row.card_name as string) || undefined,
        card_product: {
          bank_name: row.bank_name,
          card_name: row.card_name,
        },
      },
    },
  })) as unknown as PaymentWithBill[]
}
