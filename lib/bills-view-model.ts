// Bills 暗色视图的展示层派生逻辑。
// 与 DashboardView 同一模式：页面保留数据获取与副作用，这里只做纯函数，
// 便于用 characterization 测试锁住口径。

import type { CardWithBillsSummary } from '@/lib/api/bills'

export type AccountMode = 'multi' | 'single'

/**
 * 多卡一账户 / 单卡单账户 的展示口径：
 * 同一持卡人在同一家银行持有 >1 张卡 → multi；否则 single。
 * 这是展示层推导，不改 schema；同一银行跨持卡人仍算各自独立的账户。
 */
export function deriveAccountMode(
  holderId: string,
  bankName: string,
  cards: Pick<CardWithBillsSummary, 'holder_id' | 'card'>[]
): AccountMode {
  // 用户手动钉住的账户模式优先（email 导入歧义 / 独立记账的同银行卡）
  const self = cards.find(
    c => c.holder_id === holderId && (c.card.card_product?.bank_name || '') === bankName
  )
  if (self?.card.account_mode_override) return self.card.account_mode_override
  const sameBankSameHolder = cards.filter(
    c => c.holder_id === holderId && (c.card.card_product?.bank_name || '') === bankName
  )
  return sameBankSameHolder.length > 1 ? 'multi' : 'single'
}

export type BillBadgeTone = 'danger' | 'warn' | 'success'

export interface BillBadgeView {
  text: string
  tone: BillBadgeTone
}

/**
 * 卡片状态徽章：与暗色候选稿一致，统一「淡底 + ink 文字」。
 * overdue → danger；partial → warn；unpaid → warn；其余（unissued/已结清）→ success。
 */
export function billBadgeView(item: CardWithBillsSummary): BillBadgeView {
  if (item.status === 'overdue') return { text: '逾期', tone: 'danger' }
  if (item.status === 'partial') return { text: '部分还款', tone: 'warn' }
  if (item.status === 'unpaid') return { text: '待还款', tone: 'warn' }
  return {
    text: item.historyBills.length > 0 ? '本期已结清' : '未出账单',
    tone: 'success',
  }
}

/** 徽章 tone → 暗色 token 类名（soft 底 + ink 文字）。 */
export function badgeToneClass(tone: BillBadgeTone): string {
  switch (tone) {
    case 'danger':
      return 'bg-d-danger-soft text-d-danger-ink'
    case 'warn':
      return 'bg-d-gold-soft text-d-warn-ink'
    case 'success':
      return 'bg-d-success-soft text-d-success-ink'
  }
}

/** 金额强调色：逾期红 / 部分还款金 / 其余主文字（未出账单走 muted）。 */
export function amountToneClass(item: CardWithBillsSummary): string {
  const isCleared = item.status === 'unissued' || item.unpaidAmount <= 0
  if (item.status === 'overdue') return 'text-d-danger-ink'
  if (item.status === 'partial') return 'text-d-gold'
  if (isCleared) return 'text-d-muted'
  return 'text-d-text'
}

/** 账单页筛选：对象类型 × 状态（多选）× 归属维度 × 标签。 */
export type BillsEntityType = 'all' | 'cards' | 'payables'
export type BillStatusKey = 'unpaid' | 'overdue' | 'unissued' | 'paid'

/** 对象类型下可选的状态；切换类型时用它裁剪已选状态。 */
export function statusOptionsFor(entity: BillsEntityType): BillStatusKey[] {
  if (entity === 'cards') return ['unpaid', 'overdue', 'unissued']
  if (entity === 'payables') return ['unpaid', 'overdue', 'paid']
  return ['unpaid', 'overdue', 'unissued', 'paid']
}

export const BILL_STATUS_LABELS: Record<BillStatusKey, string> = {
  unpaid: '待还',
  overdue: '已逾期',
  unissued: '未出账',
  paid: '已还款',
}

export interface BillsFilterState {
  entityType: BillsEntityType
  /** 空数组 = 不按状态过滤 */
  statuses: BillStatusKey[]
  dimension: 'holder' | 'bank'
  selectedTag: string
}

/** 银行维度下代表「没有银行归属」的固定支出桶。 */
export const NO_BANK_TAG = '__no_bank__'

/** 本页按卡聚合：partial（部分还款）归入「待还」。 */
export function cardStatusKey(
  status: 'overdue' | 'unpaid' | 'partial' | 'unissued'
): BillStatusKey {
  if (status === 'overdue') return 'overdue'
  if (status === 'unissued') return 'unissued'
  return 'unpaid'
}

export function payableStatusKey(status: 'unpaid' | 'paid' | 'overdue'): BillStatusKey {
  if (status === 'paid') return 'paid'
  if (status === 'overdue') return 'overdue'
  return 'unpaid'
}

interface CardLike {
  holder_id: string | null
  status: 'overdue' | 'unpaid' | 'partial' | 'unissued'
  card: { card_product?: { bank_name?: string } | null }
}

interface PayableLike {
  holder_id: string | null
  status: 'unpaid' | 'paid' | 'overdue'
  bank_name?: string | null
}

function matchesTag(
  holderId: string | null,
  bankName: string | null | undefined,
  f: BillsFilterState
): boolean {
  if (f.selectedTag === 'all') return true
  if (f.dimension === 'holder') return holderId === f.selectedTag
  if (f.selectedTag === NO_BANK_TAG) return !bankName
  return bankName === f.selectedTag
}

export function filterCardsForView<C extends CardLike>(cards: C[], f: BillsFilterState): C[] {
  if (f.entityType === 'payables') return []
  return cards.filter(
    c =>
      matchesTag(c.holder_id, c.card.card_product?.bank_name, f) &&
      (f.statuses.length === 0 || f.statuses.includes(cardStatusKey(c.status)))
  )
}

export function filterPayablesForView<P extends PayableLike>(
  payables: P[],
  f: BillsFilterState
): P[] {
  if (f.entityType === 'cards') return []
  return payables.filter(
    p =>
      matchesTag(p.holder_id, p.bank_name, f) &&
      (f.statuses.length === 0 || f.statuses.includes(payableStatusKey(p.status)))
  )
}

/** 当前对象类型 / 维度 / 标签下各状态的条数（不受状态选择影响）。 */
export function countStatuses<C extends CardLike, P extends PayableLike>(
  cards: C[],
  payables: P[],
  f: BillsFilterState
): Record<BillStatusKey, number> {
  const counts: Record<BillStatusKey, number> = { unpaid: 0, overdue: 0, unissued: 0, paid: 0 }
  if (f.entityType !== 'payables') {
    for (const c of cards) {
      if (matchesTag(c.holder_id, c.card.card_product?.bank_name, f)) {
        counts[cardStatusKey(c.status)] += 1
      }
    }
  }
  if (f.entityType !== 'cards') {
    for (const p of payables) {
      if (matchesTag(p.holder_id, p.bank_name, f)) counts[payableStatusKey(p.status)] += 1
    }
  }
  return counts
}

/** 当前维度 / 标签下两种对象的条数。 */
export function countEntities<C extends CardLike, P extends PayableLike>(
  cards: C[],
  payables: P[],
  f: BillsFilterState
): { cards: number; payables: number } {
  let cardCount = 0
  let payableCount = 0
  for (const c of cards) {
    if (matchesTag(c.holder_id, c.card.card_product?.bank_name, f)) cardCount += 1
  }
  for (const p of payables) {
    if (matchesTag(p.holder_id, p.bank_name, f)) payableCount += 1
  }
  return { cards: cardCount, payables: payableCount }
}

/** 当前对象类型 / 状态下的持卡人、银行标签计数。 */
export function countByTag<C extends CardLike, P extends PayableLike>(
  cards: C[],
  payables: P[],
  f: BillsFilterState
): { holders: Record<string, number>; banks: Record<string, number>; noBank: number } {
  const holders: Record<string, number> = {}
  const banks: Record<string, number> = {}
  let noBank = 0
  // 与 countEntities / countStatuses 一致：facet 计数不受已选状态影响
  if (f.entityType !== 'payables') {
    for (const c of cards) {
      if (c.holder_id) holders[c.holder_id] = (holders[c.holder_id] ?? 0) + 1
      const bank = c.card.card_product?.bank_name
      if (bank) banks[bank] = (banks[bank] ?? 0) + 1
      else noBank += 1
    }
  }
  if (f.entityType !== 'cards') {
    for (const p of payables) {
      if (p.holder_id) holders[p.holder_id] = (holders[p.holder_id] ?? 0) + 1
      if (p.bank_name) banks[p.bank_name] = (banks[p.bank_name] ?? 0) + 1
      else noBank += 1
    }
  }
  return { holders, banks, noBank }
}
