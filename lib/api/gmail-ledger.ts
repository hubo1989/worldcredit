// lib/api/gmail-ledger.ts
import { db } from '../insforge'

export interface GmailLedgerEntry {
  id: string
  ledger_id: string
  bank: string
  account_tail: string | null
  kind: string
  region: string
  currency: string
  statement_amount: number
  statement_amount_raw: string | null
  minimum_payment: number
  minimum_payment_raw: string | null
  due_date: string | null
  statement_date: string | null
  subject: string | null
  source: string | null
  message_id: string | null
  thread_id: string | null
  evidence: string | null
  attachment_path: string | null
  // LLM-enriched fields
  cardholder_name: string | null
  is_overpayment: boolean
  amount_direction: string
  loan_monthly_payment: number | null
  loan_details: Record<string, unknown> | null
  llm_confidence: string | null
  // Payment tracking
  paid_amount: number
  remaining_amount: number
  completed: boolean
  payment_status: '未还款' | '部分还款' | '已还清'
  payment_note: string | null
  payment_date: string | null
  last_payment_update: string | null
  matched_card_id: string | null
  matched_bill_id: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  // Joined fields (not in DB)
  holder_name?: string
  currency_symbol?: string
}

export interface GmailLedgerSummary {
  total: number
  unpaid: number
  partial: number
  paid: number
  totalAmount: number
  unpaidAmount: number
}

// ─── Currency ──────────────────────────────────────────────

const CURRENCY_SYMBOLS: Record<string, string> = {
  CNY: '¥',
  USD: '$',
  HKD: 'HK$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
}

export function currencySymbol(code: string): string {
  return CURRENCY_SYMBOLS[code] || code + ' '
}

// ─── Holder name extraction from evidence ──────────────────

/**
 * 从单条邮件证据中提取持卡人姓名。
 * 仅当该条邮件原文包含明确的称呼时才返回，不做全局兜底。
 *
 * 支持的模式（按优先级）：
 * 1. 中文：尊敬的XXX先生/女士/小姐 → XXX（招商、民生等）
 * 2. 中文：亲爱的XXX → XXX（汇丰 HSBC）
 * 3. 英文 Apple 风格：Customer: XXX <email> 或 Customer: XXX → XXX（Apple Card/Savings）
 * 4. 英文 AmEx 风格：NAME Account Ending → NAME（American Express）
 * 5. 英文通用：Dear XXX, → XXX
 */
function extractHolderFromEvidence(evidence: string | null): string | undefined {
  if (!evidence) return undefined

  // 1. 尊敬的XX先生/女士/小姐
  const m1 = evidence.match(/尊敬的\s*(\S{1,6})\s*(?:先生|女士|小姐)/)
  if (m1) return m1[1]

  // 2. 亲爱的XX（汇丰等港资银行）
  const m2 = evidence.match(/亲爱的\s*(\S{1,6})/)
  if (m2) return m2[1]

  // 3. Apple Card: "Customer: bo hu hubo1989@gmail.com" or "Customer: bo hu"
  const m3 = evidence.match(/Customer:\s*([a-zA-Z]+\s+[a-zA-Z]+)(?:\s|$|<)/i)
  if (m3) return m3[1].trim()

  // 4. AmEx: "BO HU Account Ending: 01004"
  const m4 = evidence.match(/([A-Z]{2,}(?:\s+[A-Z]{1,})?)\s+Account\s+Ending/i)
  if (m4) return m4[1].trim()

  // 5. Generic Dear XX,
  const m5 = evidence.match(/Dear\s+([A-Za-z\s]{2,20}),/i)
  if (m5) {
    const name = m5[1].trim()
    // Skip generic "Valued Customer"
    if (!name.toLowerCase().includes('valued') && !name.toLowerCase().includes('customer')) {
      return name
    }
  }

  return undefined
}

// ─── Card → Holder matching ───────────────────────────────

async function buildCardHolderMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  try {
    const { data: cards } = await db.from('credit_cards').select('id,holder_id,card_number_last4')
    if (!cards) return map

    const productIds = [...new Set(cards.map((c: any) => c.card_product_id).filter(Boolean))]
    let products: { id: string; bank_name: string }[] = []
    if (productIds.length > 0) {
      const { data: pd } = await db.from('card_products').select('id,bank_name').in('id', productIds)
      products = (pd || []) as typeof products
    }
    const productMap = new Map(products.map(p => [p.id, p.bank_name]))

    const holderIds = [...new Set(cards.map((c: any) => c.holder_id).filter(Boolean))]
    let holders: { id: string; name: string }[] = []
    if (holderIds.length > 0) {
      const { data: hd } = await db.from('card_holders').select('id,name').in('id', holderIds)
      holders = (hd || []) as typeof holders
    }
    const holderMap = new Map(holders.map(h => [h.id, h.name]))

    for (const card of cards as any[]) {
      if (!card.card_number_last4) continue
      const bname = productMap.get(card.card_product_id) || ''
      const hname = holderMap.get(card.holder_id) || ''
      map.set(`${bname}:${card.card_number_last4}`, hname)
      map.set(`:${card.card_number_last4}`, hname)
    }
  } catch (_) { /* silent */ }
  return map
}

/**
 * 查找持卡人姓名：
 * 1. LLM 提取的 cardholder_name（最可靠）
 * 2. credit_cards DB 匹配（bank:last4 或 :last4）
 * 3. 本条 evidence 正则提取（兜底）
 * 不做全局兜底——没有就是没有
 */
function findHolderName(entry: GmailLedgerEntry, cardHolderMap: Map<string, string>): string | undefined {
  // 0. LLM-extracted name (highest priority)
  if (entry.cardholder_name) return entry.cardholder_name
  // 1. Card DB match
  if (entry.account_tail) {
    const bankShort = entry.bank.split('/')[0]
    const exact = cardHolderMap.get(`${bankShort}:${entry.account_tail}`)
    if (exact) return exact
    const byTail = cardHolderMap.get(`:${entry.account_tail}`)
    if (byTail) return byTail
  }
  // 2. Per-entry evidence extraction (fallback)
  return extractHolderFromEvidence(entry.evidence)
}

// ─── Dedup ────────────────────────────────────────────────

/**
 * 三级去重：
 * Pass 1: 精确去重 — bank + tail + due_date + amount 完全相同
 * Pass 2: 同卡同期合并 — bank + tail + statement_date 相同，保留金额最大的
 * Pass 3: 跨银行去重 — statement_date + amount + subject 相同（如 国外信用卡 vs Chase）
 */
function dedupEntries(entries: GmailLedgerEntry[]): GmailLedgerEntry[] {
  // Pass 1: exact dedup
  const seenExact = new Set<string>()
  let pass1 = entries.filter(e => {
    const k = JSON.stringify([e.bank, e.account_tail || '', e.due_date || '', e.statement_amount])
    if (seenExact.has(k)) return false
    seenExact.add(k)
    return true
  })

  // Pass 2: same card + same period → keep max amount
  const periodGroups = new Map<string, GmailLedgerEntry[]>()
  for (const e of pass1) {
    const pk = JSON.stringify([e.bank, e.account_tail || '', e.statement_date || ''])
    if (!periodGroups.has(pk)) periodGroups.set(pk, [])
    periodGroups.get(pk)!.push(e)
  }

  let pass2: GmailLedgerEntry[] = []
  for (const [, group] of periodGroups) {
    if (group.length === 1) {
      pass2.push(group[0])
    } else {
      group.sort((a, b) => Number(b.statement_amount) - Number(a.statement_amount))
      pass2.push(group[0])
    }
  }

  // Pass 3: cross-bank dedup (same date + amount + subject → different source naming)
  // Prefer the entry with a more specific bank name (not "国外信用卡")
  const crossBankGroups = new Map<string, GmailLedgerEntry[]>()
  for (const e of pass2) {
    // Group by statement_date + amount + normalized subject
    const subj = (e.subject || '').toLowerCase().trim()
    const ck = JSON.stringify([e.statement_date || '', e.statement_amount, subj])
    if (!crossBankGroups.has(ck)) crossBankGroups.set(ck, [])
    crossBankGroups.get(ck)!.push(e)
  }

  const result: GmailLedgerEntry[] = []
  for (const [, group] of crossBankGroups) {
    if (group.length === 1) {
      result.push(group[0])
    } else {
      // Prefer entries with specific bank names over generic ones like "国外信用卡"
      group.sort((a, b) => {
        const aGeneric = a.bank.includes('国外') || a.bank.includes('未知') ? 1 : 0
        const bGeneric = b.bank.includes('国外') || b.bank.includes('未知') ? 1 : 0
        return aGeneric - bGeneric // non-generic first
      })
      result.push(group[0])
    }
  }

  return result
}

// ─── Public API ───────────────────────────────────────────

/** 获取所有 Gmail 账单记录（自动过滤金额=0、去重、加持卡人、货币符号） */
export async function getGmailLedgerEntries(options?: {
  status?: GmailLedgerEntry['payment_status']
  bank?: string
  limit?: number
  offset?: number
}): Promise<GmailLedgerEntry[]> {
  let query = db.from('gmail_ledger_entries').select('*')

  if (options?.status) query = query.eq('payment_status', options.status)
  if (options?.bank) query = query.ilike('bank', `%${options.bank}%`)

  query = query.order('due_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false })

  const fetchLimit = Math.min(options?.limit ? options.limit * 3 : 500, 500)
  query = query.limit(fetchLimit)

  const { data, error } = await query
  if (error) throw error

  let entries = (data || []) as GmailLedgerEntry[]

  // 1. 过滤金额为 0 的
  entries = entries.filter(e => Number(e.statement_amount) !== 0)

  // 1b. 过滤溢缴款 — 优先用 LLM 判断，fallback 到正则
  entries = entries.filter(e => {
    if (e.is_overpayment) return false
    if (e.amount_direction === 'credit') return false
    // Fallback regex
    const ev = e.evidence || ''
    if (/no payment is due/i.test(ev) && /-\s*\$[\d,]+/.test(ev)) return false
    if (/(?:credit balance|overpayment|no payment required)/i.test(ev)) return false
    return true
  })

  // 1c. 过滤多卡合一账单的附属卡明细条目
  // 某些银行（民生、北京、农行等）一封对账单包含多张卡，主卡金额已含附属卡费用。
  // 附属卡条目有金额但无账单周期（due_date=null, statement_date=null），不是独立账单。
  entries = entries.filter(e => {
    if (Number(e.statement_amount) > 0 && !e.due_date && !e.statement_date) return false
    return true
  })

  // 2. 去重（三级）
  entries = dedupEntries(entries)

  // 3. 货币符号
  entries = entries.map(e => ({
    ...e,
    currency_symbol: currencySymbol(e.currency || 'CNY'),
  }))

  // 4. 持卡人姓名（DB 匹配 + 本条 evidence 提取，无全局兜底）
  const cardHolderMap = await buildCardHolderMap()
  entries = entries.map(e => ({
    ...e,
    holder_name: findHolderName(e, cardHolderMap),
  }))

  // Pagination after all filtering
  if (options?.offset) entries = entries.slice(options.offset)
  if (options?.limit) entries = entries.slice(0, options.limit)

  return entries
}

/** 获取汇总统计 */
export async function getGmailLedgerSummary(): Promise<GmailLedgerSummary> {
  const entries = await getGmailLedgerEntries()
  return {
    total: entries.length,
    unpaid: entries.filter(e => e.payment_status === '未还款').length,
    partial: entries.filter(e => e.payment_status === '部分还款').length,
    paid: entries.filter(e => e.payment_status === '已还清').length,
    totalAmount: entries.reduce((s, e) => s + Number(e.statement_amount || 0), 0),
    unpaidAmount: entries
      .filter(e => !e.completed)
      .reduce((s, e) => s + Math.max(0, Number(e.statement_amount || 0) - Number(e.paid_amount || 0)), 0),
  }
}

/** 标记还款 */
export async function markPayment(ledgerId: string, updates: {
  paid_amount?: number
  remaining_amount?: number
  completed?: boolean
  payment_status?: GmailLedgerEntry['payment_status']
  payment_note?: string
  payment_date?: string
}): Promise<GmailLedgerEntry> {
  const now = new Date().toISOString()
  const { data, error } = await db
    .from('gmail_ledger_entries')
    .update({
      ...updates,
      last_payment_update: now,
      updated_at: now,
    })
    .eq('ledger_id', ledgerId)
    .select()
    .single()

  if (error) throw error
  return data as GmailLedgerEntry
}

/** 获取银行列表 */
export async function getGmailLedgerBanks(): Promise<string[]> {
  const entries = await getGmailLedgerEntries()
  const banks = new Set(entries.map(e => e.bank))
  return Array.from(banks).sort()
}
