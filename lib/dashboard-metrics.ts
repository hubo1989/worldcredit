import type { BillDashboardItem } from './api/bills.server'
import { currencySymbol, sumByCurrency } from './fx'
import type { FxRates } from './fx'

/** Dashboard 页面的纯指标计算与格式化逻辑（从页面抽出，便于 characterization 测试）。 */

// ---- 类型与常量 ----

/** 持卡人分段值：'all' 或持卡人 id */
export type HolderFilter = 'all' | string

/** 未来 N 天待还切换项 */
export type FutureRange = 7 | 14 | 30

export const FUTURE_RANGES: FutureRange[] = [7, 14, 30]

/**
 * 金额转展示字符串（币种符号 + 千分位）。隐私模式下由调用方决定是否脱敏。
 *
 * 币种必须由调用方传入：这个应用同时有 CNY / USD / HKD 的卡，写死 ¥ 会把外币
 * 账单显示成人民币。
 */
export function formatMoney(n: number, currency: string): string {
  return `${currencySymbol(currency)}${(n || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`
}

/** 账单所在币种：卡产品的币种就是账单币种。 */
export function billCurrency(bill: BillDashboardItem, fallback: string): string {
  return bill.card?.card_product?.currency || fallback
}

/**
 * 计算一组账单的指标。
 *
 * 所有金额都先按币种分组、再折算到目标币种，绝不跨币种直接相加。返回的四个数字
 * 都是「折算后的真数」，同时附带 fx 元数据：汇率不可用时跨币种部分被排除在数字
 * 之外（而不是按 1:1 混进去），UI 通过 fx 标记向用户说明。
 */
export function computeMetrics(
  bills: BillDashboardItem[],
  futureDays: FutureRange,
  targetCurrency: string,
  rates: FxRates | null
) {
  // 只统计未还清的账单（§3.4）
  const unpaid = bills.filter(b => b.computed_status !== 'paid')
  const pickAmount = (b: BillDashboardItem) => ({
    amount: b.remaining_amount || 0,
    currency: billCurrency(b, targetCurrency),
  })

  const pendingSum = sumByCurrency(unpaid, pickAmount, targetCurrency, rates)

  // 已逾期：已过还款日且未还清（days_until_due < 0）
  const overdueBills = unpaid.filter(b => b.days_until_due < 0)
  const overdueSum = sumByCurrency(overdueBills, pickAmount, targetCurrency, rates)

  // 未来 N 天待还：还款日在 [0, N] 区间内
  const futureBills = unpaid.filter(b => b.days_until_due >= 0 && b.days_until_due <= futureDays)
  const futureSum = sumByCurrency(futureBills, pickAmount, targetCurrency, rates)

  // 总欠款：当前数据模型仅"普通未还"，分期/贷款暂未接入（§3.2）
  const plainOwedSum = pendingSum

  return {
    totalPending: pendingSum.total,
    overdueAmount: overdueSum.total,
    overdueBills,
    futureAmount: futureSum.total,
    plainOwed: plainOwedSum.total,
    unpaidCount: unpaid.length,
    /** 汇率拿到没有：为 false 时下面的合计是不完整的，必须显式标注。 */
    ratesAvailable: rates !== null,
    /** 缺汇率因而未计入合计的币种（含未折算金额，供 UI 展示明细）。 */
    unconvertedCurrencies: Array.from(new Set([
      ...pendingSum.unconverted_currencies,
      ...overdueSum.unconverted_currencies,
      ...futureSum.unconverted_currencies,
    ])).sort(),
    fx: { pending: pendingSum, overdue: overdueSum, future: futureSum, plainOwed: plainOwedSum },
    /** 当前口径下是否出现多币种，用于决定要不要展示币种构成。 */
    mixed: pendingSum.mixed,
  }
}

/** 卡数统计：{ holderId: count } */
export function countCardsByHolder(cards: Array<{ holder_id: string }>): Record<string, number> {
  const map: Record<string, number> = {}
  for (const c of cards) {
    const hid = c.holder_id
    if (!hid) continue
    map[hid] = (map[hid] || 0) + 1
  }
  return map
}
