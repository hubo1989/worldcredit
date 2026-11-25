// lib/recommendations/types.ts — 消费前最优用卡推荐引擎的输入/输出 DTO、
// 卡产品结构化规则契约与预设权重常量（HUB-177 / Spec 07）。
//
// 本文件与 rules.ts / engine.ts / roi.ts 一样是纯模块：不 import lib/db，
// 不发网络请求，因此可以被 Vitest 完整覆盖，也可以被浏览器与 Worker 共用。
// 金额口径一律为「主币种单位」（如 123.45 表示 123.45 元），与 lib/fx.ts 一致。

import type { FxRates } from '../fx'
import type { CardProduct, CreditCard } from '../types'

// ---------------------------------------------------------------------------
// 消费类目（9 大标准类目，与方向 3 lib/finance/categories.ts 去掉 fees_interest 后 1:1）
// ---------------------------------------------------------------------------

export const RECOMMENDATION_CATEGORIES = [
  'dining',
  'shopping',
  'travel',
  'transport',
  'utilities',
  'entertainment',
  'medical',
  'education',
  'other',
] as const

export type RecommendationCategory = (typeof RECOMMENDATION_CATEGORIES)[number]

/** 消费类目 → WC-BEN-12 RuleCategory 的确定性映射（用于权益/优惠协同加分）。 */
export const CATEGORY_TO_OPPORTUNITY_CATEGORIES: Record<
  RecommendationCategory,
  readonly ('food' | 'shopping' | 'transport' | 'travel' | 'health' | 'membership' | 'other')[]
> = {
  dining: ['food'],
  shopping: ['shopping'],
  travel: ['travel'],
  transport: ['transport'],
  utilities: ['other'],
  entertainment: ['membership', 'other'],
  medical: ['health'],
  education: ['other'],
  other: ['other'],
}

export function isRecommendationCategory(value: unknown): value is RecommendationCategory {
  return typeof value === 'string' && (RECOMMENDATION_CATEGORIES as readonly string[]).includes(value)
}

// ---------------------------------------------------------------------------
// 年费周期与状态枚举（与 0043/0044 CHECK 约束保持一致）
// ---------------------------------------------------------------------------

export type AnnualFeeCycleType =
  | 'none'
  | 'anniversary_issued'
  | 'anniversary_activated'
  | 'calendar_year'
  | 'custom_date'

export type AnnualFeeStatus = 'not_applicable' | 'in_progress' | 'waived' | 'paid' | 'unknown'

export type OptimizeFor = 'balanced' | 'max_reward' | 'longest_grace' | 'task_first'

export const OPTIMIZE_FOR_MODES: readonly OptimizeFor[] = [
  'balanced',
  'max_reward',
  'longest_grace',
  'task_first',
]

// ---------------------------------------------------------------------------
// 卡产品结构化规则（card_products.reward_rules_json / *_waiver_rules_json）
// ---------------------------------------------------------------------------

export interface CategoryRewardRuleV1 {
  category: RecommendationCategory
  /** 等效返现率百分点（4.5 = 4.50%），>= 0 */
  rate_pct: number
  raw_label?: string | null
  /** 原始积分倍率，仅供后台编辑器联动展示 */
  points_multiplier?: number | null
  /** 'all' | 'domestic' | 'foreign' | 币种代码数组 */
  currency_scope?: 'all' | 'domestic' | 'foreign' | string[]
  /** 月度返现上限（卡产品原币种） */
  monthly_cap_amount?: number | null
  /** 单笔起算金额门槛（卡产品原币种） */
  min_txn_amount?: number | null
}

export interface RewardRulesV1 {
  schema_version: 1
  reward_kind: 'cashback' | 'points' | 'miles'
  point_unit_name?: string | null
  point_value_per_unit?: number | null
  /** 一般消费基础等效返现率（%） */
  base_rate_pct: number
  base_raw_label?: string | null
  category_rules: CategoryRewardRuleV1[]
  notes?: string | null
}

export type AnnualFeeWaiverType =
  | 'none'
  | 'first_year_free'
  | 'spend_amount'
  | 'spend_count'
  | 'spend_amount_or_count'
  | 'points_redeem'

export const ANNUAL_FEE_WAIVER_TYPES: readonly AnnualFeeWaiverType[] = [
  'none',
  'first_year_free',
  'spend_amount',
  'spend_count',
  'spend_amount_or_count',
  'points_redeem',
]

export interface AnnualFeeWaiverRuleV1 {
  schema_version: 1
  waiver_type: AnnualFeeWaiverType
  first_year_free?: boolean
  /** 目标消费金额（默认卡币种） */
  target_amount?: number | null
  target_currency?: string | null
  /** 目标消费笔数（正整数） */
  target_count?: number | null
  /** 单笔合格消费最低金额（默认卡币种） */
  per_txn_min_amount?: number | null
  /** 积分抵扣所需积分数 */
  points_cost?: number | null
  notes?: string | null
}

/** credit_cards.waiver_progress_json：用户手动维护的免年费达标进度。 */
export interface WaiverProgressV1 {
  schema_version: 1
  cycle_due_date?: string | null
  /** 本周期已达标金额（卡币种） */
  amount: number
  /** 本周期已达标笔数 */
  count: number
  updated_at?: string | null
  note?: string | null
}

/** 管理端 AI 规则草稿（只预览、不落库）。 */
export interface CardProductStructuredRulesDraft {
  ftf_rate: number | null
  fx_free_currencies: string[]
  reward_rules: RewardRulesV1 | null
  annual_fee_cycle_type: AnnualFeeCycleType | null
  annual_fee_waiver_rules: AnnualFeeWaiverRuleV1 | null
  /** 依据等级：official = 抓到官网页面；model = 仅模型推断 */
  provenance: 'official' | 'model'
  notes: string | null
}

// ---------------------------------------------------------------------------
// 规则完整度与评分状态
// ---------------------------------------------------------------------------

export type RuleCompleteness = 'complete' | 'partial' | 'none'

export type CreditCheck = 'sufficient' | 'unknown_limit' | 'unknown_fx'

export type FtfStatus = 'same_currency' | 'waived_currency' | 'waived' | 'charged' | 'unknown'

// ---------------------------------------------------------------------------
// 推荐引擎输入快照（服务端从 DB 组装，引擎本身零 IO）
// ---------------------------------------------------------------------------

export interface RecommendationProductSnapshot {
  currency: string
  payment_due_type: CardProduct['payment_due_type']
  payment_due_value: number
  annual_fee: number | null
  annual_fee_waiver?: string | null
  rewards_summary?: string | null
  /** 0043 结构化规则列（缺列时为 null） */
  ftf_rate: number | null
  fx_free_currencies_json: string | null
  reward_rules_json: string | null
  annual_fee_cycle_type: AnnualFeeCycleType | null
  annual_fee_waiver_rules_json: string | null
}

/** 未达标任务的统一快照：卡级免年费门槛与 WC-BEN-12 任务在这里合并。 */
export interface RecommendationTaskSnapshot {
  source: 'annual_fee_waiver' | 'opportunity_task'
  id: string
  title: string
  /** 任务计价币种 */
  currency: string
  /** 截止日（YYYY-MM-DD）；未知为 null */
  deadline: string | null
  /** 金额缺口（任务币种）；无金额维度为 null */
  amount_gap: number | null
  /** 笔数缺口；无笔数维度为 null */
  count_gap: number | null
  /** 单笔最低消费门槛（任务币种） */
  per_txn_min_amount: number | null
  task_type: 'annual_fee' | 'welcome' | 'monthly_spend' | 'custom' | null
}

export interface RecommendationOpportunitySnapshot {
  id: string
  kind: 'benefit' | 'promo' | 'private_reward' | 'legacy_promo'
  title: string
  status_label: string
  status: 'expiring_soon' | 'available_today' | 'other'
  /** WC-BEN-12 RuleCategory */
  category: string | null
  target_url: string
}

export interface RecommendationPromoSnapshot {
  id: string
  title: string
  description: string | null
}

export interface RecommendationCardSnapshot {
  id: string
  holder_id: string
  holder_name: string
  card_currency: string
  status: CreditCard['status']
  card_type: CreditCard['card_type']
  billing_day: number
  override_billing_day?: number | null
  override_due_type?: CreditCard['override_due_type']
  override_due_value?: number | null
  credit_limit: number
  credit_limit_override?: number | null
  annual_fee_override?: number | null
  /** 0044 持卡年费追踪列（缺列时为 null） */
  annual_fee_status: AnnualFeeStatus | null
  waiver_progress_json: string | null
  next_annual_fee_date: string | null
  bank_name: string
  card_name: string
  card_number_last4: string | null
  is_shared_quota: boolean
  /** 共享额度池有效总额度（非共享时为 null） */
  pool_limit: number | null
  /** 同池全部卡片未还账单合计 */
  pool_unpaid_total: number
  /** 本卡未还账单 */
  card_unpaid_total: number
  product: RecommendationProductSnapshot | null
  tasks: RecommendationTaskSnapshot[]
  opportunities: RecommendationOpportunitySnapshot[]
  promos: RecommendationPromoSnapshot[]
}

export interface RecommendationEngineInput {
  amount: number
  currency: string
  category: RecommendationCategory | null
  merchant_keyword: string | null
  purchase_date: string
  optimize_for: OptimizeFor
  display_currency: string | null
  cards: RecommendationCardSnapshot[]
  rates: FxRates | null
}

// ---------------------------------------------------------------------------
// 推荐输出
// ---------------------------------------------------------------------------

export type ScoreFactor =
  | 'reward'
  | 'ftf'
  | 'currency_match'
  | 'grace_period'
  | 'task_bonus'
  | 'opportunity_bonus'

export interface ScoreBreakdownItem {
  factor: ScoreFactor
  score: number
  label: string
  rule_source: string
}

export interface MatchedOpportunityItem {
  id: string
  kind: RecommendationOpportunitySnapshot['kind']
  title: string
  status_label: string
  target_url: string
}

export interface CardRecommendationItem {
  rank: number
  card_id: string
  holder_id: string
  holder_name: string
  bank_name: string
  card_name: string
  card_number_last4: string | null
  card_currency: string
  total_score: number
  net_rate_pct: number
  estimated_net_reward_purchase_ccy: number
  estimated_net_reward_display_ccy: number | null
  grace_days: number
  next_billing_date: string
  next_due_date: string
  available_credit: number | null
  is_shared_quota: boolean
  credit_check: CreditCheck
  rule_completeness: RuleCompleteness
  ftf_status: FtfStatus
  rewards_summary_fallback: string | null
  score_breakdown: ScoreBreakdownItem[]
  matched_opportunities: MatchedOpportunityItem[]
  warnings: string[]
  skipped_task_hints: string[]
}

export type ExcludeCode =
  | 'card_frozen'
  | 'card_cancelled'
  | 'insufficient_credit'
  | 'shared_pool_insufficient_credit'

export interface ExcludedCardItem {
  card_id: string
  holder_id: string
  holder_name: string
  bank_name: string
  card_name: string
  card_number_last4: string | null
  card_currency: string
  exclude_code: ExcludeCode
  reason: string
  available_credit: number | null
  required_in_card_currency: number | null
}

export type RecommendationEmptyReason =
  | 'no_credit_cards'
  | 'all_frozen_or_cancelled'
  | 'all_insufficient_credit'
  | null

export interface RecommendationEngineOutput {
  purchase_date: string
  optimize_for: OptimizeFor
  fx_available: boolean
  all_cards_unconfigured: boolean
  banner_warnings: string[]
  empty_reason: RecommendationEmptyReason
  top_recommendations: CardRecommendationItem[]
  other_candidates: CardRecommendationItem[]
  excluded_cards: ExcludedCardItem[]
}

/** 客户端入参（RPC 层），服务端补 purchase_date / display_currency 后喂给引擎。 */
export interface PurchaseRecommendationInput {
  amount: number
  currency: string
  category?: RecommendationCategory | null
  /** admin 可传 'all' 或具体 holder_id；member 仅限本人 holder_id */
  holder_id?: string | null
  merchant_keyword?: string | null
  purchase_date?: string | null
  optimize_for?: OptimizeFor
  display_currency?: string | null
}

// ---------------------------------------------------------------------------
// 预设权重（1 分 = 1.00% 等效消费净收益率）
// ---------------------------------------------------------------------------

export interface RecommendationPreset {
  W_reward: number
  W_ftf: number
  W_grace: number
  MAX_TASK_BONUS: number
}

export const RECOMMENDATION_PRESETS: Record<OptimizeFor, RecommendationPreset> = {
  balanced: { W_reward: 1.0, W_ftf: 1.0, W_grace: 1.0, MAX_TASK_BONUS: 5.0 },
  max_reward: { W_reward: 1.0, W_ftf: 1.0, W_grace: 0.2, MAX_TASK_BONUS: 0.0 },
  longest_grace: { W_reward: 0.6, W_ftf: 1.0, W_grace: 3.0, MAX_TASK_BONUS: 2.0 },
  task_first: { W_reward: 0.8, W_ftf: 1.0, W_grace: 0.5, MAX_TASK_BONUS: 8.0 },
}

/** 统一两位小数舍入（规避 0.1+0.2 类浮点误差）。 */
export function round2(value: number): number {
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100
  return Object.is(rounded, -0) ? 0 : rounded
}
