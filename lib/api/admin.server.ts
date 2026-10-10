import { query, queryOne, execute, uuid, now } from '../db'
import { CardProduct, Promo, Benefit, Bank, EmailParseLog } from '../types'

/**
 * 管理后台通用 API 封装
 */

// --- 邮件解析日志 ---

export async function getEmailParseLogs(opts: {
  page?: number
  pageSize?: number
  status?: 'success' | 'failed' | 'skipped' | null
  search?: string | null
}) {
  const page = Math.max(0, opts.page ?? 0)
  const pageSize = Math.min(100, Math.max(10, opts.pageSize ?? 20))
  const conditions: string[] = []
  const params: unknown[] = []
  if (opts.status) {
    conditions.push('status = ?')
    params.push(opts.status)
  }
  if (opts.search) {
    conditions.push('(from_email LIKE ? OR subject LIKE ?)')
    const like = `%${opts.search}%`
    params.push(like, like)
  }
  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''
  const countRow = await queryOne<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM email_parse_logs ${where}`, params)
  const rows = await query<EmailParseLog>(
    `SELECT * FROM email_parse_logs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, page * pageSize]
  )
  return { total: countRow.data?.cnt ?? 0, rows: (rows.data ?? []) as EmailParseLog[] }
}

// --- 邮件账单未匹配银行的人工处理 ---

interface RawEmailBillPayload {
  is_bill?: boolean
  bank_name?: string
  card_last4?: string | null
  bill_amount?: number | null
  min_payment?: number | null
  due_date?: string
  bill_month?: string
  statement_date?: string | null
  currency?: string
}

export interface EmailParseLogHolderOption {
  id: string
  name: string
}

export async function getEmailParseLogHolders(logId: string): Promise<EmailParseLogHolderOption[]> {
  const { data: log, error } = await queryOne<EmailParseLog>(
    'SELECT * FROM email_parse_logs WHERE id = ?',
    [logId],
  )
  if (error) throw new Error(error.message)
  if (!log) throw new Error('邮件日志不存在')
  if (log.status !== 'failed' || !isUnmatchedBankError(log.error_msg)) {
    throw new Error('这封邮件不是待处理的未匹配银行账单')
  }

  const { data: holders, error: holderError } = await query<EmailParseLogHolderOption>(
    'SELECT id, name FROM card_holders WHERE created_by = ? ORDER BY created_at ASC, id ASC',
    [log.user_id],
  )
  if (holderError) throw new Error(holderError.message)
  return holders ?? []
}

export async function discardEmailParseLog(logId: string): Promise<EmailParseLog> {
  const { data: log, error } = await queryOne<EmailParseLog>(
    'SELECT * FROM email_parse_logs WHERE id = ?',
    [logId],
  )
  if (error) throw new Error(error.message)
  if (!log) throw new Error('邮件日志不存在')
  if (log.status !== 'failed' || !isUnmatchedBankError(log.error_msg)) {
    throw new Error('只有未匹配银行的失败账单可以丢弃')
  }

  const message = `${log.error_msg ?? ''}；用户已丢弃，不创建卡片，不写入账单`
  const { data: updateResult, error: updateError } = await execute(
    "UPDATE email_parse_logs SET status = 'skipped', error_msg = ? WHERE id = ? AND status = 'failed'",
    [message, logId],
  )
  if (updateError) throw new Error(updateError.message)
  if ((updateResult?.changes ?? 0) !== 1) throw new Error('这封邮件已被其他操作处理')

  const { data: updated, error: readError } = await queryOne<EmailParseLog>(
    'SELECT * FROM email_parse_logs WHERE id = ?',
    [logId],
  )
  if (readError) throw new Error(readError.message)
  if (!updated) throw new Error('邮件日志更新后不存在')
  return updated
}

export interface CreateCardFromEmailParseLogParams {
  logId: string
  holderId?: string
  bankName?: string
  cardName?: string
  currency?: string
  country?: string
}

export interface CreateCardFromEmailParseLogResult {
  cardId: string
  billId: string
  holderName: string
  createdBank: boolean
  createdProduct: boolean
  createdCard: boolean
}

function isUnmatchedBankError(message: string | null | undefined): boolean {
  return (
    typeof message === 'string' &&
    message.includes('未匹配到银行「') &&
    message.includes('请在界面手动添加该卡')
  )
}

function parseEmailBillPayload(raw: string | null): RawEmailBillPayload {
  if (!raw) throw new Error('这封邮件没有 AI 解析结果')
  try {
    const parsed = JSON.parse(raw) as RawEmailBillPayload
    if (parsed.is_bill === false) throw new Error('这封邮件不是账单')
    return parsed
  } catch (err) {
    if (err instanceof Error && err.message === '这封邮件不是账单') throw err
    throw new Error('AI 解析结果不是有效 JSON', { cause: err })
  }
}

function statementDay(statementDate: string | null | undefined): number {
  if (!statementDate) return 10
  const day = new Date(statementDate).getDate()
  return Number.isFinite(day) && day >= 1 && day <= 31 ? day : 10
}

function nextStatus(existingStatus: string | null | undefined, zeroBill: boolean): string {
  if (zeroBill) return existingStatus && existingStatus !== 'unpaid' ? existingStatus : 'paid'
  return existingStatus && existingStatus !== 'unpaid' ? existingStatus : 'unpaid'
}

export async function createCardFromEmailParseLog(
  params: CreateCardFromEmailParseLogParams,
): Promise<CreateCardFromEmailParseLogResult> {
  const { data: log, error } = await queryOne<EmailParseLog>(
    'SELECT * FROM email_parse_logs WHERE id = ?',
    [params.logId],
  )
  if (error) throw new Error(error.message)
  if (!log) throw new Error('邮件日志不存在')
  if (log.status !== 'failed' || !isUnmatchedBankError(log.error_msg)) {
    throw new Error('这封邮件不是待处理的未匹配银行账单')
  }

  const parsed = parseEmailBillPayload(log.raw_ai_response ?? null)
  const bankName = (params.bankName ?? parsed.bank_name ?? '').trim()
  const cardName = (params.cardName ?? '').trim()
  const currency = (params.currency ?? parsed.currency ?? 'CNY').trim().toUpperCase()
  const country = (params.country ?? (currency === 'CNY' ? 'CN' : '')).trim().toUpperCase()
  const tail = (parsed.card_last4 ?? '').replace(/\D/g, '')
  const billMonth = (parsed.bill_month ?? '').trim()
  const amount = Number(parsed.bill_amount)

  if (!bankName) throw new Error('请填写银行名称')
  if (!cardName) throw new Error('请填写卡片名称')
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('币种必须是 3 位字母（如 CNY）')
  if (!/^[A-Z]{2}$/.test(country)) throw new Error('国家/地区必须是 2 位字母（如 CN）')
  if (!/^\d{4,6}$/.test(tail)) throw new Error('AI 解析结果缺少 4-6 位卡尾号')
  if (!/^\d{4}-\d{2}$/.test(billMonth)) throw new Error('AI 解析结果缺少合法账单月')
  if (parsed.bill_amount == null || !Number.isFinite(amount) || amount < 0) {
    throw new Error('AI 解析结果缺少合法账单金额')
  }

  const holderSql = params.holderId
    ? `SELECT id, name FROM card_holders
       WHERE created_by = ? AND id = ?
       ORDER BY created_at ASC, id ASC LIMIT 1`
    : `SELECT id, name FROM card_holders
       WHERE created_by = ?
       ORDER BY created_at ASC, id ASC LIMIT 1`
  const holderParams = params.holderId ? [log.user_id, params.holderId] : [log.user_id]
  const { data: holder, error: holderError } = await queryOne<{ id: string; name: string }>(
    holderSql,
    holderParams,
  )
  if (holderError) throw new Error(holderError.message)
  if (!holder) throw new Error('请选择这封邮件所属用户的持卡人')

  const { data: bank, error: bankError } = await queryOne<{ id: string }>(
    'SELECT id FROM banks WHERE name = ? LIMIT 1',
    [bankName],
  )
  if (bankError) throw new Error(bankError.message)

  let bankId = bank?.id
  let createdBank = false
  if (!bankId) {
    bankId = uuid()
    const { error: insertBankError } = await execute(
      'INSERT INTO banks (id, name, full_name, country, is_active) VALUES (?, ?, ?, ?, 1)',
      [bankId, bankName, bankName, country],
    )
    if (insertBankError) throw new Error(insertBankError.message)
    createdBank = true
  }

  const { data: product, error: productError } = await queryOne<{ id: string }>(
    'SELECT id FROM card_products WHERE bank_name = ? AND card_name = ? AND currency = ? AND is_active = 1 LIMIT 1',
    [bankName, cardName, currency],
  )
  if (productError) throw new Error(productError.message)

  let productId = product?.id
  let createdProduct = false
  if (!productId) {
    productId = uuid()
    const { error: insertProductError } = await execute(
      `INSERT INTO card_products
       (id, country, bank_id, bank_name, card_name, currency, payment_due_type, payment_due_value, is_active)
       VALUES (?, ?, ?, ?, ?, ?, 'after_billing', 20, 1)`,
      [productId, country, bankId, bankName, cardName, currency],
    )
    if (insertProductError) throw new Error(insertProductError.message)
    createdProduct = true
  }

  const { data: existingCard, error: cardError } = await queryOne<{ id: string }>(
    'SELECT id FROM credit_cards WHERE holder_id = ? AND card_number_last4 = ? LIMIT 1',
    [holder.id, tail],
  )
  if (cardError) throw new Error(cardError.message)

  let cardId = existingCard?.id
  let createdCard = false
  if (!cardId) {
    cardId = uuid()
    const { error: insertCardError } = await execute(
      `INSERT INTO credit_cards
       (id, holder_id, card_product_id, card_number_last4, credit_limit, billing_day, status, card_type)
       VALUES (?, ?, ?, ?, 0, ?, 'active', 'credit')`,
      [cardId, holder.id, productId, tail, statementDay(parsed.statement_date)],
    )
    if (insertCardError) throw new Error(insertCardError.message)
    createdCard = true
  }

  const dueDate = parsed.due_date ?? parsed.statement_date ?? `${billMonth}-28`
  const minPayment = parsed.min_payment == null ? null : Number(parsed.min_payment)
  const zeroBill = amount === 0
  const { data: existingBill, error: billError } = await queryOne<{
    id: string
    status: string | null
  }>('SELECT id, status FROM bills WHERE card_id = ? AND bill_month = ? LIMIT 1', [
    cardId,
    billMonth,
  ])
  if (billError) throw new Error(billError.message)

  let billId = existingBill?.id
  if (billId) {
    const { error: updateBillError } = await execute(
      'UPDATE bills SET bill_amount = ?, min_payment = ?, due_date = ?, statement_date = ?, status = ? WHERE id = ?',
      [
        amount,
        minPayment,
        dueDate,
        parsed.statement_date ?? null,
        nextStatus(existingBill?.status, zeroBill),
        billId,
      ],
    )
    if (updateBillError) throw new Error(updateBillError.message)
  } else {
    billId = uuid()
    const { error: insertBillError } = await execute(
      `INSERT INTO bills
       (id, card_id, bill_month, bill_amount, min_payment, due_date, statement_date, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        billId,
        cardId,
        billMonth,
        amount,
        minPayment,
        dueDate,
        parsed.statement_date ?? null,
        zeroBill ? 'paid' : 'unpaid',
      ],
    )
    if (insertBillError) throw new Error(insertBillError.message)
  }

  const note = [
    createdBank ? `已新建银行「${bankName}」；` : '',
    createdProduct ? `已新建卡产品「${cardName}」；` : '',
    createdCard ? `已新建卡片（尾号 ${tail}）；` : `已复用尾号 ${tail} 的卡片；`,
    `归属持卡人：${holder.name}；账单已写入`,
  ].join('')

  const { data: updateLogResult, error: updateLogError } = await execute(
    "UPDATE email_parse_logs SET status = 'success', bill_id = ?, error_msg = ? WHERE id = ? AND status = 'failed'",
    [billId, note, params.logId],
  )
  if (updateLogError) throw new Error(updateLogError.message)
  if ((updateLogResult?.changes ?? 0) !== 1) throw new Error('这封邮件已被其他操作处理')

  return { cardId, billId, holderName: holder.name, createdBank, createdProduct, createdCard }
}

// --- 银行管理 ---

export async function getAdminBanks() {
  const { data, error } = await query<Bank>('SELECT * FROM banks ORDER BY created_at DESC')
  if (error) throw new Error(error.message)
  return data as Bank[]
}

export async function createBank(payload: Partial<Bank>) {
  const id = uuid()
  const { error } = await execute(
    'INSERT INTO banks (id, name, short_name, full_name, logo_url, country, customer_service_phone, website_url, quota_mode, statement_mode, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, payload.name!, payload.short_name || null, payload.full_name || null, payload.logo_url || null, payload.country || 'CN',
     payload.customer_service_phone || null, payload.website_url || null,
     payload.quota_mode || 'independent', payload.statement_mode || 'independent',
     payload.is_active !== false ? 1 : 0]
  )
  if (error) throw new Error(error.message)
  const row = await queryOne<Bank>('SELECT * FROM banks WHERE id = ?', [id])
  return row.data as Bank
}

export async function updateBank(id: string, payload: Partial<Bank>) {
  const fields: string[] = []
  const params: unknown[] = []
  for (const key of ['name', 'short_name', 'full_name', 'logo_url', 'country', 'customer_service_phone', 'website_url', 'quota_mode', 'statement_mode']) {
    if (payload[key as keyof Bank] !== undefined) {
      fields.push(`${key} = ?`)
      params.push(payload[key as keyof Bank])
    }
  }
  if (fields.length === 0) throw new Error('没有需要更新的字段')
  params.push(id)
  const { error } = await execute(`UPDATE banks SET ${fields.join(', ')} WHERE id = ?`, params)
  if (error) throw new Error(error.message)
  const row = await queryOne<Bank>('SELECT * FROM banks WHERE id = ?', [id])
  return row.data as Bank
}

export async function deleteBank(id: string) {
  const { error } = await execute('DELETE FROM banks WHERE id = ?', [id])
  if (error) throw new Error(error.message)
}

// --- 卡产品管理 ---

export async function getAdminCardProducts() {
  const { data, error } = await query<Record<string, unknown>>(
    'SELECT * FROM card_products ORDER BY created_at DESC'
  )
  if (error) throw new Error(error.message)
  return (data || []).map(p => ({ ...(p as unknown as CardProduct), is_active: p.is_active === 1 }))
}

export async function createCardProduct(payload: Partial<CardProduct & { is_active: boolean }>) {
  const id = uuid()
  const { error } = await execute(
    `INSERT INTO card_products (id, country, bank_id, bank_name, card_name, card_image_id, description_md, apply_url, rewards_summary, currency, payment_due_type, payment_due_value, annual_fee, annual_fee_waiver, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, payload.country || 'CN', payload.bank_id || null, payload.bank_name!, payload.card_name!,
     payload.card_image_id || null, payload.description_md || null, payload.apply_url || null,
     payload.rewards_summary || null, payload.currency || 'CNY', payload.payment_due_type || 'after_billing',
     payload.payment_due_value || 20, payload.annual_fee || 0, payload.annual_fee_waiver || null,
     payload.is_active !== false ? 1 : 0]
  )
  if (error) throw new Error(error.message)
  const row = await queryOne<Record<string, unknown>>('SELECT * FROM card_products WHERE id = ?', [id])
  return row.data
}

export async function updateCardProduct(id: string, payload: Partial<CardProduct & { is_active: boolean }>) {
  const fields: string[] = []
  const params: unknown[] = []
  for (const key of ['country', 'bank_id', 'bank_name', 'card_name', 'card_image_id', 'description_md', 'apply_url', 'rewards_summary', 'currency', 'payment_due_type', 'payment_due_value', 'annual_fee', 'annual_fee_waiver']) {
    if (payload[key as keyof CardProduct] !== undefined) {
      fields.push(`${key} = ?`)
      params.push(payload[key as keyof CardProduct])
    }
  }
  if (payload.is_active !== undefined) {
    fields.push('is_active = ?')
    params.push(payload.is_active ? 1 : 0)
  }
  if (fields.length === 0) throw new Error('没有需要更新的字段')
  params.push(id)
  const { error } = await execute(`UPDATE card_products SET ${fields.join(', ')} WHERE id = ?`, params)
  if (error) throw new Error(error.message)
  const row = await queryOne<Record<string, unknown>>('SELECT * FROM card_products WHERE id = ?', [id])
  return row.data
}

export async function deleteCardProduct(id: string) {
  const { error } = await execute('DELETE FROM card_products WHERE id = ?', [id])
  if (error) throw new Error(error.message)
}

// --- 优惠活动管理 ---

interface PromoWithProduct extends Promo {
  product_bank_name?: string
  product_card_name?: string
}

export async function getAdminPromos() {
  const { data, error } = await query<Record<string, unknown>>(
    `SELECT pr.*, cp.bank_name AS product_bank_name, cp.card_name AS product_card_name
     FROM promos pr LEFT JOIN card_products cp ON pr.card_product_id = cp.id
     ORDER BY pr.created_at DESC`
  )
  if (error) throw new Error(error.message)
  return (data || []).map(p => ({ ...(p as unknown as PromoWithProduct), is_active: p.is_active === 1 }))
}

export async function createPromo(payload: Partial<Promo & { is_active: boolean }>) {
  const id = uuid()
  const { error } = await execute(
    `INSERT INTO promos (id, card_product_id, bank_name, title, description, discount_type, start_date, end_date, conditions, max_uses, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, payload.card_product_id || null, payload.bank_name!, payload.title!,
     payload.description || null, payload.discount_type || null, payload.start_date || null,
     payload.end_date || null, payload.conditions || null, payload.max_uses || null,
     payload.is_active !== false ? 1 : 0]
  )
  if (error) throw new Error(error.message)
  const row = await queryOne<Record<string, unknown>>('SELECT * FROM promos WHERE id = ?', [id])
  return row.data
}

export async function updatePromo(id: string, payload: Partial<Promo & { is_active: boolean }>) {
  const fields: string[] = []
  const params: unknown[] = []
  for (const key of ['card_product_id', 'bank_id', 'bank_name', 'title', 'description', 'discount_type', 'start_date', 'end_date', 'conditions', 'max_uses']) {
    if (payload[key as keyof Promo] !== undefined) {
      fields.push(`${key} = ?`)
      params.push(payload[key as keyof Promo])
    }
  }
  if (payload.is_active !== undefined) {
    fields.push('is_active = ?')
    params.push(payload.is_active ? 1 : 0)
  }
  if (fields.length === 0) throw new Error('没有需要更新的字段')
  params.push(id)
  const { error } = await execute(`UPDATE promos SET ${fields.join(', ')} WHERE id = ?`, params)
  if (error) throw new Error(error.message)
  const row = await queryOne<Record<string, unknown>>('SELECT * FROM promos WHERE id = ?', [id])
  return row.data
}

export async function deletePromo(id: string) {
  const { error } = await execute('DELETE FROM promos WHERE id = ?', [id])
  if (error) throw new Error(error.message)
}

// --- 权益管理 ---

export async function getAdminBenefits() {
  const { data, error } = await query<Record<string, unknown>>(
    `SELECT b.*, cp.bank_name AS product_bank_name, cp.card_name AS product_card_name
     FROM benefits b LEFT JOIN card_products cp ON b.card_product_id = cp.id
     ORDER BY b.created_at DESC`
  )
  if (error) throw new Error(error.message)
  return data || []
}

export async function createBenefit(payload: Partial<Benefit>) {
  const id = uuid()
  const { error } = await execute(
    `INSERT INTO benefits (id, card_product_id, name, description, quota, period, reset_month, expiry_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, payload.card_product_id!, payload.name!, payload.description || null, payload.quota || 1,
     payload.period || 'yearly', payload.reset_month || null, payload.expiry_date || null]
  )
  if (error) throw new Error(error.message)
  const row = await queryOne<Record<string, unknown>>('SELECT * FROM benefits WHERE id = ?', [id])
  return row.data
}

export async function updateBenefit(id: string, payload: Partial<Benefit>) {
  const fields: string[] = []
  const params: unknown[] = []
  for (const key of ['card_product_id', 'name', 'description', 'quota', 'period', 'reset_month', 'expiry_date']) {
    if (payload[key as keyof Benefit] !== undefined) {
      fields.push(`${key} = ?`)
      params.push(payload[key as keyof Benefit])
    }
  }
  if (fields.length === 0) throw new Error('没有需要更新的字段')
  params.push(id)
  const { error } = await execute(`UPDATE benefits SET ${fields.join(', ')} WHERE id = ?`, params)
  if (error) throw new Error(error.message)
  const row = await queryOne<Record<string, unknown>>('SELECT * FROM benefits WHERE id = ?', [id])
  return row.data
}

export async function deleteBenefit(id: string) {
  const { error } = await execute('DELETE FROM benefits WHERE id = ?', [id])
  if (error) throw new Error(error.message)
}

// --- 系统设置 ---

/**
 * 敏感设置键：任何角色（含 admin）都不得经由 RPC 拿到明文。
 *
 * getSystemSettings() 在服务端边界剥掉这些键，只留下 `<key>_set` 布尔标志，
 * 让管理端能区分「从未配置」与「已配置但不回显」。需要真值的服务端内部代码
 * 必须显式调用 getSystemSettingsWithSecrets()。
 */
const SECRET_SETTING_KEYS = ['ai_api_key'] as const

function isSecretSettingKey(key: string): boolean {
  return (SECRET_SETTING_KEYS as readonly string[]).includes(key)
}

/**
 * 服务端内部使用：返回**包含密钥**的原始设置。
 *
 * 绝对不要注册进 lib/api/registry.ts——一旦注册，密钥就会随 RPC 响应体
 * 回到浏览器（devtools / 内存 / 网络面板）。AI 调用只在服务端进行。
 */
export async function getSystemSettingsWithSecrets() {
  const { data, error } = await query<{ key: string; value: string }>(
    'SELECT key, value FROM system_settings'
  )
  if (error) throw new Error(error.message)
  const settings: Record<string, unknown> = {}
  for (const item of data || []) {
    try {
      settings[item.key] = JSON.parse(item.value!)
    } catch {
      settings[item.key] = item.value
    }
  }
  return settings
}

/**
 * RPC / 客户端可见的设置：密钥已在服务端剥离。
 *
 * 密钥不在响应里，也不出现在任何字符串字段中；只暴露 `ai_api_key_set`。
 */
export async function getSystemSettings() {
  const settings = await getSystemSettingsWithSecrets()
  for (const key of SECRET_SETTING_KEYS) {
    const value = settings[key]
    delete settings[key]
    settings[`${key}_set`] = typeof value === 'string' && value.length > 0
  }
  return settings
}

export async function updateSystemSettings(key: string, value: unknown) {
  const json = JSON.stringify(value)
  const { error } = await execute(
    `INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, json, now()]
  )
  if (error) throw new Error(error.message)
  // 写路径同样不得回显：管理员提交密钥后，响应里只回「是否已配置」，不回明文。
  if (isSecretSettingKey(key)) {
    return { key, value: null, [`${key}_set`]: typeof value === 'string' && value.length > 0 }
  }
  return { key, value }
}
