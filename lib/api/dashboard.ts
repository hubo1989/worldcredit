import { insforge } from '../insforge'

/**
 * 平台运营统计概览
 */
export interface DashboardStats {
  totalUsers: number
  totalCardProducts: number
  activeCards: number
  benefitUsages: number
  activePromos: number
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const [holdersRes, productsRes, cardsRes, usagesRes, promosRes] = await Promise.all([
    insforge.database.from('card_holders').select('id', { count: 'exact', head: true }),
    insforge.database.from('card_products').select('id', { count: 'exact', head: true }),
    insforge.database.from('credit_cards').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    insforge.database.from('benefit_usages').select('id', { count: 'exact', head: true }),
    insforge.database.from('promos').select('id', { count: 'exact', head: true }).gte('end_date', new Date().toISOString().slice(0, 10)),
  ])

  return {
    totalUsers: holdersRes.count ?? 0,
    totalCardProducts: productsRes.count ?? 0,
    activeCards: cardsRes.count ?? 0,
    benefitUsages: usagesRes.count ?? 0,
    activePromos: promosRes.count ?? 0,
  }
}

/**
 * 用户活跃度：最近 7 天新增用户数 & 最近 7 天操作次数
 */
export interface UserActivity {
  recentNewUsers: number
  recentPayments: number
  recentCardOpenings: number
  recentBenefitUsages: number
}

export async function getUserActivity(): Promise<UserActivity> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const [usersRes, paymentsRes, cardsRes, benefitRes] = await Promise.all([
    insforge.database.from('card_holders').select('id', { count: 'exact', head: true }).gte('created_at', sevenDaysAgo),
    insforge.database.from('payments').select('id', { count: 'exact', head: true }).gte('created_at', sevenDaysAgo),
    insforge.database.from('credit_cards').select('id', { count: 'exact', head: true }).gte('created_at', sevenDaysAgo),
    insforge.database.from('benefit_usages').select('id', { count: 'exact', head: true }).gte('created_at', sevenDaysAgo),
  ])

  return {
    recentNewUsers: usersRes.count ?? 0,
    recentPayments: paymentsRes.count ?? 0,
    recentCardOpenings: cardsRes.count ?? 0,
    recentBenefitUsages: benefitRes.count ?? 0,
  }
}

/**
 * 卡产品概览：每个产品 + 开卡数量
 */
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
  const { data: products, error: pErr } = await insforge.database
    .from('card_products')
    .select('id, bank_name, card_name, currency, annual_fee, annual_fee_waiver')
    .order('bank_name')

  if (pErr) throw pErr

  // 获取每个产品的开卡数
  const { data: cards, error: cErr } = await insforge.database
    .from('credit_cards')
    .select('card_product_id')

  if (cErr) throw cErr

  const countMap: Record<string, number> = {}
  for (const c of cards || []) {
    countMap[c.card_product_id] = (countMap[c.card_product_id] || 0) + 1
  }

  return (products || []).map(p => ({
    ...p,
    card_count: countMap[p.id] || 0,
  }))
}

/**
 * 优惠活动列表
 */
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
  const { data: promos, error: pErr } = await insforge.database
    .from('promos')
    .select('id, bank_name, title, discount_type, start_date, end_date, max_uses')
    .order('created_at', { ascending: false })

  if (pErr) throw pErr

  const { data: usages, error: uErr } = await insforge.database
    .from('promo_usages')
    .select('promo_id')

  if (uErr) throw uErr

  const usageMap: Record<string, number> = {}
  for (const u of usages || []) {
    usageMap[u.promo_id] = (usageMap[u.promo_id] || 0) + 1
  }

  const today = new Date().toISOString().slice(0, 10)

  return (promos || []).map(p => ({
    ...p,
    usage_count: usageMap[p.id] || 0,
    is_active: !p.end_date || p.end_date >= today,
  }))
}

/**
 * 权益概览：产品 + 权益名 + 使用率
 */
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
  const { data: benefits, error: bErr } = await insforge.database
    .from('benefits')
    .select('id, card_product_id, name, quota, period')

  if (bErr) throw bErr

  // 获取卡产品名称
  const { data: products } = await insforge.database
    .from('card_products')
    .select('id, bank_name, card_name')

  const productMap: Record<string, { bank_name: string; card_name: string }> = {}
  for (const p of products || []) {
    productMap[p.id] = { bank_name: p.bank_name, card_name: p.card_name }
  }

  // 获取使用次数
  const { data: usages } = await insforge.database
    .from('benefit_usages')
    .select('benefit_id')

  const usageMap: Record<string, number> = {}
  for (const u of usages || []) {
    usageMap[u.benefit_id] = (usageMap[u.benefit_id] || 0) + 1
  }

  return (benefits || []).map(b => {
    const product = productMap[b.card_product_id] || { bank_name: '未知', card_name: '未知' }
    return {
      id: b.id,
      card_product_name: product.card_name,
      bank_name: product.bank_name,
      name: b.name,
      quota: b.quota,
      period: b.period,
      usage_count: usageMap[b.id] || 0,
    }
  })
}
