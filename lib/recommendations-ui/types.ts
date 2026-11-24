import type { CardProduct, CreditCard, PromoUsage } from '@/lib/types'

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

export const RECOMMENDATION_CATEGORY_META: Record<
  RecommendationCategory,
  { label: string; hint: string }
> = {
  dining: { label: '餐饮美食', hint: '餐厅 / 咖啡 / 外卖' },
  shopping: { label: '日常购物', hint: '百货 / 电商 / 超市' },
  travel: { label: '旅行住宿', hint: '酒店 / OTA / 景区' },
  transport: { label: '交通出行', hint: '机票 / 高铁 / 打车加油' },
  utilities: { label: '生活缴费', hint: '水电燃气 / 话费物业' },
  entertainment: { label: '娱乐订阅', hint: '流媒体 / AI 订阅 / 影院' },
  medical: { label: '医疗健康', hint: '医院 / 体检 / 药房' },
  education: { label: '教育培训', hint: '学费 / 考试 / 课程' },
  other: { label: '其他消费', hint: '常规百货外消费 / 保险' },
}

export type OptimizeForMode = 'balanced' | 'max_reward' | 'longest_grace' | 'task_first'

export const OPTIMIZE_FOR_OPTIONS: Array<{ value: OptimizeForMode; label: string; desc: string }> = [
  { value: 'balanced', label: '综合最优', desc: '兼顾净返现、免息期与临近达标任务' },
  { value: 'max_reward', label: '净回报最高', desc: '仅看返现/积分减 FTF 的纯交易净收益' },
  { value: 'longest_grace', label: '免息期最长', desc: '大额消费优先争取最长资金周转期' },
  { value: 'task_first', label: '优先冲刺达标', desc: '优先推进临近免年费或开卡礼缺口' },
]

export type AnnualFeeCycleType =
  | 'none'
  | 'anniversary_issued'
  | 'anniversary_activated'
  | 'calendar_year'
  | 'custom_date'

export const ANNUAL_FEE_CYCLE_LABELS: Record<AnnualFeeCycleType, string> = {
  none: '终身免年费 / 无年费',
  anniversary_issued: '发卡/核卡周年日',
  anniversary_activated: '激活周年日',
  calendar_year: '固定公历日 / 账单年',
  custom_date: '手动指定下次扣费日',
}

export type AnnualFeeStatus = 'not_applicable' | 'in_progress' | 'waived' | 'paid' | 'unknown'

export const ANNUAL_FEE_STATUS_LABELS: Record<AnnualFeeStatus, string> = {
  not_applicable: '无年费',
  in_progress: '考核累积中',
  waived: '已免除 / 已达标',
  paid: '已扣年费',
  unknown: '状态未知',
}

export type AnnualFeeWaiverType =
  | 'none'
  | 'first_year_free'
  | 'spend_amount'
  | 'spend_count'
  | 'spend_amount_or_count'
  | 'points_redeem'

export const ANNUAL_FEE_WAIVER_TYPE_LABELS: Record<AnnualFeeWaiverType, string> = {
  none: '刚性年费不可免',
  first_year_free: '首年免年费',
  spend_amount: '累计消费满金额免',
  spend_count: '累计消费满笔数免',
  spend_amount_or_count: '金额或笔数达其一即免',
  points_redeem: '支持积分抵扣年费',
}

export interface CategoryRewardRuleV1 {
  category: RecommendationCategory
  rate_pct: number
  raw_label?: string | null
  points_multiplier?: number | null
  currency_scope?: 'all' | 'domestic' | 'foreign' | string[]
  monthly_cap_amount?: number | null
  min_txn_amount?: number | null
}

export interface RewardRulesV1 {
  schema_version: 1
  reward_kind: 'cashback' | 'points' | 'miles'
  point_unit_name?: string | null
  point_value_per_unit?: number | null
  base_rate_pct: number
  base_raw_label?: string | null
  category_rules: CategoryRewardRuleV1[]
  notes?: string | null
}

export interface AnnualFeeWaiverRuleV1 {
  schema_version: 1
  waiver_type: AnnualFeeWaiverType
  first_year_free?: boolean
  target_amount?: number | null
  target_currency?: string | null
  target_count?: number | null
  per_txn_min_amount?: number | null
  points_cost?: number | null
  notes?: string | null
}

export interface WaiverProgressV1 {
  schema_version: 1
  cycle_due_date?: string | null
  amount: number
  count: number
  points_redeemed?: number | null
  as_of_on: string
  source: 'manual' | 'bill_items_estimate' | 'bills_estimate'
  note?: string | null
}

export type CardProductWithRules = CardProduct & {
  ftf_rate?: number | null
  fx_free_currencies_json?: string | null
  reward_rules_json?: string | null
  annual_fee_cycle_type?: AnnualFeeCycleType | null
  annual_fee_waiver_rules_json?: string | null
  rules_updated_at?: string | null
}

export type CreditCardWithAnnualFee = CreditCard & {
  annual_fee_cycle_type?: AnnualFeeCycleType | null
  next_annual_fee_date?: string | null
  annual_fee_status?: AnnualFeeStatus | null
  waiver_progress_json?: string | null
  actual_fee_paid?: number | null
  manual_reward_value?: number | null
}

export interface PurchaseRecommendationInput {
  amount: number
  currency: string
  category?: RecommendationCategory | null
  holder_id?: string | null
  merchant_keyword?: string | null
  purchase_date?: string | null
  optimize_for?: OptimizeForMode
  display_currency?: string | null
}

export interface ScoreBreakdownItem {
  factor:
    | 'reward'
    | 'ftf'
    | 'currency_match'
    | 'grace_period'
    | 'task_bonus'
    | 'opportunity_bonus'
  score: number
  label: string
  rule_source: string
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
  credit_check: 'sufficient' | 'unknown_limit' | 'unknown_fx'
  rule_completeness: 'complete' | 'partial' | 'none'
  ftf_status: 'same_currency' | 'waived_currency' | 'waived' | 'charged' | 'unknown'
  rewards_summary_fallback: string | null
  score_breakdown: ScoreBreakdownItem[]
  matched_opportunities: Array<{
    id: string
    kind: 'benefit' | 'promo' | 'private_reward' | 'legacy_promo'
    title: string
    status_label: string
    target_url: string
  }>
  warnings: string[]
  skipped_task_hints: string[]
}

export interface ExcludedCardItem {
  card_id: string
  holder_id: string
  holder_name: string
  bank_name: string
  card_name: string
  card_number_last4: string | null
  card_currency: string
  exclude_code:
    | 'card_frozen'
    | 'card_cancelled'
    | 'insufficient_credit'
    | 'shared_pool_insufficient_credit'
  reason: string
  available_credit: number | null
  required_in_card_currency: number | null
}

export interface RecommendationEngineOutput {
  purchase_date: string
  optimize_for: OptimizeForMode
  fx_available: boolean
  all_cards_unconfigured: boolean
  banner_warnings: string[]
  empty_reason: 'no_credit_cards' | 'all_frozen_or_cancelled' | 'all_insufficient_credit' | null
  top_recommendations: CardRecommendationItem[]
  other_candidates: CardRecommendationItem[]
  excluded_cards: ExcludedCardItem[]
}

export type RoiDecisionTag =
  | 'free_earning'
  | 'free_idle'
  | 'keep_high_roi'
  | 'borderline_negotiate'
  | 'negative_downgrade_cancel'

export const ROI_DECISION_META: Record<
  RoiDecisionTag,
  { label: string; advice: string; badgeClass: string }
> = {
  free_earning: {
    label: '纯赚持有',
    advice: '免年费且持续创造收益，继续持有',
    badgeClass: 'bg-d-success-soft text-d-success-ink',
  },
  free_idle: {
    label: '闲置零成本卡',
    advice: '无年费压力，可作为备用额度/活动工具卡',
    badgeClass: 'bg-d-subtle text-d-muted',
  },
  keep_high_roi: {
    label: '高 ROI · 建议续卡',
    advice: '权益与返现已覆盖年费（覆盖率 ≥ 100%），值得续持',
    badgeClass: 'bg-d-gold-soft text-d-gold',
  },
  borderline_negotiate: {
    label: '临界持平 · 观察/谈心',
    advice: '接近回本，建议核对未用权益、补齐估值或联系银行谈心免除',
    badgeClass: 'bg-d-subtle text-d-warn-ink border border-d-warn-ink/30',
  },
  negative_downgrade_cancel: {
    label: '负 ROI · 建议降级或销卡',
    advice: '当前回报显著低于年费成本，续卡前建议评估降级无年费卡或销卡',
    badgeClass: 'bg-d-danger-soft text-d-danger-ink',
  },
}

export interface RoiUsageEntry {
  usage_id?: string
  account_id?: string | null
  definition_id?: string | null
  title: string
  kind: 'benefit' | 'promo' | 'private_reward' | 'task_result' | 'legacy_promo' | 'manual'
  used_on: string
  quantity: number
  value_in_card_currency: number
  needs_valuation?: boolean
}

export interface CardAnnualFeeRoiDetail {
  card_id: string
  holder_id: string
  holder_name: string
  bank_name: string
  card_name: string
  card_number_last4: string | null
  card_currency: string
  period_mode_requested: 'current_cycle' | 'last_12m' | 'year'
  window_mode_resolved: 'current_cycle' | 'last_12m' | 'last_12m_fallback' | 'year'
  window_start: string
  window_end_exclusive: string
  next_annual_fee_date: string | null
  days_until_annual_fee: number | null
  annual_fee_status: AnnualFeeStatus
  cost_basis: 'waived' | 'actual_paid' | 'estimated_nominal' | 'zero_fee'
  annual_fee_cost: number
  redeemed_benefits_value: number
  promo_and_reward_value: number
  manual_reward_value: number
  total_value: number
  net_value: number
  coverage_pct: number | null
  roi_pct: number | null
  decision_tag: RoiDecisionTag
  unvalued_benefit_count: number
  unvalued_opportunities: Array<{
    account_id: string | null
    definition_id: string | null
    title: string
    used_count: number
  }>
  entries?: RoiUsageEntry[]
}

export interface FamilyAnnualFeeRoiBoard {
  display_currency: string
  period_mode: 'last_12m' | 'current_cycle' | 'year'
  fx_available: boolean
  unconverted_currencies: string[]
  summary: {
    card_count: number
    pending_decision_30d_count: number
    total_annual_fee_cost: number
    total_redeemed_benefits_value: number
    total_promo_and_reward_value: number
    total_value: number
    net_value: number
    overall_roi_pct: number | null
    overall_coverage_pct: number | null
  }
  cards: CardAnnualFeeRoiDetail[]
}

export interface CardCycleSpendEstimate {
  card_id: string
  currency: string
  window_start: string
  window_end_exclusive: string
  estimated_amount: number
  estimated_count: number
  source: 'bill_items_estimate' | 'bills_estimate' | 'none'
  note: string
}

export interface CardProductStructuredRulesDraft {
  ftf_rate: number | null
  fx_free_currencies: string[]
  reward_rules: RewardRulesV1 | null
  annual_fee_cycle_type: AnnualFeeCycleType | null
  annual_fee_waiver_rules: AnnualFeeWaiverRuleV1 | null
  confidence_note?: string | null
}

export type ExtendedUpdateCardPatch = Partial<CreditCardWithAnnualFee> & {
  bank_id?: string
}

export type ExtendedCardProductPatch = Partial<CardProductWithRules> & {
  is_active?: boolean
}

export type ExtendedPromoUsage = PromoUsage & {
  cashback_amount?: number | null
  cashback_currency?: string | null
}
