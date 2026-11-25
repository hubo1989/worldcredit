import { describe, expect, it } from 'vitest'
import { computeLockedRate, computeSettledAmount, sumPaymentsWithLockedFx, validateAndNormalizeFxLock } from '../finance'

describe('payment FX locking', () => {
  it('links both directions and normalizes blanks and same-currency values', () => {
    expect(computeLockedRate(500, 3625)).toBe(7.25)
    expect(computeLockedRate(3, 10)).toBe(3.333333)
    expect(computeSettledAmount(500, 7.25)).toBe(3625)
    const empty = { settled_currency: null, settled_amount: null, locked_fx_rate: null }
    expect(validateAndNormalizeFxLock(undefined, 500, 'USD')).toEqual(empty)
    expect(validateAndNormalizeFxLock({ settled_currency: ' usd ' }, 500, 'USD')).toEqual(empty)
    expect(validateAndNormalizeFxLock({
      settled_currency: ' cny ', settled_amount: 3625, locked_fx_rate: 7.25,
    }, 500, 'USD')).toEqual({ settled_currency: 'CNY', settled_amount: 3625, locked_fx_rate: 7.25 })
  })

  it('accepts the five-cent boundary, rejects partial locks and validates normalized precision', () => {
    const input = { settled_currency: 'CNY', locked_fx_rate: 7.25 }
    expect(validateAndNormalizeFxLock({ ...input, settled_amount: 3625.05 }, 500, 'USD').settled_amount).toBe(3625.05)
    expect(validateAndNormalizeFxLock({ ...input, settled_amount: 3624.95 }, 500, 'USD').settled_amount).toBe(3624.95)
    expect(() => validateAndNormalizeFxLock({ ...input, settled_amount: 3625.050001 }, 500, 'USD')).toThrow(/0.05/)
    expect(() => validateAndNormalizeFxLock(input, 500, 'USD')).toThrow(/实付币种/)
    expect(() => validateAndNormalizeFxLock({ ...input, settled_amount: 3625, locked_fx_rate: 0 }, 500, 'USD')).toThrow()
    expect(() => validateAndNormalizeFxLock({
      settled_currency: 'CNY', settled_amount: 100000.49, locked_fx_rate: 0.10000049,
    }, 1_000_000, 'USD')).toThrow(/0.05/)
  })

  it('aggregates settled and original amounts without conflating the two', () => {
    const locked = {
      bill_currency: 'USD', amount: 500, settled_currency: 'CNY', settled_amount: 3625, locked_fx_rate: 7.25,
    }
    const rates = { base: 'USD', rates: { USD: 1, CNY: 7, HKD: 7.7 }, timestamp: 0, fetched_at: 0 }
    expect(sumPaymentsWithLockedFx([locked], 'CNY', rates)).toEqual(sumPaymentsWithLockedFx([locked], 'CNY', null))
    expect(sumPaymentsWithLockedFx([locked], 'CNY', null)).toMatchObject({
      total: 3625, by_currency: { USD: 500 }, converted: true, unconverted_currencies: [],
    })
    expect(sumPaymentsWithLockedFx([locked], 'HKD', rates)).toMatchObject({ total: 3987.5, converted: true })
    expect(sumPaymentsWithLockedFx([locked], 'HKD', null)).toMatchObject({
      total: 0, by_currency: { USD: 500 }, converted: false, unconverted_currencies: ['CNY'],
    })
    expect(sumPaymentsWithLockedFx([locked, { amount: 10, bill_currency: 'USD' }], 'CNY', null)).toMatchObject({
      total: 3625, by_currency: { USD: 510 }, converted: false, unconverted_currencies: ['USD'],
    })
  })
})
