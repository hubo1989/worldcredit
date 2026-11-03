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

/**
 * 固定支出的视图筛选：与信用卡共用「状态 + 持卡人」口径。
 * 固定支出没有银行归属，选中银行维度时按 iOS BillsPresentation 的口径隐藏，
 * 避免出现「按银行筛选却混入不属于该银行的固定支出」。
 */
export type PayableViewFilter = 'all' | 'unpaid' | 'cleared'
export type PayableFilterDimension = 'holder' | 'bank'

export function filterPayablesForView<
  P extends { holder_id: string | null; status: 'unpaid' | 'paid' | 'overdue' },
>(
  payables: P[],
  viewFilter: PayableViewFilter,
  dimension: PayableFilterDimension,
  selectedTag: string
): P[] {
  return payables.filter(p => {
    if (viewFilter === 'unpaid' && p.status === 'paid') return false
    if (viewFilter === 'cleared' && p.status !== 'paid') return false
    if (selectedTag !== 'all') {
      if (dimension === 'bank') return false
      if (p.holder_id !== selectedTag) return false
    }
    return true
  })
}
