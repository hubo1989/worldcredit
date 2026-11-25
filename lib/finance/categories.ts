import { normalizeCurrencyOrDefault, sumByCurrency, type FxRates } from '../fx'
import { roundMoney, toCents } from './money'

export const SPEND_CATEGORIES = [
  'dining', 'shopping', 'transport', 'travel', 'utilities',
  'entertainment', 'medical', 'education', 'fees_interest', 'other',
] as const
export type SpendCategory = (typeof SPEND_CATEGORIES)[number]
export type BillItemType = 'purchase' | 'refund' | 'fee' | 'interest' | 'installment' | 'adjustment'
export type MerchantRules = ReadonlyMap<string, SpendCategory>
export const UNCATEGORIZED_KEY = 'uncategorized'

export const SPEND_CATEGORY_LABELS: Record<SpendCategory | typeof UNCATEGORIZED_KEY, string> = {
  dining: '餐饮美食',
  shopping: '日常购物',
  transport: '交通出行',
  travel: '旅行住宿',
  utilities: '生活缴费',
  entertainment: '娱乐订阅',
  medical: '医疗健康',
  education: '教育培训',
  fees_interest: '金融/费用',
  other: '其他',
  uncategorized: '未分类',
}

const aliases: Record<SpendCategory, string[]> = {
  dining: ['餐饮', '美食', '餐飲', 'food', 'restaurant', 'food & drink'],
  shopping: ['购物', '購物', '零售', 'retail', 'groceries', 'merchandise'],
  transport: ['交通', '出行', '交通運輸', 'transportation', 'gas'],
  travel: ['旅行', '旅游', '住宿', '旅遊', 'hotel', 'airline'],
  utilities: ['缴费', '水电', '水電', '通讯', '電訊', 'bills', 'telecom'],
  entertainment: ['娱乐', '訂閱', '订阅', 'subscription', 'digital goods'],
  medical: ['医疗', '醫療', '健康', 'health', 'healthcare', 'pharmacy'],
  education: ['教育', '培训', '培訓', 'tuition'],
  fees_interest: ['费用', '金融', '利息', '手續費', 'fee', 'fees', 'interest', 'finance charge'],
  other: ['其他', '其它', 'misc', 'miscellaneous'],
}

const keywords: Array<[SpendCategory, RegExp]> = [
  ['fees_interest', /年费|年費|利息|利子|违约金|finance charge|annual fee|foreign transaction fee|\bftf\b/i],
  ['dining', /星巴克|瑞幸|美团|美團|大众点评|麥當勞|麦当劳|咖啡|餐厅|餐廳|饿了么|starbucks|luckin|mcdonald|uber\s*eats|deliveroo|doordash|restaurant/i],
  ['travel', /国泰|國泰|南航|携程|攜程|酒店|航空|marriott|hilton|booking|agoda|airbnb|cathay/i],
  ['transport', /滴滴|高德|12306|港铁|港鐵|中石化|中石油|加油站|\b(uber|mtr|shell|lyft)\b/i],
  ['shopping', /淘宝|淘寶|京东|京東|拼多多|天猫|山姆|amazon|apple store|costco|\bsogo\b/i],
  ['entertainment', /爱奇艺|哔哩哔哩|bilibili|b站|netflix|spotify|apple one|chatgpt|\bsteam\b/i],
  ['utilities', /国家电网|國家電網|水费|水費|电费|電費|燃气|燃氣|中国移动|联通|宽带|電訊|broadband/i],
  ['medical', /医院|醫院|药房|藥房|挂号|walgreens|pharmacy|hospital|\bcvs\b/i],
  ['education', /学费|學費|培训|培訓|coursera|udemy|tuition|school/i],
]

export function normalizeMerchantKey(raw?: string | null): string {
  return (raw ?? '').normalize('NFKC').trim().toLowerCase()
    .replace(/^(?:(?:支付宝|微信支付|财付通)[\s:–—-]+|(?:alipay|sq|paypal|wechat|tst)\s*\*\s*)+/i, '')
    .replace(/\s*(?:#\s*\d+|\d+店|\(\d+\))$/, '')
    .trim().replace(/\s+/g, ' ')
}

export function categoryLabel(category?: string | null): string {
  if (!category) return SPEND_CATEGORY_LABELS.uncategorized
  return Object.hasOwn(SPEND_CATEGORY_LABELS, category)
    ? SPEND_CATEGORY_LABELS[category as keyof typeof SPEND_CATEGORY_LABELS]
    : category
}

export function mapExplicitCategory(raw?: string | null): SpendCategory | null {
  const key = raw?.normalize('NFKC').trim().toLowerCase()
  return SPEND_CATEGORIES.find(category =>
    key === category || key === SPEND_CATEGORY_LABELS[category] || aliases[category].some(alias => key === alias)
  ) ?? null
}

interface CategoryInput {
  description?: string | null
  merchant_name?: string | null
  category?: string | null
  item_type?: BillItemType | null
}

export function classifyBillItem(input: CategoryInput, userRulesMap?: MerchantRules): SpendCategory | null {
  const explicit = mapExplicitCategory(input.category)
  if (!explicit && (input.item_type === 'fee' || input.item_type === 'interest')) return 'fees_interest'
  const merchant = normalizeMerchantKey(input.merchant_name || input.description)
  const remembered = userRulesMap?.get(merchant)
  if (remembered || explicit) return remembered ?? explicit
  const text = merchant + ' ' + normalizeMerchantKey(input.description)
  return keywords.find(([, pattern]) => pattern.test(text))?.[0] ?? null
}

export function signedItemAmount(item: { item_type: BillItemType; amount: number }): number {
  if (item.item_type === 'refund') return -Math.abs(item.amount)
  if (item.item_type === 'adjustment') return item.amount
  return Math.abs(item.amount)
}

interface CategoryItem extends CategoryInput {
  bill_id: string
  item_type: BillItemType
  amount: number
  currency: string
}

interface CategoryOptions {
  displayCurrency: string
  rates?: FxRates | null
  includeFeesAndInterest?: boolean
  totalBills?: number
}

interface CurrencyBucket {
  currency: string
  cents: number
  count: number
}

export function aggregateCategoryBreakdown(items: readonly CategoryItem[], options: CategoryOptions) {
  const coveredBills = new Set<string>()
  const categories = new Map<string, Map<string, CurrencyBucket>>()
  const byBill = new Map<string, CurrencyBucket>()
  const merchantCategories = new Map<string, SpendCategory>()
  const refunds: CategoryItem[] = []

  for (const item of items) {
    coveredBills.add(item.bill_id)
    if (item.item_type === 'refund') {
      refunds.push(item)
      continue
    }
    if (item.item_type === 'adjustment') continue
    if (options.includeFeesAndInterest === false && (item.item_type === 'fee' || item.item_type === 'interest')) continue
    const category = mapExplicitCategory(item.category) ??
      (item.item_type === 'fee' || item.item_type === 'interest' ? 'fees_interest' : UNCATEGORIZED_KEY)
    const currency = normalizeCurrencyOrDefault(item.currency, options.displayCurrency)
    const billKey = JSON.stringify([item.bill_id, currency, category])
    let bucket = byBill.get(billKey)
    if (!bucket) {
      bucket = { currency, cents: 0, count: 0 }
      byBill.set(billKey, bucket)
      const billBuckets = categories.get(category) ?? new Map<string, CurrencyBucket>()
      billBuckets.set(billKey, bucket)
      categories.set(category, billBuckets)
    }
    bucket.cents += toCents(signedItemAmount(item))
    bucket.count++
    const merchant = normalizeMerchantKey(item.merchant_name || item.description)
    if (merchant && category !== UNCATEGORIZED_KEY && item.item_type === 'purchase') {
      const key = JSON.stringify([item.bill_id, currency, merchant])
      const prior = merchantCategories.get(key)
      // Stable when a merchant has multiple manually assigned categories on one bill.
      if (!prior || category < prior) merchantCategories.set(key, category)
    }
  }

  const unallocated: Record<string, number> = {}
  for (const item of refunds) {
    const currency = normalizeCurrencyOrDefault(item.currency, options.displayCurrency)
    const merchant = normalizeMerchantKey(item.merchant_name || item.description)
    const category = mapExplicitCategory(item.category) ??
      merchantCategories.get(JSON.stringify([item.bill_id, currency, merchant]))
    const bucket = category ? byBill.get(JSON.stringify([item.bill_id, currency, category])) : undefined
    const refund = Math.abs(toCents(item.amount))
    const deducted = Math.min(refund, bucket?.cents ?? 0)
    if (bucket && deducted > 0) {
      bucket.cents -= deducted
      bucket.count++
    }
    if (refund > deducted) unallocated[currency] = (unallocated[currency] ?? 0) + refund - deducted
  }

  const missing = new Set<string>()
  const breakdown = Array.from(categories, ([category, buckets]) => {
    const byCurrency: Record<string, number> = {}
    let itemCount = 0
    for (const bucket of buckets.values()) {
      byCurrency[bucket.currency] = (byCurrency[bucket.currency] ?? 0) + bucket.cents
      itemCount += bucket.count
    }
    const fx = sumByCurrency(Object.entries(byCurrency), ([currency, cents]) =>
      ({ currency, amount: cents / 100 }), options.displayCurrency, options.rates)
    fx.unconverted_currencies.forEach(currency => missing.add(currency))
    return {
      category,
      category_label: categoryLabel(category),
      amount: roundMoney(fx.total),
      item_count: itemCount,
      by_currency: fx.by_currency,
      fx_converted: fx.converted,
      fx_unconverted_currencies: fx.unconverted_currencies,
    }
  })
  const total = breakdown.reduce((sum, entry) => sum + entry.amount, 0)
  return {
    items: breakdown.sort((a, b) => b.amount - a.amount || a.category.localeCompare(b.category))
      .map(entry => ({ ...entry, percentage: total > 0 ? roundMoney(100 * entry.amount / total) : 0 })),
    unallocated_refunds_by_currency: Object.fromEntries(
      Object.entries(unallocated).map(([currency, cents]) => [currency, cents / 100]),
    ),
    covered_bills: coveredBills.size,
    total_bills: options.totalBills ?? coveredBills.size,
    fx_converted: missing.size === 0,
    fx_unconverted_currencies: [...missing].sort(),
  }
}
