// lib/__tests__/opportunity-dates.test.ts — civil-date validation, timezone
// handling and nominal cycle windows. All inputs are frozen literals; nothing
// depends on the host timezone or locale.

import { describe, it, expect } from 'vitest'
import {
  isValidCivilDate,
  isValidIanaTimeZone,
  localDateInZone,
  addDays,
  addMonthsClamped,
  getCycleWindow,
} from '../opportunities/dates'
import type { RuleSnapshotV1 } from '../opportunities/types'

const baseRules: RuleSnapshotV1 = {
  schema_version: 1,
  title: '测试权益',
  description: null,
  category: 'food',
  time_zone: 'Asia/Shanghai',
  bank_id: null,
  card_product_ids: ['p-1'],
  valid_from: null,
  valid_until_before: null,
  open_ended: true,
  weekdays: null,
  cycle: { kind: 'monthly', anchor_month: null, anchor_day: null, anchor_source: null },
  allocation: 'recurring',
  count_limit: 2,
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
}

const rulesWith = (cycle: Partial<RuleSnapshotV1['cycle']>, over: Partial<RuleSnapshotV1> = {}): RuleSnapshotV1 => ({
  ...baseRules,
  cycle: { ...baseRules.cycle, ...cycle },
  ...over,
})

describe('civil date validation', () => {
  it('accepts real calendar dates and rejects impossible ones', () => {
    expect(isValidCivilDate('2026-10-15')).toBe(true)
    expect(isValidCivilDate('2024-02-29')).toBe(true) // leap year
    expect(isValidCivilDate('2026-02-29')).toBe(false) // not a leap year
    expect(isValidCivilDate('2026-02-30')).toBe(false)
    expect(isValidCivilDate('2026-04-31')).toBe(false)
    expect(isValidCivilDate('2026-13-01')).toBe(false)
    expect(isValidCivilDate('2026-00-10')).toBe(false)
    expect(isValidCivilDate('2026-01-00')).toBe(false)
    expect(isValidCivilDate('2026-1-1')).toBe(false) // zero-padded only
    expect(isValidCivilDate('2026/01/01')).toBe(false)
    expect(isValidCivilDate('2026-01-01T00:00:00Z')).toBe(false)
    expect(isValidCivilDate('')).toBe(false)
    expect(isValidCivilDate('26-01-01')).toBe(false)
  })

  it('accepts valid IANA zones and rejects the rest', () => {
    expect(isValidIanaTimeZone('Asia/Shanghai')).toBe(true)
    expect(isValidIanaTimeZone('America/New_York')).toBe(true)
    expect(isValidIanaTimeZone('UTC')).toBe(true)
    // ECMAScript Intl matches zone names case-insensitively; normalization is
    // the writer's job, so lowercase is accepted here too.
    expect(isValidIanaTimeZone('asia/shanghai')).toBe(true)
    expect(isValidIanaTimeZone('Not/AZone')).toBe(false)
    expect(isValidIanaTimeZone('')).toBe(false)
  })

  it('Beijing midnight is still the previous day in New York', () => {
    const now = new Date('2026-10-15T16:30:00Z')
    expect(localDateInZone(now, 'Asia/Shanghai')).toBe('2026-10-16')
    expect(localDateInZone(now, 'America/New_York')).toBe('2026-10-15')
  })
})

describe('civil arithmetic (no chained setMonth)', () => {
  it('addDays crosses month and year boundaries', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('addMonthsClamped clamps to month ends from the source anchor', () => {
    expect(addMonthsClamped('2024-01-31', 1)).toBe('2024-02-29')
    expect(addMonthsClamped('2023-01-31', 1)).toBe('2023-02-28')
    expect(addMonthsClamped('2024-02-29', 12)).toBe('2025-02-28') // clamp, never Mar 1
    expect(addMonthsClamped('2024-02-29', 48)).toBe('2028-02-29') // source anchor returns in a leap year
    expect(addMonthsClamped('2026-10-15', 12)).toBe('2027-10-15')
    expect(addMonthsClamped('2026-10-15', -1)).toBe('2026-09-15')
  })
})

describe('getCycleWindow: monthly', () => {
  it('defaults to calendar months', () => {
    const w = getCycleWindow(rulesWith({ kind: 'monthly' }), '2026-10-15', { issued_on: null, activated_on: null })
    expect(w).toMatchObject({
      cycle_key: 'regular:2026-10-01',
      period_start_on: '2026-10-01',
      period_end_before: '2026-11-01',
      usable_start_on: '2026-10-01',
      usable_end_before: '2026-11-01',
      next_reset_on: '2026-11-01',
      time_zone: 'Asia/Shanghai',
    })
  })

  it('honours an anchor day and rolls to the previous period before it', () => {
    const rules = rulesWith({ kind: 'monthly', anchor_day: 5 })
    expect(getCycleWindow(rules, '2026-10-15', { issued_on: null, activated_on: null }).period_start_on).toBe('2026-10-05')
    const early = getCycleWindow(rules, '2026-10-03', { issued_on: null, activated_on: null })
    expect(early.period_start_on).toBe('2026-09-05')
    expect(early.period_end_before).toBe('2026-10-05')
  })

  it('clamps anchor day 31 at short months on both ends', () => {
    const rules = rulesWith({ kind: 'monthly', anchor_day: 31 })
    const feb = getCycleWindow(rules, '2026-02-10', { issued_on: null, activated_on: null })
    expect(feb.period_start_on).toBe('2026-01-31') // previous month's 31st
    expect(feb.period_end_before).toBe('2026-02-28') // clamped
    const april = getCycleWindow(rules, '2026-05-15', { issued_on: null, activated_on: null })
    expect(april.period_start_on).toBe('2026-04-30') // clamped from 31
    expect(april.period_end_before).toBe('2026-05-31')
  })
})

describe('getCycleWindow: weekly, daily, annual', () => {
  it('weekly windows start on ISO Monday', () => {
    // 2026-10-15 is a Thursday (ISO 4); its week starts Monday 2026-10-12.
    const w = getCycleWindow(rulesWith({ kind: 'weekly' }), '2026-10-15', { issued_on: null, activated_on: null })
    expect(w.period_start_on).toBe('2026-10-12')
    expect(w.period_end_before).toBe('2026-10-19')
  })

  it('daily windows are single days', () => {
    const w = getCycleWindow(rulesWith({ kind: 'daily' }), '2026-10-15', { issued_on: null, activated_on: null })
    expect(w.period_start_on).toBe('2026-10-15')
    expect(w.period_end_before).toBe('2026-10-16')
  })

  it('annual windows use the fixed month/day anchor', () => {
    const rules = rulesWith({ kind: 'annual', anchor_month: 10, anchor_day: 1 })
    const w = getCycleWindow(rules, '2026-10-15', { issued_on: null, activated_on: null })
    expect(w.period_start_on).toBe('2026-10-01')
    expect(w.period_end_before).toBe('2027-10-01')
    const beforeAnchor = getCycleWindow(rules, '2026-09-30', { issued_on: null, activated_on: null })
    expect(beforeAnchor.period_start_on).toBe('2025-10-01')
  })

  it('annual anchor day 31 clamps at February and recovers', () => {
    const rules = rulesWith({ kind: 'annual', anchor_month: 1, anchor_day: 31 })
    const w = getCycleWindow(rules, '2026-03-01', { issued_on: null, activated_on: null })
    expect(w.period_start_on).toBe('2026-01-31')
    expect(w.period_end_before).toBe('2027-01-31')
  })
})

describe('getCycleWindow: anniversary (card-date anchored)', () => {
  const rules = rulesWith({ kind: 'anniversary', anchor_source: 'issued_on' })
  const anchor = { issued_on: '2024-02-29', activated_on: null }

  it('collapses Feb 29 in non-leap years and restores the source anchor later', () => {
    expect(getCycleWindow(rules, '2027-02-28', anchor).period_start_on).toBe('2027-02-28')
    expect(getCycleWindow(rules, '2028-02-29', anchor).period_start_on).toBe('2028-02-29')
  })

  it('keeps the collapsed window until the next real anchor date', () => {
    const w = getCycleWindow(rules, '2027-03-05', anchor)
    expect(w.period_start_on).toBe('2027-02-28')
    expect(w.period_end_before).toBe('2028-02-29')
    const in2026 = getCycleWindow(rules, '2026-10-15', anchor)
    expect(in2026.period_start_on).toBe('2026-02-28')
    expect(in2026.period_end_before).toBe('2027-02-28')
  })

  it('uses activated_on when the anchor source says so', () => {
    const byActivation = rulesWith({ kind: 'anniversary', anchor_source: 'activated_on' })
    const w = getCycleWindow(byActivation, '2026-10-15', { issued_on: '2020-01-01', activated_on: '2025-10-02' })
    expect(w.period_start_on).toBe('2026-10-02')
  })

  it('an empty anchor is an explicit error, not a silent default', () => {
    expect(() => getCycleWindow(rules, '2026-10-15', { issued_on: null, activated_on: null })).toThrow(
      /锚点/,
    )
  })
})

describe('getCycleWindow: one_time and input validation', () => {
  it('one_time windows come from the rule validity range', () => {
    const rules = rulesWith(
      { kind: 'one_time' },
      { valid_from: '2026-01-01', valid_until_before: '2026-12-31', open_ended: false },
    )
    const w = getCycleWindow(rules, '2026-06-01', { issued_on: null, activated_on: null })
    expect(w.period_start_on).toBe('2026-01-01')
    expect(w.period_end_before).toBe('2026-12-31')
    expect(w.cycle_key).toBe('regular:2026-01-01')
    expect(w.next_reset_on).toBe(null)
  })

  it('one_time without a validity start cannot be windowed', () => {
    expect(() =>
      getCycleWindow(rulesWith({ kind: 'one_time' }), '2026-06-01', { issued_on: null, activated_on: null }),
    ).toThrow(/生效日/)
  })

  it('rejects malformed local dates and time zones', () => {
    expect(() => getCycleWindow(baseRules, '2026-02-30', { issued_on: null, activated_on: null })).toThrow()
    expect(() =>
      getCycleWindow(rulesWith({}, { time_zone: 'Mars/Olympus' }), '2026-10-15', { issued_on: null, activated_on: null }),
    ).toThrow(/时区/)
  })
})
