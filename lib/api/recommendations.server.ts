// lib/api/recommendations.server.ts — 消费前推荐与年费 ROI 的服务端聚合层（HUB-177）。
//
// 分工：纯函数内核在 lib/recommendations/{engine,roi}.ts（零 IO）；
// 本文件只做三件事：按 actor 作用域取数、把行组装成快照、把结果交回内核。
//
// 硬约束（HUB-175 §4.2 / §5）：
// - 全家庭 ROI 固定 2 轮往返（第 1 轮卡片，第 2 轮 3 组并发聚合），零 N+1；
// - 所有 IN (...) 强制 queryByChunks(..., 80)，单条 SQL 绑定参数 < 100；
// - promo_usages 排除 opportunity_legacy_links，opportunity_fulfillments 只取 task_result；
// - 0043/0044 列不存在时按「未配置」降级，绝不 1:1 误算。

import { query, queryOne, execute, queryByChunks, now as dbNow, uuid } from '../db'
import { hasColumns } from '../db/schema-capabilities'
import { fetchRates, normalizeCurrency } from '../fx'
import { resolvePoolLimit } from '../account-pools'
import type { CardWithBillsSummary } from './bills'
import type { CreditAccount } from '../types'
import { localDateInZone } from '../opportunities/dates'
import { evaluateTask, type ManualProgress, type TaskConditionsV1 } from '../opportunities/tasks'
import { assertAccountAccess, assertCardAccess, holderScopePredicate } from '../opportunities/scope.server'
import { forbiddenOrNotFound, invalidId } from '../opportunities/errors'
import type { OpportunityActor } from '../opportunities/types'
import type { CardProduct } from '../types'
import {
  buildWaiverTaskFromProgress,
  rankCardsForPurchase,
} from '../recommendations/engine'
import {
  aggregateFamilyAnnualFeeRoi,
  computeCardAnnualFeeRoi,
  resolveRoiWindow,
  type CardAnnualFeeRoiDetail,
  type FamilyAnnualFeeRoiBoard,
  type RoiPeriodMode,
  type RoiWindowMode,
  type UnvaluedBenefitRef,
} from '../recommendations/roi'
import {
  OPTIMIZE_FOR_MODES,
  isRecommendationCategory,
  round2,
  type AnnualFeeStatus,
  type AnnualFeeCycleType,
  type OptimizeFor,
  type PurchaseRecommendationInput,
  type RecommendationCategory,
  type RecommendationCardSnapshot,
  type RecommendationEngineOutput,
  type RecommendationOpportunitySnapshot,
  type RecommendationPromoSnapshot,
  type RecommendationTaskSnapshot,
} from '../recommendations/types'

const DEFAULT_TIME_ZONE = 'Asia/Shanghai'

// ---------------------------------------------------------------------------
// 入参校验
// ---------------------------------------------------------------------------

function todayOn(): string {
  return localDateInZone(new Date(), DEFAULT_TIME_ZONE)
}

/**
 * holder_id 过滤：'all'（管理端全家）与空串等价于「不额外过滤」，
 * 服务端 SQL 仍会用 holderScopePredicate 把结果收敛到 actor 可见的持卡人。
 */
function normalizeHolderFilter(holderId: string | null | undefined): string | null {
  if (!holderId || holderId === 'all') return null
  return holderId
}

function invalid(message: string): never {
  throw new Error(`推荐参数不合法：${message}`)
}

function normalizeInput(input: PurchaseRecommendationInput): {
  amount: number
  currency: string
  category: RecommendationCategory | null
  merchant_keyword: string | null
  purchase_date: string
  optimize_for: OptimizeFor
  display_currency: string | null
} {
  const amount = Number(input.amount)
  if (!Number.isFinite(amount) || amount <= 0) invalid('amount 必须是正数')
  const currency = normalizeCurrency(input.currency)
  if (!currency) invalid('currency 必须是三字母币种代码')
  const category = input.category ?? null
  if (category !== null && !isRecommendationCategory(category)) invalid('category 非法')
  const optimizeFor = input.optimize_for ?? 'balanced'
  if (!OPTIMIZE_FOR_MODES.includes(optimizeFor)) invalid('optimize_for 非法')
  const purchaseDate = input.purchase_date || todayOn()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(purchaseDate)) invalid('purchase_date 必须是 YYYY-MM-DD')
  const displayCurrency = input.display_currency ? normalizeCurrency(input.display_currency) : null
  if (input.display_currency && !displayCurrency) invalid('display_currency 必须是三字母币种代码')
  return {
    amount,
    currency,
    category,
    merchant_keyword: input.merchant_keyword?.trim() || null,
    purchase_date: purchaseDate,
    optimize_for: optimizeFor,
    display_currency: displayCurrency,
  }
}

// ---------------------------------------------------------------------------
// 第 1 轮：作用域内卡片 + 产品 + 持卡人 + 信用账户
// ---------------------------------------------------------------------------

interface RecommendationCardRow {
  id: string
  holder_id: string
  holder_name: string
  card_number_last4: string | null
  status: string
  card_type: string
  credit_limit: number
  credit_limit_override: number | null
  billing_day: number
  override_billing_day: number | null
  override_due_type: string | null
  override_due_value: number | null
  name_override: string | null
  annual_fee_override: number | null
  account_id: string | null
  issued_on: string | null
  activated_on: string | null
  product_id: string | null
  product_bank_name: string | null
  product_card_name: string | null
  product_currency: string | null
  payment_due_type: string | null
  payment_due_value: number | null
  product_annual_fee: number | null
  product_annual_fee_waiver: string | null
  rewards_summary: string | null
  quota_mode: string | null
  shared_credit_limit: number | null
  account_currency: string | null
  bank_name: string | null
  // 0043 / 0044 列（能力探测通过后才会出现在 SELECT 里）
  p_ftf_rate?: number | null
  p_fx_free_currencies_json?: string | null
  p_reward_rules_json?: string | null
  p_annual_fee_cycle_type?: string | null
  p_annual_fee_waiver_rules_json?: string | null
  cc_annual_fee_cycle_type?: string | null
  cc_annual_fee_status?: string | null
  cc_waiver_progress_json?: string | null
  cc_next_annual_fee_date?: string | null
  cc_actual_fee_paid?: number | null
  cc_manual_reward_value?: number | null
}

const PRODUCT_RULE_COLUMNS = [
  'ftf_rate',
  'fx_free_currencies_json',
  'reward_rules_json',
  'annual_fee_cycle_type',
  'annual_fee_waiver_rules_json',
] as const

const CARD_FEE_COLUMNS = [
  'annual_fee_cycle_type',
  'next_annual_fee_date',
  'annual_fee_status',
  'waiver_progress_json',
  'actual_fee_paid',
  'manual_reward_value',
] as const

async function selectCardRows(
  actor: OpportunityActor,
  options: { holderId?: string | null; cardId?: string | null; cardType?: string }
): Promise<RecommendationCardRow[]> {
  const [productReady, cardReady] = await Promise.all([
    hasColumns('card_products', PRODUCT_RULE_COLUMNS),
    hasColumns('credit_cards', CARD_FEE_COLUMNS),
  ])
  const productExtra = productReady
    ? `, cp.ftf_rate AS p_ftf_rate, cp.fx_free_currencies_json AS p_fx_free_currencies_json,
       cp.reward_rules_json AS p_reward_rules_json, cp.annual_fee_cycle_type AS p_annual_fee_cycle_type,
       cp.annual_fee_waiver_rules_json AS p_annual_fee_waiver_rules_json`
    : ''
  const cardExtra = cardReady
    ? `, cc.annual_fee_cycle_type AS cc_annual_fee_cycle_type, cc.next_annual_fee_date AS cc_next_annual_fee_date,
       cc.annual_fee_status AS cc_annual_fee_status, cc.waiver_progress_json AS cc_waiver_progress_json,
       cc.actual_fee_paid AS cc_actual_fee_paid, cc.manual_reward_value AS cc_manual_reward_value`
    : ''

  const scope = holderScopePredicate(actor)
  const conditions = [scope.sql, "cc.card_type = 'credit'"]
  const binds: unknown[] = [...scope.binds]
  if (options.holderId) {
    conditions.push('cc.holder_id = ?')
    binds.push(options.holderId)
  }
  if (options.cardId) {
    conditions.push('cc.id = ?')
    binds.push(options.cardId)
  }
  if (options.cardType) {
    conditions.push('cc.card_type = ?')
    binds.push(options.cardType)
  }

  const { data, error } = await query<RecommendationCardRow>(
    `SELECT cc.id, cc.holder_id, h.name AS holder_name, cc.card_number_last4, cc.status, cc.card_type,
       cc.credit_limit, cc.credit_limit_override, cc.billing_day, cc.override_billing_day,
       cc.override_due_type, cc.override_due_value, cc.name_override, cc.annual_fee_override,
       cc.account_id, cc.issued_on, cc.activated_on,
       cp.id AS product_id, cp.bank_name AS product_bank_name, cp.card_name AS product_card_name,
       cp.currency AS product_currency, cp.payment_due_type, cp.payment_due_value,
       cp.annual_fee AS product_annual_fee, cp.annual_fee_waiver AS product_annual_fee_waiver,
       cp.rewards_summary,
       ca.quota_mode, ca.shared_credit_limit, ca.currency AS account_currency,
       b.name AS bank_name${productExtra}${cardExtra}
     FROM credit_cards cc
     JOIN card_holders h ON cc.holder_id = h.id
     LEFT JOIN card_products cp ON cc.card_product_id = cp.id
     LEFT JOIN credit_accounts ca ON cc.account_id = ca.id
     LEFT JOIN banks b ON cp.bank_id = b.id
     WHERE ${conditions.join(' AND ')}
     ORDER BY cc.created_at ASC, cc.id ASC`,
    binds
  )
  if (error) throw new Error(error.message)
  return data || []
}

/** 各卡未还账单（用于可用授信计算，与 lib/account-pools.ts 口径一致）。 */
async function loadUnpaidByCard(cardIds: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>()
  if (cardIds.length === 0) return result
  const { data, error } = await queryByChunks<{ card_id: string; unpaid: number }, string>(
    cardIds,
    (chunk, placeholders) => ({
      sql: `SELECT b.card_id,
               COALESCE(SUM(MAX(0, b.bill_amount - COALESCE(p.paid, 0))), 0) AS unpaid
            FROM bills b
            LEFT JOIN (
              SELECT bill_id, SUM(amount) AS paid FROM payments GROUP BY bill_id
            ) p ON p.bill_id = b.id
            WHERE b.card_id IN (${placeholders}) AND b.status != 'paid'
            GROUP BY b.card_id`,
      params: chunk,
    })
  )
  if (error) throw new Error(error.message)
  for (const row of data || []) result.set(row.card_id, Number(row.unpaid) || 0)
  return result
}

// ---------------------------------------------------------------------------
// 任务快照（卡级免年费门槛 + WC-BEN-12 任务）
// ---------------------------------------------------------------------------

interface TaskRow {
  id: string
  holder_id: string
  title: string
  task_type: string
  card_ids_json: string
  cycle_rules_json: string
  cycle_progress_json: string
  period_start_on: string
  period_end_before: string
  deadline_at: string
}

async function loadActiveTaskRows(holderIds: string[], purchaseDate: string): Promise<TaskRow[]> {
  if (holderIds.length === 0) return []
  const { data, error } = await queryByChunks<TaskRow, string>(
    holderIds,
    (chunk, placeholders) => ({
      sql: `SELECT t.id, t.holder_id, t.title, t.task_type, t.card_ids_json,
               tc.rules_snapshot_json AS cycle_rules_json, tc.progress_json AS cycle_progress_json,
               tc.period_start_on, tc.period_end_before, tc.deadline_at
            FROM opportunity_tasks t
            JOIN opportunity_task_cycles tc ON tc.task_id = t.id
            WHERE t.status = 'active' AND t.holder_id IN (${placeholders})
              AND tc.period_start_on <= ? AND tc.period_end_before > ?`,
      params: [...chunk, purchaseDate, purchaseDate],
    })
  )
  if (error) throw new Error(error.message)
  return data || []
}

function buildTaskSnapshots(rows: TaskRow[]): Map<string, RecommendationTaskSnapshot[]> {
  const byCard = new Map<string, RecommendationTaskSnapshot[]>()
  for (const row of rows) {
    const parsedCycle = parseTaskCycle(row)
    if (!parsedCycle) continue
    const { cardIds, rules, progress } = parsedCycle
    let evaluation: ReturnType<typeof evaluateTask>
    try {
      evaluation = evaluateTask(rules, { ...progress, as_of_on: progress.as_of_on })
    } catch {
      continue
    }
    if (evaluation.satisfied) continue
    const snapshot: RecommendationTaskSnapshot = {
      source: 'opportunity_task',
      id: row.id,
      title: row.title,
      currency: rules.currency,
      deadline: row.period_end_before || row.deadline_at?.slice(0, 10) || null,
      amount_gap: aggregateGap(evaluation, 'amount'),
      count_gap: aggregateGap(evaluation, 'count'),
      per_txn_min_amount: minPerTxnThreshold(rules),
      task_type: row.task_type as RecommendationTaskSnapshot['task_type'],
    }
    for (const cardId of cardIds) {
      const list = byCard.get(cardId)
      if (list) list.push(snapshot)
      else byCard.set(cardId, [snapshot])
    }
  }
  return byCard
}

function parseTaskCycle(row: TaskRow): {
  cardIds: string[]
  rules: TaskConditionsV1
  progress: ManualProgress
} | null {
  try {
    const cardIds = JSON.parse(row.card_ids_json) as string[]
    const rules = JSON.parse(row.cycle_rules_json) as TaskConditionsV1
    const progress = JSON.parse(row.cycle_progress_json) as ManualProgress
    if (!Array.isArray(cardIds) || !rules || !progress) return null
    return { cardIds, rules, progress }
  } catch {
    return null
  }
}

function aggregateGap(
  evaluation: ReturnType<typeof evaluateTask>,
  kind: 'amount' | 'count'
): number | null {
  let best: number | null = null
  for (const group of evaluation.groups) {
    const groupGap = group.metrics.reduce<number | null>((sum, metric) => {
      if (metric.kind !== kind || metric.gap === null) return sum
      return (sum ?? 0) + metric.gap
    }, null)
    if (groupGap === null) continue
    // 组间 OR：取最容易达成的那一组（缺口最小）
    best = best === null ? groupGap : Math.min(best, groupGap)
  }
  return best
}

function minPerTxnThreshold(rules: TaskConditionsV1): number | null {
  let min: number | null = null
  for (const group of rules.groups) {
    for (const metric of group.metrics) {
      if (metric.kind !== 'count' || metric.per_txn_min_minor === null) continue
      const value = metric.per_txn_min_minor / 100
      min = min === null ? value : Math.min(min, value)
    }
  }
  return min
}

// ---------------------------------------------------------------------------
// 权益机会快照（expiring_soon / available_today）
// ---------------------------------------------------------------------------

interface OpportunityRow {
  card_id: string
  definition_id: string
  kind: string
  rules_json: string
  usable_start_on: string
  usable_end_before: string | null
  used_count: number
  reserved_count: number
  count_limit: number | null
  used_minor: number
  reserved_minor: number
  amount_limit_minor: number | null
  currency: string | null
}

async function loadOpportunityRows(cardIds: string[], purchaseDate: string): Promise<OpportunityRow[]> {
  if (cardIds.length === 0) return []
  const { data, error } = await queryByChunks<OpportunityRow, string>(
    cardIds,
    (chunk, placeholders) => ({
      sql: `SELECT ac.card_id, d.id AS definition_id, d.kind, rv.rules_json,
               cy.usable_start_on, cy.usable_end_before, cy.used_count, cy.reserved_count,
               cy.count_limit, cy.used_minor, cy.reserved_minor, cy.amount_limit_minor, cy.currency
            FROM opportunity_account_cards ac
            JOIN opportunity_accounts a ON a.id = ac.account_id
            JOIN opportunity_definitions d ON d.id = a.definition_id
            JOIN opportunity_cycles cy ON cy.account_id = a.id
            JOIN opportunity_rule_versions rv ON rv.id = cy.version_id
            WHERE ac.retired_at IS NULL AND ac.card_id IN (${placeholders})
              AND d.status = 'active' AND a.status = 'active'
              AND cy.activation_state = 'active'
              AND cy.usable_start_on <= ?
              AND (cy.usable_end_before IS NULL OR cy.usable_end_before > ?)`,
      params: [...chunk, purchaseDate, purchaseDate],
    })
  )
  if (error) throw new Error(error.message)
  return data || []
}

function buildOpportunitySnapshots(rows: OpportunityRow[], purchaseDate: string): Map<string, RecommendationOpportunitySnapshot[]> {
  const byCard = new Map<string, RecommendationOpportunitySnapshot[]>()
  for (const row of rows) {
    let category: string | null = null
    let title = '权益'
    let websiteUrl: string | null = null
    try {
      const parsed = JSON.parse(row.rules_json) as {
        category?: string
        title?: string
        entry?: { website_url?: string | null }
      }
      category = parsed.category ?? null
      title = parsed.title || '权益'
      websiteUrl = parsed.entry?.website_url ?? null
    } catch {
      // 脏规则快照：仍然给出可点击的权益，只是没有类目
    }

    const exhausted =
      (row.count_limit !== null && row.used_count + row.reserved_count >= row.count_limit) ||
      (row.amount_limit_minor !== null && row.used_minor + row.reserved_minor >= row.amount_limit_minor)
    if (exhausted) continue

    const daysLeft = row.usable_end_before
      ? Math.round(
          (Date.parse(`${row.usable_end_before}T00:00:00Z`) - Date.parse(`${purchaseDate}T00:00:00Z`)) /
            86_400_000
        )
      : null
    const status: RecommendationOpportunitySnapshot['status'] =
      daysLeft !== null && daysLeft <= 7 ? 'expiring_soon' : 'available_today'
    const statusLabel =
      status === 'expiring_soon' ? `即将到期（剩 ${daysLeft} 天）` : '今天可用'

    const snapshot: RecommendationOpportunitySnapshot = {
      id: row.definition_id,
      kind: row.kind as RecommendationOpportunitySnapshot['kind'],
      title,
      status_label: statusLabel,
      status,
      category,
      target_url: websiteUrl ?? '',
    }
    const list = byCard.get(row.card_id)
    if (list) list.push(snapshot)
    else byCard.set(row.card_id, [snapshot])
  }
  return byCard
}

// ---------------------------------------------------------------------------
// 旧版优惠活动（弱匹配加分）
// ---------------------------------------------------------------------------

async function loadPromoSnapshots(productIds: string[], purchaseDate: string): Promise<Map<string, RecommendationPromoSnapshot[]>> {
  const byProduct = new Map<string, RecommendationPromoSnapshot[]>()
  if (productIds.length === 0) return byProduct
  const { data, error } = await queryByChunks<RecommendationPromoSnapshot & { card_product_id: string | null }, string>(
    productIds,
    (chunk, placeholders) => ({
      sql: `SELECT id, card_product_id, title, description
            FROM promos
            WHERE card_product_id IN (${placeholders})
              AND (end_date IS NULL OR end_date >= ?)
            ORDER BY created_at DESC LIMIT 200`,
      params: [...chunk, purchaseDate],
    })
  )
  if (error) throw new Error(error.message)
  for (const row of data || []) {
    if (!row.card_product_id) continue
    const list = byProduct.get(row.card_product_id)
    if (list) list.push({ id: row.id, title: row.title, description: row.description })
    else byProduct.set(row.card_product_id, [{ id: row.id, title: row.title, description: row.description }])
  }
  return byProduct
}

// ---------------------------------------------------------------------------
// 快照组装
// ---------------------------------------------------------------------------

function toCardCurrency(row: RecommendationCardRow): string {
  return row.product_currency || row.account_currency || 'CNY'
}

function buildSnapshots(input: {
  rows: RecommendationCardRow[]
  unpaidByCard: Map<string, number>
  tasksByCard: Map<string, RecommendationTaskSnapshot[]>
  opportunitiesByCard: Map<string, RecommendationOpportunitySnapshot[]>
  promosByProduct: Map<string, RecommendationPromoSnapshot[]>
  purchaseDate: string
}): RecommendationCardSnapshot[] {
  const poolUnpaid = new Map<string, number>()
  for (const row of input.rows) {
    if (!row.account_id) continue
    const current = poolUnpaid.get(row.account_id) ?? 0
    poolUnpaid.set(row.account_id, current + (input.unpaidByCard.get(row.id) ?? 0))
  }
  // 共享额度池口径必须与 lib/account-pools.ts:resolvePoolLimit 完全同源：
  // 有 shared_credit_limit 时无论 quota_mode 都用它；否则 shared 取最大额，独立额度相加。
  const groupsByAccount = new Map<string, RecommendationCardRow[]>()
  for (const row of input.rows) {
    if (!row.account_id) continue
    const list = groupsByAccount.get(row.account_id)
    if (list) list.push(row)
    else groupsByAccount.set(row.account_id, [row])
  }
  const sharedAccountIds = new Set<string>()
  const poolLimitByAccount = new Map<string, number | null>()
  for (const [accountId, groupRows] of groupsByAccount.entries()) {
    const first = groupRows[0]
    const isShared = first.quota_mode === 'shared' || (first.shared_credit_limit ?? 0) > 0
    if (isShared) sharedAccountIds.add(accountId)
    poolLimitByAccount.set(
      accountId,
      resolvePoolLimit(
        {
          shared_credit_limit: first.shared_credit_limit ?? null,
          quota_mode: isShared ? 'shared' : 'independent',
        } as unknown as CreditAccount,
        groupRows.map(row => ({
          card: {
            status: row.status,
            credit_limit: row.credit_limit,
            credit_limit_override: row.credit_limit_override ?? null,
          },
          unpaidAmount: input.unpaidByCard.get(row.id) ?? 0,
        })) as unknown as CardWithBillsSummary[],
        isShared
      )
    )
  }

  return input.rows.map(row => {
    const cardCurrency = toCardCurrency(row)
    const isSharedQuota = !!row.account_id && sharedAccountIds.has(row.account_id)
    const tasks: RecommendationTaskSnapshot[] = [...(input.tasksByCard.get(row.id) ?? [])]
    const waiverTask = buildWaiverTaskFromProgress({
      title: '年费减免门槛',
      currency: cardCurrency,
      rulesJson: row.p_annual_fee_waiver_rules_json ?? null,
      progressJson: row.cc_waiver_progress_json ?? null,
      deadline: row.cc_next_annual_fee_date ?? null,
    })
    if (waiverTask) tasks.push(waiverTask)

    return {
      id: row.id,
      holder_id: row.holder_id,
      holder_name: row.holder_name,
      card_currency: cardCurrency,
      status: row.status as RecommendationCardSnapshot['status'],
      card_type: row.card_type as RecommendationCardSnapshot['card_type'],
      billing_day: row.billing_day,
      override_billing_day: row.override_billing_day ?? null,
      override_due_type: row.override_due_type as RecommendationCardSnapshot['override_due_type'],
      override_due_value: row.override_due_value ?? null,
      credit_limit: row.credit_limit,
      credit_limit_override: row.credit_limit_override ?? null,
      annual_fee_override: row.annual_fee_override ?? null,
      annual_fee_status: (row.cc_annual_fee_status ?? null) as AnnualFeeStatus | null,
      waiver_progress_json: row.cc_waiver_progress_json ?? null,
      next_annual_fee_date: row.cc_next_annual_fee_date ?? null,
      bank_name: row.bank_name || row.product_bank_name || '未知银行',
      card_name: row.name_override || row.product_card_name || '信用卡',
      card_number_last4: row.card_number_last4,
      is_shared_quota: isSharedQuota,
      pool_limit: isSharedQuota && row.account_id ? poolLimitByAccount.get(row.account_id) ?? null : null,
      pool_unpaid_total: isSharedQuota && row.account_id ? poolUnpaid.get(row.account_id) ?? 0 : 0,
      card_unpaid_total: input.unpaidByCard.get(row.id) ?? 0,
      product: row.product_id
        ? {
            currency: row.product_currency || 'CNY',
            payment_due_type: (row.payment_due_type || 'after_billing') as CardProduct['payment_due_type'],
            payment_due_value: row.payment_due_value ?? 20,
            annual_fee: row.product_annual_fee ?? null,
            annual_fee_waiver: row.product_annual_fee_waiver ?? null,
            rewards_summary: row.rewards_summary ?? null,
            ftf_rate: row.p_ftf_rate ?? null,
            fx_free_currencies_json: row.p_fx_free_currencies_json ?? null,
            reward_rules_json: row.p_reward_rules_json ?? null,
            annual_fee_cycle_type: (row.p_annual_fee_cycle_type ?? null) as AnnualFeeCycleType | null,
            annual_fee_waiver_rules_json: row.p_annual_fee_waiver_rules_json ?? null,
          }
        : null,
      tasks,
      opportunities: input.opportunitiesByCard.get(row.id) ?? [],
      promos: row.product_id ? input.promosByProduct.get(row.product_id) ?? [] : [],
    }
  })
}

// ---------------------------------------------------------------------------
// RPC 1：消费前 Top 3 推荐
// ---------------------------------------------------------------------------

export async function getCardRecommendations(
  actor: OpportunityActor,
  rawInput: PurchaseRecommendationInput
): Promise<RecommendationEngineOutput> {
  const input = normalizeInput(rawInput)
  const rows = await selectCardRows(actor, { holderId: normalizeHolderFilter(rawInput.holder_id) })
  const cardIds = rows.map(row => row.id)
  const holderIds = Array.from(new Set(rows.map(row => row.holder_id)))

  const [unpaidByCard, taskRows, opportunityRows, rates] = await Promise.all([
    loadUnpaidByCard(cardIds),
    loadActiveTaskRows(holderIds, input.purchase_date),
    loadOpportunityRows(cardIds, input.purchase_date),
    fetchRates(),
  ])
  const tasksByCard = buildTaskSnapshots(taskRows)
  const opportunitiesByCard = buildOpportunitySnapshots(opportunityRows, input.purchase_date)
  const productIds = Array.from(new Set(rows.map(row => row.product_id).filter((id): id is string => !!id)))
  const promosByProduct = await loadPromoSnapshots(productIds, input.purchase_date)

  const cards = buildSnapshots({
    rows,
    unpaidByCard,
    tasksByCard,
    opportunitiesByCard,
    promosByProduct,
    purchaseDate: input.purchase_date,
  })

  return rankCardsForPurchase({
    amount: input.amount,
    currency: input.currency,
    category: input.category,
    merchant_keyword: input.merchant_keyword,
    purchase_date: input.purchase_date,
    optimize_for: input.optimize_for,
    display_currency: input.display_currency,
    cards,
    rates,
  })
}

// ---------------------------------------------------------------------------
// 第 2 轮：ROI 三组聚合
// ---------------------------------------------------------------------------

interface RoiUsageRow {
  card_id: string
  used_on: string
  quantity: number
  amount_minor: number
  definition_kind: string
  cycle_currency: string | null
  account_id: string
  definition_id: string
  account_unit_minor: number | null
  account_value_currency: string | null
  definition_unit_minor: number | null
  definition_value_currency: string | null
}

interface RoiPromoRow {
  card_id: string
  used_on: string
  cashback_amount: number
  cashback_currency: string | null
}

interface RoiFulfillmentRow {
  card_id: string | null
  recorded_on: string
  amount_minor: number
  reward_amount_minor: number | null
  card_ids_json: string | null
}

interface RoiAggregateInput {
  cardIds: string[]
  holderIds: string[]
  /** 全局并集窗口：第 2 轮 SQL 只绑定这 2 个参数 */
  windowStart: string
  windowEndExclusive: string
  /**
   * 每张卡自己的统计窗口（current_cycle 下各卡周年日不同）。SQL 只按并集取数，
   * 回到内存后再按卡窗口过滤，避免把别张卡周期的核销算进来。
   */
  cardWindows?: Map<string, { start: string; end: string }>
}

interface RoiAggregates {
  benefitsByCard: Map<string, number>
  promoByCard: Map<string, number>
  taskByCard: Map<string, number>
  benefitCountByCard: Map<string, number>
  promoCountByCard: Map<string, number>
  taskCountByCard: Map<string, number>
  unvaluedByCard: Map<string, UnvaluedBenefitRef[]>
}

async function loadRoiAggregates(input: RoiAggregateInput): Promise<RoiAggregates> {
  const empty = {
    benefitsByCard: new Map<string, number>(),
    promoByCard: new Map<string, number>(),
    taskByCard: new Map<string, number>(),
    benefitCountByCard: new Map<string, number>(),
    promoCountByCard: new Map<string, number>(),
    taskCountByCard: new Map<string, number>(),
    unvaluedByCard: new Map<string, UnvaluedBenefitRef[]>(),
  }
  if (input.cardIds.length === 0) return empty

  const valuationReady = await hasColumns('opportunity_definitions', ['estimated_unit_value_minor'])
  const promoCashbackReady = await hasColumns('promo_usages', ['cashback_amount'])
  const unitColumns = valuationReady
    ? `a.estimated_unit_value_minor AS account_unit_minor,
       a.estimated_value_currency AS account_value_currency,
       d.estimated_unit_value_minor AS definition_unit_minor,
       d.estimated_value_currency AS definition_value_currency`
    : `NULL AS account_unit_minor, NULL AS account_value_currency,
       NULL AS definition_unit_minor, NULL AS definition_value_currency`

  const [usageResult, promoResult, fulfillmentResult] = await Promise.all([
    // 组 A：opportunity_usages 精确归因
    queryByChunks<RoiUsageRow, string>(input.cardIds, (chunk, placeholders) => ({
      sql: `SELECT u.card_id, u.used_on, u.quantity, u.amount_minor, d.kind AS definition_kind,
               cy.currency AS cycle_currency, a.id AS account_id, d.id AS definition_id,
               ${unitColumns}
            FROM opportunity_usages u
            JOIN opportunity_cycles cy ON cy.id = u.cycle_id
            JOIN opportunity_accounts a ON a.id = u.account_id
            JOIN opportunity_definitions d ON d.id = a.definition_id
            WHERE u.card_id IN (${placeholders}) AND u.status = 'active'
              AND u.used_on >= ? AND u.used_on < ?`,
      params: [...chunk, input.windowStart, input.windowEndExclusive],
    })),
    // 组 B：promo_usages（排除已迁入台账的 legacy 记录，防双算）
    queryByChunks<RoiPromoRow, string>(input.cardIds, (chunk, placeholders) => ({
      sql: promoCashbackReady
        ? `SELECT pu.card_id, substr(pu.used_at, 1, 10) AS used_on, pu.cashback_amount, pu.cashback_currency
             FROM promo_usages pu
             WHERE pu.card_id IN (${placeholders}) AND pu.cashback_amount > 0
               AND substr(pu.used_at, 1, 10) >= ? AND substr(pu.used_at, 1, 10) < ?
               AND NOT EXISTS (
                 SELECT 1 FROM opportunity_legacy_links ll
                 WHERE ll.source_table = 'promo_usages' AND ll.source_id = pu.id
               )`
        : `SELECT NULL AS card_id, 0 AS cashback_amount, NULL AS cashback_currency WHERE 0`,
      params: promoCashbackReady ? [...chunk, input.windowStart, input.windowEndExclusive] : [],
    })),
    // 组 C：任务奖励（仅 task_result，配额型 grant/claim/booking 不在此统计）
    queryByChunks<RoiFulfillmentRow, string>(input.holderIds, (chunk, placeholders) => ({
      sql: `SELECT f.card_id, f.recorded_on, f.amount_minor,
               CAST(json_extract(tc.reward_snapshot_json, '$.amount_minor') AS INTEGER) AS reward_amount_minor,
               t.card_ids_json
            FROM opportunity_fulfillments f
            JOIN opportunity_task_cycles tc ON tc.id = f.task_cycle_id
            JOIN opportunity_tasks t ON t.id = tc.task_id
            WHERE f.holder_id IN (${placeholders}) AND f.kind = 'task_result'
              AND f.status != 'cancelled' AND f.recorded_on >= ? AND f.recorded_on < ?`,
      params: [...chunk, input.windowStart, input.windowEndExclusive],
    })),
  ])
  if (usageResult.error) throw new Error(usageResult.error.message)
  if (promoResult.error) throw new Error(promoResult.error.message)
  if (fulfillmentResult.error) throw new Error(fulfillmentResult.error.message)

  const bump = (map: Map<string, number>, key: string, value: number) =>
    map.set(key, (map.get(key) ?? 0) + value)
  // 并集窗口取数后按卡窗口过滤：current_cycle 下每张卡的周年日不同
  const inCardWindow = (cardId: string, dateOn: string): boolean => {
    const window = input.cardWindows?.get(cardId)
    if (!window) return true
    return dateOn >= window.start && dateOn < window.end
  }

  for (const row of usageResult.data || []) {
    if (!inCardWindow(row.card_id, row.used_on)) continue
    const isBenefit = row.definition_kind === 'benefit'
    if (row.amount_minor > 0) {
      bump(isBenefit ? empty.benefitsByCard : empty.promoByCard, row.card_id, row.amount_minor / 100)
      bump(
        isBenefit ? empty.benefitCountByCard : empty.promoCountByCard,
        row.card_id,
        1
      )
      continue
    }
    const unitMinor = row.account_unit_minor ?? row.definition_unit_minor
    if (unitMinor !== null && unitMinor > 0) {
      bump(isBenefit ? empty.benefitsByCard : empty.promoByCard, row.card_id, (row.quantity * unitMinor) / 100)
      bump(isBenefit ? empty.benefitCountByCard : empty.promoCountByCard, row.card_id, 1)
      continue
    }
    // 未估值：金额记 0，但权益数量必须披露
    if (isBenefit) {
      const list = empty.unvaluedByCard.get(row.card_id) ?? []
      list.push({
        account_id: row.account_id,
        definition_id: row.definition_id,
        quantity: row.quantity,
      })
      empty.unvaluedByCard.set(row.card_id, list)
      bump(empty.benefitCountByCard, row.card_id, 1)
    }
  }

  for (const row of promoResult.data || []) {
    if (!row.card_id || !inCardWindow(row.card_id, row.used_on)) continue
    bump(empty.promoByCard, row.card_id, Number(row.cashback_amount) || 0)
    bump(empty.promoCountByCard, row.card_id, 1)
  }

  for (const row of fulfillmentResult.data || []) {
    const amountMinor = row.amount_minor > 0 ? row.amount_minor : row.reward_amount_minor ?? 0
    if (amountMinor <= 0) continue
    let cardId = row.card_id
    if (!cardId && row.card_ids_json) {
      try {
        const ids = JSON.parse(row.card_ids_json) as string[]
        if (Array.isArray(ids) && ids.length === 1) cardId = ids[0]
      } catch {
        cardId = null
      }
    }
    if (!cardId || !inCardWindow(cardId, row.recorded_on)) continue
    bump(empty.taskByCard, cardId, amountMinor / 100)
    bump(empty.taskCountByCard, cardId, 1)
  }

  return empty
}

// ---------------------------------------------------------------------------
// RPC 2：单卡年费 ROI
// ---------------------------------------------------------------------------

export interface CardAnnualFeeRoiOptions {
  period_mode?: RoiPeriodMode
  year?: number | null
}

function buildCardRoi(
  row: RecommendationCardRow,
  aggregate: RoiAggregates,
  periodMode: RoiPeriodMode,
  window: { period_start: string; period_end_exclusive: string; window_mode_resolved: RoiWindowMode }
): CardAnnualFeeRoiDetail {
  const cardCurrency = toCardCurrency(row)
  const unvaluedRefs = aggregate.unvaluedByCard.get(row.id) ?? []
  return computeCardAnnualFeeRoi({
    card: {
      id: row.id,
      holder_id: row.holder_id,
      holder_name: row.holder_name,
      bank_name: row.bank_name || row.product_bank_name || '未知银行',
      card_name: row.name_override || row.product_card_name || '信用卡',
      card_number_last4: row.card_number_last4,
      currency: cardCurrency,
      annual_fee_status: (row.cc_annual_fee_status ?? null) as AnnualFeeStatus | null,
      actual_fee_paid: row.cc_actual_fee_paid ?? null,
      manual_reward_value: row.cc_manual_reward_value ?? null,
      annual_fee_override: row.annual_fee_override ?? null,
      product_annual_fee: row.product_annual_fee ?? null,
    },
    period_mode: periodMode,
    period_start: window.period_start,
    period_end_exclusive: window.period_end_exclusive,
    window_mode_resolved: window.window_mode_resolved,
    redeemed_benefits_value: aggregate.benefitsByCard.get(row.id) ?? 0,
    promo_and_reward_value: aggregate.promoByCard.get(row.id) ?? 0,
    task_reward_value: aggregate.taskByCard.get(row.id) ?? 0,
    benefit_usage_count: aggregate.benefitCountByCard.get(row.id) ?? 0,
    promo_usage_count: aggregate.promoCountByCard.get(row.id) ?? 0,
    task_result_count: aggregate.taskCountByCard.get(row.id) ?? 0,
    unvalued_benefit_count: unvaluedRefs.reduce((sum, ref) => sum + ref.quantity, 0),
    unvalued_benefit_refs: unvaluedRefs,
  })
}

export async function getCardAnnualFeeRoi(
  actor: OpportunityActor,
  cardId: string,
  options: CardAnnualFeeRoiOptions = {}
): Promise<CardAnnualFeeRoiDetail> {
  await assertCardAccess(cardId, actor)
  const rows = await selectCardRows(actor, { cardId })
  const row = rows[0]
  if (!row) throw forbiddenOrNotFound('card')
  const periodMode: RoiPeriodMode = options.period_mode ?? 'current_cycle'
  const window = resolveRoiWindow({
    period_mode: periodMode,
    today_on: todayOn(),
    year: options.year ?? null,
    next_due_date: row.cc_next_annual_fee_date ?? null,
  })
  const aggregate = await loadRoiAggregates({
    cardIds: [row.id],
    holderIds: [row.holder_id],
    windowStart: window.period_start,
    windowEndExclusive: window.period_end_exclusive,
  })
  return buildCardRoi(row, aggregate, periodMode, window)
}

// ---------------------------------------------------------------------------
// RPC 3：全家庭年费 ROI 看板（固定 2 轮往返）
// ---------------------------------------------------------------------------

export interface FamilyAnnualFeeRoiFilters {
  holder_id?: string | null
  period_mode?: RoiPeriodMode
  year?: number | null
  display_currency?: string | null
}

export async function getFamilyAnnualFeeRoi(
  actor: OpportunityActor,
  filters: FamilyAnnualFeeRoiFilters = {}
): Promise<FamilyAnnualFeeRoiBoard> {
  const periodMode: RoiPeriodMode = filters.period_mode ?? 'last_12m'
  const today = todayOn()
  // 第 1 轮：作用域内全部信用卡
  const rows = await selectCardRows(actor, { holderId: normalizeHolderFilter(filters.holder_id) })
  if (rows.length === 0) {
    return aggregateFamilyAnnualFeeRoi([], filters.display_currency ?? 'CNY', null)
  }

  // 内存算出每张卡窗口，取全局并集边界，保证第 2 轮只有 2 个绑定参数
  const windows = new Map<string, {
    start: string
    end: string
    mode: RoiWindowMode
  }>()
  let globalStart = ''
  let globalEnd = ''
  for (const row of rows) {
    const window = resolveRoiWindow({
      period_mode: periodMode,
      today_on: today,
      year: filters.year ?? null,
      next_due_date: row.cc_next_annual_fee_date ?? null,
    })
    windows.set(row.id, {
      start: window.period_start,
      end: window.period_end_exclusive,
      mode: window.window_mode_resolved,
    })
    if (!globalStart || window.period_start < globalStart) globalStart = window.period_start
    if (!globalEnd || window.period_end_exclusive > globalEnd) globalEnd = window.period_end_exclusive
  }

  const [aggregate, rates] = await Promise.all([
    loadRoiAggregates({
      cardIds: rows.map(row => row.id),
      holderIds: Array.from(new Set(rows.map(row => row.holder_id))),
      windowStart: globalStart,
      windowEndExclusive: globalEnd,
      cardWindows: new Map(
        Array.from(windows.entries()).map(([cardId, window]) => [
          cardId,
          { start: window.start, end: window.end },
        ])
      ),
    }),
    fetchRates(),
  ])

  const details: CardAnnualFeeRoiDetail[] = []
  for (const row of rows) {
    const window = windows.get(row.id)
    if (!window) continue
    details.push(
      buildCardRoi(row, aggregate, periodMode, {
        period_start: window.start,
        period_end_exclusive: window.end,
        window_mode_resolved: window.mode,
      })
    )
  }
  return aggregateFamilyAnnualFeeRoi(details, filters.display_currency ?? null, rates)
}

// ---------------------------------------------------------------------------
// RPC 4：本周期消费额参考（松耦合，只预填表单）
// ---------------------------------------------------------------------------

export interface CardCycleSpendEstimate {
  card_id: string
  period_start: string
  period_end_exclusive: string
  window_mode_resolved: string
  spend_amount: number
  spend_count: number
  currency: string
  source: 'bill_items' | 'bills' | 'none'
}

export async function getCardCycleSpendEstimate(
  actor: OpportunityActor,
  cardId: string
): Promise<CardCycleSpendEstimate> {
  await assertCardAccess(cardId, actor)
  const rows = await selectCardRows(actor, { cardId })
  const row = rows[0]
  if (!row) throw forbiddenOrNotFound('card')
  const currency = toCardCurrency(row)
  const window = resolveRoiWindow({
    period_mode: 'current_cycle',
    today_on: todayOn(),
    next_due_date: row.cc_next_annual_fee_date ?? null,
  })

  const { data: itemRows } = await query<{ spend: number; cnt: number }>(
    `SELECT COALESCE(SUM(bi.amount), 0) AS spend, COUNT(bi.id) AS cnt
     FROM bill_items bi
     WHERE bi.card_id = ? AND substr(bi.created_at, 1, 10) >= ? AND substr(bi.created_at, 1, 10) < ?`,
    [cardId, window.period_start, window.period_end_exclusive]
  )
  if (itemRows && itemRows.length > 0 && Number(itemRows[0].cnt) > 0) {
    return {
      card_id: cardId,
      period_start: window.period_start,
      period_end_exclusive: window.period_end_exclusive,
      window_mode_resolved: window.window_mode_resolved,
      spend_amount: round2(Number(itemRows[0].spend) || 0),
      spend_count: Number(itemRows[0].cnt) || 0,
      currency,
      source: 'bill_items',
    }
  }

  const { data: billRows } = await query<{ spend: number; cnt: number }>(
    `SELECT COALESCE(SUM(b.bill_amount), 0) AS spend, COUNT(b.id) AS cnt
     FROM bills b
     WHERE b.card_id = ? AND substr(b.statement_date, 1, 10) >= ? AND substr(b.statement_date, 1, 10) < ?`,
    [cardId, window.period_start, window.period_end_exclusive]
  )
  const billSpend = billRows && billRows.length > 0 ? Number(billRows[0].spend) || 0 : 0
  const billCount = billRows && billRows.length > 0 ? Number(billRows[0].cnt) || 0 : 0
  return {
    card_id: cardId,
    period_start: window.period_start,
    period_end_exclusive: window.period_end_exclusive,
    window_mode_resolved: window.window_mode_resolved,
    spend_amount: round2(billSpend),
    spend_count: billCount,
    currency,
    source: billCount > 0 ? 'bills' : 'none',
  }
}

// ---------------------------------------------------------------------------
// RPC 5：权益单次估值补填（一键补填，解锁 ROI 估值）
// ---------------------------------------------------------------------------

export interface OpportunityValuationInput {
  target_kind: 'account' | 'definition'
  target_id: string
  estimated_unit_value_minor: number | null
  estimated_value_currency: string | null
}

export async function updateOpportunityValuation(
  actor: OpportunityActor,
  input: OpportunityValuationInput
): Promise<{ ok: true; revision: number }> {
  if (!input || (input.target_kind !== 'account' && input.target_kind !== 'definition')) {
    throw invalidId(input?.target_kind, 'target_kind')
  }
  if (typeof input.target_id !== 'string' || input.target_id.length === 0) {
    throw invalidId(input.target_id, 'target_id')
  }
  const value =
    input.estimated_unit_value_minor === null
      ? null
      : Number(input.estimated_unit_value_minor)
  if (value !== null && (!Number.isInteger(value) || value <= 0)) {
    throw new Error('单次估值必须为正整数（最小货币单位）')
  }
  const currency = input.estimated_value_currency
    ? normalizeCurrency(input.estimated_value_currency)
    : null
  if (input.estimated_value_currency && !currency) {
    throw new Error('估值币种必须是三字母代码')
  }
  if (value !== null && !currency) {
    throw new Error('填写估值金额时必须同时填写估值币种')
  }

  if (input.target_kind === 'account') {
    await assertAccountAccess(input.target_id, actor)
    await ensureValuationColumns()
    const { error } = await execute(
      `UPDATE opportunity_accounts
          SET estimated_unit_value_minor = ?, estimated_value_currency = ?, revision = revision + 1
        WHERE id = ?`,
      [value, currency, input.target_id]
    )
    if (error) throw new Error(error.message)
    const { data } = await queryOne<{ revision: number }>(
      'SELECT revision FROM opportunity_accounts WHERE id = ?',
      [input.target_id]
    )
    return { ok: true, revision: data?.revision ?? 0 }
  }

  // 目录级默认估值影响所有持卡人，仅管理员可改
  if (actor.role !== 'admin') {
    throw forbiddenOrNotFound('definition')
  }
  await ensureValuationColumns()
  const { error } = await execute(
    `UPDATE opportunity_definitions
        SET estimated_unit_value_minor = ?, estimated_value_currency = ?, revision = revision + 1
      WHERE id = ?`,
    [value, currency, input.target_id]
  )
  if (error) throw new Error(error.message)
  const { data } = await queryOne<{ revision: number }>(
    'SELECT revision FROM opportunity_definitions WHERE id = ?',
    [input.target_id]
  )
  return { ok: true, revision: data?.revision ?? 0 }
}

async function ensureValuationColumns(): Promise<void> {
  const ready = await Promise.all([
    hasColumns('opportunity_definitions', ['estimated_unit_value_minor', 'estimated_value_currency']),
    hasColumns('opportunity_accounts', ['estimated_unit_value_minor', 'estimated_value_currency']),
  ])
  if (!ready.every(Boolean)) {
    throw new Error('权益估值字段尚未迁移（HUB-176 0044 未合入），暂不支持补填估值')
  }
}

// ---------------------------------------------------------------------------
// RPC 6：优惠实得返现补录（进入 ROI 的 promo_and_reward_value）
// ---------------------------------------------------------------------------

export interface PromoUsageCashbackInput {
  promo_id: string
  card_id: string
  used_at: string
  cashback_amount: number
  cashback_currency?: string | null
  note?: string | null
  usage_id?: string | null
}

export async function upsertPromoUsageCashback(
  actor: OpportunityActor,
  input: PromoUsageCashbackInput
): Promise<{ id: string; usage_id: string }> {
  if (!input || typeof input.card_id !== 'string') throw invalidId(input?.card_id, 'card_id')
  await assertCardAccess(input.card_id, actor)
  const amount = Number(input.cashback_amount)
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('返现金额必须是正数')
  }
  const currency = normalizeCurrency(input.cashback_currency) || 'CNY'
  if (!/^\d{4}-\d{2}-\d{2}/.test(input.used_at || '')) {
    throw new Error('used_at 必须是合法日期')
  }
  if (!(await hasColumns('promo_usages', ['cashback_amount', 'cashback_currency']))) {
    throw new Error('优惠返现字段尚未迁移（HUB-176 0044 未合入），暂不支持补录')
  }

  const usageId = input.usage_id || uuid()
  const existing = input.usage_id
    ? await queryOne<{ id: string }>('SELECT id FROM promo_usages WHERE id = ?', [usageId])
    : { data: null, error: null }
  if (existing.error) throw new Error(existing.error.message)

  if (existing.data) {
    const { error } = await execute(
      `UPDATE promo_usages
          SET cashback_amount = ?, cashback_currency = ?, note = COALESCE(?, note)
        WHERE id = ? AND card_id = ?`,
      [amount, currency, input.note ?? null, usageId, input.card_id]
    )
    if (error) throw new Error(error.message)
    return { id: usageId, usage_id: usageId }
  }

  const { error } = await execute(
    `INSERT INTO promo_usages (id, promo_id, card_id, used_at, note, cashback_amount, cashback_currency, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      usageId,
      input.promo_id,
      input.card_id,
      input.used_at,
      input.note ?? null,
      amount,
      currency,
      dbNow(),
    ]
  )
  if (error) throw new Error(error.message)
  return { id: usageId, usage_id: usageId }
}
