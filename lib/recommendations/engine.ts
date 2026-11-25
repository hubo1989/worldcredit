// lib/recommendations/engine.ts — 可解释用卡推荐评分引擎（纯函数，零 IO）。
//
// 量纲：1 分 = 1.00% 等效消费净收益率。
//   total = reward_score + ftf_score + currency_match_bonus + grace_score
//         + task_bonus_score + opportunity_bonus_score
// 每一分都必须能在 score_breakdown 里找到来源（卡产品结构化规则 / 旧文本 / 免息期计算），
// 绝不做黑盒推荐。

import { convert, type FxRates } from '../fx'
import { getEffectiveCreditLimit } from '../utils'
import { computeCardGraceWindowOnDate } from '../notifications.shared'
import {
  computeProductRuleCompleteness,
  matchRewardRule,
  parseAnnualFeeCycleType,
  parseAnnualFeeWaiverRules,
  parseFxFreeCurrencies,
  parseRewardRules,
  parseWaiverProgress,
} from './rules'
import {
  CATEGORY_TO_OPPORTUNITY_CATEGORIES,
  RECOMMENDATION_PRESETS,
  round2,
  type CardRecommendationItem,
  type CreditCheck,
  type ExcludedCardItem,
  type FtfStatus,
  type MatchedOpportunityItem,
  type RecommendationCardSnapshot,
  type RecommendationEngineInput,
  type RecommendationEngineOutput,
  type RecommendationTaskSnapshot,
  type RuleCompleteness,
  type ScoreBreakdownItem,
} from './types'

const TASK_URGENCY_UNKNOWN = 0.25
const OPPORTUNITY_BONUS_CAP = 2.0
const EXPIRING_SOON_BONUS = 1.5
const AVAILABLE_TODAY_BONUS = 1.0
const PROMO_WEAK_MATCH_BONUS = 0.3
const CURRENCY_MATCH_BONUS = 0.2
const GRACE_DAYS_SCALE = 60
const TOP_N = 3
/** 同分判定阈值：低于该差值视为并列，进入 6 级决胜。 */
const SCORE_TIE_EPSILON = 0.005

interface ScoredCard {
  item: CardRecommendationItem
  /** 决胜用内部字段，不进响应体。 */
  tieBreak: {
    completenessRank: number
    currencyMatch: boolean
    hasImminentTask: boolean
    graceDays: number
    availableCredit: number | null
    creditCheckRank: number
  }
}

function completenessRank(value: RuleCompleteness): number {
  return value === 'complete' ? 2 : value === 'partial' ? 1 : 0
}

function creditCheckRank(value: CreditCheck): number {
  return value === 'sufficient' ? 2 : value === 'unknown_limit' ? 1 : 0
}

/** 确定性 6 级同分决胜。 */
function compareScored(a: ScoredCard, b: ScoredCard): number {
  const scoreDiff = b.item.total_score - a.item.total_score
  if (Math.abs(scoreDiff) >= SCORE_TIE_EPSILON) return scoreDiff
  if (a.tieBreak.completenessRank !== b.tieBreak.completenessRank) {
    return b.tieBreak.completenessRank - a.tieBreak.completenessRank
  }
  if (a.tieBreak.currencyMatch !== b.tieBreak.currencyMatch) {
    return a.tieBreak.currencyMatch ? -1 : 1
  }
  if (a.tieBreak.hasImminentTask !== b.tieBreak.hasImminentTask) {
    return a.tieBreak.hasImminentTask ? -1 : 1
  }
  if (a.tieBreak.graceDays !== b.tieBreak.graceDays) {
    return b.tieBreak.graceDays - a.tieBreak.graceDays
  }
  if (a.tieBreak.creditCheckRank !== b.tieBreak.creditCheckRank) {
    return b.tieBreak.creditCheckRank - a.tieBreak.creditCheckRank
  }
  const aCredit = a.tieBreak.availableCredit
  const bCredit = b.tieBreak.availableCredit
  if (aCredit !== null && bCredit !== null && aCredit !== bCredit) return bCredit - aCredit
  return a.item.card_id.localeCompare(b.item.card_id)
}

function toPurchaseCurrency(
  amount: number,
  from: string,
  to: string,
  rates: FxRates | null
): number | null {
  return convert(amount, from, to, rates)
}

function formatMoney(amount: number, currency: string): string {
  return `${amount.toFixed(2)} ${currency}`
}

function ruleSourceLabel(card: RecommendationCardSnapshot): string {
  return card.product
    ? `卡产品结构化规则 · ${card.bank_name} ${card.card_name}`
    : `卡产品文本兜底 · ${card.bank_name} ${card.card_name}`
}

/** 距截止日天数（负数表示已过期）；截止日未知返回 null。 */
function daysUntil(deadline: string | null, purchaseDate: string): number | null {
  if (!deadline) return null
  const diff = Math.round(
    (Date.parse(`${deadline}T00:00:00Z`) - Date.parse(`${purchaseDate}T00:00:00Z`)) / 86_400_000
  )
  return Number.isFinite(diff) ? diff : null
}

function urgencyFactor(daysLeft: number | null): number {
  if (daysLeft === null) return TASK_URGENCY_UNKNOWN
  if (daysLeft <= 7) return 1.0
  if (daysLeft <= 30) return 0.7
  if (daysLeft <= 90) return 0.4
  return 0.2
}

function baseTaskWeight(task: RecommendationTaskSnapshot): number {
  if (task.source === 'annual_fee_waiver') return 4.0
  return task.task_type === 'annual_fee' || task.task_type === 'welcome' ? 4.0 : 3.0
}

/** 推进贡献度：金额缺口与笔数缺口按 AND 组取均值，组间 OR 由调用方取最大。 */
function progressContribution(
  task: RecommendationTaskSnapshot,
  purchaseInTaskCurrency: number | null
): number {
  const contributions: number[] = []
  if (task.amount_gap !== null && task.amount_gap > 0) {
    contributions.push(purchaseInTaskCurrency === null ? 0 : Math.min(1, purchaseInTaskCurrency / task.amount_gap))
  }
  if (task.count_gap !== null && task.count_gap > 0) {
    contributions.push(Math.min(1, 1 / task.count_gap))
  }
  if (contributions.length === 0) return 0
  return contributions.reduce((sum, value) => sum + value, 0) / contributions.length
}

interface TaskBonusResult {
  score: number
  skippedHints: string[]
}

/**
 * 临近达标任务加分：
 * - 同卡的「卡级免年费门槛」与「annual_fee 类任务」按卡去重，取最高分者（防双倍加分）；
 * - 其余任务（welcome / monthly_spend / custom）正常累加；
 * - 总和以 MAX_TASK_BONUS 封顶；max_reward 模式直接 0。
 */
function computeTaskBonus(
  card: RecommendationCardSnapshot,
  purchaseInTaskCurrency: (currency: string) => number | null,
  purchaseDate: string,
  maxTaskBonus: number
): TaskBonusResult {
  if (maxTaskBonus <= 0) return { score: 0, skippedHints: [] }

  const candidates: Array<{ score: number; feeWaiverGroup: boolean }> = []
  const skippedHints: string[] = []

  for (const task of card.tasks) {
    const perTxnMin = task.per_txn_min_amount
    if (perTxnMin !== null && perTxnMin > 0) {
      const amountInTaskCurrency = purchaseInTaskCurrency(task.currency)
      if (amountInTaskCurrency === null) {
        skippedHints.push(`${task.title}：缺少汇率，无法判断单笔门槛`)
        continue
      }
      if (amountInTaskCurrency < perTxnMin) {
        skippedHints.push(`当前消费金额低于「${task.title}」单笔门槛 ${formatMoney(perTxnMin, task.currency)}`)
        continue
      }
    }
    const daysLeft = daysUntil(task.deadline, purchaseDate)
    const contribution = progressContribution(task, purchaseInTaskCurrency(task.currency))
    if (contribution <= 0) continue
    const score = round2(baseTaskWeight(task) * urgencyFactor(daysLeft) * contribution)
    candidates.push({
      score,
      feeWaiverGroup: task.source === 'annual_fee_waiver' || task.task_type === 'annual_fee',
    })
  }

  const feeWaiverScore = candidates
    .filter(entry => entry.feeWaiverGroup)
    .reduce((max, entry) => Math.max(max, entry.score), 0)
  const otherScore = candidates
    .filter(entry => !entry.feeWaiverGroup)
    .reduce((sum, entry) => sum + entry.score, 0)
  const total = feeWaiverScore + otherScore
  return { score: round2(Math.min(maxTaskBonus, total)), skippedHints }
}

interface OpportunityBonusResult {
  score: number
  matched: MatchedOpportunityItem[]
}

function matchesKeyword(text: string | null, keyword: string | null): boolean {
  if (!keyword || !text) return false
  return text.toLowerCase().includes(keyword.trim().toLowerCase())
}

function computeOpportunityBonus(
  card: RecommendationCardSnapshot,
  category: RecommendationEngineInput['category'],
  merchantKeyword: string | null
): OpportunityBonusResult {
  const allowedCategories = category ? CATEGORY_TO_OPPORTUNITY_CATEGORIES[category] : null
  let score = 0
  const matched: MatchedOpportunityItem[] = []

  for (const opportunity of card.opportunities) {
    if (opportunity.status !== 'expiring_soon' && opportunity.status !== 'available_today') continue
    const categoryMatched =
      !allowedCategories ||
      !opportunity.category ||
      allowedCategories.includes(opportunity.category as never)
    const keywordMatched = matchesKeyword(opportunity.title, merchantKeyword)
    if (!categoryMatched && !keywordMatched) continue
    score += opportunity.status === 'expiring_soon' ? EXPIRING_SOON_BONUS : AVAILABLE_TODAY_BONUS
    matched.push({
      id: opportunity.id,
      kind: opportunity.kind,
      title: opportunity.title,
      status_label: opportunity.status_label,
      target_url: opportunity.target_url,
    })
  }

  for (const promo of card.promos) {
    if (matchesKeyword(promo.title, merchantKeyword) || matchesKeyword(promo.description, merchantKeyword)) {
      score += PROMO_WEAK_MATCH_BONUS
    }
  }

  return { score: round2(Math.min(OPPORTUNITY_BONUS_CAP, score)), matched }
}

export interface ScoreCardResult {
  item: CardRecommendationItem
  excluded: ExcludedCardItem | null
}

/** 单卡评分：返回推荐项或被拦截原因（额度不足 / 冻结 / 注销）。 */
export function scoreCardForPurchase(
  card: RecommendationCardSnapshot,
  input: RecommendationEngineInput
): ScoreCardResult {
  const preset = RECOMMENDATION_PRESETS[input.optimize_for]
  const warnings: string[] = []
  const skippedTaskHints: string[] = []
  const purchaseCurrency = input.currency
  const cardCurrency = card.card_currency

  // ---- 前置：状态拦截 ----
  if (card.status !== 'active') {
    return {
      item: blankItem(card, input),
      excluded: {
        card_id: card.id,
        holder_id: card.holder_id,
        holder_name: card.holder_name,
        bank_name: card.bank_name,
        card_name: card.card_name,
        card_number_last4: card.card_number_last4,
        card_currency: cardCurrency,
        exclude_code: card.status === 'frozen' ? 'card_frozen' : 'card_cancelled',
        reason: card.status === 'frozen' ? '卡片已冻结' : '卡片已注销',
        available_credit: null,
        required_in_card_currency: null,
      },
    }
  }

  // ---- 跨币种折算与可用授信 ----
  const purchaseInCardCurrency = toPurchaseCurrency(
    input.amount,
    purchaseCurrency,
    cardCurrency,
    input.rates
  )
  let creditCheck: CreditCheck = 'sufficient'
  if (purchaseCurrency !== cardCurrency && purchaseInCardCurrency === null) {
    creditCheck = 'unknown_fx'
    warnings.push('汇率暂缺，跨币种可用额度与折算净收益暂不可用')
  }

  let availableCredit: number | null
  let effectiveLimit: number | null
  if (card.is_shared_quota && card.pool_limit !== null) {
    effectiveLimit = card.pool_limit
    availableCredit = Math.max(0, card.pool_limit - card.pool_unpaid_total)
  } else if (card.is_shared_quota) {
    // 共享池但额度未知：未知额度保留参评，交由用户确认
    effectiveLimit = null
    availableCredit = null
  } else {
    effectiveLimit = getEffectiveCreditLimit(card)
    availableCredit = effectiveLimit === null ? null : Math.max(0, effectiveLimit - card.card_unpaid_total)
  }

  if (effectiveLimit === null && creditCheck === 'sufficient') {
    creditCheck = 'unknown_limit'
    warnings.push('未设置卡片额度，请确认剩余额度充足')
  }

  if (
    availableCredit !== null &&
    purchaseInCardCurrency !== null &&
    availableCredit + 1e-6 < purchaseInCardCurrency
  ) {
    const isSharedPool = card.is_shared_quota
    return {
      item: blankItem(card, input),
      excluded: {
        card_id: card.id,
        holder_id: card.holder_id,
        holder_name: card.holder_name,
        bank_name: card.bank_name,
        card_name: card.card_name,
        card_number_last4: card.card_number_last4,
        card_currency: cardCurrency,
        exclude_code: isSharedPool ? 'shared_pool_insufficient_credit' : 'insufficient_credit',
        reason: isSharedPool
          ? `共享额度池可用额度不足（剩余 ${formatMoney(availableCredit, cardCurrency)}）`
          : `卡片可用额度不足（剩余 ${formatMoney(availableCredit, cardCurrency)}）`,
        available_credit: availableCredit,
        required_in_card_currency: purchaseInCardCurrency,
      },
    }
  }

  // ---- 1) reward_score ----
  const rewardRules = parseRewardRules(card.product?.reward_rules_json ?? null)
  const matched = matchRewardRule(
    rewardRules,
    input.category,
    purchaseInCardCurrency ?? input.amount,
    purchaseCurrency,
    cardCurrency
  )
  const rewardScore = round2(matched.rate_pct * preset.W_reward)
  const grossRewardPurchaseCcy = round2((input.amount * matched.rate_pct) / 100)

  const breakdown: ScoreBreakdownItem[] = []
  if (rewardRules) {
    const ruleLabel = matched.matched_rule?.raw_label ?? matched.raw_label
    breakdown.push({
      factor: 'reward',
      score: rewardScore,
      label: `${ruleLabel ?? '结构化回报规则'}，等效返现 ${matched.rate_pct.toFixed(2)}%（预计赚取 ${formatMoney(
        grossRewardPurchaseCcy,
        purchaseCurrency
      )}）`,
      rule_source: ruleSourceLabel(card),
    })
  } else {
    breakdown.push({
      factor: 'reward',
      score: 0,
      label: '未配置回报规则（按 0% 兜底）',
      rule_source: ruleSourceLabel(card),
    })
  }

  // ---- 2) ftf_score ----
  const fxFreeCurrencies = parseFxFreeCurrencies(card.product?.fx_free_currencies_json ?? null)
  const ftfRate = card.product?.ftf_rate ?? null
  let effectiveFtfPct = 0
  let ftfStatus: FtfStatus = 'same_currency'
  if (purchaseCurrency !== cardCurrency) {
    if (fxFreeCurrencies && fxFreeCurrencies.includes(purchaseCurrency)) {
      effectiveFtfPct = 0
      ftfStatus = 'waived_currency'
    } else if (ftfRate !== null) {
      effectiveFtfPct = ftfRate
      ftfStatus = ftfRate === 0 ? 'waived' : 'charged'
    } else {
      effectiveFtfPct = 0
      ftfStatus = 'unknown'
      warnings.push('未配置外币手续费（FTF）规则，暂按 0% 估算，实际可能产生 1%–2% 货转费')
    }
  }
  const ftfScore = round2(-effectiveFtfPct * preset.W_ftf)
  breakdown.push({
    factor: 'ftf',
    score: ftfScore,
    label:
      ftfStatus === 'same_currency'
        ? '同币种消费，无外币手续费'
        : ftfStatus === 'waived_currency' || ftfStatus === 'waived'
          ? `该币种免外币手续费（${purchaseCurrency}）`
          : ftfStatus === 'unknown'
            ? '未配置 FTF 规则，暂按 0% 估算'
            : `外币手续费 ${effectiveFtfPct.toFixed(2)}% 已扣除`,
    rule_source: card.product ? '卡产品结构化规则 · FTF' : '卡产品未配置 FTF',
  })

  // ---- 3) currency_match_bonus ----
  const currencyMatch = purchaseCurrency === cardCurrency
  const currencyMatchScore = currencyMatch ? CURRENCY_MATCH_BONUS : 0
  breakdown.push({
    factor: 'currency_match',
    score: currencyMatchScore,
    label: currencyMatch ? '同币种消费，无汇损' : '跨币种消费，存在汇兑损益',
    rule_source: '消费币种与卡币种比对',
  })

  // ---- 4) grace_score ----
  const graceWindow = computeCardGraceWindowOnDate(
    {
      billing_day: card.billing_day,
      override_billing_day: card.override_billing_day ?? null,
      override_due_type: card.override_due_type ?? null,
      override_due_value: card.override_due_value ?? null,
      payment_due_type: card.product?.payment_due_type ?? 'after_billing',
      payment_due_value: card.product?.payment_due_value ?? 20,
    },
    input.purchase_date
  )
  const clampedGraceDays = Math.min(Math.max(graceWindow.graceDays, 0), GRACE_DAYS_SCALE)
  const graceScore = round2((clampedGraceDays / GRACE_DAYS_SCALE) * preset.W_grace)
  breakdown.push({
    factor: 'grace_period',
    score: graceScore,
    label: `免息期 ${graceWindow.graceDays} 天（${graceWindow.nextBillingDate} 出账 / ${graceWindow.nextDueDate} 到期）`,
    rule_source: '账单日与还款规则推算',
  })

  // ---- 5) task_bonus_score ----
  const taskBonus = computeTaskBonus(
    card,
    currency => toPurchaseCurrency(input.amount, purchaseCurrency, currency, input.rates),
    input.purchase_date,
    preset.MAX_TASK_BONUS
  )
  skippedTaskHints.push(...taskBonus.skippedHints)
  if (taskBonus.score > 0) {
    breakdown.push({
      factor: 'task_bonus',
      score: taskBonus.score,
      label: '临近达标任务/免年费门槛加权',
      rule_source: '免年费门槛与消费达标任务',
    })
  }

  // ---- 6) opportunity_bonus_score ----
  const opportunityBonus = computeOpportunityBonus(card, input.category, input.merchant_keyword)
  if (opportunityBonus.score > 0) {
    breakdown.push({
      factor: 'opportunity_bonus',
      score: opportunityBonus.score,
      label: `可叠加权益/优惠 ${opportunityBonus.matched.length} 项`,
      rule_source: 'WC-BEN-12 权益台账与优惠活动',
    })
  }

  const totalScore = round2(
    rewardScore +
      ftfScore +
      currencyMatchScore +
      graceScore +
      taskBonus.score +
      opportunityBonus.score
  )
  const netRatePct = round2(matched.rate_pct - effectiveFtfPct)
  const estimatedNetRewardPurchaseCcy = round2((input.amount * netRatePct) / 100)
  const estimatedNetRewardDisplayCcy = input.display_currency
    ? toPurchaseCurrency(
        estimatedNetRewardPurchaseCcy,
        purchaseCurrency,
        input.display_currency,
        input.rates
      )
    : null

  const completeness: RuleCompleteness = computeProductRuleCompleteness({
    reward_rules: rewardRules,
    ftf_rate: ftfRate,
    fx_free_currencies: fxFreeCurrencies,
    annual_fee_cycle_type: parseAnnualFeeCycleType(card.product?.annual_fee_cycle_type ?? null),
    annual_fee_waiver_rules: parseAnnualFeeWaiverRules(
      card.product?.annual_fee_waiver_rules_json ?? null
    ),
  })

  const item: CardRecommendationItem = {
    rank: 0,
    card_id: card.id,
    holder_id: card.holder_id,
    holder_name: card.holder_name,
    bank_name: card.bank_name,
    card_name: card.card_name,
    card_number_last4: card.card_number_last4,
    card_currency: cardCurrency,
    total_score: totalScore,
    net_rate_pct: netRatePct,
    estimated_net_reward_purchase_ccy: estimatedNetRewardPurchaseCcy,
    estimated_net_reward_display_ccy:
      estimatedNetRewardDisplayCcy === null ? null : round2(estimatedNetRewardDisplayCcy),
    grace_days: graceWindow.graceDays,
    next_billing_date: graceWindow.nextBillingDate,
    next_due_date: graceWindow.nextDueDate,
    available_credit: availableCredit,
    is_shared_quota: card.is_shared_quota,
    credit_check: creditCheck,
    rule_completeness: completeness,
    ftf_status: ftfStatus,
    rewards_summary_fallback: card.product?.rewards_summary ?? null,
    score_breakdown: breakdown,
    matched_opportunities: opportunityBonus.matched,
    warnings,
    skipped_task_hints: skippedTaskHints,
  }

  return {
    item,
    excluded: null,
  }
}

function blankItem(card: RecommendationCardSnapshot, input: RecommendationEngineInput): CardRecommendationItem {
  return {
    rank: 0,
    card_id: card.id,
    holder_id: card.holder_id,
    holder_name: card.holder_name,
    bank_name: card.bank_name,
    card_name: card.card_name,
    card_number_last4: card.card_number_last4,
    card_currency: card.card_currency,
    total_score: 0,
    net_rate_pct: 0,
    estimated_net_reward_purchase_ccy: 0,
    estimated_net_reward_display_ccy: null,
    grace_days: 0,
    next_billing_date: input.purchase_date,
    next_due_date: input.purchase_date,
    available_credit: null,
    is_shared_quota: card.is_shared_quota,
    credit_check: 'unknown_limit',
    rule_completeness: 'none',
    ftf_status: 'unknown',
    rewards_summary_fallback: card.product?.rewards_summary ?? null,
    score_breakdown: [],
    matched_opportunities: [],
    warnings: [],
    skipped_task_hints: [],
  }
}

/** 决胜字段由引擎内部组装（响应体不暴露）。 */
function tieBreakOf(
  item: CardRecommendationItem,
  card: RecommendationCardSnapshot,
  purchaseCurrency: string,
  purchaseDate: string
) {
  return {
    completenessRank: completenessRank(item.rule_completeness),
    currencyMatch: purchaseCurrency === card.card_currency,
    hasImminentTask: card.tasks.some(task => {
      const days = daysUntil(task.deadline, purchaseDate)
      return days !== null && days <= 30
    }),
    graceDays: item.grace_days,
    availableCredit: item.available_credit,
    creditCheckRank: creditCheckRank(item.credit_check),
  }
}

/**
 * 排序并切分 Top 3。贷款卡不参与（也不计入 excluded_cards）；
 * empty_reason 在没有任何合格候选时给出确定原因。
 */
export function rankCardsForPurchase(input: RecommendationEngineInput): RecommendationEngineOutput {
  const creditCards = input.cards.filter(card => card.card_type === 'credit')
  const scored: ScoredCard[] = []
  const excluded: ExcludedCardItem[] = []

  for (const card of creditCards) {
    const result = scoreCardForPurchase(card, input)
    if (result.excluded) {
      excluded.push(result.excluded)
      continue
    }
    scored.push({
      item: result.item,
      tieBreak: tieBreakOf(result.item, card, input.currency, input.purchase_date),
    })
  }

  scored.sort(compareScored)
  scored.forEach((entry, index) => {
    entry.item.rank = index + 1
  })

  const items = scored.map(entry => entry.item)
  const bannerWarnings: string[] = []
  const unconfiguredCount = items.filter(item => item.rule_completeness === 'none').length
  const allCardsUnconfigured = items.length > 0 && unconfiguredCount === items.length
  if (allCardsUnconfigured) {
    bannerWarnings.push('当前卡片均未配置结构化回报规则，已按「同币种 + 最长免息期」保底排序')
  }

  let emptyReason: RecommendationEngineOutput['empty_reason'] = null
  if (creditCards.length === 0) {
    emptyReason = 'no_credit_cards'
  } else if (items.length === 0 && excluded.length > 0) {
    const onlyCredit =
      excluded.every(entry => entry.exclude_code === 'insufficient_credit') ||
      excluded.every(entry => entry.exclude_code === 'shared_pool_insufficient_credit')
    emptyReason = onlyCredit ? 'all_insufficient_credit' : 'all_frozen_or_cancelled'
  }

  return {
    purchase_date: input.purchase_date,
    optimize_for: input.optimize_for,
    fx_available: input.rates !== null,
    all_cards_unconfigured: allCardsUnconfigured,
    banner_warnings: bannerWarnings,
    empty_reason: emptyReason,
    top_recommendations: items.slice(0, TOP_N),
    other_candidates: items.slice(TOP_N),
    excluded_cards: excluded,
  }
}

/** 解析 waiver_progress_json 并计算卡级免年费差额（供服务端组装任务快照）。 */
export function buildWaiverTaskFromProgress(input: {
  title: string
  currency: string
  rulesJson: string | null
  progressJson: string | null
  deadline: string | null
}): RecommendationTaskSnapshot | null {
  const rules = parseAnnualFeeWaiverRules(input.rulesJson)
  if (!rules) return null
  if (rules.waiver_type !== 'spend_amount' && rules.waiver_type !== 'spend_count' && rules.waiver_type !== 'spend_amount_or_count') {
    return null
  }
  const progress = parseWaiverProgress(input.progressJson)
  const amount = progress?.amount ?? 0
  const count = progress?.count ?? 0
  const amountGap =
    rules.target_amount != null && rules.target_amount > 0
      ? Math.max(0, rules.target_amount - amount)
      : null
  const countGap =
    rules.target_count != null && rules.target_count > 0
      ? Math.max(0, rules.target_count - count)
      : null
  if (amountGap === null && countGap === null) return null
  const satisfied =
    rules.waiver_type === 'spend_amount_or_count'
      ? (amountGap === 0) || (countGap === 0)
      : amountGap === 0 && countGap === 0
  if (satisfied) return null
  return {
    source: 'annual_fee_waiver',
    id: `waiver:${input.title}`,
    title: input.title,
    currency: rules.target_currency ?? input.currency,
    deadline: input.deadline,
    amount_gap: amountGap,
    count_gap: countGap,
    per_txn_min_amount: rules.per_txn_min_amount ?? null,
    task_type: 'annual_fee',
  }
}
