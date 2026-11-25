import { batch, execute, query, queryOne, uuid, now, D1_MAX_BIND_PARAMS } from '../db'
import { normalizeCurrency } from '../fx'
import type { BillItem, MerchantCategoryRule } from '../types'
import { isValidCalendarDate } from '../utils'
import { BILL_ITEM_SOURCES, BILL_ITEM_TYPES, MAX_IMPORT_ITEMS, normalizeBillItemInput, type BillItemInput } from '../finance/bill-item-import'
import { mapExplicitCategory, normalizeMerchantKey, type MerchantRules } from '../finance/categories'
import { RpcDomainError } from './errors'
import { assertBillAccess, MemberScopeError, type MemberContext } from './member-scope'

interface BillItemScope {
  card_id: string
  account_id: string | null
  holder_id: string
  currency: string
  statement_mode: string | null
  managed_by: string
}

interface AttributionCard {
  id: string
  card_number_last4: string | null
}

type EditableFields = Pick<BillItemInput, 'card_id' | 'card_tail' | 'description' | 'merchant_name' |
  'transaction_date' | 'post_date' | 'amount' | 'currency' | 'item_type' | 'category'>
export interface UpdateBillItemPatch extends Partial<EditableFields> {
  remember_merchant?: boolean
  user_id?: string
}

interface ItemActor {
  remember_merchant?: boolean
  user_id?: string
}

const validation = (message: string) => new RpcDomainError('VALIDATION_FAILED', message)

async function billItemScope(billId: string): Promise<BillItemScope> {
  const { data, error } = await queryOne<BillItemScope>(
    'SELECT b.card_id, b.account_id, c.holder_id, p.currency, a.statement_mode, h.managed_by ' +
    'FROM bills b JOIN credit_cards c ON c.id = b.card_id JOIN card_products p ON p.id = c.card_product_id ' +
    'JOIN card_holders h ON h.id = c.holder_id LEFT JOIN credit_accounts a ON a.id = b.account_id WHERE b.id = ?',
    [billId],
  )
  if (error) throw new Error(error.message)
  if (!data) throw new RpcDomainError('NOT_FOUND', '账单不存在')
  return data
}

async function attributionCards(scope: BillItemScope): Promise<AttributionCard[]> {
  const { data, error } = await query<AttributionCard>(
    'SELECT id, card_number_last4 FROM credit_cards WHERE id = ? OR (account_id = ? AND holder_id = ?)',
    [scope.card_id, scope.statement_mode === 'merged' ? scope.account_id : null, scope.holder_id],
  )
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function assertBillItemAccess(itemId: unknown, ctx: MemberContext): Promise<void> {
  if (typeof itemId !== 'string') throw new MemberScopeError('参数必须是账单明细 ID')
  const { data } = await queryOne<{ bill_id: string }>('SELECT bill_id FROM bill_items WHERE id = ?', [itemId])
  if (!data) throw new MemberScopeError('无权访问该账单明细')
  await assertBillAccess(data.bill_id, ctx)
}

export async function getMerchantCategoryRules(userId?: string): Promise<MerchantCategoryRule[]> {
  if (!userId) return []
  const { data, error } = await query<MerchantCategoryRule>(
    'SELECT * FROM merchant_category_rules WHERE user_id = ? ORDER BY normalized_merchant', [userId],
  )
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function getBillItems(billId: string): Promise<BillItem[]> {
  const { data, error } = await query<BillItem>(
    'SELECT * FROM bill_items WHERE bill_id = ? ORDER BY transaction_date DESC, created_at ASC, id ASC',
    [billId],
  )
  if (error) throw new Error(error.message)
  return data ?? []
}

function validateInput(item: BillItemInput): void {
  if (!item || typeof item.description !== 'string' || !item.description.trim()) throw validation('请输入交易摘要')
  if (!Number.isFinite(item.amount) || !Number.isSafeInteger(Math.round(item.amount * 100))) {
    throw validation('交易金额无效')
  }
  if (item.item_type != null && !BILL_ITEM_TYPES.includes(item.item_type)) throw validation('交易类型无效')
  if (item.source != null && !BILL_ITEM_SOURCES.includes(item.source)) throw validation('明细来源无效')
  if (item.currency != null && !normalizeCurrency(item.currency)) throw validation('币种代码无效')
  for (const day of [item.transaction_date, item.post_date]) {
    if (day != null && !isValidCalendarDate(day)) throw validation('交易或入账日期无效')
  }
  for (const value of [item.merchant_name, item.category, item.card_id, item.card_tail, item.raw_text]) {
    if (value != null && typeof value !== 'string') throw validation('明细文本字段无效')
  }
  if (item.confidence != null && !Number.isFinite(item.confidence)) throw validation('明细置信度无效')
}

export function validateBillItemImport(items: unknown): asserts items is BillItemInput[] {
  if (!Array.isArray(items) || items.length > MAX_IMPORT_ITEMS) {
    throw validation('单次最多导入 ' + MAX_IMPORT_ITEMS + ' 条账单明细')
  }
  for (const item of items) validateInput(item)
}

function itemCard(input: BillItemInput, cards: readonly AttributionCard[]) {
  const tail = input.card_tail?.trim() || null
  if (input.card_id) {
    const selected = cards.find(card => card.id === input.card_id)
    if (!selected) throw validation('归属卡片不属于该账单')
    if (tail && selected.card_number_last4 && tail !== selected.card_number_last4) {
      throw validation('卡尾号与归属卡片不一致')
    }
    return { card_id: selected.id, card_tail: tail ?? selected.card_number_last4 }
  }
  const matches = tail ? cards.filter(card => card.card_number_last4 === tail) : []
  return { card_id: matches.length === 1 ? matches[0].id : null, card_tail: tail }
}

function normalizeForWrite(
  input: BillItemInput, scope: BillItemScope, rules: MerchantRules, cards: readonly AttributionCard[],
) {
  validateInput(input)
  const item = normalizeBillItemInput(input, rules, scope.currency)
  const category = input.category === null ? null
    : item.source === 'manual' || item.source === 'csv' || item.source === 'text'
      ? mapExplicitCategory(input.category) ?? item.category
      : item.category
  return {
    ...itemCard(input, cards),
    transaction_date: item.transaction_date ?? null,
    post_date: item.post_date ?? null,
    description: item.description,
    merchant_name: item.merchant_name ?? null,
    category,
    amount: item.amount,
    currency: item.currency,
    item_type: item.item_type,
    source: item.source,
    confidence: item.confidence ?? null,
    raw_text: item.raw_text ?? null,
    metadata: typeof item.metadata === 'string' ? item.metadata
      : item.metadata == null ? null : JSON.stringify(item.metadata),
  }
}

export async function prepareBillItemInserts(
  billId: string, scope: BillItemScope, items: BillItemInput[], userId?: string,
) {
  validateBillItemImport(items)
  if (!items.length) return { rows: [], statements: [] }
  const [rules, cards] = await Promise.all([
    getMerchantCategoryRules(userId ?? scope.managed_by),
    items.some(item => item.card_id || item.card_tail) ? attributionCards(scope) : [],
  ])
  const ruleMap = new Map(rules.map(rule => [rule.normalized_merchant, rule.category]))
  const timestamp = now()
  const rows: BillItem[] = items.map(input => ({
    id: uuid(), bill_id: billId,
    ...normalizeForWrite(input, scope, ruleMap, cards),
    updated_at: timestamp, created_at: timestamp,
  }))

  const columns = [
    'id', 'card_id', 'card_tail', 'transaction_date', 'post_date', 'description', 'merchant_name',
    'category', 'amount', 'currency', 'item_type', 'source', 'confidence', 'raw_text', 'metadata',
  ] as const
  // Reuse the shared bill ID and timestamp in each statement. A maximum-size import
  // fits in one transaction and every statement stays under D1's bind limit.
  const rowsPerStatement = Math.floor((D1_MAX_BIND_PARAMS - 2) / columns.length)
  const statements = []
  for (let index = 0; index < rows.length; index += rowsPerStatement) {
    const chunk = rows.slice(index, index + rowsPerStatement)
    const placeholders = chunk.map((_, rowIndex) => {
      const fields = columns.map((_, fieldIndex) => '?' + (3 + rowIndex * columns.length + fieldIndex))
      return ' (?1, ?2, ?2, ' + fields.join(', ') + ')'
    })
    statements.push({
      sql: 'INSERT INTO bill_items (bill_id, updated_at, created_at, ' + columns.join(', ') + ') VALUES' +
        placeholders.join(','),
      params: [billId, timestamp, ...chunk.flatMap(row => columns.map(column => row[column]))],
    })
  }
  return { rows, statements }
}

function rememberMerchant(item: Pick<BillItem, 'merchant_name' | 'description' | 'category'>, actor: ItemActor) {
  if (!actor.remember_merchant || !actor.user_id || !item.category) return []
  const merchant = item.merchant_name || item.description
  const key = normalizeMerchantKey(merchant)
  if (!key) return []
  return [{
    sql: 'INSERT INTO merchant_category_rules (id, user_id, normalized_merchant, display_merchant, category, updated_at) ' +
      'SELECT ?, ?, ?, ?, ?, ? WHERE changes() > 0 ' +
      'ON CONFLICT(user_id, normalized_merchant) DO UPDATE SET display_merchant = excluded.display_merchant, ' +
      'category = excluded.category, updated_at = excluded.updated_at',
    params: [uuid(), actor.user_id, key, merchant, item.category, now()],
  }]
}

export async function createBillItem(input: BillItemInput & ItemActor & { bill_id: string }): Promise<BillItem> {
  if (!input || typeof input.bill_id !== 'string') throw validation('请输入账单 ID')
  const scope = await billItemScope(input.bill_id)
  const { rows: [item], statements } = await prepareBillItemInserts(input.bill_id, scope, [input], input.user_id)
  const { error } = await batch([...statements, ...rememberMerchant(item, input)])
  if (error) throw new Error(error.message)
  return item
}

export async function batchImportBillItems(input: { bill_id: string; items: BillItemInput[]; user_id?: string }) {
  if (!input || typeof input.bill_id !== 'string') throw validation('请输入账单 ID')
  validateBillItemImport(input.items)
  const scope = await billItemScope(input.bill_id)
  const { rows, statements } = await prepareBillItemInserts(input.bill_id, scope, input.items, input.user_id)
  if (statements.length) {
    const { error } = await batch(statements)
    if (error) throw new Error(error.message)
  }
  return { inserted: rows.length, items: rows }
}

export async function updateBillItem(itemId: string, patch: UpdateBillItemPatch): Promise<BillItem> {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw validation('请输入明细修改字段')
  const { data: old, error: readError } = await queryOne<BillItem>('SELECT * FROM bill_items WHERE id = ?', [itemId])
  if (readError) throw new Error(readError.message)
  if (!old) throw new RpcDomainError('NOT_FOUND', '账单明细不存在')
  const scope = await billItemScope(old.bill_id)
  const attributionChanged = patch.card_id !== undefined || patch.card_tail !== undefined
  const cards = attributionChanged ? await attributionCards(scope) : []
  const normalized = normalizeForWrite({
    ...old,
    description: patch.description === undefined ? old.description : patch.description,
    amount: patch.amount === undefined ? old.amount : patch.amount,
    transaction_date: patch.transaction_date,
    post_date: patch.post_date,
    merchant_name: patch.merchant_name === undefined ? old.merchant_name : patch.merchant_name,
    item_type: patch.item_type === undefined ? old.item_type : patch.item_type,
    currency: patch.currency === undefined ? normalizeCurrency(old.currency) : patch.currency,
    category: patch.category === undefined ? old.category : patch.category,
    card_id: attributionChanged ? patch.card_id : null,
    card_tail: attributionChanged ? patch.card_tail : null,
  }, scope, new Map(), cards)
  const saved = {
    description: normalized.description,
    amount: normalized.amount,
    transaction_date: patch.transaction_date === undefined ? old.transaction_date : normalized.transaction_date,
    post_date: patch.post_date === undefined ? old.post_date : normalized.post_date,
    merchant_name: normalized.merchant_name,
    item_type: normalized.item_type,
    currency: normalized.currency,
    category: patch.category === undefined ? old.category : normalized.category,
    card_id: attributionChanged ? normalized.card_id : old.card_id,
    card_tail: attributionChanged ? normalized.card_tail : old.card_tail,
    updated_at: now(),
  }
  const columns = Object.keys(saved) as Array<keyof typeof saved>
  const { data, error } = await batch([{
    sql: 'UPDATE bill_items SET ' + columns.map(key => key + ' = ?').join(', ') +
      ' WHERE id = ? AND bill_id = ? AND ' + columns.map(key => key + ' IS ?').join(' AND ') + ' RETURNING *',
    params: [...columns.map(key => saved[key]), itemId, old.bill_id, ...columns.map(key => old[key])],
  }, ...rememberMerchant(saved, patch)])
  if (error) throw new Error(error.message)
  const item = data?.[0]?.results[0] as BillItem | undefined
  if (!item) throw new RpcDomainError('CONFLICT', '账单明细已变更，请刷新后重试')
  return item
}

export async function deleteBillItem(itemId: string): Promise<{ ok: true }> {
  const { error } = await execute('DELETE FROM bill_items WHERE id = ?', [itemId])
  if (error) throw new Error(error.message)
  return { ok: true }
}

export async function clearBillItems(billId: string): Promise<{ deleted: number }> {
  const { data, error } = await execute('DELETE FROM bill_items WHERE bill_id = ?', [billId])
  if (error) throw new Error(error.message)
  return { deleted: data?.changes ?? 0 }
}
