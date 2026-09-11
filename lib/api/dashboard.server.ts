import { query } from '../db'

export interface DashboardStats {
  totalUsers: number
  totalCardProducts: number
  activeCards: number
  benefitUsages: number
  activePromos: number
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const { data, error } = await query<{
    holders: number; products: number; active_cards: number; usages: number; active_promos: number
  }>(`
    SELECT
      (SELECT COUNT(*) FROM card_holders) AS holders,
      (SELECT COUNT(*) FROM card_products) AS products,
      (SELECT COUNT(*) FROM credit_cards WHERE status = 'active') AS active_cards,
      (SELECT COUNT(*) FROM benefit_usages) AS usages,
      (SELECT COUNT(*) FROM promos WHERE end_date >= date('now')) AS active_promos
  `)
  if (error) throw new Error(error.message)
  const row = data?.[0]
  return {
    totalUsers: row?.holders ?? 0,
    totalCardProducts: row?.products ?? 0,
    activeCards: row?.active_cards ?? 0,
    benefitUsages: row?.usages ?? 0,
    activePromos: row?.active_promos ?? 0,
  }
}

export interface UserActivity {
  recentNewUsers: number
  recentPayments: number
  recentCardOpenings: number
  recentBenefitUsages: number
}

export async function getUserActivity(): Promise<UserActivity> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await query<{
    new_users: number; payments: number; card_openings: number; benefit_usages: number
  }>(`
    SELECT
      (SELECT COUNT(*) FROM card_holders WHERE created_at >= ?) AS new_users,
      (SELECT COUNT(*) FROM payments WHERE created_at >= ?) AS payments,
      (SELECT COUNT(*) FROM credit_cards WHERE created_at >= ?) AS card_openings,
      (SELECT COUNT(*) FROM benefit_usages WHERE created_at >= ?) AS benefit_usages
  `, [sevenDaysAgo, sevenDaysAgo, sevenDaysAgo, sevenDaysAgo])
  if (error) throw new Error(error.message)
  const row = data?.[0]
  return {
    recentNewUsers: row?.new_users ?? 0,
    recentPayments: row?.payments ?? 0,
    recentCardOpenings: row?.card_openings ?? 0,
    recentBenefitUsages: row?.benefit_usages ?? 0,
  }
}

export interface CardProductStat {
  id: string
  bank_name: string
  card_name: string
  currency: string
  annual_fee: number | null
  annual_fee_waiver: string | null
  card_count: number
}

export async function getCardProductStats(): Promise<CardProductStat[]> {
  const { data, error } = await query<CardProductStat>(`
    SELECT cp.id, cp.bank_name, cp.card_name, cp.currency, cp.annual_fee, cp.annual_fee_waiver,
           COUNT(cc.id) AS card_count
    FROM card_products cp
    LEFT JOIN credit_cards cc ON cc.card_product_id = cp.id
    GROUP BY cp.id
    ORDER BY cp.bank_name
  `)
  if (error) throw new Error(error.message)
  return data || []
}

export interface PromoItem {
  id: string
  bank_name: string
  title: string
  discount_type: string | null
  start_date: string | null
  end_date: string | null
  max_uses: number | null
  usage_count: number
  is_active: boolean
}

export async function getPromoList(): Promise<PromoItem[]> {
  const { data, error } = await query<{
    id: string; bank_name: string; title: string; discount_type: string | null;
    start_date: string | null; end_date: string | null; max_uses: number | null; usage_count: number
  }>(`
    SELECT p.id, p.bank_name, p.title, p.discount_type, p.start_date, p.end_date, p.max_uses,
           COUNT(pu.id) AS usage_count
    FROM promos p
    LEFT JOIN promo_usages pu ON pu.promo_id = p.id
    GROUP BY p.id
    ORDER BY p.created_at DESC
  `)
  if (error) throw new Error(error.message)
  const today = new Date().toISOString().slice(0, 10)
  return (data || []).map(p => ({ ...p, is_active: !p.end_date || p.end_date >= today }))
}

export interface BenefitStat {
  id: string
  card_product_name: string
  bank_name: string
  name: string
  quota: number
  period: string
  usage_count: number
}

export async function getBenefitStats(): Promise<BenefitStat[]> {
  const { data, error } = await query<BenefitStat>(`
    SELECT b.id, cp.card_name AS card_product_name, cp.bank_name,
           b.name, b.quota, b.period,
           COUNT(bu.id) AS usage_count
    FROM benefits b
    LEFT JOIN card_products cp ON b.card_product_id = cp.id
    LEFT JOIN benefit_usages bu ON bu.benefit_id = b.id
    GROUP BY b.id
  `)
  if (error) throw new Error(error.message)
  return data || []
}
