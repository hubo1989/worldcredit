import type { CardWithBillsSummary } from './api/bills'
import type { CreditAccount } from './types'
import { getEffectiveCardName, getEffectiveCreditLimit } from './utils'

export interface AccountPoolGroup {
  key: string
  account: CreditAccount | null
  bankName: string
  holderId: string
  currency: string
  title: string
  isMergedStatement: boolean
  isSharedQuota: boolean
  cards: CardWithBillsSummary[]
  poolLimit: number | null
  poolUsed: number
  poolAvailable: number | null
}

/**
 * 计算账户池有效总额度：仅纳入 `status === 'active'` 的正常卡片，
 * 排除已冻结（frozen）和已注销（cancelled）卡片的失效额度。
 */
export function resolvePoolLimit(
  account: CreditAccount | null,
  cards: CardWithBillsSummary[],
  isSharedQuota: boolean
): number | null {
  const activeCards = cards.filter((item) => item.card.status === 'active')
  if (activeCards.length === 0) return null

  if (isSharedQuota) {
    if (account?.shared_credit_limit != null && account.shared_credit_limit > 0) {
      return Number(account.shared_credit_limit)
    }
    let maxLimit = 0
    for (const item of activeCards) {
      const eff = getEffectiveCreditLimit(item.card)
      if (eff !== null && eff > maxLimit) maxLimit = eff
    }
    return maxLimit > 0 ? maxLimit : null
  }

  let total = 0
  let hasAnyLimit = false
  for (const item of activeCards) {
    const eff = getEffectiveCreditLimit(item.card)
    if (eff !== null) {
      total += eff
      hasAnyLimit = true
    }
  }
  return hasAnyLimit ? total : null
}

export function buildAccountPools(
  cards: CardWithBillsSummary[],
  accountsById: Map<string, CreditAccount>
): AccountPoolGroup[] {
  const grouped = new Map<string, CardWithBillsSummary[]>()
  for (const item of cards) {
    const accountId = item.account?.id || item.card.account_id
    const key = accountId || `standalone:${item.card.id}`
    const list = grouped.get(key)
    if (list) list.push(item)
    else grouped.set(key, [item])
  }

  const pools: AccountPoolGroup[] = []
  for (const [key, groupCards] of grouped.entries()) {
    const first = groupCards[0]
    const accountId = first.account?.id || first.card.account_id || null
    const account = (accountId ? accountsById.get(accountId) : undefined) ?? first.account ?? null
    const bankName =
      account?.bank_name || first.card.card_product?.bank_name || '银行卡'
    const currency =
      account?.currency || first.card.card_product?.currency || 'CNY'
    const isMergedStatement = account?.statement_mode === 'merged'
    const isSharedQuota = account?.quota_mode === 'shared'
    const poolLimit = resolvePoolLimit(account, groupCards, isSharedQuota)
    const poolUsed = groupCards.reduce((sum, c) => sum + Number(c.unpaidAmount || 0), 0)
    const poolAvailable = poolLimit !== null ? Math.max(0, poolLimit - poolUsed) : null

    const sortedCards = [...groupCards].sort((a, b) => {
      const aPrimary = account?.primary_card_id === a.card.id ? 0 : 1
      const bPrimary = account?.primary_card_id === b.card.id ? 0 : 1
      if (aPrimary !== bPrimary) return aPrimary - bPrimary
      return getEffectiveCardName(a.card, a.card.card_product).localeCompare(
        getEffectiveCardName(b.card, b.card.card_product),
        'zh-CN'
      )
    })

    const title =
      account?.label ||
      (groupCards.length > 1 || isMergedStatement
        ? `${bankName}共享账户`
        : getEffectiveCardName(first.card, first.card.card_product))

    pools.push({
      key,
      account,
      bankName,
      holderId: account?.holder_id || first.holder_id,
      currency,
      title,
      isMergedStatement,
      isSharedQuota,
      cards: sortedCards,
      poolLimit,
      poolUsed,
      poolAvailable,
    })
  }

  return pools.sort((a, b) => {
    if (b.cards.length !== a.cards.length) return b.cards.length - a.cards.length
    if (b.poolUsed !== a.poolUsed) return b.poolUsed - a.poolUsed
    return a.bankName.localeCompare(b.bankName, 'zh-CN')
  })
}
