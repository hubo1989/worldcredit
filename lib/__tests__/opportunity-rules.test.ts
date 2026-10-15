// lib/__tests__/opportunity-rules.test.ts — RuleSnapshotV1 runtime validation
// and the legacy benefit → rule adapter. Validation is field-by-field with
// path-bearing errors; TypeScript types are never the validator.

import { describe, it, expect } from 'vitest'
import { validateRuleSnapshot, legacyBenefitToRules } from '../opportunities/rules'
import { getCycleWindow } from '../opportunities/dates'
import type { RuleSnapshotV1 } from '../opportunities/types'

const validSnapshot: RuleSnapshotV1 = {
  schema_version: 1,
  title: '餐饮 5 折',
  description: '每周五餐饮立减',
  category: 'food',
  time_zone: 'Asia/Shanghai',
  bank_id: 'bk-1',
  card_product_ids: ['p-1', 'p-2'],
  valid_from: '2026-01-01',
  valid_until_before: '2026-12-31',
  open_ended: false,
  weekdays: [5],
  cycle: { kind: 'monthly', anchor_month: null, anchor_day: null, anchor_source: null },
  allocation: 'recurring',
  count_limit: 2,
  amount_limit_minor: null,
  currency: null,
  unit_label: '次',
  eligibility_text: '持卡人本人',
  requires_personal_confirmation: false,
  claim_window: { starts_at: '2026-01-01T00:00:00Z', ends_at: '2026-03-01T00:00:00Z' },
  booking_window: null,
  workflow_time_basis: 'fixed',
  booking_consumes: 'reserve_then_use',
  cancellation_rule: 'confirm_with_issuer',
  entry: { website_url: 'https://example.com/promo', app_name: null, app_path: null },
}

function mutate(over: Record<string, unknown>): unknown {
  return { ...validSnapshot, ...over }
}

function mutateCycle(over: Record<string, unknown>): unknown {
  return { ...validSnapshot, cycle: { ...validSnapshot.cycle, ...over } }
}

describe('validateRuleSnapshot: accept and reject cases', () => {
  it('accepts a fully populated snapshot unchanged', () => {
    expect(validateRuleSnapshot(validSnapshot)).toEqual(validSnapshot)
  })

  it('rejects unknown schema versions instead of guessing defaults', () => {
    expect(() => validateRuleSnapshot(mutate({ schema_version: 2 }))).toThrow(/schema_version/)
    expect(() => validateRuleSnapshot(mutate({ schema_version: '1' }))).toThrow(/schema_version/)
  })

  it('validates title, category and time zone', () => {
    expect(() => validateRuleSnapshot(mutate({ title: '' }))).toThrow(/title/)
    expect(() => validateRuleSnapshot(mutate({ title: 'x'.repeat(121) }))).toThrow(/title/)
    expect(() => validateRuleSnapshot(mutate({ category: 'fun' }))).toThrow(/category/)
    expect(() => validateRuleSnapshot(mutate({ time_zone: 'Not/AZone' }))).toThrow(/time_zone/)
  })

  it('validates weekdays as sorted unique ISO 1..7', () => {
    expect(() => validateRuleSnapshot(mutate({ weekdays: [0] }))).toThrow(/weekdays/)
    expect(() => validateRuleSnapshot(mutate({ weekdays: [8] }))).toThrow(/weekdays/)
    expect(() => validateRuleSnapshot(mutate({ weekdays: [3, 3] }))).toThrow(/weekdays/)
    expect(() => validateRuleSnapshot(mutate({ weekdays: [2, 1] }))).toThrow(/weekdays/)
    expect(() => validateRuleSnapshot(mutate({ weekdays: [1, 7] }))).not.toThrow()
    expect(() => validateRuleSnapshot(mutate({ weekdays: null }))).not.toThrow()
  })

  it('validates the validity window and open_ended exclusivity', () => {
    expect(() => validateRuleSnapshot(mutate({ valid_until_before: '2026-01-01' }))).toThrow(/valid_until_before/)
    expect(() => validateRuleSnapshot(mutate({ valid_until_before: '2025-12-31' }))).toThrow(/valid_until_before/)
    expect(() => validateRuleSnapshot(mutate({ valid_from: '2026-13-01' }))).toThrow(/valid_from/)
    // open_ended and an explicit end are contradictory:
    expect(() => validateRuleSnapshot(mutate({ open_ended: true }))).toThrow(/open_ended/)
  })

  it('count_limit: 0 and null pass, negatives and fractions fail', () => {
    expect(() => validateRuleSnapshot(mutate({ count_limit: 0 }))).not.toThrow()
    expect(() => validateRuleSnapshot(mutate({ count_limit: null }))).not.toThrow()
    expect(() => validateRuleSnapshot(mutate({ count_limit: -1 }))).toThrow(/count_limit/)
    expect(() => validateRuleSnapshot(mutate({ count_limit: 1.5 }))).toThrow(/count_limit/)
    expect(() => validateRuleSnapshot(mutate({ count_limit: '6' }))).toThrow(/count_limit/)
  })

  it('amount_limit_minor requires a known currency', () => {
    expect(() =>
      validateRuleSnapshot(mutate({ amount_limit_minor: 10000, currency: null })),
    ).toThrow(/currency/)
    expect(() =>
      validateRuleSnapshot(mutate({ amount_limit_minor: 10000, currency: 'usd' })),
    ).toThrow(/currency/)
    expect(() =>
      validateRuleSnapshot(mutate({ amount_limit_minor: 10000, currency: 'XXX' })),
    ).toThrow(/currency/)
    expect(() =>
      validateRuleSnapshot(mutate({ amount_limit_minor: 10000, currency: 'JPY' })),
    ).not.toThrow()
    expect(() => validateRuleSnapshot(mutate({ amount_limit_minor: -1, currency: 'CNY' }))).toThrow(
      /amount_limit_minor/,
    )
  })

  it('cycle anchors must match the cycle kind', () => {
    expect(() => validateRuleSnapshot(mutateCycle({ kind: 'annual', anchor_month: null }))).toThrow(
      /anchor_month/,
    )
    expect(() => validateRuleSnapshot(mutateCycle({ kind: 'annual', anchor_month: 13 }))).toThrow(
      /anchor_month/,
    )
    expect(() =>
      validateRuleSnapshot(mutateCycle({ kind: 'anniversary', anchor_source: null })),
    ).toThrow(/anchor_source/)
    expect(() => validateRuleSnapshot(mutateCycle({ anchor_day: 32 }))).toThrow(/anchor_day/)
    expect(() => validateRuleSnapshot(mutateCycle({ anchor_day: 0 }))).toThrow(/anchor_day/)
    expect(() => validateRuleSnapshot(mutateCycle({ kind: 'daily', anchor_day: 5 }))).toThrow(
      /anchor_day/,
    )
    // one_time windows come from valid_from, not from cycle anchors:
    expect(() =>
      validateRuleSnapshot(mutateCycle({ kind: 'one_time' })),
    ).not.toThrow()
  })

  it('rejects enum drift and malformed windows', () => {
    expect(() => validateRuleSnapshot(mutate({ allocation: 'oneoff' }))).toThrow(/allocation/)
    expect(() => validateRuleSnapshot(mutate({ workflow_time_basis: 'sometimes' }))).toThrow(
      /workflow_time_basis/,
    )
    expect(() =>
      validateRuleSnapshot(mutate({ claim_window: { starts_at: '2026-03-01T00:00:00Z', ends_at: '2026-01-01T00:00:00Z' } })),
    ).toThrow(/claim_window/)
    expect(() =>
      validateRuleSnapshot(mutate({ claim_window: { starts_at: '2026-01-01', ends_at: null } })),
    ).toThrow(/claim_window/)
  })

  it('validates entry URLs and rejects unknown top-level fields', () => {
    expect(() =>
      validateRuleSnapshot(mutate({ entry: { website_url: 'ftp://example.com', app_name: null, app_path: null } })),
    ).toThrow(/website_url/)
    expect(() => validateRuleSnapshot(mutate({ surprise: true }))).toThrow(/surprise/)
    expect(() => validateRuleSnapshot(mutate({ card_product_ids: ['p-1', 2] }))).toThrow(
      /card_product_ids/,
    )
  })

  it('rejects non-object input outright', () => {
    expect(() => validateRuleSnapshot(null)).toThrow()
    expect(() => validateRuleSnapshot('rules')).toThrow()
    expect(() => validateRuleSnapshot(42)).toThrow()
  })
})

describe('legacyBenefitToRules adapter', () => {
  const legacyBenefit = {
    id: 'b-1',
    card_product_id: 'p-cmb-life',
    name: '观影优惠',
    description: '每月 2 次观影立减',
    quota: 2,
    period: 'monthly' as const,
    reset_month: null,
    expiry_date: null,
  }

  it('maps monthly benefits to calendar-month rules keeping quota 0/null semantics', () => {
    const rules = legacyBenefitToRules(legacyBenefit)
    expect(validateRuleSnapshot(rules)).toEqual(rules) // adapter output must validate
    expect(rules.cycle).toEqual({ kind: 'monthly', anchor_month: null, anchor_day: null, anchor_source: null })
    expect(rules.count_limit).toBe(2)
    expect(rules.time_zone).toBe('Asia/Shanghai')
    expect(rules.open_ended).toBe(true)
    expect(
      getCycleWindow(rules, '2026-10-15', { issued_on: null, activated_on: null }).period_start_on,
    ).toBe('2026-10-01')
  })

  it('maps yearly benefits to an annual anchor on reset_month (defaulting to January)', () => {
    const withReset = legacyBenefitToRules({ ...legacyBenefit, period: 'yearly', reset_month: 6 })
    expect(withReset.cycle).toMatchObject({ kind: 'annual', anchor_month: 6, anchor_day: 1 })
    const defaulted = legacyBenefitToRules({ ...legacyBenefit, period: 'yearly', reset_month: null })
    expect(defaulted.cycle).toMatchObject({ kind: 'annual', anchor_month: 1, anchor_day: 1 })
  })

  it('maps expiry_date to a half-open validity end and keeps quota 0', () => {
    const rules = legacyBenefitToRules({
      ...legacyBenefit,
      quota: 0,
      expiry_date: '2026-12-31',
    })
    expect(rules.count_limit).toBe(0)
    expect(rules.valid_until_before).toBe('2027-01-01') // inclusive end → exclusive before
    expect(rules.open_ended).toBe(false)
  })

  it('one_time stays unwindowed until a human confirms an effective date', () => {
    const rules = legacyBenefitToRules({ ...legacyBenefit, period: 'one_time' })
    expect(rules.cycle.kind).toBe('one_time')
    expect(rules.valid_from).toBe(null)
    expect(() =>
      getCycleWindow(rules, '2026-10-15', { issued_on: null, activated_on: null }),
    ).toThrow(/生效日/)
  })
})
