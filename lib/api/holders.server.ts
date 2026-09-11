// lib/api/holders.ts
import { query, queryOne, execute, uuid, now, batch } from '../db'
import type { CardHolder, CreditCard, Bill, CardProduct } from '../types'

export interface HolderStats {
  cardCount: number
  bankCount: number
  pendingAmount: number
  pendingCardCount: number
}

export interface HolderWithStats extends CardHolder {
  stats: HolderStats
}

export type CreditCardWithProduct = CreditCard & {
  card_product?: CardProduct
}

async function getCardsGroupedByHolder(holderIds: string[]): Promise<Record<string, CreditCardWithProduct[]>> {
  if (holderIds.length === 0) return {}
  const placeholders = holderIds.map(() => '?').join(',')
  const { data: cards, error } = await query<CreditCard & { card_product_id: string }>(
    `SELECT * FROM credit_cards WHERE holder_id IN (${placeholders})`,
    holderIds
  )
  if (error) throw new Error(error.message)
  if (!cards || cards.length === 0) return {}

  const productIds = Array.from(new Set(cards.map(c => c.card_product_id).filter(Boolean)))
  let productMap: Record<string, CardProduct> = {}

  if (productIds.length > 0) {
    const pPlaceholders = productIds.map(() => '?').join(',')
    const { data: products } = await query<CardProduct>(
      `SELECT * FROM card_products WHERE id IN (${pPlaceholders})`,
      productIds
    )
    if (products) {
      productMap = products.reduce((acc, p) => {
        acc[p.id] = p
        return acc
      }, {} as Record<string, CardProduct>)
    }
  }

  const grouped: Record<string, CreditCardWithProduct[]> = {}
  for (const card of cards) {
    const hid = card.holder_id as string
    if (!grouped[hid]) grouped[hid] = []
    grouped[hid].push({
      ...card,
      card_product: productMap[card.card_product_id]
    })
  }
  return grouped
}

async function getUnpaidBillsByCards(cardIds: string[]): Promise<Record<string, Bill[]>> {
  if (cardIds.length === 0) return {}
  const placeholders = cardIds.map(() => '?').join(',')
  const { data, error } = await query<Bill>(
    `SELECT * FROM bills WHERE card_id IN (${placeholders}) AND status IN ('unpaid', 'partial', 'overdue')`,
    cardIds
  )
  if (error) throw new Error(error.message)
  const grouped: Record<string, Bill[]> = {}
  for (const bill of (data || [])) {
    const cid = bill.card_id as string
    if (!grouped[cid]) grouped[cid] = []
    grouped[cid].push(bill)
  }
  return grouped
}

function computeStats(cards: CreditCardWithProduct[], billsByCard: Record<string, Bill[]>): HolderStats {
  const bankNames = new Set(cards.map(c => c.card_product?.bank_name).filter(Boolean))
  let pendingAmount = 0
  const pendingCardIds = new Set<string>()
  for (const card of cards) {
    const bills = billsByCard[card.id] || []
    for (const bill of bills) {
      pendingAmount += Number(bill.bill_amount) || 0
      pendingCardIds.add(card.id)
    }
  }
  return {
    cardCount: cards.length,
    bankCount: bankNames.size,
    pendingAmount,
    pendingCardCount: pendingCardIds.size,
  }
}

export async function getHolders(userId?: string): Promise<CardHolder[]> {
  const conditions: string[] = []
  const params: unknown[] = []
  if (userId) {
    // Admin sees holders they created; a member sees holders bound to their account.
    conditions.push('(created_by = ? OR auth_user_id = ?)')
    params.push(userId, userId)
  }
  const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : ''
  const { data, error } = await query<CardHolder>(
    `SELECT * FROM card_holders${where} ORDER BY created_at DESC`,
    params
  )
  if (error) throw new Error(error.message)
  return data || []
}

/** Card count per holder id, used by the holders management page. */
export async function getHolderCardCounts(
  holderIds: string[]
): Promise<Record<string, number>> {
  if (!holderIds || holderIds.length === 0) return {}
  const placeholders = holderIds.map(() => '?').join(',')
  const { data, error } = await query<{ holder_id: string; count: number }>(
    `SELECT holder_id, COUNT(*) AS count FROM credit_cards
     WHERE holder_id IN (${placeholders}) GROUP BY holder_id`,
    holderIds
  )
  if (error) throw new Error(error.message)
  const counts: Record<string, number> = {}
  for (const row of data || []) counts[row.holder_id] = row.count
  return counts
}

export async function getHoldersWithStats(userId?: string): Promise<HolderWithStats[]> {
  const holders = await getHolders(userId)
  if (holders.length === 0) return []

  const holderIds = holders.map(h => h.id)
  const cardsByHolder = await getCardsGroupedByHolder(holderIds)
  const allCardIds = Object.values(cardsByHolder).flat().map(c => c.id)
  const billsByCard = await getUnpaidBillsByCards(allCardIds)

  return holders.map(holder => {
    const cards = cardsByHolder[holder.id] || []
    const stats = computeStats(cards, billsByCard)
    return { ...holder, stats }
  })
}

export async function getHolder(id: string): Promise<CardHolder> {
  const { data, error } = await queryOne<CardHolder>(
    'SELECT * FROM card_holders WHERE id = ?', [id]
  )
  if (error) throw new Error(error.message)
  if (!data) throw new Error('持卡人不存在')
  return data
}

export async function getHolderDetailStats(holderId: string): Promise<{ cards: CreditCardWithProduct[]; stats: HolderStats }> {
  const cardsByHolder = await getCardsGroupedByHolder([holderId])
  const cards = cardsByHolder[holderId] || []
  const cardIds = cards.map(c => c.id)
  const billsByCard = await getUnpaidBillsByCards(cardIds)
  const stats = computeStats(cards, billsByCard)
  return { cards, stats }
}

/** Bind/unbind a holder to the user account matching the given email. */
async function syncHolderAuthUser(holderId: string, email?: string | null): Promise<void> {
  if (!email) {
    await execute('UPDATE card_holders SET auth_user_id = NULL WHERE id = ?', [holderId])
    return
  }
  const { data } = await queryOne<{ id: string }>('SELECT id FROM users WHERE lower(email) = lower(?)', [email])
  await execute('UPDATE card_holders SET auth_user_id = ? WHERE id = ?', [data?.id ?? null, holderId])
}

export async function createHolder(holder: Omit<CardHolder, 'id' | 'created_at'>): Promise<CardHolder> {
  const id = uuid()
  const ts = now()
  const { error } = await execute(
    'INSERT INTO card_holders (id, created_by, managed_by, name, phone, email, avatar_color, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [id, holder.created_by, holder.created_by, holder.name, holder.phone || null, holder.email || null, holder.avatar_color || '#1976d2', ts]
  )
  if (error) throw new Error(error.message)
  await syncHolderAuthUser(id, holder.email)
  return getHolder(id)
}

export async function updateHolder(id: string, updates: Partial<CardHolder>): Promise<CardHolder> {
  const fields: string[] = []
  const params: unknown[] = []
  const fieldMap: Record<string, unknown> = {
    name: updates.name,
    phone: updates.phone,
    email: updates.email,
    avatar_color: updates.avatar_color,
  }
  for (const [key, value] of Object.entries(fieldMap)) {
    if (value !== undefined) {
      fields.push(`${key} = ?`)
      params.push(value)
    }
  }
  if (fields.length === 0) throw new Error('没有需要更新的字段')
  params.push(id)
  const { error } = await execute(`UPDATE card_holders SET ${fields.join(', ')} WHERE id = ?`, params)
  if (error) throw new Error(error.message)
  if (updates.email !== undefined) await syncHolderAuthUser(id, updates.email)
  return getHolder(id)
}

export async function deleteHolder(id: string): Promise<void> {
  const { error } = await execute('DELETE FROM card_holders WHERE id = ?', [id])
  if (error) throw new Error(error.message)
}

/**
 * 将多个次要持卡人归拢合并到一个主持卡人下。
 * D1 batch is used for the transaction (all statements succeed or all fail).
 */
export async function mergeHolders(
  primaryHolderId: string,
  sourceHolderIds: string[]
): Promise<{ mergedCardsCount: number; updatedAliases: string[] }> {
  const uniqueSourceIds = Array.from(new Set(sourceHolderIds)).filter(id => id && id !== primaryHolderId)
  if (!primaryHolderId || uniqueSourceIds.length === 0) {
    return { mergedCardsCount: 0, updatedAliases: [] }
  }

  // 1. Move all cards from source holders to primary holder
  const sourcePlaceholders = uniqueSourceIds.map(() => '?').join(',')
  const { data: cards } = await query<{ id: string }>(
    `SELECT id FROM credit_cards WHERE holder_id IN (${sourcePlaceholders})`,
    uniqueSourceIds
  )
  const cardIds = (cards || []).map(c => c.id)

  if (cardIds.length === 0) {
    // No cards to merge — just delete the source holders
    const deletePlaceholders = uniqueSourceIds.map(() => '?').join(',')
    await execute(`DELETE FROM card_holders WHERE id IN (${deletePlaceholders})`, uniqueSourceIds)
    return { mergedCardsCount: 0, updatedAliases: [] }
  }

  // 2. Batch: move cards + delete source holders
  const cardPlaceholders = cardIds.map(() => '?').join(',')
  const deletePlaceholders = uniqueSourceIds.map(() => '?').join(',')
  const { error } = await batch([
    { sql: `UPDATE credit_cards SET holder_id = ? WHERE id IN (${cardPlaceholders})`, params: [primaryHolderId, ...cardIds] },
    { sql: `DELETE FROM card_holders WHERE id IN (${deletePlaceholders})`, params: uniqueSourceIds },
  ])
  if (error) throw new Error(error.message)

  return { mergedCardsCount: cardIds.length, updatedAliases: [] }
}

// --- Stats page data ---

export interface StatsPageSummary {
  totalLimit: number
  totalUsed: number
  availableLimit: number
  utilizationRate: number
}

export interface StatsPageQuickStats {
  cardCount: number
  monthlyBills: number
  pendingPayment: number
  overdueCount: number
}

export interface StatsPageTrend {
  month: string
  totalAmount: number
}

export interface StatsPageData {
  summary: StatsPageSummary
  quickStats: StatsPageQuickStats
  monthlyTrend: StatsPageTrend[]
}

export async function getHolderStatsPageData(holderId: string): Promise<StatsPageData> {
  const now = new Date()
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  // Fetch cards
  const { data: cards, error: cardError } = await query<CreditCard>(
    'SELECT * FROM credit_cards WHERE holder_id = ?', [holderId]
  )
  if (cardError) throw new Error(cardError.message)
  const allCards = (cards || []) as CreditCard[]
  const activeCards = allCards.filter(c => c.status === 'active')
  const cardIds = allCards.map(c => c.id)

  // Fetch bills
  let allBills: Bill[] = []
  if (cardIds.length > 0) {
    const placeholders = cardIds.map(() => '?').join(',')
    const { data: bills, error: billError } = await query<Bill>(
      `SELECT * FROM bills WHERE card_id IN (${placeholders})`, cardIds
    )
    if (billError) throw new Error(billError.message)
    allBills = (bills || []) as Bill[]
  }

  // Summary
  const totalLimit = activeCards.reduce((s, c) => s + (Number(c.credit_limit) || 0), 0)
  const unpaidStatuses: Bill['status'][] = ['unpaid', 'partial', 'overdue']
  const unpaidBills = allBills.filter(b => unpaidStatuses.includes(b.status))
  const totalUsed = unpaidBills.reduce((s, b) => s + (Number(b.bill_amount) || 0), 0)
  const availableLimit = Math.max(0, totalLimit - totalUsed)
  const utilizationRate = totalLimit > 0 ? Math.min(Math.round((totalUsed / totalLimit) * 100), 100) : 0

  // Quick stats
  const monthlyBills = allBills
    .filter(b => b.bill_month === currentMonth)
    .reduce((s, b) => s + (Number(b.bill_amount) || 0), 0)
  const pendingPayment = unpaidBills
    .filter(b => b.status !== 'overdue')
    .reduce((s, b) => s + (Number(b.bill_amount) || 0), 0)
  const overdueCount = allBills.filter(
    b => b.status === 'overdue' && new Date(b.due_date) < now
  ).length

  // 6-month trend
  const monthlyTrend: StatsPageTrend[] = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const totalAmount = allBills
      .filter(b => b.bill_month === month)
      .reduce((s, b) => s + (Number(b.bill_amount) || 0), 0)
    monthlyTrend.push({ month, totalAmount })
  }

  return {
    summary: { totalLimit, totalUsed, availableLimit, utilizationRate },
    quickStats: { cardCount: activeCards.length, monthlyBills, pendingPayment, overdueCount },
    monthlyTrend,
  }
}
