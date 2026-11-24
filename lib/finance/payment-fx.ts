import { normalizeCurrency, normalizeCurrencyOrDefault, sumByCurrency, type FxRates, type FxSum } from '../fx'
import { RpcDomainError } from '../api/errors'
import { roundMoney } from './money'

export interface PaymentFxLockInput {
  settled_currency?: string | null
  settled_amount?: number | null
  locked_fx_rate?: number | null
}

export interface PaymentFxLock {
  settled_currency: string | null
  settled_amount: number | null
  locked_fx_rate: number | null
}

export function computeLockedRate(amount: number, settledAmount: number): number {
  return amount > 0 && settledAmount > 0 ? Math.round(settledAmount / amount * 1_000_000) / 1_000_000 : 0
}

export function computeSettledAmount(amount: number, lockedRate: number): number {
  return roundMoney(amount * lockedRate)
}

export function validateAndNormalizeFxLock(
  input: PaymentFxLockInput | null | undefined,
  amount: number,
  billCurrency: string,
): PaymentFxLock {
  const rawCurrency = input?.settled_currency
  const currency = normalizeCurrency(rawCurrency)
  const currencyUnset = rawCurrency == null || (typeof rawCurrency === 'string' && !rawCurrency.trim())
  const rawAmount = input?.settled_amount
  const rawRate = input?.locked_fx_rate
  if ((currency && currency === normalizeCurrency(billCurrency)) ||
    (currencyUnset && rawAmount == null && rawRate == null)) {
    return { settled_currency: null, settled_amount: null, locked_fx_rate: null }
  }
  if (!currency || rawAmount == null || !Number.isFinite(rawAmount) || rawAmount <= 0 ||
    rawRate == null || !Number.isFinite(rawRate) || rawRate <= 0 || !Number.isFinite(amount) || amount <= 0) {
    throw new RpcDomainError('VALIDATION_FAILED', '汇率锁定需要有效的实付币种、实付金额和汇率')
  }

  const settledAmount = roundMoney(rawAmount)
  const lockedRate = Math.round(rawRate * 1_000_000) / 1_000_000
  const withinTolerance = (expected: number, settled: number) => {
    if (!Number.isFinite(expected)) return false
    const epsilon = Number.EPSILON * 4 * Math.max(expected, settled, 1)
    return Math.abs(expected - settled) <= 0.05 + epsilon
  }
  if (settledAmount <= 0 || lockedRate <= 0 ||
    !withinTolerance(amount * rawRate, rawAmount) || !withinTolerance(amount * lockedRate, settledAmount)) {
    throw new RpcDomainError('VALIDATION_FAILED', '实付金额与账单金额乘以锁定汇率的差额不得超过 0.05')
  }
  return { settled_currency: currency, settled_amount: settledAmount, locked_fx_rate: lockedRate }
}

export interface LockedPaymentLike extends PaymentFxLockInput {
  amount: number
  bill_currency: string
}

export function sumPaymentsWithLockedFx(
  payments: readonly LockedPaymentLike[],
  targetCurrency: string,
  rates?: FxRates | null,
): FxSum {
  const target = normalizeCurrencyOrDefault(targetCurrency, 'CNY')
  const original = sumByCurrency(payments, payment => ({
    amount: payment.amount,
    currency: payment.bill_currency,
  }), target, null)
  const actual = sumByCurrency(payments, payment => {
    const currency = normalizeCurrency(payment.settled_currency)
    return currency && payment.settled_amount != null && Number.isFinite(payment.settled_amount) && payment.settled_amount > 0
      ? { amount: payment.settled_amount, currency }
      : { amount: payment.amount, currency: payment.bill_currency }
  }, target, rates)
  return {
    ...actual,
    total: roundMoney(actual.total),
    by_currency: Object.fromEntries(Object.entries(original.by_currency).map(([key, value]) => [key, roundMoney(value)])),
    mixed: original.mixed,
  }
}
