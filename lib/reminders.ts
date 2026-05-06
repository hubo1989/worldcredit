// lib/reminders.ts
import { db } from './insforge'
import type { CreditCard, Bill, Promo, Benefit } from './types'

export type ReminderType = 'bill_due' | 'bill_overdue' | 'promo_expiring' | 'benefit_expiring' | 'annual_fee_attention'
export type ReminderSeverity = 'critical' | 'high' | 'medium' | 'low'

export interface Reminder {
  key: string
  type: ReminderType
  severity: ReminderSeverity
  title: string
  description: string
  actionUrl: string
  holderName: string
  bankName: string
  cardName?: string
  amount?: number
  dueDate?: string
  expiryDate?: string
  currency?: string
}

interface BillWithCard extends Bill {
  credit_cards: Pick<CreditCard, 'bank_name' | 'card_name' | 'card_number_last4' | 'currency' | 'holder_id'>
}

interface PromoWithCard extends Promo {
  credit_cards?: Pick<CreditCard, 'bank_name' | 'card_name' | 'holder_id'>
}

interface BenefitWithCard extends Benefit {
  credit_cards: Pick<CreditCard, 'bank_name' | 'card_name' | 'holder_id'>
}

interface CardWithHolder extends CreditCard {
  card_holders: { name: string }
}

/**
 * Calculate days until a date (negative if past)
 */
function daysUntil(dateStr: string): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(dateStr)
  target.setHours(0, 0, 0, 0)
  return Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
}

/**
 * Get severity for days until deadline
 */
function getSeverityForDays(days: number): ReminderSeverity {
  if (days < 0) return 'critical'
  if (days === 0) return 'critical'
  if (days <= 1) return 'high'
  if (days <= 3) return 'medium'
  return 'low'
}

/**
 * Calculate bill-related reminders
 */
async function getBillReminders(
  unpaidBills: BillWithCard[],
  holders: Map<string, string>
): Promise<Reminder[]> {
  const reminders: Reminder[] = []
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  for (const bill of unpaidBills) {
    if (!bill.due_date) continue

    const days = daysUntil(bill.due_date)
    const holderName = holders.get(bill.credit_cards.holder_id) || '未知持卡人'
    const { bank_name, card_name, currency } = bill.credit_cards

    // Overdue bills
    if (days < 0 && bill.status !== 'paid') {
      reminders.push({
        key: `bill_overdue:${bill.id}`,
        type: 'bill_overdue',
        severity: 'critical',
        title: '账单已逾期',
        description: `${bank_name} ${card_name} 账单 ${Math.abs(days)} 天前到期，金额 ${bill.bill_amount} ${currency}`,
        actionUrl: `/bills/${bill.id}`,
        holderName,
        bankName: bank_name,
        cardName: card_name,
        amount: bill.bill_amount,
        dueDate: bill.due_date,
        currency,
      })
    }
    // Bills due within 3 days
    else if (days >= 0 && days <= 3 && bill.status !== 'paid') {
      const severity = getSeverityForDays(days)
      const dayText = days === 0 ? '今天' : days === 1 ? '明天' : `${days}天后`
      reminders.push({
        key: `bill_due:${bill.id}`,
        type: 'bill_due',
        severity,
        title: `账单${dayText}到期`,
        description: `${bank_name} ${card_name} 账单 ${dayText}到期，金额 ${bill.bill_amount} ${currency}`,
        actionUrl: `/bills/${bill.id}`,
        holderName,
        bankName: bank_name,
        cardName: card_name,
        amount: bill.bill_amount,
        dueDate: bill.due_date,
        currency,
      })
    }
  }

  return reminders
}

/**
 * Calculate promo expiry reminders
 */
async function getPromoReminders(
  promos: PromoWithCard[],
  holders: Map<string, string>
): Promise<Reminder[]> {
  const reminders: Reminder[] = []

  for (const promo of promos) {
    if (!promo.end_date) continue

    const days = daysUntil(promo.end_date)
    if (days < 0 || days > 7) continue

    const holderName = promo.credit_cards
      ? holders.get(promo.credit_cards.holder_id) || '未知持卡人'
      : '全家'

    reminders.push({
      key: `promo_expiring:${promo.id}`,
      type: 'promo_expiring',
      severity: days <= 1 ? 'high' : 'medium',
      title: `优惠${days === 0 ? '今天' : `${days}天后`}到期`,
      description: `${promo.bank_name} ${promo.title} ${days === 0 ? '今天' : `${days}天后`}到期`,
      actionUrl: promo.card_id ? `/cards/${promo.card_id}` : '/promos',
      holderName,
      bankName: promo.bank_name,
      expiryDate: promo.end_date,
    })
  }

  return reminders
}

/**
 * Calculate benefit expiry reminders
 */
async function getBenefitReminders(
  benefits: BenefitWithCard[],
  holders: Map<string, string>
): Promise<Reminder[]> {
  const reminders: Reminder[] = []

  for (const benefit of benefits) {
    if (!benefit.expiry_date) continue

    const days = daysUntil(benefit.expiry_date)
    if (days < 0 || days > 30) continue

    const holderName = holders.get(benefit.credit_cards.holder_id) || '未知持卡人'
    const { bank_name, card_name } = benefit.credit_cards

    reminders.push({
      key: `benefit_expiring:${benefit.id}`,
      type: 'benefit_expiring',
      severity: days <= 7 ? 'medium' : 'low',
      title: `权益${days <= 7 ? `${days}天后` : '即将'}到期`,
      description: `${bank_name} ${card_name} ${benefit.name} ${days <= 7 ? `${days}天后` : '即将'}到期`,
      actionUrl: `/cards/${benefit.card_id}`,
      holderName,
      bankName: bank_name,
      cardName: card_name,
      expiryDate: benefit.expiry_date,
    })
  }

  return reminders
}

/**
 * Calculate annual fee attention reminders
 */
async function getAnnualFeeReminders(
  cards: CardWithHolder[],
  holders: Map<string, string>
): Promise<Reminder[]> {
  const reminders: Reminder[] = []
  const currentYear = new Date().getFullYear()

  for (const card of cards) {
    // Only cards with annual fee
    if (!card.annual_fee || card.annual_fee <= 0) continue

    // Cards with waiver conditions
    if (!card.annual_fee_waiver) continue

    const holderName = holders.get(card.id) || card.card_holders.name || '未知持卡人'

    reminders.push({
      key: `annual_fee:${card.id}:${currentYear}`,
      type: 'annual_fee_attention',
      severity: 'low',
      title: '年费条件待关注',
      description: `${card.bank_name} ${card.card_name} 年费 ${card.annual_fee} ${card.currency}，减免条件：${card.annual_fee_waiver}`,
      actionUrl: `/cards/${card.id}`,
      holderName,
      bankName: card.bank_name,
      cardName: card.card_name,
      amount: card.annual_fee,
      currency: card.currency,
    })
  }

  return reminders
}

/**
 * Main function to calculate all reminders for a user
 */
export async function calculateReminders(
  userId: string,
  role: 'admin' | 'member',
  managedHolderIds?: string[]
): Promise<Reminder[]> {
  // Get holder names map
  let holdersQuery = db
    .from('card_holders')
    .select('id, name')

  if (role === 'member' && managedHolderIds) {
    holdersQuery = holdersQuery.in('id', managedHolderIds.length > 0 ? managedHolderIds : ['00000000-0000-0000-0000-000000000000'])
  }

  const { data: holders } = await holdersQuery
  const holderMap = new Map(holders?.map(h => [h.id, h.name]) || [])

  // Get unpaid bills with card info
  const { data: bills } = await db
    .from('bills')
    .select('*, credit_cards(bank_name, card_name, card_number_last4, currency, holder_id)')
    .in('status', ['unpaid', 'partial', 'overdue'])

  // Filter bills by holder access
  let filteredBills = bills || []
  if (role === 'member' && managedHolderIds) {
    filteredBills = filteredBills.filter(b => managedHolderIds.includes(b.credit_cards.holder_id))
  }

  // Get active promos with card info
  const today = new Date().toISOString().split('T')[0]
  const { data: promos } = await db
    .from('promos')
    .select('*, credit_cards(bank_name, card_name, holder_id)')
    .or(`end_date.is.null,end_date.gte.${today}`)
    .order('end_date', { ascending: true })

  // Filter promos by holder access
  let filteredPromos = promos || []
  if (role === 'member' && managedHolderIds) {
    filteredPromos = filteredPromos.filter(p => !p.credit_cards || managedHolderIds.includes(p.credit_cards.holder_id))
  }

  // Get benefits with card info
  const { data: benefits } = await db
    .from('benefits')
    .select('*, credit_cards(bank_name, card_name, holder_id)')
    .not('expiry_date', 'is', null)
    .order('expiry_date', { ascending: true })

  // Filter benefits by holder access
  let filteredBenefits = benefits || []
  if (role === 'member' && managedHolderIds) {
    filteredBenefits = filteredBenefits.filter(b => managedHolderIds.includes(b.credit_cards.holder_id))
  }

  // Get cards with annual fee
  let cardsQuery = db
    .from('credit_cards')
    .select('*, card_holders(name)')
    .gt('annual_fee', 0)
    .not('annual_fee_waiver', 'is', null)

  if (role === 'member' && managedHolderIds) {
    cardsQuery = cardsQuery.in('holder_id', managedHolderIds.length > 0 ? managedHolderIds : ['00000000-0000-0000-0000-000000000000'])
  }

  const { data: cards } = await cardsQuery

  // Calculate all reminders
  const [billReminders, promoReminders, benefitReminders, annualFeeReminders] = await Promise.all([
    getBillReminders(filteredBills, holderMap),
    getPromoReminders(filteredPromos, holderMap),
    getBenefitReminders(filteredBenefits, holderMap),
    getAnnualFeeReminders(cards || [], holderMap),
  ])

  const allReminders = [
    ...billReminders,
    ...promoReminders,
    ...benefitReminders,
    ...annualFeeReminders,
  ]

  // Sort by severity
  const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 }
  return allReminders.sort((a, b) => {
    const severityDiff = severityOrder[a.severity] - severityOrder[b.severity]
    if (severityDiff !== 0) return severityDiff

    // Within same severity, sort by type
    const typeOrder = { bill_overdue: 0, bill_due: 1, promo_expiring: 2, benefit_expiring: 3, annual_fee_attention: 4 }
    return typeOrder[a.type] - typeOrder[b.type]
  })
}
