// lib/__tests__/opportunity-availability.test.ts — the pure availability
// matrix (plan Task 11 step 1, product spec §6.2/§6.3). Every row of the
// matrix gets an explicit status + action + reason; nothing falls through to
// a silent default.

import { describe, it, expect } from 'vitest'
import {
  computeAvailability,
  AVAILABILITY_SORT_RANK,
  type AvailabilityInput,
} from '../opportunities/availability'
import { OpportunityError } from '../opportunities/errors'
import type { RuleSnapshotV1 } from '../opportunities/types'

const TODAY = '2026-10-15' // Thursday (ISO 4)
const WEEKDAY = 4

function rules(over: Partial<RuleSnapshotV1> = {}): RuleSnapshotV1 {
  return {
    schema_version: 1,
    title: '贵宾厅',
    description: null,
    category: 'travel',
    time_zone: 'Asia/Shanghai',
    bank_id: null,
    card_product_ids: [],
    valid_from: null,
    valid_until_before: null,
    open_ended: true,
    weekdays: null,
    cycle: { kind: 'monthly', anchor_month: null, anchor_day: 1, anchor_source: null },
    allocation: 'recurring',
    count_limit: 6,
    amount_limit_minor: null,
    currency: null,
    unit_label: '次',
    eligibility_text: null,
    requires_personal_confirmation: false,
    claim_window: null,
    booking_window: null,
    workflow_time_basis: 'fixed',
    booking_consumes: 'reserve_then_use',
    cancellation_rule: 'confirm_with_issuer',
    entry: { website_url: null, app_name: null, app_path: null },
    ...over,
  }
}

function input(over: Partial<AvailabilityInput> = {}): AvailabilityInput {
  return {
    today_on: TODAY,
    weekday: WEEKDAY,
    rules: rules(),
    definition_status: 'active',
    terminated_at: null,
    account_status: 'active',
    eligibility: 'confirmed',
    eligible_from_on: null,
    has_active_linked_card: true,
    cycle: {
      activation_state: 'active',
      usable_start_on: '2026-10-01',
      usable_end_before: '2026-11-01',
      count_limit: 6,
      amount_limit_minor: null,
      opening_used_count: 0,
      used_count: 0,
      reserved_count: 0,
      opening_used_minor: 0,
      used_minor: 0,
      reserved_minor: 0,
    },
    balance_verified: true,
    ...over,
  }
}

describe('terminal and not-started states', () => {
  it('定义归档／规则终止／账户归档／资格不适用 → expired', () => {
    expect(computeAvailability(input({ definition_status: 'archived' })).status).toBe('expired')
    expect(computeAvailability(input({ terminated_at: '2026-10-01' })).status).toBe('expired')
    expect(computeAvailability(input({ account_status: 'archived' })).status).toBe('expired')
    expect(computeAvailability(input({ eligibility: 'ineligible' })).status).toBe('expired')
  })

  it('使用期已结束 → expired；未开始 → not_started（含个人资格起始日）', () => {
    const expired = computeAvailability(
      input({ rules: rules({ open_ended: false, valid_until_before: '2026-10-15' }) }),
    )
    expect(expired.status).toBe('expired')

    const future = computeAvailability(
      input({ rules: rules({ valid_from: '2026-11-01' }) }),
    )
    expect(future.status).toBe('not_started')

    const eligibleLater = computeAvailability(input({ eligible_from_on: '2026-11-01' }))
    expect(eligibleLater.status).toBe('not_started')
  })

  it('无截止且非 open_ended → needs_confirmation，绝不默认长期有效', () => {
    const r = computeAvailability(input({ rules: rules({ open_ended: false }) }))
    expect(r.status).toBe('needs_confirmation')
    expect(r.reason).toContain('截止日期')
  })
})

describe('confirmation gaps', () => {
  it('需个人确认且资格未知 → needs_confirmation', () => {
    const r = computeAvailability(
      input({
        eligibility: 'unknown',
        rules: rules({ requires_personal_confirmation: true }),
      }),
    )
    expect(r.status).toBe('needs_confirmation')
    expect(r.action).toBe('fix_data')
  })

  it('无可用关联卡（冻结/注销/贷款）→ needs_confirmation', () => {
    const r = computeAvailability(input({ has_active_linked_card: false }))
    expect(r.status).toBe('needs_confirmation')
    expect(r.reason).toContain('关联信用卡')
  })

  it('未找到覆盖今天的周期 → needs_confirmation', () => {
    const r = computeAvailability(input({ cycle: null }))
    expect(r.status).toBe('needs_confirmation')
    expect(r.reason).toContain('周期')
  })
})

describe('claim gating and grant-only', () => {
  it('pending_claim + 无窗口 → claimable/record_claim', () => {
    const r = computeAvailability(
      input({ cycle: { ...input().cycle!, activation_state: 'pending_claim' } }),
    )
    expect(r.status).toBe('claimable')
    expect(r.action).toBe('record_claim')
  })

  it('领取窗口未开 → not_started；已关未领 → needs_confirmation', () => {
    const window = { starts_at: '2026-11-01T00:00:00Z', ends_at: '2026-11-10T00:00:00Z' }
    const early = computeAvailability(
      input({
        cycle: { ...input().cycle!, activation_state: 'pending_claim' },
        rules: rules({ claim_window: window }),
      }),
    )
    expect(early.status).toBe('not_started')

    const late = computeAvailability(
      input({
        cycle: { ...input().cycle!, activation_state: 'pending_claim' },
        rules: rules({ claim_window: { starts_at: '2026-10-01T00:00:00Z', ends_at: '2026-10-10T00:00:00Z' } }),
      }),
    )
    expect(late.status).toBe('needs_confirmation')
  })

  it('grant-only 无已到账配额 → exhausted（奖励未到账）', () => {
    const r = computeAvailability(
      input({ rules: rules({ allocation: 'grant_only' }), cycle: null }),
    )
    expect(r.status).toBe('exhausted')
    expect(r.reason).toContain('未到账')
  })
})

describe('weekday and quota', () => {
  it('非有效星期：usable_today=false 且带原因，7 天内截止仍标 expiring_soon', () => {
    const r = computeAvailability(
      input({
        rules: rules({ weekdays: [1, 2, 3], valid_until_before: '2026-10-22', open_ended: false }),
        cycle: { ...input().cycle!, usable_end_before: '2026-10-22' }, // 周四不在 [1,2,3]，6 天后截止
      }),
    )
    expect(r.usable_today).toBe(false)
    expect(r.reason).toContain('星期')
    expect(r.status).toBe('expiring_soon')

    const far = computeAvailability(
      input({
        rules: rules({ weekdays: [1, 2, 3], valid_until_before: '2027-06-01', open_ended: false }),
        cycle: { ...input().cycle!, usable_end_before: '2027-06-01' },
      }),
    )
    expect(far.status).toBe('available_today')
    expect(far.usable_today).toBe(false)
  })

  it('额度用尽 → exhausted；预约占用给出预约原因', () => {
    const used = computeAvailability(
      input({ cycle: { ...input().cycle!, used_count: 6 } }),
    )
    expect(used.status).toBe('exhausted')
    expect(used.reason).toContain('用完')

    const reserved = computeAvailability(
      input({ cycle: { ...input().cycle!, reserved_count: 6 } }),
    )
    expect(reserved.status).toBe('exhausted')
    expect(reserved.reason).toContain('预约')
  })

  it('部分 reserved 不影响可用，余量按 opening+used+reserved 计算', () => {
    const r = computeAvailability(
      input({ cycle: { ...input().cycle!, used_count: 2, reserved_count: 1, opening_used_count: 1 } }),
    )
    expect(r.status).toBe('available_today')
    expect(r.remaining_count).toBe(2)
  })

  it('金额型余量按 minor units 计算', () => {
    const amountRules = rules({
      count_limit: null,
      amount_limit_minor: 100_00,
      currency: 'CNY',
    })
    const r = computeAvailability(input({ rules: amountRules, cycle: { ...input().cycle!, count_limit: null, amount_limit_minor: 100_00, used_minor: 40_00, reserved_minor: 30_00, opening_used_minor: 10_00 } }))
    expect(r.remaining_minor).toBe(20_00)
    expect(r.status).toBe('available_today')
  })
})

describe('expiring window', () => {
  it('7 天内截止且有余量 → expiring_soon，今天截止给 0 天', () => {
    const today = computeAvailability(
      input({ cycle: { ...input().cycle!, usable_end_before: '2026-10-16' } }),
    )
    expect(today.status).toBe('expiring_soon')
    expect(today.days_left).toBe(1)

    const far = computeAvailability(
      input({ cycle: { ...input().cycle!, usable_end_before: '2026-12-31' } }),
    )
    expect(far.status).toBe('available_today')
  })

  it('期初未核对：needs_review 标记但不阻塞可用', () => {
    const r = computeAvailability(input({ balance_verified: false }))
    expect(r.status).toBe('available_today')
    expect(r.needs_review).toBe(true)
  })
})

describe('sort rank', () => {
  it('默认顺序：即将到期 → 可用 → 待领取 → 需确认 → 已用尽 → 未开始 → 已失效', () => {
    expect(AVAILABILITY_SORT_RANK.expiring_soon).toBeLessThan(AVAILABILITY_SORT_RANK.available_today)
    expect(AVAILABILITY_SORT_RANK.available_today).toBeLessThan(AVAILABILITY_SORT_RANK.claimable)
    expect(AVAILABILITY_SORT_RANK.claimable).toBeLessThan(AVAILABILITY_SORT_RANK.needs_confirmation)
    expect(AVAILABILITY_SORT_RANK.needs_confirmation).toBeLessThan(AVAILABILITY_SORT_RANK.exhausted)
    expect(AVAILABILITY_SORT_RANK.exhausted).toBeLessThan(AVAILABILITY_SORT_RANK.not_started)
    expect(AVAILABILITY_SORT_RANK.not_started).toBeLessThan(AVAILABILITY_SORT_RANK.expired)
  })
})

describe('input validation', () => {
  it('非法 weekday / today_on 拒绝', () => {
    expect(() => computeAvailability(input({ weekday: 8 }))).toThrow(OpportunityError)
    expect(() => computeAvailability(input({ today_on: '2026-13-01' }))).toThrow(OpportunityError)
  })
})
