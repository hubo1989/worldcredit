import { normalizeCurrency, normalizeCurrencyOrDefault } from '../fx'
import { isValidCalendarDate } from '../utils'
import { classifyBillItem, mapExplicitCategory, signedItemAmount, type BillItemType, type MerchantRules, type SpendCategory } from './categories'
import { roundMoney } from './money'

export const BILL_ITEM_SOURCES = ['manual', 'csv', 'text', 'llm', 'email', 'sms', 'image', 'pdf'] as const
export type BillItemSource = (typeof BILL_ITEM_SOURCES)[number]
export const BILL_ITEM_TYPES = ['purchase', 'refund', 'fee', 'interest', 'installment', 'adjustment'] as const satisfies readonly BillItemType[]
export const MAX_IMPORT_ITEMS = 500

export interface BillItemInput {
  card_id?: string | null
  card_tail?: string | null
  transaction_date?: string | null
  post_date?: string | null
  description: string
  merchant_name?: string | null
  category?: string | null
  amount: number
  currency?: string | null
  item_type?: BillItemType | null
  source?: BillItemSource
  confidence?: number | null
  raw_text?: string | null
  metadata?: Record<string, unknown> | string | null
}

export interface NormalizedBillItem extends BillItemInput {
  category: SpendCategory | null
  currency: string
  item_type: BillItemType
  source: BillItemSource
}

const REFUND = /退款|退貨|退货|退税|冲正|refund|rebate|credit adjust|reversal/i

export function normalizeBillItemInput(
  raw: BillItemInput,
  userRulesMap?: MerchantRules,
  defaultCurrency = 'CNY',
): NormalizedBillItem {
  const description = raw.description.trim()
  const item_type = raw.item_type ?? (raw.amount < 0 || REFUND.test(description) ? 'refund' : 'purchase')
  return {
    ...raw,
    description,
    merchant_name: raw.merchant_name?.trim() || null,
    item_type,
    amount: roundMoney(item_type === 'adjustment' ? raw.amount : Math.abs(raw.amount)),
    currency: normalizeCurrencyOrDefault(raw.currency, defaultCurrency),
    source: raw.source ?? 'manual',
    category: classifyBillItem({ ...raw, description, item_type }, userRulesMap),
  }
}

export function computeBillItemsDiscrepancy(
  effectiveAmount: number,
  items: readonly (FingerprintItemAmount & { currency?: string | null })[],
  billCurrency?: string,
) {
  const currencies = new Set(items.map(item => normalizeCurrency(item.currency)).filter(Boolean))
  const reference = normalizeCurrency(billCurrency)
  const comparable = reference
    ? items.filter(item => !item.currency || normalizeCurrency(item.currency) === reference)
    : currencies.size <= 1 ? items : []
  const itemsNetTotal = roundMoney(comparable.reduce((sum, item) => sum + signedItemAmount(item), 0))
  const diff = comparable.length ? roundMoney(itemsNetTotal - effectiveAmount) : 0
  return { hasDiscrepancy: Math.abs(diff) > 0.01, itemsNetTotal, diff }
}

interface FingerprintItemAmount {
  item_type: BillItemType
  amount: number
}

interface FingerprintItem extends FingerprintItemAmount {
  transaction_date?: string | null
  description: string
}

export function buildItemFingerprint(item: FingerprintItem): string {
  const date = item.transaction_date?.trim().slice(0, 10) ?? ''
  const description = item.description.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ')
  return [date, description, signedItemAmount(item).toFixed(2)].join('|')
}

interface ImportOptions {
  billMonth?: string
  defaultCurrency: string
  userRulesMap?: MerchantRules
  existingItems?: readonly FingerprintItem[]
}

export interface ParsedImportPreviewRow {
  tempId: string
  item: NormalizedBillItem
  isDuplicate: boolean
  checked: boolean
  is_duplicate: boolean
  default_checked: boolean
  rawLine?: string
}

function previewRows(inputs: readonly (BillItemInput | null)[], options: ImportOptions): ParsedImportPreviewRow[] {
  const seen = new Set(options.existingItems?.map(buildItemFingerprint))
  return inputs.flatMap((input, index) => {
    if (!input) return []
    const item = normalizeBillItemInput(input, options.userRulesMap, options.defaultCurrency)
    const fingerprint = buildItemFingerprint(item)
    const duplicate = seen.has(fingerprint)
    seen.add(fingerprint)
    return [{
      tempId: item.source + '-' + index,
      item,
      isDuplicate: duplicate,
      checked: !duplicate,
      is_duplicate: duplicate,
      default_checked: !duplicate,
      rawLine: item.raw_text ?? undefined,
    }]
  })
}

const DATE_TOKEN = /^(?:(\d{4})[-/])?(\d{1,2})[-/](\d{1,2})$/

function parseTransactionDate(raw: string | undefined, billMonth?: string): string | null {
  const match = DATE_TOKEN.exec(raw?.trim() ?? '')
  if (!match) return null
  const [, year, month, day] = match
  const billYear = Number(billMonth?.slice(0, 4))
  if (!year && !billYear) return null
  const yearNumber = year ? Number(year) : billYear - (billMonth?.endsWith('-01') && Number(month) === 12 ? 1 : 0)
  const date = [String(yearNumber).padStart(4, '0'), month.padStart(2, '0'), day.padStart(2, '0')].join('-')
  return isValidCalendarDate(date) ? date : null
}

function parseAmount(raw: string | undefined): number | null {
  let value = raw?.normalize('NFKC').trim().replace(/[\s¥￥$€£]/g, '').replace(/[−–]/g, '-') ?? ''
  if (/^\(.*\)$/.test(value)) value = '-' + value.slice(1, -1)
  value = value.replace(/^([+-]?)(?:HK|US|RMB)(?=\d)/i, '$1')
  if (!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(value)) return null
  const amount = Number(value.replace(/,/g, ''))
  return Number.isFinite(amount) ? amount : null
}

export function parsePastedBillItems(text: string, options: ImportOptions): ParsedImportPreviewRow[] {
  const inputs = text.split(/\r?\n/).map((raw): BillItemInput | null => {
    const line = raw.trim()
    if (!line) return null
    const delimiter = line.includes('\t') ? /\t/ : /\s{2,}/
    let parts = line.split(delimiter).map(part => part.trim()).filter(Boolean)
    if (parts.length < 2) {
      let csv: string[] | undefined
      if (line.includes(',')) {
        try {
          csv = parseCsvMatrix(line)[0]
        } catch {
          return null
        }
      }
      if (csv) {
        // Quoted amounts are already one field. Rejoin an unquoted trailing thousands group.
        const amountEnd = mapExplicitCategory(csv.at(-1)) ? csv.length - 1 : csv.length
        let amountStart = amountEnd - 1
        while (amountStart > 1 && /^\d{3}(?:\.\d+)?$/.test(csv[amountStart])) {
          if (!/^[+−–-]?\d{1,3}$/.test(csv[amountStart - 1])) break
          amountStart--
        }
        if (amountStart < amountEnd - 1) {
          csv.splice(amountStart, amountEnd - amountStart, csv.slice(amountStart, amountEnd).join(','))
        }
      }
      parts = csv?.length && csv.some(part => parseAmount(part) !== null) && parseAmount(csv[0]) === null
        ? csv
        : line.split(/\s+/)
      // A space-delimited amount may itself contain a thousands separator.
      if (csv && /^\S+\s+\S/.test(csv[0]) && !DATE_TOKEN.test(csv[0])) parts = line.split(/\s+/)
    }
    const first = parts[0]
    const hasDate = DATE_TOKEN.test(first)
    const transaction_date = hasDate ? parseTransactionDate(parts.shift(), options.billMonth) : null
    if (hasDate && (first.length >= 8 || options.billMonth) && !transaction_date) return null
    const last = parts.at(-1)
    const category = parts.length > 2 && mapExplicitCategory(last) ? parts.pop() : null
    const amounts = parts.map(parseAmount)
    const amountIndex = amounts.findLastIndex(amount => amount !== null)
    const amount = amounts[amountIndex]
    if (amount === null || amount === undefined) return null
    const description = parts.filter((_, index) => index !== amountIndex).join(' ').trim()
    if (!description) return null
    return { transaction_date, description, amount, category, source: 'text', raw_text: line }
  })
  return previewRows(inputs, options)
}

/** RFC 4180 fields, including quoted newlines, escaped quotes, and an optional BOM. */
export function parseCsvMatrix(csvText: string): string[][] {
  const text = csvText.replace(/^\uFEFF/, '')
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const endRow = () => {
    row.push(field.trim())
    if (row.some(Boolean)) rows.push(row)
    row = []
    field = ''
  }

  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    if (quoted) {
      if (char !== '"') field += char
      else if (text[index + 1] !== '"') quoted = false
      else {
        field += '"'
        index++
      }
    } else if (char === '"' && !field.trim()) {
      quoted = true
    } else if (char === ',') {
      row.push(field.trim())
      field = ''
    } else if (char === '\r' || char === '\n') {
      endRow()
      if (char === '\r' && text[index + 1] === '\n') index++
    } else {
      field += char
    }
  }
  if (quoted) throw new Error('CSV 含未闭合的引号')
  endRow()
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

export function inferCsvColumnMapping(headers: readonly string[]): CsvColumnMapping {
  const find = (pattern: RegExp) => {
    const index = headers.findIndex(header => pattern.test(header.normalize('NFKC').trim()))
    return index === -1 ? null : index
  }
  return {
    dateCol: find(/交易[日时時]|记账日|入賬日|日期|\bdate\b/i),
    descCol: find(/摘要|商[户戶]|描述|说明|merchant|description|details|memo/i),
    amountCol: find(/^[^借贷貸]*(?:金额|金額|交易额)|\bamount\b/i),
    debitCreditCol: find(/借贷|借貸|收支|方向|direction|debit\s*[/|-]\s*credit|^type$/i),
    currencyCol: find(/币种|幣種|货币|貨幣|currency/i),
    categoryCol: find(/分类|分類|类别|類別|category/i),
  }
}

export function parseCsvBillItems(csvText: string, mapping: CsvColumnMapping | undefined, options: ImportOptions & { hasHeader?: boolean }): ParsedImportPreviewRow[]
export function parseCsvBillItems(csvText: string, options: ImportOptions & { hasHeader?: boolean }): ParsedImportPreviewRow[]
export function parseCsvBillItems(matrix: readonly string[][], mapping: CsvColumnMapping, options: ImportOptions & { hasHeader?: boolean }): ParsedImportPreviewRow[]
export function parseCsvBillItems(
  csv: string | readonly string[][],
  mappingOrOptions: CsvColumnMapping | (ImportOptions & { hasHeader?: boolean }) | undefined,
  importOptions?: ImportOptions & { hasHeader?: boolean },
): ParsedImportPreviewRow[] {
  const options = importOptions ?? mappingOrOptions as ImportOptions & { hasHeader?: boolean }
  const hasHeader = options.hasHeader !== false
  const rows = typeof csv === 'string' ? parseCsvMatrix(csv) : csv
  const mapping = (importOptions ? mappingOrOptions as CsvColumnMapping | undefined : undefined) ??
    (hasHeader ? inferCsvColumnMapping(rows[0] ?? []) : {
      dateCol: 0, descCol: 1, amountCol: 2, debitCreditCol: null, currencyCol: null, categoryCol: null,
    })
  const inputs = rows.slice(hasHeader ? 1 : 0).map((row): BillItemInput | null => {
    const get = (column: number | null) => column === null ? undefined : row[column]?.trim()
    const description = get(mapping.descCol)
    const amount = parseAmount(get(mapping.amountCol))
    if (!description || amount === null) return null
    const direction = get(mapping.debitCreditCol) ?? ''
    const item_type = /贷|貸|退|返|refund|^credit$|^cr$/i.test(direction) ? 'refund'
      : /借|支出|^debit$|^dr$/i.test(direction) ? 'purchase' : undefined
    return {
      description,
      amount,
      item_type,
      transaction_date: parseTransactionDate(get(mapping.dateCol), options.billMonth),
      currency: get(mapping.currencyCol),
      category: get(mapping.categoryCol),
      source: 'csv',
    }
  })
  return previewRows(inputs, options)
}
