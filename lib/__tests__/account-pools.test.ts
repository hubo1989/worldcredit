import { describe, expect, it } from 'vitest'
import { buildAccountPools, resolvePoolLimit } from '../account-pools'
import type { CardWithBillsSummary } from '../api/bills'
import type { CreditAccount } from '../types'

function makeCardSummary(
  id: string,
  status: 'active' | 'frozen' | 'cancelled',
  creditLimit: number,
  unpaidAmount = 0,
  account?: CreditAccount
): CardWithBillsSummary {
  return {
    card: {
      id,
      holder_id: 'h1',
      card_product_id: 'cp1',
      account_id: account?.id ?? null,
      credit_limit: creditLimit,
      billing_day: 5,
      status,
      card_type: 'credit',
      created_at: '2026-10-01T00:00:00Z',
      card_product: {
        id: 'cp1',
        bank_id: 'b1',
        bank_name: '招商银行',
        card_name: `卡-${id}`,
        currency: 'CNY',
        country: 'CN',
        payment_due_type: 'after_billing',
        payment_due_value: 20,
        is_active: true,
        created_at: '2026-10-01T00:00:00Z',
      },
    },
    account,
    activeBill: null,
    historyBills: [],
    billingDay: 5,
    nextBillingDate: new Date('2026-11-05'),
    unpaidAmount,
    graceDays: 40,
    nextDueDate: new Date('2026-11-25'),
    status: unpaidAmount > 0 ? 'unpaid' : 'unissued',
    holder_id: 'h1',
  }
}

describe('account-pools', () => {
  const sharedAccount: CreditAccount = {
    id: 'acc-shared',
    holder_id: 'h1',
    bank_id: 'b1',
    bank_name: '招商银行',
    currency: 'CNY',
    account_tail: null,
    statement_mode: 'merged',
    quota_mode: 'shared',
    shared_credit_limit: 50000,
    billing_day: 5,
    due_type: 'after_billing',
    due_value: 20,
    primary_card_id: 'c1',
    label: '招行主账户',
    status: 'active',
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
  }

  it('excludes frozen and cancelled cards from independent poolLimit while keeping them visible', () => {
    const indepAccount: CreditAccount = {
      ...sharedAccount,
      id: 'acc-indep',
      statement_mode: 'independent',
      quota_mode: 'independent',
      shared_credit_limit: null,
    }
    const activeCard = makeCardSummary('c-active', 'active', 30000, 5000, indepAccount)
    const frozenCard = makeCardSummary('c-frozen', 'frozen', 80000, 0, indepAccount)
    const cancelledCard = makeCardSummary('c-cancelled', 'cancelled', 60000, 1000, indepAccount)

    const limit = resolvePoolLimit(indepAccount, [activeCard, frozenCard, cancelledCard], false)
    expect(limit).toBe(30000)

    const pools = buildAccountPools([activeCard, frozenCard, cancelledCard], new Map([[indepAccount.id, indepAccount]]))
    expect(pools).toHaveLength(1)
    expect(pools[0].cards).toHaveLength(3)
    expect(pools[0].poolLimit).toBe(30000)
    expect(pools[0].poolUsed).toBe(6000)
    expect(pools[0].poolAvailable).toBe(24000)
  })

  it('returns null poolLimit when all cards in an account pool are inactive', () => {
    const frozen = makeCardSummary('c-f', 'frozen', 50000, 1200, sharedAccount)
    const cancelled = makeCardSummary('c-c', 'cancelled', 50000, 0, sharedAccount)

    expect(resolvePoolLimit(sharedAccount, [frozen, cancelled], true)).toBeNull()
    expect(resolvePoolLimit(null, [frozen], false)).toBeNull()

    const pools = buildAccountPools([frozen, cancelled], new Map([[sharedAccount.id, sharedAccount]]))
    expect(pools[0].poolLimit).toBeNull()
    expect(pools[0].poolAvailable).toBeNull()
    expect(pools[0].poolUsed).toBe(1200)
  })

  it('ignores inactive card limits in fallback shared pool max calculation', () => {
    const accNoShared: CreditAccount = {
      ...sharedAccount,
      shared_credit_limit: null,
    }
    const active = makeCardSummary('c-a', 'active', 20000, 0, accNoShared)
    const frozenHigher = makeCardSummary('c-fh', 'frozen', 100000, 0, accNoShared)

    expect(resolvePoolLimit(accNoShared, [active, frozenHigher], true)).toBe(20000)
  })
})
