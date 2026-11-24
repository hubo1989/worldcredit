import { format } from 'date-fns'
import {
  convert,
  normalizeCurrency,
  normalizeCurrencyOrDefault,
  sumByCurrency,
  type FxRates,
} from '@/lib/fx'
import {
  addMonthsToPayablePeriod,
  billEffectiveDueDate,
  billEffectiveMinPayment,
  billEffectiveStatementDate,
  effectiveBillAmount,
  getLocalTodayString,
  isBillUnissued,
  payableDueDate,
} from '@/lib/utils'
import {
  SPEND_CATEGORIES,
  SPEND_CATEGORY_LABELS,
  type BillItem,
  type BillItemInput,
  type BillItemType,
  type FamilyStatementReport,
  type InstallmentFeeMode,
  type InstallmentPeriod,
  type InstallmentPlan,
  type PaymentWithFx,
  type SpendCategory,
} from './types'

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

export function round6(n: number): number {
  return Math.round((n + Number.EPSILON) * 1_000_000) / 1_000_000
}

export function categoryLabel(category: string | null | undefined): string {
  if (!category) return SPEND_CATEGORY_LABELS.uncategorized
  if (category in SPEND_CATEGORY_LABELS) {
    return SPEND_CATEGORY_LABELS[category as keyof typeof SPEND_CATEGORY_LABELS]
  }
  return category
}

// ---------------------------------------------------------------------------
// 1. Bill item normalization, classification & CSV/text parsing
// ---------------------------------------------------------------------------

const MERCHANT_PREFIX_RE = /^(支付宝[-–—:\s]*|微信支付[-–—:\s]*|财付通[-–—:\s]*|ALIPAY\*?\s*|WECHAT\s*\*?\s*|SQ\s*\*|PAYPAL\s*\*|TST\s*\*)/i
const MERCHANT_SUFFIX_RE = /(\s*[#-]\s*\d+|\s*\d+店|\s*\(\d+\))$/i

export function normalizeMerchantKey(raw: string | null | undefined): string {
  if (!raw) return ''
  return raw
    .normalize('NFKC')
    .trim()
    .replace(MERCHANT_PREFIX_RE, '')
    .replace(MERCHANT_SUFFIX_RE, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

const CATEGORY_SYNONYMS: Record<string, SpendCategory> = {
  dining: 'dining',
  餐饮: 'dining',
  餐饮美食: 'dining',
  美食: 'dining',
  food: 'dining',
  restaurant: 'dining',
  shopping: 'shopping',
  购物: 'shopping',
  日常购物: 'shopping',
  零售: 'shopping',
  百货: 'shopping',
  transport: 'transport',
  交通: 'transport',
  交通出行: 'transport',
  出行: 'transport',
  transit: 'transport',
  travel: 'travel',
  旅行: 'travel',
  旅行住宿: 'travel',
  航旅: 'travel',
  酒店: 'travel',
  utilities: 'utilities',
  生活缴费: 'utilities',
  缴费: 'utilities',
  水电煤: 'utilities',
  entertainment: 'entertainment',
  娱乐: 'entertainment',
  娱乐订阅: 'entertainment',
  订阅: 'entertainment',
  medical: 'medical',
  医疗: 'medical',
  医疗健康: 'medical',
  健康: 'medical',
  education: 'education',
  教育: 'education',
  教育培训: 'education',
  fees_interest: 'fees_interest',
  '金融/费用': 'fees_interest',
  费用: 'fees_interest',
  利息: 'fees_interest',
  other: 'other',
  其他: 'other',
}

const CATEGORY_KEYWORDS: Array<{ category: SpendCategory; keywords: string[] }> = [
  {
    category: 'fees_interest',
    keywords: [
      '年费',
      '利息',
      '违约金',
      '滞纳金',
      '分期手续费',
      '外币手续费',
      '货币转换费',
      'finance charge',
      'annual fee',
      'foreign transaction fee',
      'late fee',
      'interest',
      'ftf',
    ],
  },
  {
    category: 'dining',
    keywords: [
      '星巴克',
      '瑞幸',
      '喜茶',
      '奈雪',
      '霸王茶姬',
      '美团',
      '饿了么',
      '大众点评',
      '肯德基',
      '麦当劳',
      '海底捞',
      '咖啡',
      '餐厅',
      '饭店',
      '烧烤',
      '火锅',
      'starbucks',
      'mcdonald',
      'kfc',
      'uber eats',
      'ubereats',
      'doordash',
      'deliveroo',
      'foodpanda',
      'cafe',
      'coffee',
    ],
  },
  {
    category: 'transport',
    keywords: [
      '滴滴',
      '高德',
      '曹操出行',
      '12306',
      '铁路',
      '地铁',
      '公交',
      '高速',
      'etc',
      '中石化',
      '中石油',
      '加油',
      '充电桩',
      '停车',
      '港铁',
      '八达通',
      'uber',
      'lyft',
      'grab',
      'mtr',
      'octopus',
      'shell',
      'chevron',
    ],
  },
  {
    category: 'travel',
    keywords: [
      '国泰',
      '南航',
      '东航',
      '国航',
      '海航',
      '春秋航空',
      '携程',
      '去哪儿',
      '飞猪',
      '同程',
      '酒店',
      '宾馆',
      '民宿',
      '航空',
      '机票',
      'cathay',
      'ana',
      'jal',
      'united',
      'delta',
      'marriott',
      'hilton',
      'hyatt',
      'ihg',
      'booking',
      'agoda',
      'airbnb',
      'expedia',
      'trip.com',
    ],
  },
  {
    category: 'utilities',
    keywords: [
      '国家电网',
      '南方电网',
      '电费',
      '水费',
      '燃气',
      '煤气',
      '供暖',
      '物业',
      '中国移动',
      '中国联通',
      '中国电信',
      '话费',
      '宽带',
      'verizon',
      'at&t',
      't-mobile',
      'comcast',
      'electric',
      'water',
    ],
  },
  {
    category: 'entertainment',
    keywords: [
      'netflix',
      'spotify',
      'apple one',
      'icloud',
      'chatgpt',
      'openai',
      'claude',
      'steam',
      'playstation',
      'nintendo',
      'youtube',
      'disney',
      'b站',
      'bilibili',
      '爱奇艺',
      '腾讯视频',
      '优酷',
      '网易云',
      'qq音乐',
      '电影',
      '影城',
    ],
  },
  {
    category: 'medical',
    keywords: [
      '医院',
      '药房',
      '药店',
      '诊所',
      '体检',
      '口腔',
      '牙科',
      '眼科',
      '挂号',
      '医保',
      'cvs',
      'walgreens',
      'pharmacy',
      'clinic',
      'hospital',
      'medical',
      'dental',
    ],
  },
  {
    category: 'education',
    keywords: [
      '学校',
      '大学',
      '学费',
      '培训',
      '课程',
      '书店',
      '得到',
      'coursera',
      'udemy',
      'tuition',
      'university',
      'college',
      'kindle',
    ],
  },
  {
    category: 'shopping',
    keywords: [
      '淘宝',
      '天猫',
      '京东',
      '拼多多',
      '唯品会',
      '抖音商城',
      '小红书',
      '山姆',
      '盒马',
      'costco',
      'walmart',
      'target',
      'amazon',
      'apple store',
      'apple.com',
      'sogo',
      'uniqlo',
      '优衣库',
      '宜家',
      'ikea',
      '超市',
      '便利店',
      '7-eleven',
      '全家',
      '罗森',
    ],
  },
]

const REFUND_RE = /(退款|退货|退税|冲正|refund|rebate|credit adjust|reversal)/i
const FEE_RE = /(年费|手续费|违约金|滞纳金|annual fee|late fee|foreign transaction fee|ftf)/i
const INTEREST_RE = /(利息|循环息|finance charge|interest charge)/i

export function mapExplicitCategory(raw: string | null | undefined): SpendCategory | null {
  if (!raw) return null
  const normalized = raw.trim().toLowerCase()
  if (!normalized) return null
  if (SPEND_CATEGORIES.includes(normalized as SpendCategory)) {
    return normalized as SpendCategory
  }
  return CATEGORY_SYNONYMS[normalized] ?? null
}

export function classifyBillItem(
  input: {
    description?: string | null
    merchant_name?: string | null
    category?: string | null
    item_type?: BillItemType | null
  },
  userRulesMap?: Map<string, SpendCategory> | Record<string, SpendCategory>,
): SpendCategory | null {
  const explicit = mapExplicitCategory(input.category)
  if ((input.item_type === 'fee' || input.item_type === 'interest') && !explicit) {
    return 'fees_interest'
  }

  const merchantKey = normalizeMerchantKey(input.merchant_name || input.description)
  if (merchantKey && userRulesMap) {
    const matched =
      userRulesMap instanceof Map ? userRulesMap.get(merchantKey) : userRulesMap[merchantKey]
    if (matched) return matched
  }

  if (explicit) return explicit

  const haystack = `${input.merchant_name || ''} ${input.description || ''}`.trim().toLowerCase()
  if (!haystack) return null

  for (const rule of CATEGORY_KEYWORDS) {
    if (rule.keywords.some((kw) => haystack.includes(kw))) {
      return rule.category
    }
  }
  return null
}

export function signedItemAmount(item: { item_type: BillItemType; amount: number }): number {
  const amt = Number(item.amount) || 0
  if (item.item_type === 'refund') return -Math.abs(amt)
  if (item.item_type === 'adjustment') return amt
  return Math.abs(amt)
}

export function normalizeBillItemInput(
  raw: {
    description: string
    merchant_name?: string | null
    amount: number
    item_type?: BillItemType | null
    category?: string | null
    currency?: string | null
    transaction_date?: string | null
    post_date?: string | null
    source?: BillItemInput['source']
  },
  userRulesMap?: Map<string, SpendCategory> | Record<string, SpendCategory>,
): BillItemInput {
  const rawAmt = Number(raw.amount) || 0
  const desc = (raw.description || '').trim() || '未命名交易'
  let itemType: BillItemType = raw.item_type ?? 'purchase'
  let normalizedAmt = round2(Math.abs(rawAmt))

  if (!raw.item_type) {
    if (rawAmt < 0 || REFUND_RE.test(desc)) {
      itemType = 'refund'
    } else if (INTEREST_RE.test(desc)) {
      itemType = 'interest'
    } else if (FEE_RE.test(desc)) {
      itemType = 'fee'
    }
  } else if (raw.item_type === 'adjustment') {
    normalizedAmt = round2(rawAmt)
  }

  const category = classifyBillItem(
    {
      description: desc,
      merchant_name: raw.merchant_name,
      category: raw.category,
      item_type: itemType,
    },
    userRulesMap,
  )

  return {
    description: desc,
    merchant_name: raw.merchant_name?.trim() || null,
    transaction_date: raw.transaction_date || null,
    post_date: raw.post_date || null,
    amount: normalizedAmt,
    currency: normalizeCurrencyOrDefault(raw.currency, 'CNY'),
    item_type: itemType,
    category,
    source: raw.source ?? 'manual',
  }
}

export function computeBillItemsDiscrepancy(
  effectiveAmount: number,
  items: ReadonlyArray<{ item_type: BillItemType; amount: number }>,
): { hasDiscrepancy: boolean; itemsNetTotal: number; diff: number } {
  if (items.length === 0) {
    return { hasDiscrepancy: false, itemsNetTotal: 0, diff: 0 }
  }
  const itemsNetTotal = round2(items.reduce((sum, item) => sum + signedItemAmount(item), 0))
  const diff = round2(itemsNetTotal - effectiveAmount)
  return {
    hasDiscrepancy: Math.abs(diff) > 0.01,
    itemsNetTotal,
    diff,
  }
}

export function buildItemFingerprint(item: {
  transaction_date?: string | null
  description: string
  item_type: BillItemType
  amount: number
}): string {
  const datePart = (item.transaction_date || '').trim().slice(0, 10)
  const descPart = item.description.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ')
  return `${datePart}|${descPart}|${signedItemAmount(item).toFixed(2)}`
}

function normalizeParsedDate(rawDate: string | undefined, billMonth?: string): string | null {
  if (!rawDate) return null
  const trimmed = rawDate.trim().replace(/\//g, '-')
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(trimmed)) {
    const [y, m, d] = trimmed.split('-')
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  if (/^\d{1,2}-\d{1,2}$/.test(trimmed) && billMonth && /^\d{4}-\d{2}$/.test(billMonth)) {
    const [billYearStr, billMonthStr] = billMonth.split('-')
    const [mStr, dStr] = trimmed.split('-')
    let year = Number(billYearStr)
    const txMonth = Number(mStr)
    if (Number(billMonthStr) === 1 && txMonth === 12) {
      year -= 1
    }
    return `${year}-${mStr.padStart(2, '0')}-${dStr.padStart(2, '0')}`
  }
  return null
}

export interface ParsedImportPreviewRow {
  tempId: string
  item: BillItemInput
  isDuplicate: boolean
  checked: boolean
  rawLine?: string
}

export function parsePastedBillItems(
  text: string,
  options: {
    billMonth?: string
    defaultCurrency: string
    userRulesMap?: Map<string, SpendCategory> | Record<string, SpendCategory>
    existingItems?: ReadonlyArray<{
      transaction_date?: string | null
      description: string
      item_type: BillItemType
      amount: number
    }>
  },
): ParsedImportPreviewRow[] {
  const existingFingerprints = new Set((options.existingItems ?? []).map(buildItemFingerprint))
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)

  const rows: ParsedImportPreviewRow[] = []
  lines.forEach((line, idx) => {
    const tokens = line.includes('\t')
      ? line.split('\t').map((s) => s.trim())
      : line.includes(',')
        ? line.split(',').map((s) => s.trim())
        : line.split(/\s{2,}/).map((s) => s.trim())

    let parts = tokens.filter(Boolean)
    if (parts.length < 2) {
      parts = line.split(/\s+/).filter(Boolean)
    }

    let dateStr: string | undefined
    let amountVal: number | null = null
    let explicitCategory: string | undefined
    const descParts: string[] = []

    for (let i = 0; i < parts.length; i++) {
      const token = parts[i]
      if (!dateStr && /^(\d{4}[/-])?\d{1,2}[/-]\d{1,2}$/.test(token)) {
        dateStr = token
        continue
      }
      const cleanedNum = token.replace(/[¥$￥,，]/g, '').replace(/^(HK\$|US\$)/i, '')
      if (amountVal === null && /^[+-]?\d+(\.\d{1,2})?$/.test(cleanedNum)) {
        amountVal = Number(cleanedNum)
        continue
      }
      if (i === parts.length - 1 && mapExplicitCategory(token)) {
        explicitCategory = token
        continue
      }
      descParts.push(token)
    }

    if (amountVal === null || !Number.isFinite(amountVal)) return
    const description = descParts.join(' ').trim() || line
    const txDate = normalizeParsedDate(dateStr, options.billMonth)
    const item = normalizeBillItemInput(
      {
        transaction_date: txDate,
        description,
        amount: amountVal,
        category: explicitCategory ?? null,
        currency: options.defaultCurrency,
        source: 'text',
      },
      options.userRulesMap,
    )
    const fp = buildItemFingerprint({
      transaction_date: item.transaction_date,
      description: item.description,
      item_type: item.item_type ?? 'purchase',
      amount: item.amount,
    })
    const isDuplicate = existingFingerprints.has(fp)
    rows.push({
      tempId: `txt-${idx}-${fp}`,
      item,
      isDuplicate,
      checked: !isDuplicate,
      rawLine: line,
    })
  })

  return rows
}

/** Lightweight RFC 4180 CSV parser handling BOM, quoted commas & newlines. */
export function parseCsvMatrix(csvText: string): string[][] {
  const clean = csvText.replace(/^\uFEFF/, '')
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i]
    const next = clean[i + 1]
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"'
        i++
      } else if (ch === '"') {
        inQuotes = false
      } else {
        cell += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      row.push(cell.trim())
      cell = ''
    } else if (ch === '\r' && next === '\n') {
      row.push(cell.trim())
      if (row.some(Boolean)) rows.push(row)
      row = []
      cell = ''
      i++
    } else if (ch === '\n' || ch === '\r') {
      row.push(cell.trim())
      if (row.some(Boolean)) rows.push(row)
      row = []
      cell = ''
    } else {
      cell += ch
    }
  }
  row.push(cell.trim())
  if (row.some(Boolean)) rows.push(row)
  return rows
}

export interface CsvColumnMapping {
  dateCol: number | null
  descCol: number | null
  amountCol: number | null
  debitCreditCol: number | null
  currencyCol: number | null
  categoryCol: number | null
}

export function inferCsvColumnMapping(headers: string[]): CsvColumnMapping {
  const findIdx = (patterns: RegExp[]) =>
    headers.findIndex((h) => patterns.some((re) => re.test(h.trim())))

  const dateIdx = findIdx([/交易日|记账日|日期|date|time/i])
  const descIdx = findIdx([/摘要|商户|交易描述|说明|merchant|description|details|memo/i])
  const amountIdx = findIdx([/金额|交易额|amount|value/i])
  const dcIdx = findIdx([/借贷|收支|类型|direction|type|debit/i])
  const curIdx = findIdx([/币种|货币|currency/i])
  const catIdx = findIdx([/分类|类别|category/i])

  return {
    dateCol: dateIdx >= 0 ? dateIdx : null,
    descCol: descIdx >= 0 ? descIdx : headers.length > 1 ? 1 : 0,
    amountCol: amountIdx >= 0 ? amountIdx : headers.length > 2 ? 2 : null,
    debitCreditCol: dcIdx >= 0 ? dcIdx : null,
    currencyCol: curIdx >= 0 ? curIdx : null,
    categoryCol: catIdx >= 0 ? catIdx : null,
  }
}

export function parseCsvBillItems(
  matrix: string[][],
  mapping: CsvColumnMapping,
  options: {
    hasHeader: boolean
    billMonth?: string
    defaultCurrency: string
    userRulesMap?: Map<string, SpendCategory> | Record<string, SpendCategory>
    existingItems?: ReadonlyArray<{
      transaction_date?: string | null
      description: string
      item_type: BillItemType
      amount: number
    }>
  },
): ParsedImportPreviewRow[] {
  const existingFingerprints = new Set((options.existingItems ?? []).map(buildItemFingerprint))
  const startRow = options.hasHeader ? 1 : 0
  const rows: ParsedImportPreviewRow[] = []

  for (let i = startRow; i < matrix.length; i++) {
    const cols = matrix[i]
    if (!cols || cols.length === 0) continue
    const rawAmountStr =
      mapping.amountCol !== null ? (cols[mapping.amountCol] ?? '') : ''
    const cleanedNum = rawAmountStr.replace(/[¥$￥,，\s]/g, '').replace(/^(HK\$|US\$)/i, '')
    const parsedNum = Number(cleanedNum)
    if (!cleanedNum || !Number.isFinite(parsedNum) || parsedNum === 0) continue

    const desc =
      (mapping.descCol !== null ? cols[mapping.descCol] : '') || 'CSV 导入交易'
    const dcStr = mapping.debitCreditCol !== null ? (cols[mapping.debitCreditCol] ?? '') : ''
    let explicitType: BillItemType | undefined
    if (/(贷|退|返|refund|credit)/i.test(dcStr)) {
      explicitType = 'refund'
    } else if (/(费|fee)/i.test(dcStr)) {
      explicitType = 'fee'
    } else if (/(息|interest)/i.test(dcStr)) {
      explicitType = 'interest'
    }

    const rawDate = mapping.dateCol !== null ? cols[mapping.dateCol] : undefined
    const txDate = normalizeParsedDate(rawDate, options.billMonth)
    const cur =
      mapping.currencyCol !== null && cols[mapping.currencyCol]
        ? normalizeCurrencyOrDefault(cols[mapping.currencyCol], options.defaultCurrency)
        : options.defaultCurrency
    const rawCat = mapping.categoryCol !== null ? cols[mapping.categoryCol] : undefined

    const item = normalizeBillItemInput(
      {
        transaction_date: txDate,
        description: desc,
        amount: parsedNum,
        item_type: explicitType,
        category: rawCat,
        currency: cur,
        source: 'csv',
      },
      options.userRulesMap,
    )
    const fp = buildItemFingerprint({
      transaction_date: item.transaction_date,
      description: item.description,
      item_type: item.item_type ?? 'purchase',
      amount: item.amount,
    })
    const isDuplicate = existingFingerprints.has(fp)
    rows.push({
      tempId: `csv-${i}-${fp}`,
      item,
      isDuplicate,
      checked: !isDuplicate,
    })
  }

  return rows
}

// ---------------------------------------------------------------------------
// 2. Installment schedule & exposure pure calculations
// ---------------------------------------------------------------------------

export const INSTALLMENT_FEE_MODE_LABELS: Record<InstallmentFeeMode, string> = {
  equal_principal_fee: '等额本金+手续费',
  interest_free: '免息分期',
  equal_installment_apr: '等额本息 (APR)',
}

export function generateInstallmentSchedule(plan: {
  principal_amount: number
  total_periods: number
  paid_periods: number
  fee_mode: InstallmentFeeMode
  fee_charge_mode: 'per_period' | 'upfront'
  fee_rate_per_period?: number | null
  custom_period_fee?: number | null
  apr?: number | null
  start_month: string
  due_day: number
  due_month_offset: 0 | 1
}): InstallmentPeriod[] {
  const N = Math.max(1, Math.floor(plan.total_periods))
  const P = round2(Math.max(0, plan.principal_amount))
  const schedule: InstallmentPeriod[] = []
  let remaining = P

  const monthlyRate = plan.fee_mode === 'equal_installment_apr' ? (plan.apr ?? 0) / 12 : 0
  let equalA = 0
  if (plan.fee_mode === 'equal_installment_apr' && monthlyRate > 0) {
    const pow = Math.pow(1 + monthlyRate, N)
    equalA = round2((P * monthlyRate * pow) / (pow - 1))
  }

  const basePrincipal = round2(P / N)
  const fixedFee =
    plan.custom_period_fee != null
      ? round2(plan.custom_period_fee)
      : round2(P * (plan.fee_rate_per_period ?? 0))

  for (let i = 1; i <= N; i++) {
    let principal: number
    let fee: number

    if (plan.fee_mode === 'equal_installment_apr' && monthlyRate > 0) {
      fee = round2(remaining * monthlyRate)
      if (i === N) {
        principal = round2(remaining)
      } else {
        principal = round2(Math.min(remaining, Math.max(0, equalA - fee)))
      }
    } else {
      principal = i === N ? round2(remaining) : basePrincipal
      if (plan.fee_mode === 'equal_principal_fee') {
        if (plan.fee_charge_mode === 'upfront') {
          fee = i === 1 ? fixedFee : 0
        } else {
          fee = fixedFee
        }
      } else {
        fee = 0
      }
    }

    remaining = round2(Math.max(0, remaining - principal))
    const billMonth = addMonthsToPayablePeriod(plan.start_month, i - 1)
    const dueMonth = addMonthsToPayablePeriod(billMonth, plan.due_month_offset)
    const dueDate = format(payableDueDate(plan.due_day, dueMonth), 'yyyy-MM-dd')

    schedule.push({
      period_index: i,
      bill_month: billMonth,
      due_date: dueDate,
      principal,
      fee,
      total: round2(principal + fee),
      remaining_principal_after: remaining,
      is_paid: i <= plan.paid_periods,
    })
  }

  return schedule
}

export function computeActiveInstallmentsExposure(
  plans: ReadonlyArray<InstallmentPlan>,
  existingBillScopes: Set<string>,
  cardAccountMap?: Map<string, string | null>,
): {
  unbilledByCardAndPlan: Map<string, { unbilledPrincipal: number; periods: InstallmentPeriod[] }>
  unbilledEntries: Array<{ plan: InstallmentPlan; amount: number; currency: string }>
} {
  const unbilledByCardAndPlan = new Map<
    string,
    { unbilledPrincipal: number; periods: InstallmentPeriod[] }
  >()
  const unbilledEntries: Array<{ plan: InstallmentPlan; amount: number; currency: string }> = []

  for (const plan of plans) {
    if (plan.status !== 'active') continue
    const schedule = generateInstallmentSchedule(plan)
    const accountId = cardAccountMap?.get(plan.card_id) ?? null
    let unbilledPrincipal = 0
    const periods: InstallmentPeriod[] = []

    for (const p of schedule) {
      if (p.is_paid) continue
      const cardScope = `card:${plan.card_id}:${p.bill_month}`
      const accScope = accountId ? `acc:${accountId}:${p.bill_month}` : null
      const covered =
        plan.billing_mode === 'included_in_statement' &&
        (existingBillScopes.has(cardScope) || (accScope !== null && existingBillScopes.has(accScope)))
      periods.push({ ...p, covered_by_statement: covered })
      if (!covered) {
        unbilledPrincipal = round2(unbilledPrincipal + p.principal)
      }
    }

    unbilledByCardAndPlan.set(plan.id, { unbilledPrincipal, periods })
    if (unbilledPrincipal > 0) {
      unbilledEntries.push({
        plan,
        amount: unbilledPrincipal,
        currency: plan.currency,
      })
    }
  }

  return { unbilledByCardAndPlan, unbilledEntries }
}

// ---------------------------------------------------------------------------
// 3. Rolling interest & repayment health pure engine
// ---------------------------------------------------------------------------

function calendarDaysBetween(startIso: string, endIso: string): number {
  const s = new Date(`${startIso.slice(0, 10)}T00:00:00Z`).getTime()
  const e = new Date(`${endIso.slice(0, 10)}T00:00:00Z`).getTime()
  if (!Number.isFinite(s) || !Number.isFinite(e)) return 0
  return Math.max(0, Math.round((e - s) / 86_400_000))
}

export interface BillRepaymentHealth {
  applicable: boolean
  tier: 'A_items' | 'B_statement_fallback'
  effective_amount: number
  total_paid: number
  remaining_amount: number
  min_payment: number | null
  min_payment_status: 'unset' | 'covered' | 'uncovered'
  uncovered_min: number
  is_fully_paid: boolean
  is_overdue: boolean
  estimated_interest: number
  daily_rate: number
  estimate_date: string
  used_fallback_date: boolean
  interest_bearing_principal: number
}

export function estimateBillRepaymentHealth(input: {
  bill: {
    bill_month: string
    bill_amount: number
    bill_amount_override?: number | null
    min_payment?: number | null
    min_payment_override?: number | null
    statement_date?: string | null
    statement_date_override?: string | null
    statement_start?: string | null
    statement_end?: string | null
    due_date: string
    due_date_override?: string | null
  }
  cardType?: 'credit' | 'loan'
  items: ReadonlyArray<BillItem>
  payments: ReadonlyArray<Pick<PaymentWithFx, 'amount' | 'paid_at'>>
  dailyRate?: number
  estimateDate?: string
}): BillRepaymentHealth {
  const today = input.estimateDate || getLocalTodayString('Asia/Shanghai')
  const dailyRate = input.dailyRate ?? 0.0005
  const effectiveAmount = round2(effectiveBillAmount(input.bill))
  const totalPaid = round2(
    input.payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0),
  )
  const remaining = round2(Math.max(0, effectiveAmount - totalPaid))
  const rawMin = billEffectiveMinPayment(input.bill)
  const minPayment = rawMin != null && rawMin > 0 ? round2(rawMin) : null
  const dueDate = billEffectiveDueDate(input.bill)
  const isOverdue = remaining > 0.01 && !isBillUnissued(input.bill) && dueDate < today

  if (input.cardType === 'loan') {
    return {
      applicable: false,
      tier: 'B_statement_fallback',
      effective_amount: effectiveAmount,
      total_paid: totalPaid,
      remaining_amount: remaining,
      min_payment: minPayment,
      min_payment_status: 'unset',
      uncovered_min: 0,
      is_fully_paid: remaining <= 0.01,
      is_overdue: isOverdue,
      estimated_interest: 0,
      daily_rate: dailyRate,
      estimate_date: today,
      used_fallback_date: false,
      interest_bearing_principal: 0,
    }
  }

  let minStatus: 'unset' | 'covered' | 'uncovered' = 'unset'
  let uncoveredMin = 0
  if (minPayment != null) {
    if (totalPaid >= minPayment - 0.01) {
      minStatus = 'covered'
    } else {
      minStatus = 'uncovered'
      uncoveredMin = round2(Math.max(0, minPayment - totalPaid))
    }
  }

  const isFullyPaid = totalPaid >= effectiveAmount - 0.01
  if (isFullyPaid) {
    return {
      applicable: true,
      tier: input.items.some(
        (it) =>
          (it.item_type === 'purchase' || it.item_type === 'fee' || it.item_type === 'interest') &&
          it.amount > 0,
      )
        ? 'A_items'
        : 'B_statement_fallback',
      effective_amount: effectiveAmount,
      total_paid: totalPaid,
      remaining_amount: 0,
      min_payment: minPayment,
      min_payment_status: minStatus,
      uncovered_min: uncoveredMin,
      is_fully_paid: true,
      is_overdue: false,
      estimated_interest: 0,
      daily_rate: dailyRate,
      estimate_date: today,
      used_fallback_date: false,
      interest_bearing_principal: 0,
    }
  }

  const fallbackStmtDate =
    billEffectiveStatementDate(input.bill) ||
    input.bill.statement_end ||
    input.bill.statement_start ||
    `${input.bill.bill_month}-01`

  const bearingItems = input.items.filter(
    (it) =>
      (it.item_type === 'purchase' || it.item_type === 'fee' || it.item_type === 'interest') &&
      it.amount > 0,
  )

  let usedFallbackDate = false
  let tier: 'A_items' | 'B_statement_fallback' = 'B_statement_fallback'

  interface PrincipalSlice {
    startDate: string
    amount: number
  }
  let slices: PrincipalSlice[]

  if (bearingItems.length > 0) {
    tier = 'A_items'
    slices = bearingItems
      .map((it) => {
        if (!it.transaction_date) usedFallbackDate = true
        const startDate = (
          it.transaction_date ||
          it.post_date ||
          billEffectiveStatementDate(input.bill) ||
          input.bill.statement_end ||
          dueDate
        ).slice(0, 10)
        return { startDate, amount: round2(it.amount) }
      })
      .sort((a, b) => a.startDate.localeCompare(b.startDate))

    // Apply refunds & negative adjustments to most recent slices first
    const totalRefund = input.items.reduce((sum, it) => {
      if (it.item_type === 'refund') return sum + Math.abs(it.amount)
      if (it.item_type === 'adjustment' && it.amount < 0) return sum + Math.abs(it.amount)
      return sum
    }, 0)

    let remRefund = totalRefund
    for (let i = slices.length - 1; i >= 0 && remRefund > 0; i--) {
      const deduct = Math.min(slices[i].amount, remRefund)
      slices[i].amount = round2(slices[i].amount - deduct)
      remRefund = round2(remRefund - deduct)
    }
    slices = slices.filter((s) => s.amount > 0.005)
  } else {
    usedFallbackDate = !billEffectiveStatementDate(input.bill) && !input.bill.statement_end
    slices = [{ startDate: fallbackStmtDate.slice(0, 10), amount: effectiveAmount }]
  }

  const sortedPayments = [...input.payments]
    .filter((p) => Number(p.amount) > 0)
    .sort((a, b) => (a.paid_at || '').localeCompare(b.paid_at || ''))

  let estimatedInterest = 0
  let sliceIdx = 0

  for (const pay of sortedPayments) {
    let remPay = Number(pay.amount) || 0
    const paidAt = (pay.paid_at || today).slice(0, 10)
    while (remPay > 0.005 && sliceIdx < slices.length) {
      const slice = slices[sliceIdx]
      const cover = Math.min(slice.amount, remPay)
      const days = calendarDaysBetween(slice.startDate, paidAt)
      estimatedInterest += cover * dailyRate * days
      slice.amount = round2(slice.amount - cover)
      remPay = round2(remPay - cover)
      if (slice.amount <= 0.005) sliceIdx++
    }
  }

  let unpaidPrincipal = 0
  for (let i = sliceIdx; i < slices.length; i++) {
    const slice = slices[i]
    if (slice.amount <= 0.005) continue
    const days = calendarDaysBetween(slice.startDate, today)
    estimatedInterest += slice.amount * dailyRate * days
    unpaidPrincipal = round2(unpaidPrincipal + slice.amount)
  }

  return {
    applicable: true,
    tier,
    effective_amount: effectiveAmount,
    total_paid: totalPaid,
    remaining_amount: remaining,
    min_payment: minPayment,
    min_payment_status: minStatus,
    uncovered_min: uncoveredMin,
    is_fully_paid: false,
    is_overdue: isOverdue,
    estimated_interest: round2(estimatedInterest),
    daily_rate: dailyRate,
    estimate_date: today,
    used_fallback_date: usedFallbackDate,
    interest_bearing_principal: unpaidPrincipal,
  }
}

export function simulateRepaymentScenarios(
  input: {
    bill: {
      bill_month: string
      bill_amount: number
      bill_amount_override?: number | null
      min_payment?: number | null
      min_payment_override?: number | null
      statement_date?: string | null
      statement_date_override?: string | null
      statement_start?: string | null
      statement_end?: string | null
      due_date: string
      due_date_override?: string | null
    }
    cardType?: 'credit' | 'loan'
    items: ReadonlyArray<BillItem>
    payments: ReadonlyArray<Pick<PaymentWithFx, 'amount' | 'paid_at'>>
    dailyRate?: number
    customPayAmount?: number
  },
  nextStatementDate: string,
) {
  const baseParams = {
    bill: input.bill,
    cardType: input.cardType,
    items: input.items,
    payments: input.payments,
    dailyRate: input.dailyRate,
    estimateDate: nextStatementDate,
  }
  const effective = effectiveBillAmount(input.bill)
  const paid = input.payments.reduce((s, p) => s + (Number(p.amount) || 0), 0)
  const remaining = Math.max(0, round2(effective - paid))
  const minPay = billEffectiveMinPayment(input.bill)
  const today = getLocalTodayString('Asia/Shanghai')

  const current = estimateBillRepaymentHealth(baseParams)

  const extraForMin = minPay != null && minPay > paid ? round2(minPay - paid) : 0
  const minScenario = estimateBillRepaymentHealth({
    ...baseParams,
    payments:
      extraForMin > 0
        ? [...input.payments, { amount: extraForMin, paid_at: today }]
        : input.payments,
  })

  const fullScenario = estimateBillRepaymentHealth({
    ...baseParams,
    payments:
      remaining > 0 ? [...input.payments, { amount: remaining, paid_at: today }] : input.payments,
  })

  const customExtra = Math.max(0, round2(input.customPayAmount ?? 0))
  const customScenario = estimateBillRepaymentHealth({
    ...baseParams,
    payments:
      customExtra > 0 ? [...input.payments, { amount: customExtra, paid_at: today }] : input.payments,
  })

  return {
    nextStatementDate,
    current,
    min_payment: minScenario,
    full_payment: fullScenario,
    custom: customScenario,
  }
}

// ---------------------------------------------------------------------------
// 4. Payment FX lock helpers
// ---------------------------------------------------------------------------

export function computeLockedRate(amount: number, settledAmount: number): number {
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(settledAmount) || settledAmount <= 0) {
    return 0
  }
  return round6(settledAmount / amount)
}

export function computeSettledAmount(amount: number, lockedRate: number): number {
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(lockedRate) || lockedRate <= 0) {
    return 0
  }
  return round2(amount * lockedRate)
}

export function validateFxLockInput(input: {
  amount: number
  billCurrency: string
  settledCurrency?: string | null
  settledAmount?: number | null
  lockedFxRate?: number | null
}): {
  ok: true
  normalized: { settled_currency: string | null; settled_amount: number | null; locked_fx_rate: number | null }
} | { ok: false; error: string } {
  const billCur = normalizeCurrencyOrDefault(input.billCurrency, 'CNY')
  const settledCur = normalizeCurrency(input.settledCurrency)
  const hasAny =
    Boolean(input.settledCurrency?.trim()) ||
    input.settledAmount != null ||
    input.lockedFxRate != null

  if (!hasAny || (settledCur && settledCur === billCur && input.settledAmount == null && input.lockedFxRate == null)) {
    return {
      ok: true,
      normalized: { settled_currency: null, settled_amount: null, locked_fx_rate: null },
    }
  }

  if (settledCur === billCur) {
    return {
      ok: true,
      normalized: { settled_currency: null, settled_amount: null, locked_fx_rate: null },
    }
  }

  if (!settledCur) {
    return { ok: false, error: '请选择有效的实际结算币种（3位字母代码）' }
  }
  if (!Number.isFinite(input.settledAmount) || (input.settledAmount ?? 0) <= 0) {
    return { ok: false, error: '实付结算金额必须大于 0' }
  }
  if (!Number.isFinite(input.lockedFxRate) || (input.lockedFxRate ?? 0) <= 0) {
    return { ok: false, error: '锁定汇率必须大于 0' }
  }

  const expected = input.amount * (input.lockedFxRate as number)
  if (Math.abs(expected - (input.settledAmount as number)) > 0.05) {
    return {
      ok: false,
      error: `实付金额与「原币 × 锁定汇率」（${expected.toFixed(2)}）偏差超过 0.05，请同步修正`,
    }
  }

  return {
    ok: true,
    normalized: {
      settled_currency: settledCur,
      settled_amount: round2(input.settledAmount as number),
      locked_fx_rate: round6(input.lockedFxRate as number),
    },
  }
}

// ---------------------------------------------------------------------------
// 5. CSV formula-injection-safe serialization & report serialization
// ---------------------------------------------------------------------------

export function sanitizeCsvCell(field: string | number | null | undefined): string {
  if (field === null || field === undefined) return ''
  let str = String(field)
  if (/^[\t\r\n ]*[=+\-@]|^[\t\r]/.test(str)) {
    str = `'${str}`
  }
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

export function buildSafeCsv(
  headers: string[],
  rows: Array<Record<string, string | number | null | undefined>>,
): string {
  const BOM = '\uFEFF'
  const headerRow = headers.map(sanitizeCsvCell).join(',')
  const dataRows = rows.map((row) => headers.map((h) => sanitizeCsvCell(row[h])).join(','))
  return [BOM, headerRow, ...dataRows].join('\n')
}

export function sanitizeFilenameSegment(raw: string): string {
  return raw.replace(/[/\\:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '') || 'all'
}

export function statementReportToCsv(report: FamilyStatementReport): string {
  const BOM = '\uFEFF'
  const lines: string[] = []
  const pushRow = (cells: Array<string | number | null | undefined>) => {
    lines.push(cells.map(sanitizeCsvCell).join(','))
  }

  pushRow(['# WorldCredit 对账单', report.scope_label, `${report.period_start} 至 ${report.period_end}`, `折算目标币种: ${report.display_currency}`])
  pushRow([])

  pushRow(['## 分币种总览'])
  pushRow(['原币种', '账单总额', '已还总额', '已锁结算成本', '剩余待还', '分期未出本金', '固定支出应还', '逾期笔数'])
  for (const row of report.currency_summary) {
    pushRow([
      row.currency,
      row.billed.toFixed(2),
      row.paid.toFixed(2),
      row.locked_settled_amount != null
        ? `${row.locked_settled_currency ?? report.display_currency} ${row.locked_settled_amount.toFixed(2)}`
        : '—',
      row.remaining.toFixed(2),
      row.installment_unbilled.toFixed(2),
      row.payable_due.toFixed(2),
      row.overdue_count,
    ])
  }
  pushRow([])

  pushRow(['## 折算参考合计', report.fx_converted ? '汇率完整' : `未含缺汇率币种: ${report.fx_unconverted_currencies.join('、')}`])
  pushRow(['指标', `金额 (${report.display_currency})`])
  pushRow(['账单总额', report.converted_totals.billed.toFixed(2)])
  pushRow(['已还金额', report.converted_totals.paid.toFixed(2)])
  pushRow(['剩余待还', report.converted_totals.remaining.toFixed(2)])
  pushRow(['分期未出本金', report.converted_totals.installment_unbilled.toFixed(2)])
  pushRow(['固定支出应还', report.converted_totals.payable_due.toFixed(2)])
  pushRow(['逾期账单笔数', report.converted_totals.overdue_count])
  pushRow([])

  if (report.card_rows.length > 0) {
    pushRow(['## 持卡人 × 卡片对账清单'])
    pushRow(['持卡人', '银行', '卡片', '尾号', '原币种', '账单金额', '已还金额', '剩余待还', '状态', '汇率备注'])
    for (const c of report.card_rows) {
      pushRow([
        c.holder_name,
        c.bank_name,
        c.card_name,
        c.card_tail ?? '',
        c.currency,
        c.billed.toFixed(2),
        c.paid.toFixed(2),
        c.remaining.toFixed(2),
        c.status,
        c.fx_note ?? '',
      ])
    }
    pushRow([])
  }

  if (report.category_breakdown.length > 0) {
    pushRow(['## 消费分类汇总'])
    pushRow(['分类', '折算金额', '占比(%)', '笔数'])
    for (const cat of report.category_breakdown) {
      pushRow([
        cat.category_label || categoryLabel(cat.category),
        cat.amount.toFixed(2),
        cat.percentage.toFixed(1),
        cat.item_count ?? '',
      ])
    }
    pushRow([])
  }

  if (report.monthly_breakdown && report.monthly_breakdown.length > 0) {
    pushRow(['## 月度明细'])
    pushRow(['月份', `折算账单(${report.display_currency})`, `折算已还(${report.display_currency})`, `折算待还(${report.display_currency})`, '原币明细'])
    for (const m of report.monthly_breakdown) {
      const orig = Object.entries(m.by_currency)
        .map(([cur, v]) => `${cur} 账单 ${v.billed.toFixed(2)} / 已还 ${v.paid.toFixed(2)} / 待还 ${v.remaining.toFixed(2)}`)
        .join('；')
      pushRow([m.month, m.converted_billed.toFixed(2), m.converted_paid.toFixed(2), m.converted_remaining.toFixed(2), orig])
    }
  }

  return `${BOM}${lines.join('\n')}`
}

// ---------------------------------------------------------------------------
// 6. Dashboard three-part total debt breakdown helper
// ---------------------------------------------------------------------------

export interface DebtBreakdownSummary {
  plainOwed: number
  installmentOwed: number
  loanOwed: number
  totalDebt: number
  unconvertedCurrencies: string[]
}

export function computeThreePartDebtBreakdown(input: {
  bills: ReadonlyArray<{
    card_id: string
    account_id?: string | null
    bill_month: string
    computed_status?: string
    status?: string
    remaining_amount?: number
    card?: {
      card_type?: 'credit' | 'loan'
      card_product?: { currency?: string }
    }
  }>
  payables: ReadonlyArray<{
    category?: string
    status?: string
    amount: number
    paid_amount?: number
    currency?: string
  }>
  installmentPlans: ReadonlyArray<InstallmentPlan>
  targetCurrency: string
  rates: FxRates | null
}): DebtBreakdownSummary {
  const unpaidBills = input.bills.filter((b) => (b.computed_status ?? b.status) !== 'paid')
  const plainBills = unpaidBills.filter((b) => b.card?.card_type !== 'loan')
  const loanBills = unpaidBills.filter((b) => b.card?.card_type === 'loan')

  const pickBill = (b: (typeof unpaidBills)[number]) => ({
    amount: Number(b.remaining_amount ?? 0),
    currency: b.card?.card_product?.currency || input.targetCurrency,
  })

  const plainSum = sumByCurrency(plainBills, pickBill, input.targetCurrency, input.rates)

  const existingBillScopes = new Set<string>()
  const cardAccountMap = new Map<string, string | null>()
  for (const b of input.bills) {
    existingBillScopes.add(`card:${b.card_id}:${b.bill_month}`)
    if (b.account_id) {
      existingBillScopes.add(`acc:${b.account_id}:${b.bill_month}`)
      cardAccountMap.set(b.card_id, b.account_id)
    }
  }

  const { unbilledEntries } = computeActiveInstallmentsExposure(
    input.installmentPlans,
    existingBillScopes,
    cardAccountMap,
  )
  const instSum = sumByCurrency(
    unbilledEntries,
    (entry) => ({ amount: entry.amount, currency: entry.currency }),
    input.targetCurrency,
    input.rates,
  )

  const loanPayables = input.payables
    .filter((p) => p.category === 'loan' && p.status !== 'paid')
    .map((p) => ({
      amount: Math.max(0, Number(p.amount) - Number(p.paid_amount ?? 0)),
      currency: p.currency || input.targetCurrency,
    }))
    .filter((p) => p.amount > 0.01)

  const loanEntries = [...loanBills.map(pickBill), ...loanPayables]
  const loanSum = sumByCurrency(loanEntries, (e) => e, input.targetCurrency, input.rates)

  const totalEntries = [
    ...plainBills.map(pickBill),
    ...unbilledEntries.map((e) => ({ amount: e.amount, currency: e.currency })),
    ...loanEntries,
  ]
  const totalSum = sumByCurrency(totalEntries, (e) => e, input.targetCurrency, input.rates)

  return {
    plainOwed: round2(plainSum.total),
    installmentOwed: round2(instSum.total),
    loanOwed: round2(loanSum.total),
    totalDebt: round2(totalSum.total),
    unconvertedCurrencies: totalSum.unconverted_currencies,
  }
}

export function formatReferenceFxRate(
  fromCurrency: string,
  toCurrency: string,
  rates: FxRates | null,
): number | null {
  const val = convert(1, fromCurrency, toCurrency, rates)
  return val != null && Number.isFinite(val) && val > 0 ? round6(val) : null
}
