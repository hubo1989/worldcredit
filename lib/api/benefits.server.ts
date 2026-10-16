import { query, queryOne, execute, uuid, now } from '../db'
import type { Benefit, BenefitUsage, CardProduct } from '../types'
import { legacyBenefitToRules } from '../opportunities/rules'
import { getCycleWindow, isValidCivilDate } from '../opportunities/dates'
import type { OpportunityActor } from '../opportunities/types'
import { OpportunityError } from '../opportunities/errors'
import { recordOpportunityUsage } from '../opportunities/usages.server'
import { materializeCycleForDate } from '../opportunities/accounts.server'
import { archiveLegacyDefinition } from '../opportunities/legacy.server'

/**
 * 兼容写路径的统一周期起点：旧 benefit 经 legacyBenefitToRules 适配后用
 * getCycleWindow 计算，与卡详情等所有调用方共享同一口径（Task 10 整体转入
 * 新账本前的过渡实现）。
 */
export function legacyBenefitPeriodStart(benefit: Benefit, nowOn: string): string | null {
  if (!isValidCivilDate(nowOn)) return null
  if (benefit.period === 'one_time') return null
  const rules = legacyBenefitToRules({
    card_product_id: benefit.card_product_id,
    name: benefit.name,
    description: benefit.description ?? null,
    // 旧表 quota 无非负约束、expiry_date 无格式约束，适配前先净化。
    quota: Math.max(0, benefit.quota),
    period: benefit.period,
    reset_month: benefit.reset_month ?? null,
    expiry_date: isValidCivilDate(benefit.expiry_date) ? benefit.expiry_date : null,
  })
  return getCycleWindow(rules, nowOn, { issued_on: null, activated_on: null }).period_start_on
}

/**
 * 根据权益的周期类型计算当前周期的起始日期。
 * nowOn 可注入固定日期（测试）；不传时使用服务器当日。
 */
function getPeriodStart(benefit: Benefit, nowOn: string): string | null {
  return legacyBenefitPeriodStart(benefit, nowOn)
}

export async function getBenefitsByCard(cardProductId: string): Promise<Benefit[]> {
  const { data, error } = await query<Benefit>(
    'SELECT * FROM benefits WHERE card_product_id = ?',
    [cardProductId]
  )
  if (error) throw new Error(error.message)
  return data || []
}

/** Ledger account on this benefit visible to the caller (compat addition). */
export interface BenefitAccountSummary {
  id: string
  holder_id: string
  scope_kind: 'card' | 'holder'
}

export interface MyBenefitRow extends Benefit {
  card_product: CardProduct
  usage_count: number
  accounts: BenefitAccountSummary[]
  /** Wrapped opportunity definition id (account setup entry; null if unwrapped). */
  definition_id: string | null
}

/**
 * 兼容读路径（Task 10 起含新账本联动）：
 *   - usage_count = 当期窗口内**未归属**的旧 benefit_usages + 该用户可见账本
 *     账户上的 active 新流水。已归属的旧行只经 opportunity_usages 计一次，
 *     不再双算；账本账户按 holder scope 过滤，不泄漏他人账户。
 *   - accounts 增量字段列出该用户可访问的账本账户（旧字段全部保留）。
 */
export async function getAllMyBenefits(userId?: string, nowOn?: string): Promise<MyBenefitRow[]> {
  const today = nowOn ?? new Date().toISOString().slice(0, 10)
  let cardIdsFilter: string[] | null = null
  let scopedHolderIds: string[] = []

  if (userId) {
    const { data: holders } = await query<{ id: string }>(
      'SELECT id FROM card_holders WHERE created_by = ? OR auth_user_id = ?', [userId, userId]
    )
    scopedHolderIds = (holders || []).map(h => h.id)
    if (scopedHolderIds.length === 0) return []

    const pPlaceholders = scopedHolderIds.map(() => '?').join(',')
    const { data: userCards } = await query<{ card_product_id: string }>(
      `SELECT card_product_id FROM credit_cards WHERE holder_id IN (${pPlaceholders})`,
      scopedHolderIds
    )
    cardIdsFilter = (userCards || []).map(c => c.card_product_id).filter(Boolean)
    if (cardIdsFilter.length === 0) return []
  }

  // Get product IDs from cards
  let cardSql = 'SELECT DISTINCT card_product_id FROM credit_cards WHERE card_product_id IS NOT NULL'
  let cardParams: unknown[] = []
  if (cardIdsFilter !== null && cardIdsFilter.length > 0) {
    const placeholders = cardIdsFilter.map(() => '?').join(',')
    cardSql += ` AND card_product_id IN (${placeholders})`
    cardParams = cardIdsFilter
  }
  const { data: cards, error: cardsError } = await query<{ card_product_id: string }>(cardSql, cardParams)
  if (cardsError) throw new Error(cardsError.message)
  if (!cards?.length) return []

  const productIds = Array.from(new Set(cards.map(c => c.card_product_id).filter(Boolean)))
  if (productIds.length === 0) return []

  const pPlaceholders = productIds.map(() => '?').join(',')
  const { data: benefits, error: benefitsError } = await query<Benefit>(
    `SELECT * FROM benefits WHERE card_product_id IN (${pPlaceholders})`,
    productIds
  )
  if (benefitsError) throw new Error(benefitsError.message)
  const benefitList = benefits || []
  if (benefitList.length === 0) return []

  const { data: products } = await query<CardProduct>(
    `SELECT * FROM card_products WHERE id IN (${pPlaceholders})`, productIds
  )
  const productMap: Record<string, CardProduct> = (products || []).reduce((acc, p) => {
    acc[p.id] = p
    return acc
  }, {} as Record<string, CardProduct>)

  // Old usage rows — already-mapped ones count through the ledger instead.
  const benefitIds = benefitList.map(b => b.id)
  const bPlaceholders = benefitIds.map(() => '?').join(',')
  const { data: allUsages, error: usagesError } = await query<{ id: string; benefit_id: string; used_at: string }>(
    `SELECT bu.id, bu.benefit_id, bu.used_at
     FROM benefit_usages bu
     LEFT JOIN opportunity_legacy_links l
       ON l.source_table = 'benefit_usages' AND l.source_id = bu.id
     WHERE bu.benefit_id IN (${bPlaceholders}) AND l.source_id IS NULL`,
    benefitIds
  )
  if (usagesError) throw new Error(usagesError.message)

  const usagesByBenefit: Record<string, { id: string; used_at: string }[]> = {}
  allUsages?.forEach(u => {
    ;(usagesByBenefit[u.benefit_id] ||= []).push({ id: u.id, used_at: u.used_at })
  })

  // Ledger side: visible accounts per benefit + their active usages in hand;
  // the per-benefit window filter happens below with each benefit's own
  // current period start, exactly like the legacy rows.
  const accountsByBenefit: Record<string, BenefitAccountSummary[]> = {}
  const definitionIdByBenefit: Record<string, string> = {}
  const ledgerUsages: { benefit_id: string; used_on: string }[] = []
  {
    // Wrapped definition id for every listed benefit (account setup entry).
    const { data: defRows, error: defError } = await query<{ legacy_benefit_id: string; id: string }>(
      `SELECT legacy_benefit_id, id FROM opportunity_definitions WHERE legacy_benefit_id IN (${bPlaceholders})`,
      benefitIds,
    )
    if (defError) throw new Error(defError.message)
    for (const d of defRows || []) definitionIdByBenefit[d.legacy_benefit_id] = d.id
  }
  if (userId && scopedHolderIds.length > 0) {
    const holderPh = scopedHolderIds.map(() => '?').join(',')
    const { data: accountRows, error: accountsError } = await query<{
      legacy_benefit_id: string; id: string; holder_id: string; scope_kind: 'card' | 'holder'
    }>(
      `SELECT d.legacy_benefit_id, a.id, a.holder_id, a.scope_kind
       FROM opportunity_definitions d
       JOIN opportunity_accounts a ON a.definition_id = d.id
       WHERE d.legacy_benefit_id IN (${bPlaceholders}) AND a.holder_id IN (${holderPh})`,
      [...benefitIds, ...scopedHolderIds]
    )
    if (accountsError) throw new Error(accountsError.message)
    for (const a of accountRows || []) {
      ;(accountsByBenefit[a.legacy_benefit_id] ||= []).push({
        id: a.id, holder_id: a.holder_id, scope_kind: a.scope_kind
      })
    }
    const accountIds = (accountRows || []).map(a => a.id)
    if (accountIds.length > 0) {
      const accPh = accountIds.map(() => '?').join(',')
      const { data: ledgerRows, error: ledgerError } = await query<{
        benefit_id: string; used_on: string
      }>(
        `SELECT d.legacy_benefit_id AS benefit_id, u.used_on
         FROM opportunity_usages u
         JOIN opportunity_accounts a ON a.id = u.account_id
         JOIN opportunity_definitions d ON d.id = a.definition_id
         WHERE u.account_id IN (${accPh}) AND u.status = 'active'
           AND u.used_on <= ?`,
        [...accountIds, today]
      )
      if (ledgerError) throw new Error(ledgerError.message)
      ledgerUsages.push(...(ledgerRows || []))
    }
  }

  return benefitList.map(b => {
    const usages = usagesByBenefit[b.id] || []
    const periodStart = getPeriodStart(b, today)
    // 半开区间上界：登记已拒绝未来日期，这里再挡一次旧数据，防止未来 usage 污染当期计数
    const unmappedInWindow = periodStart
      ? usages.filter(u => u.used_at >= periodStart && u.used_at <= today).length
      : usages.filter(u => u.used_at <= today).length
    const ledgerInWindow = periodStart
      ? ledgerUsages.filter(u => u.benefit_id === b.id && u.used_on >= periodStart).length
      : ledgerUsages.filter(u => u.benefit_id === b.id).length
    return {
      ...b,
      card_product: productMap[b.card_product_id] || {
        id: b.card_product_id, bank_name: '银行卡', card_name: '标准信用卡', country: 'CN',
        currency: 'CNY', payment_due_type: 'after_billing' as const, payment_due_value: 20,
        is_active: true, created_at: new Date().toISOString()
      },
      usage_count: unmappedInWindow + ledgerInWindow,
      accounts: accountsByBenefit[b.id] ?? [],
      definition_id: definitionIdByBenefit[b.id] ?? null,
    }
  })
}

/**
 * 兼容写路径适配器（Task 10）：旧 recordBenefitUsage 改走新账本——
 *   - 唯一账户/唯一绑定卡 → 直接落新流水；
 *   - 多解（多账户或多卡）→ AMBIGUOUS_ACCOUNT；
 *   - 无账户 → NEEDS_CONFIRMATION（先初始化账户）；
 *   - 不再写 benefit_usages，避免双算。
 * 返回形状保持 BenefitUsage；nowOn 供测试注入。
 */
export async function recordBenefitUsage(
  actor: OpportunityActor,
  usage: Omit<BenefitUsage, 'id' | 'created_at'>,
  nowOn?: string,
): Promise<BenefitUsage> {
  const today = nowOn ?? new Date().toISOString().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(usage.used_at) || usage.used_at > today) {
    throw new Error('使用日期无效：不能登记未来日期')
  }

  const { data: benefit } = await queryOne<Benefit>('SELECT * FROM benefits WHERE id = ?', [
    usage.benefit_id,
  ])
  if (!benefit) throw new Error('权益不存在')
  if (benefit.expiry_date && benefit.expiry_date < today) {
    throw new OpportunityError('EXPIRED', '该权益已过期，无法登记使用')
  }

  // Accounts on the wrapped definition inside the actor's holder scope.
  const scopeSql =
    actor.role === 'admin'
      ? '(h.created_by = ? OR h.managed_by = ?)'
      : 'h.auth_user_id = ?'
  const scopeBinds = actor.role === 'admin' ? [actor.user_id, actor.user_id] : [actor.user_id]
  const { data: accounts } = await query<{
    id: string; holder_id: string
  }>(
    `SELECT a.id, a.holder_id FROM opportunity_accounts a
     JOIN opportunity_definitions d ON d.id = a.definition_id
     JOIN card_holders h ON h.id = a.holder_id
     WHERE d.legacy_benefit_id = ? AND a.status = 'active' AND ${scopeSql}`,
    [usage.benefit_id, ...scopeBinds]
  )
  if (!accounts || accounts.length === 0) {
    throw new OpportunityError('NEEDS_CONFIRMATION', '请先为该权益初始化账户后再登记使用')
  }
  if (accounts.length > 1) {
    throw new OpportunityError('AMBIGUOUS_ACCOUNT', '该权益存在多个账户，请在权益台账中选择目标账户登记')
  }
  const account = accounts[0]

  // Exactly one active linked card; more than one is ambiguous for a legacy
  // write that never named a card.
  const { data: cardRows } = await query<{ card_id: string }>(
    `SELECT card_id FROM opportunity_account_cards
     WHERE account_id = ? AND retired_at IS NULL`,
    [account.id]
  )
  if (!cardRows || cardRows.length !== 1) {
    throw new OpportunityError('AMBIGUOUS_ACCOUNT', '该权益账户绑定卡不唯一，请在权益台账中选择目标卡登记')
  }
  const cardId = cardRows[0].card_id

  const opts = nowOn ? { now: `${nowOn}T12:00:00Z` } : undefined
  const cycle = await materializeCycleForDate(actor, account.id, usage.used_at, `legacy-bu-${uuid()}`, opts)
  if (!cycle) {
    throw new OpportunityError('EXPIRED', '该权益当前周期不可用，无法登记使用')
  }

  const recorded = await recordOpportunityUsage(
    actor,
    {
      account_id: account.id,
      cycle_id: cycle.id,
      card_id: cardId,
      used_on: usage.used_at,
      quantity: 1,
      amount_minor: 0,
      note: usage.note ?? null,
      request_key: `legacy-bu-${uuid()}`,
    },
    opts,
  )

  return {
    id: recorded.usage_id,
    benefit_id: usage.benefit_id,
    used_at: usage.used_at,
    note: usage.note,
    created_at: opts?.now ?? now(),
  }
}

export async function createBenefit(benefit: Omit<Benefit, 'id' | 'created_at'>): Promise<Benefit> {
  const id = uuid()
  const ts = now()
  const { error } = await execute(
    'INSERT INTO benefits (id, card_product_id, name, description, quota, period, reset_month, expiry_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, benefit.card_product_id, benefit.name, benefit.description || null, benefit.quota,
     benefit.period, benefit.reset_month || null, benefit.expiry_date || null, ts]
  )
  if (error) throw new Error(error.message)
  const row = await queryOne<Benefit>('SELECT * FROM benefits WHERE id = ?', [id])
  if (!row.data) throw new Error('权益创建失败')
  return row.data
}

export async function updateBenefit(id: string, updates: Partial<Benefit>): Promise<Benefit> {
  const fields: string[] = []
  const params: unknown[] = []
  for (const key of ['card_product_id', 'name', 'description', 'quota', 'period', 'reset_month', 'expiry_date']) {
    if (updates[key as keyof Benefit] !== undefined) {
      fields.push(`${key} = ?`)
      params.push(updates[key as keyof Benefit])
    }
  }
  if (fields.length === 0) throw new Error('没有需要更新的字段')
  params.push(id)
  const { error } = await execute(`UPDATE benefits SET ${fields.join(', ')} WHERE id = ?`, params)
  if (error) throw new Error(error.message)
  const row = await queryOne<Benefit>('SELECT * FROM benefits WHERE id = ?', [id])
  if (!row.data) throw new Error('权益更新失败')
  return row.data
}

/**
 * 兼容删除适配器（Task 10）：旧删除按钮改归档包装定义，旧行与其使用
 * 历史保留，不再级联删除。
 */
export async function deleteBenefit(id: string): Promise<void> {
  await archiveLegacyDefinition(id, 'benefit')
}

/**
 * 兼容入口（Task 13）：AI 结果只产出候选，不写目录。返回固定
 * review_required=true 与候选列表；正式入目录走 previewOpportunityCandidates
 * → 人工复核 → publishOpportunityVersion（来源落库）。
 */
export async function autoEnrichCardBenefits(
  cardProductId: string,
  bankName: string,
  cardName: string,
): Promise<{ review_required: true; card_product_id: string; candidates: Array<{ name: string; description: string | null; quota: number; period: string; reset_month: number | null }> }> {
  const { aiCollectCardBenefits } = await import('./ai.server')
  const collected = await aiCollectCardBenefits(bankName, cardName)
  return {
    review_required: true,
    card_product_id: cardProductId,
    candidates: (collected ?? []).map((item) => ({
      name: item.name,
      description: item.description ?? null,
      quota: Math.max(0, Number(item.quota) || 0),
      period: item.period ?? 'yearly',
      reset_month: item.reset_month ?? null,
    })),
  }
}
