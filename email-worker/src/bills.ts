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
  /** 邮件归属的用户：待确认草稿的 created_by。 */
  userId?: string
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

  return { holders, defaultHolderId: holders[0]?.id ?? null, userId }
}

/** 卡片尾号统一成纯数字；保留前导零（Amex 有 0 开头的账户）。 */
function normalizeCardTail(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '')
}

/** 50 天启发式的基准：账单日到还款日的最长间隔（最长免息期）。 */
export const BILLING_DAY_REFERENCE_GAP = 50
/** 50 天启发式的容差：偏差在这个范围内才用收件日期当账单日。 */
export const BILLING_DAY_GAP_TOLERANCE = 15

/**
 * 从一封账单邮件推卡账单日（1-31），推不出返回 null。
 *
 * 证据强度从高到低：
 *   1. 正文明确写出的「账单日 X」——只认白纸黑字，不从账期/还款日推算
 *      （邮储 3293 曾把周期首日 22 当账单日，就是推算的锅）；
 *   2. 本期出账日（Statement Date）的「日」——出账日就是账单日本身；
 *   3. 50 天启发式（仅当 1、2 都缺）：还款日 − 50 天 ≈ 最早可能出账日，
 *      收件日期与它偏差 ≤15 天说明收件日确实落在出账窗口，用收件日的「日」
 *      当账单日；偏差 >15 天说明假设不成立，宁可返回 null 让用户手填——
 *      默认值污染（邮储 0726/2891 被填成默认 10）就是这么来的。
 */
export function deriveBillingDayFromEmail(params: {
  statementDay?: number | null
  statementDate?: string | null
  dueDate?: string | null
  receivedDate?: string | null
}): number | null {
  const { statementDay, statementDate, dueDate, receivedDate } = params
  if (typeof statementDay === 'number' && statementDay >= 1 && statementDay <= 31) {
    return Math.trunc(statementDay)
  }
  if (statementDate) {
    const day = new Date(statementDate).getDate()
    if (day >= 1 && day <= 31) return day
  }
  if (!dueDate || !receivedDate) return null
  const due = new Date(dueDate)
  const received = new Date(receivedDate)
  if (Number.isNaN(due.getTime()) || Number.isNaN(received.getTime())) return null
  const gapDays = Math.round((due.getTime() - received.getTime()) / 86_400_000)
  if (Math.abs(gapDays - BILLING_DAY_REFERENCE_GAP) > BILLING_DAY_GAP_TOLERANCE) return null
  const day = received.getDate()
  return day >= 1 && day <= 31 ? day : null
}

/**
 * 在指定持卡人范围内按尾号找卡，找不到且尾号明确时建卡。
 * 尾号为空时不建卡，否则每一封无尾号账单都会造出一张新卡。
 *
 * 建卡必须挂到真实卡产品上（card_product_id NOT NULL + 外键 RESTRICT），而卡产品
 * 同时决定了这张卡的币种。所以这里只在按银行名匹配到产品时才建卡：宁可跳过、
 * 让用户在界面手动补，也不能随便挑一个产品把美国卡标成 CNY。
 */
export interface CardProductCandidate {
  id: string
  bank_name: string
  currency: string
}

/** 银行名归一化：去空白 + 小写，让 'Chase' / 'chase bank' 这类写法可比。 */
function normalizeBankName(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/[\s\u3000]+/g, '')
}

/**
 * 按账单里的银行名挑一个卡产品作为新卡的载体。
 * 先按银行名匹配（精确名优先于互相包含，因为「Citibank」与「Citibank HK」是两家），
 * 再优先选币种一致的那个——同一家银行可能有本币和外币两种产品
 * （如汇丰中国 CNY / 汇丰香港 HKD），选错会把币种记错。
 * 匹配不到返回 null，调用方据此跳过而不是硬造卡。
 */
export function pickCardProductForBank(
  products: CardProductCandidate[],
  bankName: string | null,
  currency: string | null
): CardProductCandidate | null {
  const wanted = normalizeBankName(bankName)
  if (!wanted) return null

  const exact = products.filter(product => normalizeBankName(product.bank_name) === wanted)
  const partial = products.filter(product => {
    const have = normalizeBankName(product.bank_name)
    if (!have) return false
    return have.includes(wanted) || wanted.includes(have)
  })
  const matches = exact.length ? exact : partial
  if (!matches.length) return null

  const wantedCurrency = (currency ?? '').trim().toUpperCase()
  if (wantedCurrency) {
    const sameCurrency = matches.find(p => (p.currency ?? '').trim().toUpperCase() === wantedCurrency)
    if (sameCurrency) return sameCurrency
  }
  return matches[0]
}

export interface FindOrCreateCardParams {
  holderId: string
  cardTail: string | null
  statementDate: string | null
  /** 正文明确写出的「账单日」数值（1-31），最强证据。 */
  statementDay?: number | null
  /** 本期还款日 + 邮件收件日期，合成 50 天启发式的输入。 */
  dueDate?: string | null
  receivedDate?: string | null
  /** AI 解出的银行名，用于匹配卡产品；缺失则不建卡。 */
  bankName: string | null
  /** AI 解出的币种，用于在同银行多产品里排除币种不符的候选。 */
  currency: string | null
  /**
   * false 时只查找不创建：归属不可信（回落默认持卡人）绝不能凭猜测
   * 给某个人名下新建卡——2026-10-16 民生 0872 就这样被挂错了人。
   * 此时返回 needsDraft=true，由调用方落待确认草稿。
   */
  allowCreate?: boolean
}

export type FindOrCreateCardOutcome =
  | { ok: true; cardId: string; created: boolean }
  | { ok: false; reason: string; needsDraft?: boolean }

export async function findOrCreateCardForHolder(
  db: D1Database,
  params: FindOrCreateCardParams
): Promise<FindOrCreateCardOutcome> {
  const tail = normalizeCardTail(params.cardTail)
  if (!tail) return { ok: false, reason: '账单未给出尾号，跳过（避免误挂到其他卡）' }

  const existing = await db.prepare(
    'SELECT id FROM credit_cards WHERE holder_id = ? AND card_number_last4 = ? LIMIT 1'
  ).bind(params.holderId, tail).first<{ id: string }>()
  if (existing) return { ok: true, cardId: existing.id, created: false }

  if (params.allowCreate === false) {
    return {
      ok: false,
      reason: '归属未确认且该持卡人名下无此卡，已存入待确认草稿（请在界面选卡确认）',
      needsDraft: true,
    }
  }

  // credit_cards.card_product_id 是 NOT NULL 且外键 RESTRICT，必须挂在真实卡产品上。
  // 这里刻意不新建卡产品：缺少银行/卡种上下文时硬造会污染产品目录。
  const products = await db.prepare(
    'SELECT id, bank_name, currency FROM card_products WHERE is_active = 1 ORDER BY created_at ASC, id ASC'
  ).all<CardProductCandidate>()
  const product = pickCardProductForBank(products.results ?? [], params.bankName, params.currency)
  if (!product) {
    const bank = (params.bankName ?? '').trim()
    return {
      ok: false,
      reason: bank
        ? `未匹配到银行「${bank}」，请在界面手动添加该卡`
        : '账单未给出银行名，无法自动建卡',
    }
  }

  // 账单日必须有依据才建卡：正文明示的账单日 > 本期出账日 > 50 天启发式。
  // 三者都缺时宁可落待确认草稿让用户手填，也不写默认值——邮储 0726/2891 的
  // 卡档账单日 10 就是旧逻辑「无依据默认 10」的污染。
  const billingDay = deriveBillingDayFromEmail({
    statementDay: params.statementDay ?? null,
    statementDate: params.statementDate,
    dueDate: params.dueDate ?? null,
    receivedDate: params.receivedDate ?? null,
  })
  if (!billingDay) {
    return {
      ok: false,
      reason: '邮件未给出账单日，也无法按「还款日−50 天±15 天」用收件日期推定，已存入待确认草稿（请在界面确认时填写账单日）',
      needsDraft: true,
    }
  }

  const cardId = crypto.randomUUID()
  // 额度暂记 0：AI 结果里没有额度字段，宁可留空等用户补，也不猜一个数。
  // 币种不落库在这里——它由 card_product 决定，所以上面必须挑对产品。
  await db.prepare(
    'INSERT INTO credit_cards (id, holder_id, card_product_id, card_number_last4, credit_limit, billing_day, status, card_type) VALUES (?, ?, ?, ?, 0, ?, ?, ?)'
  ).bind(cardId, params.holderId, product.id, tail, billingDay, 'active', 'credit').run()

  return { ok: true, cardId, created: true }
}

/**
 * 归属无法确认时的安全出口：把 AI 解析结果原样存成待确认草稿
 * （bill_import_drafts，status=draft，card_id=NULL），
 * 用户在界面选择正确持卡人的卡片并确认后才真正入库。
 */
export async function parkBillAsDraft(
  db: D1Database,
  userId: string,
  parsed: Record<string, unknown>
): Promise<string> {
  const id = crypto.randomUUID()
  const confidence =
    typeof parsed.confidence === 'number' && Number.isFinite(parsed.confidence)
      ? parsed.confidence
      : null
  await db
    .prepare(
      `INSERT INTO bill_import_drafts (id, created_by, card_id, source_type, parsed_payload, confidence)
       VALUES (?, ?, NULL, 'email', ?, ?)`
    )
    .bind(id, userId, JSON.stringify(parsed), confidence)
    .run()
  return id
}

export interface UpsertBillOptions {
  /**
   * 归属是否可信（To 头显示名或正文称呼真的命中了某个持卡人）。
   * false 表示这人只是被回落成了默认持卡人，不能凭此覆盖他那个月的既有账单。
   */
  trusted: boolean
}

export interface UpsertBillOutcome {
  billId: string
  action: 'inserted' | 'updated' | 'preserved'
  /** 仅 action='preserved' 时给出，写进 skipped 让日志说清为什么没写。 */
  reason: string | null
}

/**
 * 重发/补发邮件不能把已经还清或部分还款的账单打回未还款。
 * 只有原本就是 unpaid（或没有状态）时才保持 unpaid，其余状态一律原样保留。
 *
 * 直发路径（index.ts）与附件路径共用这条规则：同一家银行重发邮件不该让已还清
 * 的账单重新出现在待还列表里，两条路径的行为必须一致。
 */
export function keepPaidStatus(existing: string | null | undefined): string {
  const current = (existing ?? '').trim()
  return current && current !== 'unpaid' ? current : 'unpaid'
}

/**
 * 幂等写账单：唯一键是 (card_id, bill_month)。
 *
 * 归属不可信（trusted=false）且该月账单已存在时**不覆盖**，返回 preserved 让上层
 * 记进 skipped：名册外的人（新卡、亲戚、银行拼写差异）寄来的同尾号账单，不能
 * 顶着默认持卡人的身份把他那个月的账单改写掉。归属不可信但库里还没有这条账单时
 * 仍然插入——此时不存在"覆盖别人"的风险，记下来总比丢掉好。
 */
export async function upsertBillForCard(
  db: D1Database,
  cardId: string,
  parsed: BillParseResult,
  options: UpsertBillOptions
): Promise<UpsertBillOutcome> {
  const billMonth = parsed.bill_month as string
  const amount = Number(parsed.bill_amount)
  const minPayment = parsed.min_payment != null ? Number(parsed.min_payment) : null
  const statementDate = parsed.statement_date ?? null
  // 0 元账单的 due_date 兜底（bills.due_date NOT NULL）：缺省时用账单日或月末；
  // 0 元新账单 status 直接置 paid（应还 0 元 = 已还清），与直发路径同口径。
  const zeroBill = amount === 0
  const dueDate = (parsed.due_date as string | null) ?? statementDate ?? (billMonth + '-28')
  const initialStatus = zeroBill ? 'paid' : 'unpaid'

  const existing = await db.prepare(
    'SELECT id, status FROM bills WHERE card_id = ? AND bill_month = ?'
  ).bind(cardId, billMonth).first<{ id: string; status: string | null }>()

  if (existing) {
    if (!options.trusted) {
      return {
        billId: existing.id,
        action: 'preserved',
        reason: `该卡 ${billMonth} 账单已存在，但收件人无法确认归属（已回落默认持卡人），保留原值`,
      }
    }
    await db.prepare(
      'UPDATE bills SET bill_amount = ?, min_payment = ?, due_date = ?, statement_date = ?, status = ? WHERE id = ?'
    ).bind(amount, minPayment, dueDate, statementDate, keepPaidStatus(existing.status), existing.id).run()
    return { billId: existing.id, action: 'updated', reason: null }
  }

  const billId = crypto.randomUUID()
  await db.prepare(
    'INSERT INTO bills (id, card_id, bill_month, bill_amount, min_payment, due_date, statement_date, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(billId, cardId, billMonth, amount, minPayment, dueDate, statementDate, initialStatus).run()
  return { billId, action: 'inserted', reason: null }
}

/**
 * 用本期账单证据同步卡档账单日（直发与附件路径共用）。
 *
 * 卡档账单日残留旧值（民生 9765 的 4 月旧账期值、邮储的默认 10）的根因之一
 * 是账单日只在「建卡」时写一次，之后每期账单再准也不回写。这里在每期账单
 * 落库后回写，但要求至少一个客观日期证据与候选值互相印证：
 *   - 本期出账日（statement_date）的「日」== 候选值；或
 *   - 历史账单里有一期出账日的「日」== 候选值（连续 2 期相同）。
 * 只有正文明示的「账单日 X」而没有出账日佐证时不更新——AI 幻觉单证据不配
 * 改卡档（Chase 通知邮件的 "as of Oct 16" 就是这类污染源）。
 *
 * @returns 是否更新了卡档（供日志记录）。
 */
export async function syncBillingDayFromBill(
  db: D1Database,
  cardId: string,
  parsed: BillParseResult
): Promise<boolean> {
  const statementDateDay = parsed.statement_date
    ? new Date(parsed.statement_date).getDate()
    : null
  const explicit = parsed.statement_day
  const candidate =
    typeof explicit === 'number' && explicit >= 1 && explicit <= 31
      ? Math.trunc(explicit)
      : statementDateDay
  if (!candidate || candidate < 1 || candidate > 31) return false

  const card = await db
    .prepare('SELECT billing_day FROM credit_cards WHERE id = ?')
    .bind(cardId)
    .first<{ billing_day: number }>()
  if (!card || card.billing_day === candidate) return false

  const currentConfirms = statementDateDay === candidate
  let previousConfirms = false
  if (parsed.bill_month) {
    const prev = await db
      .prepare(
        `SELECT statement_date FROM bills
         WHERE card_id = ? AND bill_month < ? AND statement_date IS NOT NULL
         ORDER BY bill_month DESC LIMIT 6`
      )
      .bind(cardId, parsed.bill_month)
      .all<{ statement_date: string }>()
    previousConfirms = (prev.results || []).some(
      row => new Date(row.statement_date).getDate() === candidate
    )
  }
  if (!currentConfirms && !previousConfirms) return false

  await db
    .prepare('UPDATE credit_cards SET billing_day = ? WHERE id = ? AND billing_day != ?')
    .bind(candidate, cardId, candidate)
    .run()
  return true
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
        date: parsed.headers.date ?? null,
        text: parsed.text,
        headerName: extractHeaderDisplayName(parsed.headers.to),
        // 部分银行（如农行）只在正文写「尊敬的X先生/女士」，To 头里没有姓名
        bodyName: extractNameFromBody(parsed.text),
      })
    } catch {
      // 单封坏件不该拖垮整个包，记一条空结果由上层按「无正文」跳过
      messages.push({
        label, subject: null, from: null, to: null, date: null, text: '', headerName: null, bodyName: null,
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
    // 与直发路径同口径：0 元账单合法（== null 判空，不用 falsy）；
    // 0 元时 due_date 可缺（无需还款就没有截止日）
    const zeroBill = Number(parsed.bill_amount) === 0
    if (
      parsed.is_bill === false ||
      !parsed.bill_month ||
      parsed.bill_amount == null || Number.isNaN(Number(parsed.bill_amount)) ||
      (!zeroBill && !parsed.due_date)
    ) {
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

    // 归属是否可信只由「真的命中了某个人」决定；回落默认持卡人不算可信。
    const trusted = resolution.source === 'header_name' || resolution.source === 'body_honorific'

    const card = await findOrCreateCardForHolder(db, {
      holderId: resolution.holderId,
      cardTail: parsed.card_last4 ?? null,
      statementDate: parsed.statement_date ?? null,
      statementDay: parsed.statement_day ?? null,
      dueDate: parsed.due_date ?? null,
      receivedDate: message.date,
      bankName: parsed.bank_name ?? null,
      currency: parsed.currency ?? null,
      // 归属不可信时绝不自动建卡（会挂到默认持卡人头上）；落草稿等人工确认。
      allowCreate: trusted,
    })
    if (!card.ok) {
      if (card.needsDraft && scope.userId) {
        await parkBillAsDraft(db, scope.userId, parsed as unknown as Record<string, unknown>)
        skipped.push({ label: message.label, reason: `${card.reason}｜草稿已保存` })
        continue
      }
      // 尾号缺失、或按银行名匹配不到卡产品时都不建卡，也不能随便挂到已有卡上，
      // 记录后跳过，等人工在界面补
      skipped.push({ label: message.label, reason: card.reason })
      continue
    }

    const outcome = await upsertBillForCard(db, card.cardId, parsed, { trusted })
    if (outcome.action === 'preserved') {
      // 归属不可信 + 该月账单已存在：不覆盖，如实记进 skipped
      skipped.push({ label: message.label, reason: outcome.reason ?? '归属无法确认，保留原值' })
      continue
    }
    // 每期账单落库后回写卡档账单日（有出账日证据互相印证才动，见函数注释）
    const billingDayUpdated = await syncBillingDayFromBill(db, card.cardId, parsed)
    written.push({
      holderId: resolution.holderId,
      holderName: scope.holders.find(h => h.id === resolution.holderId)?.name ?? '',
      cardId: card.cardId,
      billId: outcome.billId,
      aiResult: parsed,
      matchSource: resolution.source,
      billingDayUpdated,
    })
  }

  return { written, skipped }
}
