// lib/api/payables.server.ts — 周期性固定支出（房租 / 贷款 / 其他周期应付）。
//
// 与信用卡账单分开建模：房租不是卡账，混进 credit_cards 会污染卡数、额度、
// 免息期等所有口径（见 migrations/d1/0009 的说明）。

import { query, queryOne, execute, uuid, now } from '../db'
import { payablePeriodOf, payableDueDate, nextPayablePeriodOf, diffInCalendarDays } from '../utils'
import {
  CUSTOM_CATEGORY_SENTINEL,
  MAX_CUSTOM_CATEGORY_LENGTH,
  PAYABLE_HISTORY_LIMIT,
  dedupeCustomCategories,
  isPayableCategory,
  isPayableCycleType,
  isValidEveryNMonths,
  isValidPayablePeriod,
  normalizeCustomCategoryName,
  normalizePayableCurrency,
  resolvePresetPayableCategory,
  type PayableCategory,
  type PayableCycleType,
} from './payables.shared'
import { RpcDomainError } from './errors'

export type { PayableCategory, PayableCycleType } from './payables.shared'

export interface RecurringPayable {
  id: string
  created_by: string
  name: string
  category: PayableCategory
  /** 自定义分类展示名；预设分类时为 null（保留 category='other' 以兼容旧版与 iOS 枚举） */
  custom_category?: string | null
  amount: number
  currency: string
  /** 支出周期：monthly（默认） / every_n_months / yearly */
  cycle_type?: PayableCycleType
  /** 周期步长（月）：monthly=1，every_n_months=2..60，yearly=12 */
  cycle_months?: number
  /** 每年应付月份（1–12）；仅 cycle_type='yearly' 时有值 */
  due_month?: number | null
  due_day: number
  /** 起算/锚点账期 'YYYY-MM'；monthly 为 null */
  anchor_period?: string | null
  holder_id: string | null
  note: string | null
  /** 归属银行名称（选填；null = 非银行，筛选时单列一个桶） */
  bank_name?: string | null
  /** 还款/转账目标银行账号（选填，展示层一键复制） */
  bank_account?: string | null
  is_active: number
  created_at: string
}

export interface RecurringPayableInput {
  name: string
  category: PayableCategory
  custom_category?: string | null
  amount: number
  currency: string
  cycle_type?: PayableCycleType
  cycle_months?: number | null
  due_month?: number | null
  due_day: number
  anchor_period?: string | null
  holder_id?: string | null
  note?: string | null
  bank_name?: string | null
  bank_account?: string | null
}

/** 创建入参：created_by 由客户端带上、服务端按会话覆盖（与 createHolder 同约定）。 */
export type CreateRecurringPayableInput = RecurringPayableInput & { created_by: string }

/** 列表项：应付事项 + 当期状态，供账单页直接渲染。 */
export interface PayableWithStatus extends RecurringPayable {
  /** 当前账期 'YYYY-MM' */
  period: string
  /** 当期到期日 'YYYY-MM-DD' */
  due_date: string
  /** 距到期天数（负数 = 已逾期） */
  days_until_due: number
  /** 当期已登记金额（未登记为 0） */
  paid_amount: number
  /** 状态：待付 / 已付 / 逾期 */
  status: 'unpaid' | 'paid' | 'overdue'
}

/** 某个应付事项在指定账期的付款金额（没有则 0）。 */
async function paidAmountFor(payableId: string, period: string): Promise<number> {
  const { data } = await queryOne<{ total: number | null }>(
    'SELECT SUM(amount) AS total FROM recurring_payable_payments WHERE payable_id = ? AND period = ?',
    [payableId, period]
  )
  return Number(data?.total ?? 0)
}

/**
 * 把一条应付记录合成为「带当期状态」的展示对象。
 *
 * 状态判定与 computeStatus 同口径：到期日当天不算逾期（days = 0 仍算待付）。
 */
function withStatus(
  row: RecurringPayable,
  period: string,
  paidAmount: number,
  today: Date
): PayableWithStatus {
  const dueDate = payableDueDate(row.due_day, period)
  const dueDateStr = `${dueDate.getFullYear()}-${String(dueDate.getMonth() + 1).padStart(2, '0')}-${String(dueDate.getDate()).padStart(2, '0')}`
  const daysUntilDue = diffInCalendarDays(dueDateStr, today)
  const amount = Number(row.amount) || 0
  let status: PayableWithStatus['status'] = 'unpaid'
  if (amount > 0 && paidAmount >= amount - 0.01) status = 'paid'
  else if (daysUntilDue < 0) status = 'overdue'
  return {
    ...row,
    cycle_type: row.cycle_type ?? 'monthly',
    cycle_months: row.cycle_months ?? 1,
    due_month: row.due_month ?? null,
    anchor_period: row.anchor_period ?? null,
    custom_category: row.custom_category ?? null,
    amount,
    period,
    due_date: dueDateStr,
    days_until_due: daysUntilDue,
    paid_amount: paidAmount,
    status,
  }
}

/**
 * 展示期解析（2026-10-21 滚动规则）：本期已付清且距下期应付日不足 30 天时，
 * 展示期滚动到下期——卡片转为「待还款」，可以直接对下期登记付款，不再出现
 * 「已进入应付窗口却显示已登记」的矛盾。
 *
 * 滚动以本期付清为前提：本期未付清（含逾期）时绝不滚动，否则下期临近
 * （如应付日 5 号、今天 10 号，下期只剩 26 天）会把当前逾期掩盖成待还款。
 * 列表展示与付款登记必须共用此函数，保证登记写进的账期与用户看到的账期一致。
 */
/** 导出仅供测试：滚动规则的核心判定。 */
export async function resolveDisplayPeriod(
  row: RecurringPayable,
  today: Date
): Promise<{ period: string; paidAmount: number }> {
  const current = payablePeriodOf(today, row)
  const amount = Number(row.amount) || 0
  const paidCurrent = await paidAmountFor(row.id, current)
  const settled = amount > 0 && paidCurrent >= amount - 0.01
  const nextPeriod = nextPayablePeriodOf(current, row)
  const nextDue = payableDueDate(row.due_day, nextPeriod)
  if (settled && diffInCalendarDays(nextDue, today) < 30) {
    // 滚动到下期：该期此前不可能有付款记录，已付金额为 0
    return { period: nextPeriod, paidAmount: 0 }
  }
  return { period: current, paidAmount: paidCurrent }
}

export interface PayablePaymentRecord {
  id: string
  payable_id: string
  period: string
  amount: number
  paid_at: string
  note: string | null
  created_at: string
}

/** 某个固定支出的历史还款记录（按账期倒序，同期按登记时间倒序）。 */
export async function getPayablePayments(payableId: string): Promise<PayablePaymentRecord[]> {
  if (typeof payableId !== 'string' || !payableId.trim()) {
    throw new RpcDomainError('VALIDATION_FAILED', '缺少合法的固定支出 ID')
  }
  const { data, error } = await query<PayablePaymentRecord>(
    `SELECT id, payable_id, period, amount, paid_at, note, created_at
     FROM recurring_payable_payments
     WHERE payable_id = ?
     ORDER BY period DESC, created_at DESC
     LIMIT ?`,
    [payableId, PAYABLE_HISTORY_LIMIT]
  )
  if (error) throw new Error(error.message)
  return data ?? []
}

/** 账单页用：当前生效的应付事项 + 当期状态。 */
export async function getRecurringPayables(
  userId: string,
  today: Date = new Date()
): Promise<PayableWithStatus[]> {
  const effectiveToday = today instanceof Date ? today : new Date()
  const { data, error } = await query<RecurringPayable>(
    'SELECT * FROM recurring_payables WHERE created_by = ? AND is_active = 1 ORDER BY due_day ASC',
    [userId]
  )
  if (error) throw new Error(error.message)
  const rows = data || []
  if (rows.length === 0) return []

  return Promise.all(
    rows.map(async row => {
      const { period, paidAmount } = await resolveDisplayPeriod(row, effectiveToday)
      return withStatus(row, period, paidAmount, effectiveToday)
    })
  )
}

/** 归属银行：trim 后空串归一为 null（= 非银行）；不做白名单，银行可被重命名。 */
function normalizePayableBankName(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') {
    throw new RpcDomainError('VALIDATION_FAILED', '银行名称不合法')
  }
  const trimmed = value.trim()
  if (!trimmed) return null
  if (trimmed.length > 60) {
    throw new RpcDomainError('VALIDATION_FAILED', '银行名称过长')
  }
  return trimmed
}

interface NormalizedCategoryResult {
  category: PayableCategory
  custom_category: string | null
  shouldPersistCustom: boolean
}

function normalizePayableCategorySelection(
  rawCategory: unknown,
  rawCustomCategory: unknown
): NormalizedCategoryResult {
  if (rawCustomCategory !== undefined && rawCustomCategory !== null) {
    if (typeof rawCustomCategory !== 'string') {
      throw new RpcDomainError('VALIDATION_FAILED', '自定义分类名称不合法')
    }
    const normalizedCustom = normalizeCustomCategoryName(rawCustomCategory)
    if (normalizedCustom !== null) {
      if (normalizedCustom.length > MAX_CUSTOM_CATEGORY_LENGTH) {
        throw new RpcDomainError(
          'VALIDATION_FAILED',
          `自定义分类名称不能超过 ${MAX_CUSTOM_CATEGORY_LENGTH} 个字符`
        )
      }
      const matchedPreset = resolvePresetPayableCategory(normalizedCustom)
      if (matchedPreset) {
        return { category: matchedPreset, custom_category: null, shouldPersistCustom: false }
      }
      return { category: 'other', custom_category: normalizedCustom, shouldPersistCustom: true }
    }
    if (rawCategory === CUSTOM_CATEGORY_SENTINEL) {
      throw new RpcDomainError('VALIDATION_FAILED', '请填写自定义分类名称')
    }
  } else if (rawCategory === CUSTOM_CATEGORY_SENTINEL) {
    throw new RpcDomainError('VALIDATION_FAILED', '请填写自定义分类名称')
  }

  if (!isPayableCategory(rawCategory)) {
    throw new RpcDomainError('VALIDATION_FAILED', '请选择合法的支出分类')
  }
  return { category: rawCategory, custom_category: null, shouldPersistCustom: false }
}

interface NormalizedCycleResult {
  cycle_type: PayableCycleType
  cycle_months: number
  due_month: number | null
  due_day: number
  anchor_period: string | null
}

function normalizePayableCycleSelection(
  raw: {
    cycle_type?: unknown
    cycle_months?: unknown
    due_month?: unknown
    due_day: unknown
    anchor_period?: unknown
  },
  today: Date
): NormalizedCycleResult {
  if (
    typeof raw.due_day !== 'number' ||
    !Number.isInteger(raw.due_day) ||
    raw.due_day < 1 ||
    raw.due_day > 31
  ) {
    throw new RpcDomainError('VALIDATION_FAILED', '应付日必须在 1–31 之间')
  }
  const dueDay = raw.due_day

  const rawType = raw.cycle_type ?? 'monthly'
  if (!isPayableCycleType(rawType)) {
    throw new RpcDomainError('VALIDATION_FAILED', '支出周期必须是每月、每 X 月或每年之一')
  }

  if (rawType === 'monthly') {
    return {
      cycle_type: 'monthly',
      cycle_months: 1,
      due_month: null,
      due_day: dueDay,
      anchor_period: null,
    }
  }

  if (rawType === 'every_n_months') {
    if (!isValidEveryNMonths(raw.cycle_months)) {
      throw new RpcDomainError('VALIDATION_FAILED', '间隔月数必须是 2–60 之间的整数')
    }
    let anchorPeriod: string
    if (
      raw.anchor_period === undefined ||
      raw.anchor_period === null ||
      (typeof raw.anchor_period === 'string' && raw.anchor_period.trim() === '')
    ) {
      anchorPeriod = payablePeriodOf(today)
    } else if (!isValidPayablePeriod(raw.anchor_period)) {
      throw new RpcDomainError('VALIDATION_FAILED', '起算月份格式必须为 YYYY-MM')
    } else {
      anchorPeriod = raw.anchor_period.trim()
    }
    return {
      cycle_type: 'every_n_months',
      cycle_months: raw.cycle_months,
      due_month: null,
      due_day: dueDay,
      anchor_period: anchorPeriod,
    }
  }

  // yearly：每年按同月同日推导
  if (
    typeof raw.due_month !== 'number' ||
    !Number.isInteger(raw.due_month) ||
    raw.due_month < 1 ||
    raw.due_month > 12
  ) {
    throw new RpcDomainError('VALIDATION_FAILED', '每年应付月份必须是 1–12 之间的整数')
  }
  const dueMonth = raw.due_month
  let anchorPeriod: string
  if (
    raw.anchor_period !== undefined &&
    raw.anchor_period !== null &&
    !(typeof raw.anchor_period === 'string' && raw.anchor_period.trim() === '')
  ) {
    if (!isValidPayablePeriod(raw.anchor_period)) {
      throw new RpcDomainError('VALIDATION_FAILED', '起算月份格式必须为 YYYY-MM')
    }
    const trimmedAnchor = raw.anchor_period.trim()
    if (Number(trimmedAnchor.slice(5, 7)) !== dueMonth) {
      throw new RpcDomainError('VALIDATION_FAILED', '起算月份必须与每年应付月份一致')
    }
    anchorPeriod = trimmedAnchor
  } else {
    const candidatePeriod = `${today.getFullYear()}-${String(dueMonth).padStart(2, '0')}`
    const candidateDue = payableDueDate(dueDay, candidatePeriod)
    const anchorYear =
      diffInCalendarDays(candidateDue, today) >= 0
        ? today.getFullYear()
        : today.getFullYear() + 1
    anchorPeriod = `${anchorYear}-${String(dueMonth).padStart(2, '0')}`
  }

  return {
    cycle_type: 'yearly',
    cycle_months: 12,
    due_month: dueMonth,
    due_day: dueDay,
    anchor_period: anchorPeriod,
  }
}

/**
 * 将自定义分类幂等去重持久化到用户词典表，并返回标准展示名称
 * （若已有大小写不同但同名的词条，沿用首次保存的展示名）。
 */
async function persistCustomCategoryForUser(userId: string, name: string): Promise<string> {
  const normalized = normalizeCustomCategoryName(name)
  if (!normalized) return name
  const normKey = normalized.toLowerCase()
  const existing = await queryOne<{ name: string }>(
    'SELECT name FROM payable_custom_categories WHERE user_id = ? AND normalized_name = ?',
    [userId, normKey]
  )
  if (existing.data?.name) {
    return existing.data.name
  }
  const { error } = await execute(
    `INSERT INTO payable_custom_categories (id, user_id, name, normalized_name, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, normalized_name) DO NOTHING`,
    [uuid(), userId, normalized, normKey, now()]
  )
  if (error) throw new Error(error.message)
  const after = await queryOne<{ name: string }>(
    'SELECT name FROM payable_custom_categories WHERE user_id = ? AND normalized_name = ?',
    [userId, normKey]
  )
  return after.data?.name ?? normalized
}

/** 读取当前用户已持久化的自定义分类列表（去重、排除预设同名项）。 */
export async function getPayableCustomCategories(userId?: string): Promise<string[]> {
  if (typeof userId !== 'string' || !userId.trim()) {
    throw new RpcDomainError('VALIDATION_FAILED', '缺少合法的用户身份')
  }
  const [dictRes, usedRes] = await Promise.all([
    query<{ name: string }>(
      'SELECT name FROM payable_custom_categories WHERE user_id = ? ORDER BY created_at ASC, rowid ASC',
      [userId]
    ),
    query<{ name: string }>(
      `SELECT custom_category AS name
       FROM recurring_payables
       WHERE created_by = ? AND custom_category IS NOT NULL
       ORDER BY created_at ASC, rowid ASC`,
      [userId]
    ),
  ])
  if (dictRes.error) throw new Error(dictRes.error.message)
  if (usedRes.error) throw new Error(usedRes.error.message)
  return dedupeCustomCategories([
    ...(dictRes.data ?? []).map(r => r.name),
    ...(usedRes.data ?? []).map(r => r.name),
  ])
}

/** 单独保存一个自定义分类（幂等去重）并返回最新可选列表。 */
export async function savePayableCustomCategory(
  userId: string,
  rawName: string
): Promise<string[]> {
  if (typeof userId !== 'string' || !userId.trim()) {
    throw new RpcDomainError('VALIDATION_FAILED', '缺少合法的用户身份')
  }
  const resolved = normalizePayableCategorySelection(CUSTOM_CATEGORY_SENTINEL, rawName)
  if (resolved.shouldPersistCustom && resolved.custom_category) {
    await persistCustomCategoryForUser(userId, resolved.custom_category)
  }
  return getPayableCustomCategories(userId)
}

export async function createRecurringPayable(
  input: CreateRecurringPayableInput,
  today: Date = new Date()
): Promise<PayableWithStatus> {
  const effectiveToday = today instanceof Date ? today : new Date()
  if (!input.name?.trim()) throw new RpcDomainError('VALIDATION_FAILED', '请填写名称')
  if (!Number.isFinite(input.amount) || input.amount < 0) {
    throw new RpcDomainError('VALIDATION_FAILED', '金额必须是不小于 0 的数字')
  }
  const cycle = normalizePayableCycleSelection(
    {
      cycle_type: input.cycle_type,
      cycle_months: input.cycle_months,
      due_month: input.due_month,
      due_day: input.due_day,
      anchor_period: input.anchor_period,
    },
    effectiveToday
  )
  const currency = normalizePayableCurrency(input.currency)
  if (!currency) throw new RpcDomainError('VALIDATION_FAILED', '币种必须是 CNY / USD / HKD 之一')
  const bankName = normalizePayableBankName(input.bank_name)
  const categorySelection = normalizePayableCategorySelection(input.category, input.custom_category)

  let customCategory = categorySelection.custom_category
  if (categorySelection.shouldPersistCustom && customCategory && input.created_by) {
    customCategory = await persistCustomCategoryForUser(input.created_by, customCategory)
  }

  const id = uuid()
  const { error } = await execute(
    `INSERT INTO recurring_payables (
       id, created_by, name, category, custom_category, amount, currency,
       cycle_type, cycle_months, due_month, due_day, anchor_period,
       holder_id, note, bank_name, bank_account, is_active, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    [
      id,
      input.created_by,
      input.name.trim(),
      categorySelection.category,
      customCategory,
      input.amount,
      currency,
      cycle.cycle_type,
      cycle.cycle_months,
      cycle.due_month,
      cycle.due_day,
      cycle.anchor_period,
      input.holder_id || null,
      input.note || null,
      bankName,
      input.bank_account?.trim() || null,
      now(),
    ]
  )
  if (error) throw new Error(error.message)
  const created = await queryOne<RecurringPayable>('SELECT * FROM recurring_payables WHERE id = ?', [id])
  if (!created.data) throw new Error('创建失败')
  const { period, paidAmount } = await resolveDisplayPeriod(created.data, effectiveToday)
  return withStatus(created.data, period, paidAmount, effectiveToday)
}

export async function updateRecurringPayable(
  id: string,
  patch: Partial<RecurringPayableInput> & { is_active?: number },
  today: Date = new Date()
): Promise<PayableWithStatus> {
  const effectiveToday = today instanceof Date ? today : new Date()
  if (patch.name !== undefined && !patch.name?.trim()) {
    throw new RpcDomainError('VALIDATION_FAILED', '请填写名称')
  }
  if (patch.amount !== undefined && (!Number.isFinite(patch.amount) || patch.amount < 0)) {
    throw new RpcDomainError('VALIDATION_FAILED', '金额必须是不小于 0 的数字')
  }
  if (patch.currency !== undefined) {
    const currency = normalizePayableCurrency(patch.currency)
    if (!currency) throw new RpcDomainError('VALIDATION_FAILED', '币种必须是 CNY / USD / HKD 之一')
    patch = { ...patch, currency }
  }
  if (patch.bank_name !== undefined) {
    patch = { ...patch, bank_name: normalizePayableBankName(patch.bank_name) }
  }

  const existing = await queryOne<RecurringPayable>('SELECT * FROM recurring_payables WHERE id = ?', [id])
  if (!existing.data) throw new RpcDomainError('NOT_FOUND', '应付事项不存在')

  const updates: Record<string, unknown> = {}
  if (patch.name !== undefined) updates.name = patch.name.trim()
  if (patch.amount !== undefined) updates.amount = patch.amount
  if (patch.currency !== undefined) updates.currency = patch.currency
  if (patch.holder_id !== undefined) updates.holder_id = patch.holder_id || null
  if (patch.note !== undefined) updates.note = patch.note
  if (patch.bank_name !== undefined) updates.bank_name = patch.bank_name
  if (patch.bank_account !== undefined) updates.bank_account = patch.bank_account?.trim() || null
  if (patch.is_active !== undefined) updates.is_active = patch.is_active

  // 触及分类或自定义分类时联合归一，避免切换回预设分类后残留旧 custom_category
  if (patch.category !== undefined || patch.custom_category !== undefined) {
    const rawCat = patch.category ?? existing.data.category
    const rawCustom =
      patch.custom_category !== undefined
        ? patch.custom_category
        : patch.category !== undefined
          ? null
          : existing.data.custom_category
    const categorySelection = normalizePayableCategorySelection(rawCat, rawCustom)
    let customCategory = categorySelection.custom_category
    if (categorySelection.shouldPersistCustom && customCategory) {
      customCategory = await persistCustomCategoryForUser(existing.data.created_by, customCategory)
    }
    updates.category = categorySelection.category
    updates.custom_category = customCategory
  }

  // 触及周期或应付日时联合校验与归一，保证切换周期后无脏字段残留
  const touchesCycle =
    patch.cycle_type !== undefined ||
    patch.cycle_months !== undefined ||
    patch.due_month !== undefined ||
    patch.due_day !== undefined ||
    patch.anchor_period !== undefined

  if (touchesCycle) {
    const nextCycleType = patch.cycle_type ?? existing.data.cycle_type ?? 'monthly'
    const nextDueMonth =
      patch.due_month !== undefined ? patch.due_month : existing.data.due_month
    // 若显式传入 anchor_period 则用传入值；否则在同周期且（年付同月或每 X 月）时保留原锚点
    let candidateAnchor: unknown = patch.anchor_period
    if (candidateAnchor === undefined) {
      if (nextCycleType === 'every_n_months' && existing.data.cycle_type === 'every_n_months') {
        candidateAnchor = existing.data.anchor_period
      } else if (
        nextCycleType === 'yearly' &&
        existing.data.cycle_type === 'yearly' &&
        existing.data.due_month === nextDueMonth
      ) {
        candidateAnchor = existing.data.anchor_period
      }
    }
    const normalizedCycle = normalizePayableCycleSelection(
      {
        cycle_type: nextCycleType,
        cycle_months:
          patch.cycle_months !== undefined ? patch.cycle_months : existing.data.cycle_months,
        due_month: nextDueMonth,
        due_day: patch.due_day !== undefined ? patch.due_day : existing.data.due_day,
        anchor_period: candidateAnchor,
      },
      effectiveToday
    )
    updates.cycle_type = normalizedCycle.cycle_type
    updates.cycle_months = normalizedCycle.cycle_months
    updates.due_month = normalizedCycle.due_month
    updates.due_day = normalizedCycle.due_day
    updates.anchor_period = normalizedCycle.anchor_period
  }

  const fields = Object.keys(updates).map(key => `${key} = ?`)
  const params = Object.values(updates)
  if (fields.length === 0) throw new Error('没有需要更新的字段')
  params.push(id)

  const { error } = await execute(`UPDATE recurring_payables SET ${fields.join(', ')} WHERE id = ?`, params)
  if (error) throw new Error(error.message)
  const updated = await queryOne<RecurringPayable>('SELECT * FROM recurring_payables WHERE id = ?', [id])
  if (!updated.data) throw new Error('应付事项不存在')
  const { period, paidAmount } = await resolveDisplayPeriod(updated.data, effectiveToday)
  return withStatus(updated.data, period, paidAmount, effectiveToday)
}

export async function deleteRecurringPayable(id: string): Promise<void> {
  const { error } = await execute('DELETE FROM recurring_payables WHERE id = ?', [id])
  if (error) throw new Error(error.message)
}

/**
 * 登记当期还款。
 *
 * period 由服务端按展示期滚动规则决定（与列表展示一致）：本期已付清且
 * 距下期不足 30 天时登记的就是下期。重复登记由 (payable_id, period)
 * 唯一约束挡下，天然幂等。
 */
export async function payRecurringPayable(
  payableId: string,
  amount: number,
  note?: string,
  rawToday: Date = new Date()
): Promise<PayableWithStatus> {
  const today = rawToday instanceof Date ? rawToday : new Date()
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('还款金额必须大于 0')

  const payable = await queryOne<RecurringPayable>('SELECT * FROM recurring_payables WHERE id = ?', [payableId])
  if (!payable.data) throw new Error('应付事项不存在')

  // 账期与列表展示共用同一滚动逻辑：卡片显示「待还款」的是哪一期，
  // 登记就写进哪一期，不会出现展示下期却记到本期的错位。
  const { period } = await resolveDisplayPeriod(payable.data, today)

  const existing = await queryOne<{ id: string }>(
    'SELECT id FROM recurring_payable_payments WHERE payable_id = ? AND period = ?',
    [payableId, period]
  )
  if (existing.data) throw new Error('本期已登记还款，无需重复登记')

  const { error } = await execute(
    `INSERT INTO recurring_payable_payments (id, payable_id, period, amount, paid_at, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [uuid(), payableId, period, amount,
     `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`,
     note || null, now()]
  )
  if (error) throw new Error(error.message)
  return withStatus(payable.data, period, await paidAmountFor(payableId, period), today)
}

/** 供统计复用：当期应付合计（按币种分组，绝不跨币种直接相加）。 */
export function sumPayablesByCurrency(payables: PayableWithStatus[]): Record<string, number> {
  const totals: Record<string, number> = {}
  for (const p of payables) {
    if (p.status === 'paid') continue
    const remaining = Math.max(0, p.amount - p.paid_amount)
    if (remaining <= 0) continue
    totals[p.currency] = (totals[p.currency] || 0) + remaining
  }
  return totals
}
