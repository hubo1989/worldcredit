// lib/api/holders.ts
import { db } from '../insforge'
import type { CardHolder, CreditCard, Bill } from '../types'

export interface HolderStats {
  cardCount: number
  bankCount: number
  pendingAmount: number
  pendingCardCount: number
}

export interface HolderWithStats extends CardHolder {
  stats: HolderStats
}

async function getCardsGroupedByHolder(holderIds: string[]): Promise<Record<string, CreditCard[]>> {
  if (holderIds.length === 0) return {}
  const { data, error } = await db
    .from('credit_cards')
    .select('*')
    .in('holder_id', holderIds)
  if (error) throw error
  const grouped: Record<string, CreditCard[]> = {}
  for (const card of (data || [])) {
    const hid = card.holder_id as string
    if (!grouped[hid]) grouped[hid] = []
    grouped[hid].push(card)
  }
  return grouped
}

async function getUnpaidBillsByCards(cardIds: string[]): Promise<Record<string, Bill[]>> {
  if (cardIds.length === 0) return {}
  const { data, error } = await db
    .from('bills')
    .select('*')
    .in('card_id', cardIds)
    .in('status', ['unpaid', 'partial', 'overdue'])
  if (error) throw error
  const grouped: Record<string, Bill[]> = {}
  for (const bill of (data || [])) {
    const cid = bill.card_id as string
    if (!grouped[cid]) grouped[cid] = []
    grouped[cid].push(bill)
  }
  return grouped
}

function computeStats(cards: CreditCard[], billsByCard: Record<string, Bill[]>): HolderStats {
  const bankNames = new Set(cards.map(c => c.bank_name))
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

export async function getHolders(_userId: string): Promise<CardHolder[]> {
  // TODO: Re-enable .eq('managed_by', userId) after running migration 001_add_managed_by.sql
  const { data, error } = await db
    .from('card_holders')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function getHoldersWithStats(userId: string): Promise<HolderWithStats[]> {
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
  const { data, error } = await db
    .from('card_holders')
    .select('*')
    .eq('id', id)
    .single()
  if (error) throw error
  return data
}

export async function getHolderDetailStats(holderId: string): Promise<{ cards: CreditCard[]; stats: HolderStats }> {
  const cardsByHolder = await getCardsGroupedByHolder([holderId])
  const cards = cardsByHolder[holderId] || []
  const cardIds = cards.map(c => c.id)
  const billsByCard = await getUnpaidBillsByCards(cardIds)
  const stats = computeStats(cards, billsByCard)
  return { cards, stats }
}

export async function createHolder(holder: Omit<CardHolder, 'id' | 'created_at'>): Promise<CardHolder> {
  const { data, error } = await db
    .from('card_holders')
    .insert(holder)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateHolder(id: string, updates: Partial<CardHolder>): Promise<CardHolder> {
  const { data, error } = await db
    .from('card_holders')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteHolder(id: string): Promise<void> {
  const { error } = await db
    .from('card_holders')
    .delete()
    .eq('id', id)
  if (error) throw error
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

  const { data: cards, error: cardError } = await db
    .from('credit_cards')
    .select('*')
    .eq('holder_id', holderId)
  if (cardError) throw cardError

  const allCards = (cards || []) as CreditCard[]
  const activeCards = allCards.filter(c => c.status === 'active')
  const cardIds = allCards.map(c => c.id)

  let allBills: Bill[] = []
  if (cardIds.length > 0) {
    const { data: bills, error: billError } = await db
      .from('bills')
      .select('*')
      .in('card_id', cardIds)
    if (billError) throw billError
    allBills = (bills || []) as Bill[]
  }

  const totalLimit = activeCards.reduce((s, c) => s + (Number(c.credit_limit) || 0), 0)
  const unpaidStatuses: Bill['status'][] = ['unpaid', 'partial', 'overdue']
  const unpaidBills = allBills.filter(b => unpaidStatuses.includes(b.status))
  const totalUsed = unpaidBills.reduce((s, b) => s + (Number(b.bill_amount) || 0), 0)
  const availableLimit = Math.max(0, totalLimit - totalUsed)
  const utilizationRate = totalLimit > 0 ? Math.min(Math.round((totalUsed / totalLimit) * 100), 100) : 0

  const monthlyBills = allBills
    .filter(b => b.bill_month === currentMonth)
    .reduce((s, b) => s + (Number(b.bill_amount) || 0), 0)
  const pendingPayment = unpaidBills
    .filter(b => b.status !== 'overdue')
    .reduce((s, b) => s + (Number(b.bill_amount) || 0), 0)
  const overdueCount = allBills.filter(
    b => b.status === 'overdue' && new Date(b.due_date) < now
  ).length

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
