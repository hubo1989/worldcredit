// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import React from 'react'

const mockRouterBack = vi.fn()
const mockRouterPush = vi.fn()
const mockRouterReplace = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ back: mockRouterBack, push: mockRouterPush, replace: mockRouterReplace }),
}))

let mockUser: { id: string; email: string; name: string; role: 'admin' | 'member' } = {
  id: 'u-admin',
  email: 'admin@example.com',
  name: '管理员',
  role: 'admin',
}

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ user: mockUser, loading: false }),
}))

vi.mock('@/lib/hooks/useUserPreferences', () => ({
  useUserPreferences: () => ({
    displayConfig: { default_currency: 'CNY', privacy_mode: false },
  }),
}))

vi.mock('@/lib/api/holders', () => ({
  getHolders: vi.fn(),
}))

vi.mock('@/lib/recommendations-ui/rpc', () => ({
  getCardRecommendations: vi.fn(),
  getCardAnnualFeeRoi: vi.fn(),
  getFamilyAnnualFeeRoi: vi.fn(),
  getCardCycleSpendEstimate: vi.fn(),
  updateOpportunityValuation: vi.fn(),
  upsertPromoUsageCashback: vi.fn(),
  updateCardAnnualFeeFields: vi.fn(),
  createAdminCardProductWithRules: vi.fn(),
  updateAdminCardProductWithRules: vi.fn(),
  previewCardProductRules: vi.fn(),
}))

import { getHolders } from '@/lib/api/holders'
import {
  getCardRecommendations,
  getCardAnnualFeeRoi,
  getFamilyAnnualFeeRoi,
  getCardCycleSpendEstimate,
  updateOpportunityValuation,
  updateCardAnnualFeeFields,
  previewCardProductRules,
} from '@/lib/recommendations-ui/rpc'
import { resolveAnnualFeeCycleLocal } from '@/lib/recommendations-ui/helpers'
import { CardRecommendationAssistant } from '@/components/mobile/CardRecommendationAssistant'
import { AnnualFeeRoiBoard } from '@/components/mobile/AnnualFeeRoiBoard'
import { CardAnnualFeeSection } from '@/components/mobile/CardAnnualFeeSection'
import { CardRoiSummaryCard } from '@/components/mobile/CardRoiSummaryCard'
import { CardProductRulesEditor } from '@/components/admin/CardProductRulesEditor'
import type {
  CardAnnualFeeRoiDetail,
  CardProductWithRules,
  CreditCardWithAnnualFee,
  FamilyAnnualFeeRoiBoard,
  RecommendationEngineOutput,
} from '@/lib/recommendations-ui/types'

const mockedGetHolders = vi.mocked(getHolders)
const mockedGetCardRecommendations = vi.mocked(getCardRecommendations)
const mockedGetCardAnnualFeeRoi = vi.mocked(getCardAnnualFeeRoi)
const mockedGetFamilyAnnualFeeRoi = vi.mocked(getFamilyAnnualFeeRoi)
const mockedGetCardCycleSpendEstimate = vi.mocked(getCardCycleSpendEstimate)
const mockedUpdateValuation = vi.mocked(updateOpportunityValuation)
const mockedUpdateCardAnnualFeeFields = vi.mocked(updateCardAnnualFeeFields)
const mockedPreviewCardProductRules = vi.mocked(previewCardProductRules)

function makeRecommendationOutput(
  overrides: Partial<RecommendationEngineOutput> = {}
): RecommendationEngineOutput {
  return {
    purchase_date: '2026-11-25',
    optimize_for: 'balanced',
    fx_available: true,
    all_cards_unconfigured: false,
    banner_warnings: [],
    empty_reason: null,
    top_recommendations: [
      {
        rank: 1,
        card_id: 'card-a',
        holder_id: 'holder-1',
        holder_name: '张三',
        bank_name: '招商银行',
        card_name: '经典白金卡',
        card_number_last4: '8888',
        card_currency: 'CNY',
        total_score: 4.78,
        net_rate_pct: 4.0,
        estimated_net_reward_purchase_ccy: 20,
        estimated_net_reward_display_ccy: 20,
        grace_days: 35,
        next_billing_date: '2026-12-05',
        next_due_date: '2026-12-25',
        available_credit: 42000,
        is_shared_quota: false,
        credit_check: 'sufficient',
        rule_completeness: 'complete',
        ftf_status: 'same_currency',
        rewards_summary_fallback: null,
        score_breakdown: [
          {
            factor: 'reward',
            score: 4.0,
            label: '餐饮返现 4.00%（预计赚取 ¥20.00）',
            rule_source: '卡产品结构化规则 · 招商银行 经典白金卡',
          },
          {
            factor: 'currency_match',
            score: 0.2,
            label: '本币消费无汇损 +0.20',
            rule_source: '同币种匹配',
          },
          {
            factor: 'grace_period',
            score: 0.58,
            label: '免息期 35 天 (+0.58)',
            rule_source: '账单日每月 5 日 · 还款 2026-12-25',
          },
        ],
        matched_opportunities: [
          {
            id: 'opp-1',
            kind: 'promo',
            title: '周三餐饮立减',
            status_label: '今日可用',
            target_url: '/promos?card=card-a',
          },
        ],
        warnings: [],
        skipped_task_hints: [],
      },
      {
        rank: 2,
        card_id: 'card-b',
        holder_id: 'holder-1',
        holder_name: '张三',
        bank_name: '建设银行',
        card_name: '冷门无规则卡',
        card_number_last4: '1234',
        card_currency: 'CNY',
        total_score: 0.8,
        net_rate_pct: 0,
        estimated_net_reward_purchase_ccy: 0,
        estimated_net_reward_display_ccy: 0,
        grace_days: 48,
        next_billing_date: '2026-12-10',
        next_due_date: '2026-12-30',
        available_credit: null,
        is_shared_quota: false,
        credit_check: 'unknown_limit',
        rule_completeness: 'none',
        ftf_status: 'same_currency',
        rewards_summary_fallback: '消费 1 元积 1 分',
        score_breakdown: [],
        matched_opportunities: [],
        warnings: ['未设置卡片额度，请确认剩余额度充足'],
        skipped_task_hints: ['当前消费金额低于该任务单笔门槛 ¥200'],
      },
    ],
    other_candidates: [],
    excluded_cards: [
      {
        card_id: 'card-frozen',
        holder_id: 'holder-1',
        holder_name: '张三',
        bank_name: '广发银行',
        card_name: '犀利卡',
        card_number_last4: '5678',
        card_currency: 'CNY',
        exclude_code: 'card_frozen',
        reason: '卡片已冻结',
        available_credit: null,
        required_in_card_currency: null,
      },
    ],
    ...overrides,
  }
}

describe('方向 4 前端：选卡助手、年费周期、ROI 看板与规则编辑器', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUser = {
      id: 'u-admin',
      email: 'admin@example.com',
      name: '管理员',
      role: 'admin',
    }
    mockedGetHolders.mockResolvedValue([
      {
        id: 'holder-1',
        name: '张三',
        created_by: 'u-admin',
        avatar_color: '#7aadff',
        created_at: '2026-01-01T00:00:00Z',
      },
      {
        id: 'holder-2',
        name: '李四',
        created_by: 'u-admin',
        avatar_color: '#7aadff',
        created_at: '2026-01-02T00:00:00Z',
      },
    ])
  })

  it('CardRecommendationAssistant 校验金额 > 0，展示 Top 3 得分拆解、空规则兜底与被拦截卡', async () => {
    mockedGetCardRecommendations.mockResolvedValue(makeRecommendationOutput())

    render(<CardRecommendationAssistant />)

    expect(await screen.findByText(/招商银行 · 经典白金卡/)).toBeInTheDocument()
    expect(screen.getByText('Top 1 · 最佳推荐')).toBeInTheDocument()
    expect(screen.getByText(/餐饮返现 4.00%/)).toBeInTheDocument()
    expect(screen.getByText('未配置回报规则（按 0% 兜底）')).toBeInTheDocument()

    // 展开被拦截卡
    fireEvent.click(screen.getByRole('button', { name: /查看全部候选与不推荐原因/ }))
    expect(screen.getByText('卡片已冻结')).toBeInTheDocument()

    // 校验金额 <= 0 阻止提交并内联报错
    const amountInput = screen.getByLabelText(/计划消费金额/)
    fireEvent.change(amountInput, { target: { value: '0' } })
    const callsBefore = mockedGetCardRecommendations.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: '计算最优刷卡建议' }))
    expect(screen.getByText('请输入大于 0 的消费金额')).toBeInTheDocument()
    expect(mockedGetCardRecommendations.mock.calls.length).toBe(callsBefore)
  })

  it('member 登录选卡助手不暴露其他家庭成员选择器', async () => {
    mockUser = { id: 'u-member', email: 'm@example.com', name: '成员', role: 'member' }
    mockedGetHolders.mockResolvedValue([
      {
        id: 'holder-2',
        name: '李四',
        created_by: 'u-admin',
        auth_user_id: 'u-member',
        avatar_color: '#7aadff',
        created_at: '2026-01-02T00:00:00Z',
      },
    ])
    mockedGetCardRecommendations.mockResolvedValue(makeRecommendationOutput())

    render(<CardRecommendationAssistant />)
    await screen.findByText(/招商银行 · 经典白金卡/)

    fireEvent.click(screen.getByRole('button', { name: /偏好模式 · 持卡人/ }))
    expect(screen.queryByRole('option', { name: '全部家庭成员' })).not.toBeInTheDocument()
    expect(screen.getByText(/当前仅推荐本人持卡人档案：李四/)).toBeInTheDocument()
  })

  it('AnnualFeeRoiBoard 按 PR #65 真实 DTO（totals / unvalued_benefit_refs / period_start）展示全家汇总、缺汇率隔离与补填估值', async () => {
    const board: FamilyAnnualFeeRoiBoard = {
      period_mode: 'last_12m',
      window_start: '2025-11-25',
      window_end_exclusive: '2026-11-26',
      display_currency: 'CNY',
      fx_available: false,
      unconverted_currencies: ['USD'],
      warnings: [],
      totals: {
        annual_fee_cost: {
          converted_currency: 'CNY',
          by_currency: { CNY: 3600, USD: 550 },
          total: 3600,
          converted: false,
          unconverted_currencies: ['USD'],
          mixed: true,
        },
        redeemed_benefits_value: {
          converted_currency: 'CNY',
          by_currency: { CNY: 1300 },
          total: 1300,
          converted: true,
          unconverted_currencies: [],
          mixed: false,
        },
        promo_and_reward_value: {
          converted_currency: 'CNY',
          by_currency: { CNY: 2800 },
          total: 2800,
          converted: true,
          unconverted_currencies: [],
          mixed: false,
        },
        manual_reward_value: {
          converted_currency: 'CNY',
          by_currency: {},
          total: 0,
          converted: true,
          unconverted_currencies: [],
          mixed: false,
        },
        total_value: {
          converted_currency: 'CNY',
          by_currency: { CNY: 4100 },
          total: 4100,
          converted: true,
          unconverted_currencies: [],
          mixed: false,
        },
        net_value: {
          converted_currency: 'CNY',
          by_currency: { CNY: 500, USD: -550 },
          total: 500,
          converted: false,
          unconverted_currencies: ['USD'],
          mixed: true,
        },
      },
      cards: [
        {
          card_id: 'card-n',
          holder_id: 'holder-1',
          holder_name: '张三',
          bank_name: '招商银行',
          card_name: '经典白金卡',
          card_number_last4: '8888',
          card_currency: 'CNY',
          period_mode: 'last_12m',
          period_start: '2025-11-25',
          period_end_exclusive: '2026-11-26',
          window_mode_resolved: 'last_12m_fallback',
          annual_fee_cost: 3600,
          cost_basis: 'estimated_nominal',
          redeemed_benefits_value: 1300,
          promo_and_reward_value: 2800,
          manual_reward_value: 0,
          total_value: 4100,
          net_value: 500,
          coverage_pct: 113.9,
          roi_pct: 13.9,
          decision_tag: 'keep_high_roi',
          decision_label: '高 ROI · 建议续卡',
          unvalued_benefit_count: 0,
          unvalued_benefit_refs: [],
          item_counts: {
            benefit_usages: 2,
            promo_usages: 1,
            task_results: 0,
          },
        },
        {
          card_id: 'card-p',
          holder_id: 'holder-1',
          holder_name: '张三',
          bank_name: 'Chase',
          card_name: 'Freedom',
          card_number_last4: '9999',
          card_currency: 'USD',
          period_mode: 'last_12m',
          period_start: '2025-11-25',
          period_end_exclusive: '2026-11-26',
          window_mode_resolved: 'last_12m_fallback',
          annual_fee_cost: 0,
          cost_basis: 'zero_fee',
          redeemed_benefits_value: 0,
          promo_and_reward_value: 200,
          manual_reward_value: 0,
          total_value: 200,
          net_value: 200,
          coverage_pct: null,
          roi_pct: null,
          decision_tag: 'free_earning',
          decision_label: '纯赚持有',
          unvalued_benefit_count: 3,
          unvalued_benefit_refs: [
            {
              account_id: 'acc-opp-1',
              definition_id: 'def-opp-1',
              quantity: 3,
            },
          ],
          item_counts: {
            benefit_usages: 1,
            promo_usages: 0,
            task_results: 0,
          },
        },
      ],
    }
    mockedGetFamilyAnnualFeeRoi.mockResolvedValue(board)
    mockedUpdateValuation.mockResolvedValue({ ok: true, revision: 2 })

    render(<AnnualFeeRoiBoard />)

    expect(await screen.findByText(/未含汇率：USD 未计入合计/)).toBeInTheDocument()
    expect(screen.getByText(/全家年费 ROI 汇总（折算 CNY · 共 2 张信用卡）/)).toBeInTheDocument()
    expect(screen.getAllByText(/2025-11-25 ~ 2026-11-26/).length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('免年费')).toBeInTheDocument()
    expect(screen.queryByText(/Infinity|NaN/)).not.toBeInTheDocument()
    expect(screen.getByText('另有 3 次已核销权益未设估值')).toBeInTheDocument()

    // 打开补填估值弹窗并保存
    fireEvent.click(screen.getByRole('button', { name: '[去补填]' }))
    const valInput = await screen.findByLabelText(/单次自用估值/)
    fireEvent.change(valInput, { target: { value: '150' } })
    fireEvent.click(screen.getByRole('button', { name: '保存估值' }))

    await waitFor(() => {
      expect(mockedUpdateValuation).toHaveBeenCalledWith({
        target_kind: 'account',
        target_id: 'acc-opp-1',
        estimated_unit_value_minor: 15000,
        estimated_value_currency: 'USD',
      })
    })
  })

  it('resolveAnnualFeeCycleLocal 严格守卫未知日期不编造，并正确钳制闰年 02-29', () => {
    const unknownState = resolveAnnualFeeCycleLocal(
      {
        annual_fee_override: 2000,
        annual_fee_cycle_type: 'anniversary_issued',
        next_annual_fee_date: null,
        annual_fee_status: null,
        issued_on: null,
        activated_on: null,
      },
      { annual_fee: 2000, annual_fee_cycle_type: 'anniversary_issued' },
      '2026-11-25'
    )
    expect(unknownState.nextDueDate).toBeNull()

    const leap2025 = resolveAnnualFeeCycleLocal(
      {
        annual_fee_override: 3600,
        annual_fee_cycle_type: 'anniversary_issued',
        next_annual_fee_date: null,
        annual_fee_status: null,
        issued_on: '2024-02-29',
        activated_on: null,
      },
      null,
      '2025-01-10'
    )
    expect(leap2025.nextDueDate).toBe('2025-02-28')

    const leap2028 = resolveAnnualFeeCycleLocal(
      {
        annual_fee_override: 3600,
        annual_fee_cycle_type: 'anniversary_issued',
        next_annual_fee_date: null,
        annual_fee_status: null,
        issued_on: '2024-02-29',
        activated_on: null,
      },
      null,
      '2028-01-10'
    )
    expect(leap2028.nextDueDate).toBe('2028-02-29')
  })

  it('CardAnnualFeeSection 与 CardRoiSummaryCard 按 PR #65 真实 DTO（period_start / spend_amount / spend_count）渲染与预填', async () => {
    const card: CreditCardWithAnnualFee = {
      id: 'card-1',
      holder_id: 'holder-1',
      card_product_id: 'prod-1',
      credit_limit: 50000,
      billing_day: 5,
      status: 'active',
      card_type: 'credit',
      created_at: '2026-01-01T00:00:00Z',
      annual_fee_override: 3600,
    }
    const product: CardProductWithRules = {
      id: 'prod-1',
      country: 'CN',
      bank_name: '招商银行',
      card_name: '经典白金卡',
      currency: 'CNY',
      payment_due_type: 'after_billing',
      payment_due_value: 20,
      annual_fee: 3600,
      is_active: true,
      created_at: '2026-01-01T00:00:00Z',
    }
    const roiDetail: CardAnnualFeeRoiDetail = {
      card_id: 'card-1',
      holder_id: 'holder-1',
      holder_name: '张三',
      bank_name: '招商银行',
      card_name: '经典白金卡',
      card_number_last4: '8888',
      card_currency: 'CNY',
      period_mode: 'current_cycle',
      period_start: '2025-12-25',
      period_end_exclusive: '2026-12-25',
      window_mode_resolved: 'exact_cycle',
      annual_fee_cost: 3600,
      cost_basis: 'estimated_nominal',
      redeemed_benefits_value: 1300,
      promo_and_reward_value: 2800,
      manual_reward_value: 0,
      total_value: 4100,
      net_value: 500,
      coverage_pct: 113.9,
      roi_pct: 13.9,
      decision_tag: 'keep_high_roi',
      decision_label: '高 ROI · 建议续卡',
      unvalued_benefit_count: 0,
      unvalued_benefit_refs: [],
      item_counts: {
        benefit_usages: 2,
        promo_usages: 1,
        task_results: 0,
      },
    }
    mockedGetCardAnnualFeeRoi.mockResolvedValue(roiDetail)
    mockedGetCardCycleSpendEstimate.mockResolvedValue({
      card_id: 'card-1',
      period_start: '2025-12-25',
      period_end_exclusive: '2026-12-25',
      window_mode_resolved: 'exact_cycle',
      spend_amount: 800,
      spend_count: 2,
      currency: 'CNY',
      source: 'bill_items',
    })
    mockedUpdateCardAnnualFeeFields.mockResolvedValue({} as never)

    const onUpdated = vi.fn()
    render(
      <>
        <CardAnnualFeeSection card={card} product={product} onUpdated={onUpdated} />
        <CardRoiSummaryCard card={card} product={product} onUpdated={onUpdated} />
      </>
    )

    expect(
      screen.getByText(/年费到期日未知，请补充发卡日或下次扣费日以开启年费前 30 天提醒/)
    ).toBeInTheDocument()
    expect(await screen.findByText('高 ROI · 建议续卡')).toBeInTheDocument()
    expect(screen.getByText('113.9%')).toBeInTheDocument()
    expect(screen.getByText(/统计区间：2025-12-25 ~ 2026-12-25/)).toBeInTheDocument()

    // 点击按账单参考填充，验证 spend_amount / spend_count 预填到输入框
    fireEvent.click(screen.getByRole('button', { name: '更新进度' }))
    fireEvent.click(screen.getByRole('button', { name: '按账单参考填充' }))
    await waitFor(() => {
      expect(mockedGetCardCycleSpendEstimate).toHaveBeenCalledWith('card-1')
      expect((screen.getByLabelText(/已消费金额/) as HTMLInputElement).value).toBe('800')
      expect((screen.getByLabelText('已消费笔数') as HTMLInputElement).value).toBe('2')
    })

    // 取消编辑后点击标记已免年费（走 ConfirmDialog）
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    fireEvent.click(screen.getByRole('button', { name: '标记已免年费' }))
    fireEvent.click(screen.getByRole('button', { name: '确认已豁免' }))
    await waitFor(() => {
      expect(mockedUpdateCardAnnualFeeFields).toHaveBeenCalledWith('card-1', {
        annual_fee_status: 'waived',
        actual_fee_paid: 0,
      })
    })
  })

  it('CardProductRulesEditor 支持 AI 草稿预览且必须人工点击「应用到表单」才修改', async () => {
    mockedPreviewCardProductRules.mockResolvedValue({
      ftf_rate: 0,
      fx_free_currencies: ['USD'],
      reward_rules: {
        schema_version: 1,
        reward_kind: 'points',
        base_rate_pct: 1.5,
        category_rules: [{ category: 'dining', rate_pct: 4.5, currency_scope: 'all' }],
      },
      annual_fee_cycle_type: 'anniversary_issued',
      annual_fee_waiver_rules: { schema_version: 1, waiver_type: 'none' },
      confidence_note: '基于公开规则草稿',
    })

    const onChange = vi.fn()
    render(
      <CardProductRulesEditor
        product={{
          bank_name: 'Chase',
          card_name: 'Sapphire Preferred',
          currency: 'USD',
          country: 'US',
        }}
        onChange={onChange}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /AI 生成规则草稿/ }))
    expect(await screen.findByText(/AI 规则预览草稿（尚未写库）/)).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '应用到表单' }))
    expect(onChange).toHaveBeenCalledTimes(1)
  })
})
