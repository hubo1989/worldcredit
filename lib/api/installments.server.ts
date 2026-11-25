// lib/api/installments.server.ts — 信用卡分期计划 CRUD（0041 `installment_plans`）。
//
// 权限在 registry 的 memberGuard 里做（assertCardAccess / assertInstallmentAccess），
// 本文件只负责业务校验与落库；所有金额口径来自 direction3.shared 的纯摊销函数。

import { query, queryOne, execute, batch, uuid } from '../db'
import { isValidCalendarDate } from '../utils'
import { RpcDomainError } from './errors'
import { isValidPayablePeriod } from './payables.shared'
import {
  generateInstallmentSchedule,
  nextInstallmentPeriod,
  remainingInstallmentPrincipal,
  round2,
  type InstallmentPlanLike,
} from './direction3.shared'

export const INSTALLMENT_PLAN_TYPES = ['purchase', 'bill', 'cash'] as const
export type InstallmentPlanType = (typeof INSTALLMENT_PLAN_TYPES)[number]

export const INSTALLMENT_FEE_MODES = [
  'interest_free',
  'equal_principal_fee',
  'equal_installment_apr',
] as const
export type InstallmentFeeMode = (typeof INSTALLMENT_FEE_MODES)[number]

export const INSTALLMENT_BILLING_MODES = ['included_in_statement', 'independent'] as const
export type InstallmentBillingMode = (typeof INSTALLMENT_BILLING_MODES)[number]

export interface InstallmentPlan {
  id: string
  card_id: string
  source_bill_id: string | null
  source_item_id: string | null
  title: string
  plan_type: InstallmentPlanType
  currency: string
  principal_amount: number
  total_periods: number
  paid_periods: number
  fee_mode: InstallmentFeeMode
  fee_charge_mode: 'per_period' | 'upfront'
  fee_rate_per_period: number | null
  custom_period_fee: number | null
  apr: number | null
  start_month: string
  due_day: number
  due_month_offset: number
  billing_mode: InstallmentBillingMode
  status: 'active' | 'completed' | 'early_settled' | 'cancelled'
  early_settled_at: string | null
  early_settled_amount: number | null
  note: string | null
  created_at: string
  updated_at: string
}

export interface InstallmentPlanWithSummary extends InstallmentPlan {
  remaining_periods: number
  remaining_principal: number
  next_due_date: string | null
  next_amount: number | null
}

export interface CreateInstallmentInput {
  card_id: string
  source_bill_id?: string | null
  source_item_id?: string | null
  title: string
  plan_type?: InstallmentPlanType
  currency?: string
  principal_amount: number
  total_periods: number
  fee_mode?: InstallmentFeeMode
  fee_charge_mode?: 'per_period' | 'upfront'
  fee_rate_per_period?: number | null
  custom_period_fee?: number | null
  apr?: number | null
  start_month: string
  due_day: number
  due_month_offset?: number
  billing_mode?: InstallmentBillingMode
  note?: string | null
}

export interface UpdateInstallmentPatch {
  title?: string
  note?: string | null
  plan_type?: InstallmentPlanType
  due_day?: number
  billing_mode?: InstallmentBillingMode
  fee_rate_per_period?: number | null
  custom_period_fee?: number | null
}

export interface InstallmentFilters {
  holder_id?: string
  card_id?: string
  status?: string
}

const CURRENCY_RE = /^[A-Za-z]{3}$/

function assertString(value: unknown, label: string, maxLength = 200): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new RpcDomainError('VALIDATION_FAILED', `${label}不能为空`)
  }
  const trimmed = value.trim()
  if (trimmed.length > maxLength) {
    throw new RpcDomainError('VALIDATION_FAILED', `${label}长度不能超过 ${maxLength} 个字符`)
  }
  return trimmed
}

function assertPositive(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new RpcDomainError('VALIDATION_FAILED', `${label}必须是大于 0 的数字`)
  }
  return value
}

function assertOptionalNonNegative(value: unknown, label: string): number | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new RpcDomainError('VALIDATION_FAILED', `${label}必须是不小于 0 的数字`)
  }
  return value
}

function assertEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new RpcDomainError('VALIDATION_FAILED', `${label}不合法`)
  }
  return value as T
}

function toSummary(plan: InstallmentPlan): InstallmentPlanWithSummary {
  const next = nextInstallmentPeriod(plan)
  return {
    ...plan,
    remaining_periods: Math.max(0, plan.total_periods - plan.paid_periods),
    remaining_principal: round2(remainingInstallmentPrincipal(plan as InstallmentPlanLike)),
    next_due_date: next?.due_date ?? null,
    next_amount: next ? round2(next.total) : null,
  }
}

export async function getInstallmentPlans(
  filters: InstallmentFilters = {},
): Promise<InstallmentPlanWithSummary[]> {
  const conditions: string[] = []
  const params: unknown[] = []
  if (filters.card_id) {
    conditions.push('ip.card_id = ?')
    params.push(filters.card_id)
  }
  if (filters.status) {
    conditions.push('ip.status = ?')
    params.push(filters.status)
  }
  const holderClause = filters.holder_id ? ' AND cc.holder_id = ?' : ''
  if (filters.holder_id) params.push(filters.holder_id)
  const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : ''
  const { data, error } = await query<InstallmentPlan>(
    `SELECT ip.* FROM installment_plans ip
     JOIN credit_cards cc ON cc.id = ip.card_id
     ${where}${holderClause}
     ORDER BY ip.start_month DESC, ip.created_at DESC`,
    params,
  )
  if (error) throw new Error(error.message)
  return (data || []).map(toSummary)
}

async function loadPlan(planId: string): Promise<InstallmentPlan> {
  if (typeof planId !== 'string' || !planId.trim()) {
    throw new RpcDomainError('VALIDATION_FAILED', '缺少合法的分期计划 ID')
  }
  const { data, error } = await queryOne<InstallmentPlan>(
    'SELECT * FROM installment_plans WHERE id = ?',
    [planId],
  )
  if (error) throw new Error(error.message)
  if (!data) throw new RpcDomainError('NOT_FOUND', '分期计划不存在')
  return data
}

export async function createInstallmentPlan(
  input: CreateInstallmentInput,
): Promise<InstallmentPlanWithSummary> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new RpcDomainError('VALIDATION_FAILED', '缺少合法的分期参数')
  }
  const cardId = assertString(input.card_id, '卡片 ID', 64)
  const title = assertString(input.title, '分期标题', 120)
  const principal = assertPositive(input.principal_amount, '分期本金')
  const totalPeriods = input.total_periods
  if (
    typeof totalPeriods !== 'number' ||
    !Number.isInteger(totalPeriods) ||
    totalPeriods < 2 ||
    totalPeriods > 60
  ) {
    throw new RpcDomainError('VALIDATION_FAILED', '分期期数必须是 2–60 之间的整数')
  }
  if (!isValidPayablePeriod(input.start_month)) {
    throw new RpcDomainError('VALIDATION_FAILED', '分期起始账期必须是 YYYY-MM')
  }
  if (
    typeof input.due_day !== 'number' ||
    !Number.isInteger(input.due_day) ||
    input.due_day < 1 ||
    input.due_day > 31
  ) {
    throw new RpcDomainError('VALIDATION_FAILED', '还款日必须是 1–31 之间的整数')
  }
  const currency =
    typeof input.currency === 'string' && CURRENCY_RE.test(input.currency.trim())
      ? input.currency.trim().toUpperCase()
      : 'CNY'
  const planType = assertEnum(input.plan_type ?? 'purchase', INSTALLMENT_PLAN_TYPES, '分期类型')
  const feeMode = assertEnum(
    input.fee_mode ?? 'equal_principal_fee',
    INSTALLMENT_FEE_MODES,
    '手续费模式',
  )
  const feeChargeMode =
    input.fee_charge_mode === 'upfront' ? 'upfront' : ('per_period' as const)
  const billingMode = assertEnum(
    input.billing_mode ?? 'included_in_statement',
    INSTALLMENT_BILLING_MODES,
    '入账模式',
  )
  const feeRate = assertOptionalNonNegative(input.fee_rate_per_period, '每期手续费率')
  const customFee = assertOptionalNonNegative(input.custom_period_fee, '每期手续费')
  const apr = assertOptionalNonNegative(input.apr, '年化利率')
  if (apr !== null && apr > 1) {
    throw new RpcDomainError('VALIDATION_FAILED', '年化利率必须是小数（如 0.18 表示 18%）')
  }
  const dueMonthOffset =
    input.due_month_offset === 1 ? 1 : (0 as 0 | 1)

  const { data: card, error: cardError } = await queryOne<{ id: string; currency: string | null }>(
    `SELECT cc.id, cp.currency FROM credit_cards cc
     LEFT JOIN card_products cp ON cc.card_product_id = cp.id
     WHERE cc.id = ?`,
    [cardId],
  )
  if (cardError) throw new Error(cardError.message)
  if (!card) throw new RpcDomainError('NOT_FOUND', '卡片不存在')

  const id = uuid()
  const now = new Date().toISOString()
  const { error } = await execute(
    `INSERT INTO installment_plans (
       id, card_id, source_bill_id, source_item_id, title, plan_type, currency,
       principal_amount, total_periods, paid_periods, fee_mode, fee_charge_mode,
       fee_rate_per_period, custom_period_fee, apr, start_month, due_day,
       due_month_offset, billing_mode, status, note, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
    [
      id,
      cardId,
      input.source_bill_id ?? null,
      input.source_item_id ?? null,
      title,
      planType,
      currency || card.currency || 'CNY',
      round2(principal),
      totalPeriods,
      feeMode,
      feeChargeMode,
      feeRate,
      customFee,
      apr,
      input.start_month,
      input.due_day,
      dueMonthOffset,
      billingMode,
      input.note ?? null,
      now,
      now,
    ],
  )
  if (error) throw new Error(error.message)
  return toSummary(await loadPlan(id))
}

export async function updateInstallmentPlan(
  planId: string,
  patch: UpdateInstallmentPatch,
): Promise<InstallmentPlanWithSummary> {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new RpcDomainError('VALIDATION_FAILED', '缺少合法的编辑参数')
  }
  const plan = await loadPlan(planId)
  const sets: string[] = []
  const params: unknown[] = []

  if (patch.title !== undefined) {
    sets.push('title = ?')
    params.push(assertString(patch.title, '分期标题', 120))
  }
  if (patch.note !== undefined) {
    if (patch.note !== null && typeof patch.note !== 'string') {
      throw new RpcDomainError('VALIDATION_FAILED', '备注不合法')
    }
    sets.push('note = ?')
    params.push(patch.note)
  }
  if (patch.plan_type !== undefined) {
    sets.push('plan_type = ?')
    params.push(assertEnum(patch.plan_type, INSTALLMENT_PLAN_TYPES, '分期类型'))
  }
  if (patch.due_day !== undefined) {
    if (
      typeof patch.due_day !== 'number' ||
      !Number.isInteger(patch.due_day) ||
      patch.due_day < 1 ||
      patch.due_day > 31
    ) {
      throw new RpcDomainError('VALIDATION_FAILED', '还款日必须是 1–31 之间的整数')
    }
    sets.push('due_day = ?')
    params.push(patch.due_day)
  }
  if (patch.billing_mode !== undefined) {
    sets.push('billing_mode = ?')
    params.push(assertEnum(patch.billing_mode, INSTALLMENT_BILLING_MODES, '入账模式'))
  }
  if (patch.fee_rate_per_period !== undefined) {
    sets.push('fee_rate_per_period = ?')
    params.push(assertOptionalNonNegative(patch.fee_rate_per_period, '每期手续费率'))
  }
  if (patch.custom_period_fee !== undefined) {
    sets.push('custom_period_fee = ?')
    params.push(assertOptionalNonNegative(patch.custom_period_fee, '每期手续费'))
  }

  if (sets.length === 0) {
    throw new RpcDomainError('VALIDATION_FAILED', '没有可更新的字段')
  }
  sets.push('updated_at = ?')
  params.push(new Date().toISOString(), plan.id)
  const { error } = await execute(
    `UPDATE installment_plans SET ${sets.join(', ')} WHERE id = ?`,
    params,
  )
  if (error) throw new Error(error.message)
  return toSummary(await loadPlan(plan.id))
}

/** 期次推进（+1 已还一期 / -1 回退一期），越界钳制；还清自动置 completed。 */
export async function advanceInstallmentPeriod(
  planId: string,
  delta: 1 | -1,
): Promise<InstallmentPlanWithSummary> {
  if (delta !== 1 && delta !== -1) {
    throw new RpcDomainError('VALIDATION_FAILED', '期次调整只支持 +1 或 -1')
  }
  const plan = await loadPlan(planId)
  if (plan.status !== 'active' && plan.status !== 'completed') {
    throw new RpcDomainError('CONFLICT', '仅进行中或已完成的分期可调整期次')
  }
  const nextPaid = Math.min(plan.total_periods, Math.max(0, plan.paid_periods + delta))
  const nextStatus: InstallmentPlan['status'] =
    nextPaid >= plan.total_periods ? 'completed' : 'active'
  const { error } = await batch([
    {
      sql: `UPDATE installment_plans
            SET paid_periods = ?, status = ?, updated_at = ?
            WHERE id = ?`,
      params: [nextPaid, nextStatus, new Date().toISOString(), plan.id],
    },
  ])
  if (error) throw new Error(error.message)
  return toSummary(await loadPlan(plan.id))
}

/** 提前结清：剩余期次一次性标记为已结清，记录结清时间与金额。 */
export async function settleInstallmentEarly(
  planId: string,
  input: { settled_at: string; settled_amount: number },
): Promise<InstallmentPlanWithSummary> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new RpcDomainError('VALIDATION_FAILED', '缺少合法的结清参数')
  }
  if (typeof input.settled_at !== 'string' || !isValidCalendarDate(input.settled_at)) {
    throw new RpcDomainError('VALIDATION_FAILED', '结清日期必须是 YYYY-MM-DD 格式的真实日历日')
  }
  const settledAmount = assertPositive(input.settled_amount, '结清金额')
  const plan = await loadPlan(planId)
  if (plan.status === 'early_settled' || plan.status === 'cancelled') {
    throw new RpcDomainError('CONFLICT', '该分期计划已结清或已取消')
  }
  const { error } = await batch([
    {
      sql: `UPDATE installment_plans
            SET status = 'early_settled', paid_periods = total_periods,
                early_settled_at = ?, early_settled_amount = ?, updated_at = ?
            WHERE id = ?`,
      params: [input.settled_at, round2(settledAmount), new Date().toISOString(), plan.id],
    },
  ])
  if (error) throw new Error(error.message)
  return toSummary(await loadPlan(plan.id))
}

export async function deleteInstallmentPlan(planId: string): Promise<{ ok: true }> {
  const plan = await loadPlan(planId)
  const { error } = await execute('DELETE FROM installment_plans WHERE id = ?', [plan.id])
  if (error) throw new Error(error.message)
  return { ok: true }
}

/** 摊销表（供账单详情/分期管理 UI 直接展示，纯计算不落库）。 */
export async function getInstallmentSchedule(
  planId: string,
): Promise<ReturnType<typeof generateInstallmentSchedule>> {
  const plan = await loadPlan(planId)
  return generateInstallmentSchedule(plan as InstallmentPlanLike)
}
