import { query, queryOne, execute, uuid } from '../db'
import type { CardProduct, CreditCard, CardHolder, Bill, Benefit, BenefitUsage } from '@/lib/types'
import { normalizeAliases } from '../utils'

export type CreditCardWithProduct = CreditCard & {
  card_product?: CardProduct
  bank_name?: string
  card_name?: string
}

interface CardJoinRow {
  id: string
  holder_id: string
  card_product_id: string
  card_number_last4: string | null
  credit_limit: number
  billing_day: number
  status: string
  card_type: string
  loan_due_day: number | null
  override_billing_day: number | null
  override_due_type: string | null
  override_due_value: number | null
  name_override: string | null
  annual_fee_override: number | null
  created_at: string
  // product fields
  p_id: string | null
  p_country: string | null
  p_bank_id: string | null
  p_bank_name: string | null
  p_card_name: string | null
  p_currency: string | null
  p_payment_due_type: string | null
  p_payment_due_value: number | null
  p_annual_fee: number | null
  p_annual_fee_waiver: string | null
  p_is_active: number | null
  p_created_at: string | null
}

function joinRowToCard(row: CardJoinRow): CreditCardWithProduct {
  const card: CreditCardWithProduct = {
    id: row.id,
    holder_id: row.holder_id,
    card_product_id: row.card_product_id,
    card_number_last4: row.card_number_last4 || undefined,
    credit_limit: row.credit_limit,
    billing_day: row.billing_day,
    status: row.status as CreditCard['status'],
    card_type: row.card_type as CreditCard['card_type'],
    loan_due_day: row.loan_due_day || undefined,
    override_billing_day: row.override_billing_day || undefined,
    override_due_type: row.override_due_type as CreditCard['override_due_type'],
    override_due_value: row.override_due_value || undefined,
    name_override: row.name_override || undefined,
    annual_fee_override: row.annual_fee_override != null ? row.annual_fee_override : undefined,
    created_at: row.created_at,
  }
  if (row.p_id) {
    card.card_product = {
      id: row.p_id,
      country: row.p_country || 'CN',
      bank_id: row.p_bank_id || undefined,
      bank_name: row.p_bank_name || '',
      card_name: row.p_card_name || '',
      currency: row.p_currency || 'CNY',
      payment_due_type: (row.p_payment_due_type || 'after_billing') as CardProduct['payment_due_type'],
      payment_due_value: row.p_payment_due_value || 20,
      annual_fee: row.p_annual_fee || 0,
      annual_fee_waiver: row.p_annual_fee_waiver || undefined,
      is_active: row.p_is_active === 1,
      created_at: row.p_created_at || row.created_at,
    }
    card.bank_name = card.card_product.bank_name
    card.card_name = card.name_override || card.card_product.card_name
  }
  return card
}

const CARD_SELECT = `cc.id, cc.holder_id, cc.card_product_id, cc.card_number_last4, cc.credit_limit,
  cc.billing_day, cc.status, cc.card_type, cc.loan_due_day, cc.override_billing_day,
  cc.override_due_type, cc.override_due_value, cc.name_override, cc.annual_fee_override, cc.created_at,
  cp.id AS p_id, cp.country AS p_country, cp.bank_id AS p_bank_id, cp.bank_name AS p_bank_name,
  cp.card_name AS p_card_name, cp.currency AS p_currency, cp.payment_due_type AS p_payment_due_type,
  cp.payment_due_value AS p_payment_due_value, cp.annual_fee AS p_annual_fee,
  cp.annual_fee_waiver AS p_annual_fee_waiver, cp.is_active AS p_is_active, cp.created_at AS p_created_at
FROM credit_cards cc LEFT JOIN card_products cp ON cc.card_product_id = cp.id`

export async function getCardProducts(): Promise<CardProduct[]> {
  const { data, error } = await query<Record<string, unknown>>(
    'SELECT * FROM card_products WHERE is_active = 1 ORDER BY bank_name ASC'
  )
  if (error) throw new Error(error.message)
  return (data || []).map(p => ({ ...(p as unknown as CardProduct), is_active: p.is_active === 1 }))
}

export async function getCardHolders(): Promise<CardHolder[]> {
  const { data, error } = await query<CardHolder>(
    'SELECT * FROM card_holders ORDER BY created_at ASC'
  )
  if (error) throw new Error(error.message)
  // D1 把 aliases 存成 TEXT，读回来是 JSON 字符串；与 holders.server.ts 同样在读取边界归一化
  return (data || []).map(row => ({ ...row, aliases: normalizeAliases(row.aliases) }))
}

/** Light-weight card list (id + holder) used by the dashboard filter chips. */
export async function getCardsBasicByHolders(
  holderIds: string[]
): Promise<Array<{ id: string; holder_id: string }>> {
  if (!holderIds || holderIds.length === 0) return []
  const placeholders = holderIds.map(() => '?').join(',')
  const { data, error } = await query<{ id: string; holder_id: string }>(
    `SELECT id, holder_id FROM credit_cards WHERE holder_id IN (${placeholders})`,
    holderIds
  )
  if (error) throw new Error(error.message)
  return data || []
}

/** All cards joined with their product, for bill entry forms. */
export async function getAllCardsWithProduct(): Promise<CreditCardWithProduct[]> {
  const { data, error } = await query<CardJoinRow>(
    `SELECT ${CARD_SELECT} ORDER BY cc.created_at DESC`
  )
  if (error) throw new Error(error.message)
  return (data || []).map(joinRowToCard)
}

export interface CardDetailBill extends Bill {
  paid_amount: number
  computed_status: Bill['status']
}

export interface CardDetailBenefit extends Benefit {
  used: number
}

export interface CardDetail {
  card: CreditCardWithProduct & {
    card_holder?: CardHolder
  }
  bills: CardDetailBill[]
  benefits: CardDetailBenefit[]
}

function computeBillStatus(billAmount: number, paid: number, dueDate: string): Bill['status'] {
  const amount = Number(billAmount) || 0
  if (amount <= 0 || paid >= amount) return 'paid'
  if (paid > 0) return 'partial'
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const due = new Date(dueDate)
  due.setHours(0, 0, 0, 0)
  return due.getTime() < today.getTime() ? 'overdue' : 'unpaid'
}

/** Card detail page aggregate: card + product + holder, recent bills with
 *  payment totals, and per-period benefit usage counts. */
export async function getCardDetail(cardId: string): Promise<CardDetail> {
  const base = await getCardById(cardId)
  if (!base) throw new Error('卡片不存在')

  const card: CardDetail['card'] = { ...base }
  if (base.holder_id) {
    const { data: holderRow, error } = await queryOne<CardHolder>(
      'SELECT * FROM card_holders WHERE id = ?',
      [base.holder_id]
    )
    if (!error && holderRow) card.card_holder = holderRow
  }

  const { data: billRows, error: billsError } = await query<Bill>(
    // 手填金额优先：SQL 层直接归一化，避免下游各自合成时漏掉一处
    `SELECT id, card_id, bill_month, statement_start, statement_end, statement_date,
            COALESCE(bill_amount_override, bill_amount) AS bill_amount,
            bill_amount_override, min_payment, due_date, status, created_at
     FROM bills WHERE card_id = ? ORDER BY due_date DESC LIMIT 3`,
    [cardId]
  )
  if (billsError) throw new Error(billsError.message)
  const bills = billRows || []
  const billIds = bills.map(b => b.id)
  let paidByBill = new Map<string, number>()
  if (billIds.length > 0) {
    const placeholders = billIds.map(() => '?').join(',')
    const { data: payRows, error: payError } = await query<{ bill_id: string; amount: number }>(
      `SELECT bill_id, amount FROM payments WHERE bill_id IN (${placeholders})`,
      billIds
    )
    if (payError) throw new Error(payError.message)
    paidByBill = new Map<string, number>()
    for (const p of payRows || []) {
      paidByBill.set(p.bill_id, (paidByBill.get(p.bill_id) || 0) + Number(p.amount || 0))
    }
  }
  const billList: CardDetailBill[] = bills.map(b => {
    const paid = paidByBill.get(b.id) || 0
    return {
      ...b,
      paid_amount: paid,
      computed_status: computeBillStatus(Number(b.bill_amount) || 0, paid, b.due_date),
    }
  })

  const benefits: CardDetailBenefit[] = []
  if (base.card_product_id) {
    const { data: benefitRows, error: benError } = await query<Benefit>(
      'SELECT * FROM benefits WHERE card_product_id = ?',
      [base.card_product_id]
    )
    if (benError) throw new Error(benError.message)
    const bs = benefitRows || []
    if (bs.length > 0) {
      const ids = bs.map(b => b.id)
      const placeholders = ids.map(() => '?').join(',')
      const { data: usageRows, error: usageError } = await query<Pick<BenefitUsage, 'benefit_id' | 'used_at'>>(
        `SELECT benefit_id, used_at FROM benefit_usages WHERE benefit_id IN (${placeholders})`,
        ids
      )
      if (usageError) throw new Error(usageError.message)
      const allUsages = usageRows || []
      const nowDate = new Date()
      for (const b of bs) {
        const periodUsages = allUsages.filter(u => {
          if (u.benefit_id !== b.id) return false
          if (!u.used_at) return false
          if (b.period === 'one_time') return true
          const d = new Date(u.used_at)
          if (b.period === 'monthly') {
            return d.getMonth() === nowDate.getMonth() && d.getFullYear() === nowDate.getFullYear()
          }
          // yearly
          const resetMonth = b.reset_month || 1
          const startY = nowDate.getMonth() + 1 >= resetMonth ? nowDate.getFullYear() : nowDate.getFullYear() - 1
          const start = new Date(startY, resetMonth - 1, 1)
          return d >= start
        })
        benefits.push({ ...b, used: periodUsages.length })
      }
    }
  }

  return { card, bills: billList, benefits }
}

export async function getCardsByHolder(holderId: string): Promise<CreditCardWithProduct[]> {
  const { data, error } = await query<CardJoinRow>(
    `SELECT ${CARD_SELECT} WHERE cc.holder_id = ? ORDER BY cc.created_at DESC`,
    [holderId]
  )
  if (error) throw new Error(error.message)
  return (data || []).map(joinRowToCard)
}

export async function createCard(card: Omit<CreditCard, 'id' | 'created_at'>): Promise<CreditCardWithProduct> {
  const id = uuid()
  const { error } = await execute(
    `INSERT INTO credit_cards (id, holder_id, card_product_id, card_number_last4, credit_limit, billing_day, status, card_type, loan_due_day, override_billing_day, override_due_type, override_due_value)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, card.holder_id, card.card_product_id, card.card_number_last4 || null, card.credit_limit,
     card.billing_day, card.status || 'active', card.card_type || 'credit', card.loan_due_day || null,
     card.override_billing_day || null, card.override_due_type || null, card.override_due_value || null]
  )
  if (error) throw new Error(error.message)
  const created = await getCardById(id)
  if (!created) throw new Error('卡片创建失败')
  return created
}

async function getCardById(id: string): Promise<CreditCardWithProduct | null> {
  const { data, error } = await queryOne<CardJoinRow>(
    `SELECT ${CARD_SELECT} WHERE cc.id = ?`, [id]
  )
  if (error || !data) return null
  return joinRowToCard(data)
}

export async function updateCard(
  id: string,
  patch: Partial<Omit<CreditCard, 'id' | 'created_at'>>
): Promise<CreditCardWithProduct> {
  const fields: string[] = []
  const params: unknown[] = []
  const fieldMap: Record<string, unknown> = {
    card_number_last4: patch.card_number_last4,
    credit_limit: patch.credit_limit,
    billing_day: patch.billing_day,
    status: patch.status,
    card_type: patch.card_type,
    loan_due_day: patch.loan_due_day,
    override_billing_day: patch.override_billing_day,
    override_due_type: patch.override_due_type,
    override_due_value: patch.override_due_value,
    name_override: patch.name_override,
    annual_fee_override: patch.annual_fee_override,
  }
  for (const [key, value] of Object.entries(fieldMap)) {
    if (value !== undefined) {
      fields.push(`${key} = ?`)
      params.push(value)
    }
  }
  if (fields.length === 0) throw new Error('没有需要更新的字段')
  params.push(id)
  const { error } = await execute(`UPDATE credit_cards SET ${fields.join(', ')} WHERE id = ?`, params)
  if (error) throw new Error(error.message)
  const updated = await getCardById(id)
  if (!updated) throw new Error('卡片更新失败')
  return updated
}

export async function deleteCard(id: string): Promise<void> {
  const { error } = await execute('DELETE FROM credit_cards WHERE id = ?', [id])
  if (error) throw new Error(error.message)
}
