// lib/api/payments.ts
import { query, queryOne, execute, uuid } from '../db'
import type { Payment } from '../types'
import type { PaymentWithBill } from './bills.server'
import { generateIdempotencyKey } from '../utils'

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
 * 根据还款记录计算账单已还金额，并更新账单状态
 */
export async function recalcBillStatus(billId: string, billAmount: number): Promise<void> {
  const payments = await getPaymentsByBill(billId)
  const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0)
  let status: 'unpaid' | 'partial' | 'paid'
  if (totalPaid >= billAmount) status = 'paid'
  else if (totalPaid > 0) status = 'partial'
  else status = 'unpaid'
  const { error } = await execute('UPDATE bills SET status = ? WHERE id = ?', [status, billId])
  if (error) throw new Error(error.message)
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
