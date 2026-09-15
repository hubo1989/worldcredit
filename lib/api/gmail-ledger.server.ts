// lib/api/gmail-ledger.ts
import { query, queryOne, execute } from '../db'

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
  /** Amount was entered by hand (no-amount statement mail), not parsed. */
  manually_priced?: number
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
  /** Entries whose mail carried no amount yet, awaiting manual entry. */
  needsAmount: number
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
    const { data: cards } = await query<{ id: string; holder_id: string; card_number_last4: string | null; card_product_id: string }>(
      'SELECT id, holder_id, card_number_last4, card_product_id FROM credit_cards'
    )
    if (!cards) return map

    const productIds = [...new Set(cards.map((c) => c.card_product_id).filter(Boolean))]
    let products: { id: string; bank_name: string }[] = []
    if (productIds.length > 0) {
      const { data: pd } = await query<{ id: string; bank_name: string }>(
        `SELECT id, bank_name FROM card_products WHERE id IN (${productIds.map(() => '?').join(',')})`, productIds
      )
      products = (pd || []) as typeof products
    }
    const productMap = new Map(products.map(p => [p.id, p.bank_name]))

    const holderIds = [...new Set(cards.map((c) => c.holder_id).filter(Boolean))]
    let holders: { id: string; name: string }[] = []
    if (holderIds.length > 0) {
      const { data: hd } = await query<{ id: string; name: string }>(
        `SELECT id, name FROM card_holders WHERE id IN (${holderIds.map(() => '?').join(',')})`, holderIds
      )
      holders = (hd || []) as typeof holders
    }
    const holderMap = new Map(holders.map(h => [h.id, h.name]))

    for (const card of cards) {
      if (!card.card_number_last4) continue
      const bname = productMap.get(card.card_product_id) || ''
      const hname = holderMap.get(card.holder_id) || ''
      map.set(`${bname}:${card.card_number_last4}`, hname)
      map.set(`:${card.card_number_last4}`, hname)
    }
  } catch { /* silent */ }
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
  const pass1 = entries.filter(e => {
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

  const pass2: GmailLedgerEntry[] = []
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

/**
 * 获取 Gmail 账单记录（去重、加持卡人、货币符号）。
 *
 * 默认只返回有金额的条目；无金额的（邮件正文本身没有金额，多是"账单已就绪 /
 * AutoPay 提醒"）用 needsAmount 单独取出来补录，避免混进常规账单列表。
 */
export async function getGmailLedgerEntries(options?: {
  status?: GmailLedgerEntry['payment_status']
  bank?: string
  limit?: number
  offset?: number
  /** Return only entries with no amount yet (the "待补金额" view). */
  needsAmount?: boolean
  /** Also return no-amount entries alongside priced ones. */
  includeUnpriced?: boolean
  /**
   * Owner scope. Members must pass their own user id; admins omit it and see
   * every row (preserving the pre-downshift behaviour). Ledger rows are keyed
   * by the user that ingested the statement mail, same as sync-gmail.
   */
  createdBy?: string
}): Promise<GmailLedgerEntry[]> {
  const conditions: string[] = []
  const params: unknown[] = []
  if (options?.createdBy) {
    conditions.push('created_by = ?')
    params.push(options.createdBy)
  }
  if (options?.status) {
    conditions.push('payment_status = ?')
    params.push(options.status)
  }
  if (options?.bank) {
    conditions.push('bank LIKE ?')
    params.push(`%${options.bank}%`)
  }
  const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : ''
  const fetchLimit = Math.min(options?.limit ? options.limit * 3 : 500, 500)

  const { data, error } = await query<GmailLedgerEntry>(
    `SELECT * FROM gmail_ledger_entries${where} ORDER BY due_date ASC, created_at DESC LIMIT ?`,
    [...params, fetchLimit]
  )
  if (error) throw new Error(error.message)

  let entries = (data || []) as GmailLedgerEntry[]

  // 1. 金额为 0 的条目 = 邮件正文里没有金额（多为"账单已就绪/AutoPay 提醒"），
  //    它们仍然入库并保留，供人工补录金额，但不混进常规账单列表：
  //    needsAmount 只看待补的，includeUnpriced 两者都要，默认只给有金额的。
  const isUnpriced = (e: GmailLedgerEntry) => Number(e.statement_amount || 0) === 0
  if (options?.needsAmount) {
    entries = entries.filter(isUnpriced)
  } else if (!options?.includeUnpriced) {
    entries = entries.filter(e => !isUnpriced(e))
  }

  // 1b/1c 都是按金额判定的噪音过滤，只对已定价的条目有意义；
  // 待补金额的条目本来就是"金额缺失"，套用只会把它们滤空。
  if (!options?.needsAmount) {
    // 过滤溢缴款 — 优先用 LLM 判断，fallback 到正则
    entries = entries.filter(e => {
      if (e.is_overpayment) return false
      if (e.amount_direction === 'credit') return false
      // Fallback regex
      const ev = e.evidence || ''
      if (/no payment is due/i.test(ev) && /-\s*\$[\d,]+/.test(ev)) return false
      if (/(?:credit balance|overpayment|no payment required)/i.test(ev)) return false
      return true
    })

    // 过滤多卡合一账单的附属卡明细条目
    // 某些银行（民生、北京、农行等）一封对账单包含多张卡，主卡金额已含附属卡费用。
    // 附属卡条目有金额但无账单周期（due_date=null, statement_date=null），不是独立账单。
    entries = entries.filter(e => {
      // 手工补录的账单即使没有账期也要保留：这一条是人工确认过的独立账单，
      // 1c 规则针对的是多卡合一对账单里的附属卡明细行，不是这种情况。
      if (e.manually_priced) return true
      if (Number(e.statement_amount) > 0 && !e.due_date && !e.statement_date) return false
      return true
    })
  }

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
export async function getGmailLedgerSummary(createdBy?: string): Promise<GmailLedgerSummary> {
  const entries = await getGmailLedgerEntries({ createdBy })
  // Counted separately: unpriced rows are excluded from the default list above.
  const pendingAmount = await getGmailLedgerEntries({ needsAmount: true, createdBy })
  return {
    total: entries.length,
    unpaid: entries.filter(e => e.payment_status === '未还款').length,
    partial: entries.filter(e => e.payment_status === '部分还款').length,
    paid: entries.filter(e => e.payment_status === '已还清').length,
    totalAmount: entries.reduce((s, e) => s + Number(e.statement_amount || 0), 0),
    unpaidAmount: entries
      .filter(e => !e.completed)
      .reduce((s, e) => s + Math.max(0, Number(e.statement_amount || 0) - Number(e.paid_amount || 0)), 0),
    needsAmount: pendingAmount.length,
  }
}

/**
 * 补录账单金额。
 *
 * 有些银行邮件（尤其 Amex 的 "statement is ready" / AutoPay 提醒）正文里根本没有
 * 金额和到期日，解析出来就是 0。这类条目不能靠 markPayment 修——那只改还款字段，
 * 金额仍为 0，UI 依旧当作"未定价"。这里单独提供补录金额的写入口，
 * 金额与到期日一起写，补完即进入常规账单列表。
 */
export async function updateLedgerAmount(ledgerId: string, updates: {
  statement_amount: number
  minimum_payment?: number | null
  due_date?: string | null
  statement_date?: string | null
}): Promise<GmailLedgerEntry> {
  const amount = Number(updates.statement_amount)
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('金额必须是大于 0 的数字')
  }
  const ts = new Date().toISOString()
  const fields = ['statement_amount = ?']
  const params: unknown[] = [amount]
  if (updates.minimum_payment !== undefined) {
    fields.push('minimum_payment = ?')
    params.push(updates.minimum_payment)
  }
  if (updates.due_date !== undefined) {
    fields.push('due_date = ?')
    params.push(updates.due_date || null)
  }
  if (updates.statement_date !== undefined) {
    fields.push('statement_date = ?')
    params.push(updates.statement_date || null)
  }
  // 补录前金额缺失，还款状态重新按"未还款"起算，避免带着 0 元的旧状态。
  // manually_priced 标记这条金额来自人工补录，读取时免于被"附属卡明细"规则过滤。
  fields.push('remaining_amount = ?', 'payment_status = ?', 'completed = 0',
              'manually_priced = 1',
              'last_payment_update = ?', 'updated_at = ?')
  params.push(amount, '未还款', ts, ts, ledgerId)

  const { error } = await execute('UPDATE gmail_ledger_entries SET ' + fields.join(', ') + ' WHERE ledger_id = ?', params)
  if (error) throw new Error(error.message)

  const { data: updated } = await queryOne<GmailLedgerEntry>(
    'SELECT * FROM gmail_ledger_entries WHERE ledger_id = ?', [ledgerId]
  )
  if (!updated) throw new Error('记录不存在')
  return updated
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
  const ts = new Date().toISOString()
  const fields: string[] = []
  const params: unknown[] = []
  if (updates.paid_amount !== undefined) { fields.push('paid_amount = ?'); params.push(updates.paid_amount) }
  if (updates.remaining_amount !== undefined) { fields.push('remaining_amount = ?'); params.push(updates.remaining_amount) }
  if (updates.completed !== undefined) { fields.push('completed = ?'); params.push(updates.completed ? 1 : 0) }
  if (updates.payment_status !== undefined) { fields.push('payment_status = ?'); params.push(updates.payment_status) }
  if (updates.payment_note !== undefined) { fields.push('payment_note = ?'); params.push(updates.payment_note) }
  if (updates.payment_date !== undefined) { fields.push('payment_date = ?'); params.push(updates.payment_date) }
  fields.push('last_payment_update = ?', 'updated_at = ?')
  params.push(ts, ts, ledgerId)

  const { error } = await execute(`UPDATE gmail_ledger_entries SET ${fields.join(', ')} WHERE ledger_id = ?`, params)
  if (error) throw new Error(error.message)

  const { data: updated } = await queryOne<GmailLedgerEntry>(
    'SELECT * FROM gmail_ledger_entries WHERE ledger_id = ?', [ledgerId]
  )
  if (!updated) throw new Error('记录不存在')
  return updated
}

/** 获取银行列表 */
export async function getGmailLedgerBanks(createdBy?: string): Promise<string[]> {
  const entries = await getGmailLedgerEntries({ createdBy })
  const banks = new Set(entries.map(e => e.bank))
  return Array.from(banks).sort()
}
