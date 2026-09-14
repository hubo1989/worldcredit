/**
 * 转发账单包的落库逻辑：在「某个持卡人」范围内找卡、必要时建卡，然后写账单。
 *
 * 与旧的直发路径（index.ts 里的 findCardId）关键区别：
 *   - 旧路径在「该用户所有持卡人的全部卡」里按尾号匹配，多持卡人时会把不同人的
 *     同尾号卡串在一起；
 *   - 这里先定持卡人，再只在 holder_id = ? 范围内匹配。
 * 直发路径本轮不动，附件路径单独走这里。
 */

import type { BillParseResult, HolderScopedBill, NestedBillMessage, RawAttachment } from './types'
import {
  extractNameFromBody,
  isEmlAttachment,
  resolveHolder,
  type HolderRecord,
} from './holders'
import { decodeMimeHeaderValue, extractHeaderDisplayName, parseRawMessage } from './mime'

interface HolderRow {
  id: string
  name: string
  aliases: unknown
}

/**
 * D1 把 card_holders.aliases 声明成 TEXT，读回来是 JSON 字符串而不是数组。
 * 这里在读取边界归一化，避免下游按数组使用时崩掉（与 lib/api/holders.server.ts 同口径）。
 */
function normalizeAliases(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string')
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) return parsed.filter((v): v is string => typeof v === 'string')
    } catch {
      return []
    }
  }
  return []
}

export interface HolderScope {
  holders: HolderRecord[]
  /** 该用户的兜底持卡人：最早创建的那个，识别不出具体人时用它。 */
  defaultHolderId: string | null
}

/**
 * 读取该用户（created_by = userId）名下的持卡人。
 * 与旧逻辑一致：只认 created_by，避免把别人家的持卡人算进来。
 */
export async function loadHolderScope(db: D1Database, userId: string): Promise<HolderScope> {
  const rows = await db.prepare(
    'SELECT id, name, aliases FROM card_holders WHERE created_by = ? ORDER BY created_at ASC, id ASC'
  ).bind(userId).all<HolderRow>()

  const holders: HolderRecord[] = (rows.results || []).map(row => ({
    id: row.id,
    name: row.name ?? '',
    aliases: normalizeAliases(row.aliases),
  }))

  return { holders, defaultHolderId: holders[0]?.id ?? null }
}

/** 卡片尾号统一成纯数字；保留前导零（Amex 有 0 开头的账户）。 */
function normalizeCardTail(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '')
}

function pickStatementDay(statementDate: string | null | undefined): number {
  if (!statementDate) return 10
  const day = new Date(statementDate).getDate()
  return Number.isFinite(day) && day >= 1 && day <= 31 ? day : 10
}

/**
 * 在指定持卡人范围内按尾号找卡，找不到且尾号明确时建卡。
 * 返回 null 有两种含义：尾号缺失（不建卡），或库里没有可用卡产品（建不了卡）。
 * 尾号为空时不建卡，否则每一封无尾号账单都会造出一张新卡。
 */
export async function findOrCreateCardForHolder(
  db: D1Database,
  holderId: string,
  cardTail: string | null,
  statementDate: string | null
): Promise<{ cardId: string; created: boolean } | null> {
  const tail = normalizeCardTail(cardTail)
  if (!tail) return null

  const existing = await db.prepare(
    'SELECT id FROM credit_cards WHERE holder_id = ? AND card_number_last4 = ? LIMIT 1'
  ).bind(holderId, tail).first<{ id: string }>()
  if (existing) return { cardId: existing.id, created: false }

  // credit_cards.card_product_id 是 NOT NULL 且外键 RESTRICT，必须挂在真实卡产品上。
  // 这里刻意不新建卡产品：缺少银行/卡种上下文时硬造会污染产品目录。
  const product = await db.prepare(
    'SELECT id FROM card_products ORDER BY is_active DESC, created_at ASC LIMIT 1'
  ).first<{ id: string }>()
  if (!product) return null

  const cardId = crypto.randomUUID()
  await db.prepare(
    'INSERT INTO credit_cards (id, holder_id, card_product_id, card_number_last4, credit_limit, billing_day, status, card_type) VALUES (?, ?, ?, ?, 0, ?, ?, ?)'
  ).bind(cardId, holderId, product.id, tail, pickStatementDay(statementDate), 'active', 'credit').run()

  return { cardId, created: true }
}

/** 幂等写账单：唯一键是 (card_id, bill_month)，命中则覆盖，未命中则插入。 */
export async function upsertBillForCard(db: D1Database, cardId: string, parsed: BillParseResult): Promise<string> {
  const billMonth = parsed.bill_month as string
  const dueDate = parsed.due_date as string
  const amount = Number(parsed.bill_amount)
  const minPayment = parsed.min_payment != null ? Number(parsed.min_payment) : null
  const statementDate = parsed.statement_date ?? null

  const existing = await db.prepare(
    'SELECT id FROM bills WHERE card_id = ? AND bill_month = ?'
  ).bind(cardId, billMonth).first<{ id: string }>()

  if (existing) {
    await db.prepare(
      'UPDATE bills SET bill_amount = ?, min_payment = ?, due_date = ?, statement_date = ?, status = ? WHERE id = ?'
    ).bind(amount, minPayment, dueDate, statementDate, 'unpaid', existing.id).run()
    return existing.id
  }

  const billId = crypto.randomUUID()
  await db.prepare(
    'INSERT INTO bills (id, card_id, bill_month, bill_amount, min_payment, due_date, statement_date, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(billId, cardId, billMonth, amount, minPayment, dueDate, statementDate, 'unpaid').run()
  return billId
}

/**
 * 把顶层转发包里的 .eml 附件逐个拆成独立的嵌套账单邮件。
 *
 * 每个嵌套 .eml 都当成一封完整邮件重新走 parseRawMessage：它自己可能还是 multipart，
 * 正文可能是 base64 + gbk，直接当字符串处理会乱码。PDF 等非邮件附件本轮跳过。
 */
export function extractNestedBillMessages(attachments: RawAttachment[]): NestedBillMessage[] {
  const messages: NestedBillMessage[] = []
  let index = 0

  for (const attachment of attachments) {
    if (!isEmlAttachment(attachment)) continue
    index++
    const label = attachment.filename?.trim() || 'attachment-' + index

    try {
      const parsed = parseRawMessage(attachment.bytes)
      messages.push({
        label,
        subject: decodeMimeHeaderValue(parsed.headers.subject) || null,
        from: decodeMimeHeaderValue(parsed.headers.from) || null,
        to: parsed.headers.to,
        text: parsed.text,
        headerName: extractHeaderDisplayName(parsed.headers.to),
        // 部分银行（如农行）只在正文写「尊敬的X先生/女士」，To 头里没有姓名
        bodyName: extractNameFromBody(parsed.text),
      })
    } catch {
      // 单封坏件不该拖垮整个包，记一条空结果由上层按「无正文」跳过
      messages.push({
        label, subject: null, from: null, to: null, text: '', headerName: null, bodyName: null,
      })
    }
  }

  return messages
}

export interface PersistNestedBillsResult {
  written: HolderScopedBill[]
  skipped: Array<{ label: string; reason: string }>
}

/**
 * 逐个嵌套账单：认持卡人 -> 找/建卡 -> 写账单。
 * AI 解析由调用方注入，这样本地重放和测试都不用打网络。
 */
export async function persistNestedBills(
  db: D1Database,
  scope: HolderScope,
  messages: NestedBillMessage[],
  parse: (text: string) => Promise<BillParseResult>
): Promise<PersistNestedBillsResult> {
  const written: HolderScopedBill[] = []
  const skipped: Array<{ label: string; reason: string }> = []

  for (const message of messages) {
    if (!message.text.trim()) {
      skipped.push({ label: message.label, reason: '附件无正文' })
      continue
    }

    let parsed: BillParseResult
    try {
      parsed = await parse(message.text)
    } catch (err) {
      skipped.push({ label: message.label, reason: 'AI 解析失败：' + (err instanceof Error ? err.message : String(err)) })
      continue
    }

    // 转发包里混着「电子对账单已可查阅」这类通知和营销邮件，字段不全的一律跳过
    if (parsed.is_bill === false || !parsed.bill_month || !parsed.due_date || !parsed.bill_amount) {
      skipped.push({ label: message.label, reason: '非账单或缺少必填字段' })
      continue
    }

    const resolution = resolveHolder({
      holders: scope.holders,
      defaultHolderId: scope.defaultHolderId,
      headerName: message.headerName,
      bodyName: message.bodyName,
    })
    if (!resolution.holderId) {
      skipped.push({ label: message.label, reason: '该用户名下无持卡人' })
      continue
    }

    const card = await findOrCreateCardForHolder(
      db, resolution.holderId, parsed.card_last4 ?? null, parsed.statement_date ?? null
    )
    if (!card) {
      // 尾号缺失不能建卡，也不能随便挂到已有卡上——记录后跳过，等人工在界面补
      const reason = (parsed.card_last4 ?? '').replace(/\D/g, '')
        ? '缺少可用卡产品，无法建卡'
        : '账单未给出尾号，跳过（避免误挂到其他卡）'
      skipped.push({ label: message.label, reason })
      continue
    }

    const billId = await upsertBillForCard(db, card.cardId, parsed)
    written.push({
      holderId: resolution.holderId,
      holderName: scope.holders.find(h => h.id === resolution.holderId)?.name ?? '',
      cardId: card.cardId,
      billId,
      aiResult: parsed,
      matchSource: resolution.source,
    })
  }

  return { written, skipped }
}
