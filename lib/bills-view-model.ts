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
