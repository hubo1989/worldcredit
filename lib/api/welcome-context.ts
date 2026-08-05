import { insforge } from '../insforge'
import { getBillDashboardItems } from './bills'
import type { AiWelcomeContext } from '../types'

/**
 * 获取 AI 助手欢迎横幅所需的真实个性化上下文。
 *
 * 数据来源：
 *  - 持卡人姓名：card_holders 表（取当前用户名下第一条）
 *  - 卡数量：credit_cards 表（status = active）
 *  - 账单聚合：复用 getBillDashboardItems 计算未结清/逾期/将到期/剩余总额
 *
 * 所有错误都被吞掉并返回安全兜底值，避免欢迎横幅因数据加载失败而崩溃。
 */
export async function getAiWelcomeContext(userId?: string): Promise<AiWelcomeContext> {
  const ctx: AiWelcomeContext = {
    holderName: undefined,
    cardCount: 0,
    pendingBills: 0,
    overdueCount: 0,
    dueSoonCount: 0,
    totalRemaining: 0,
  }

  // 持卡人姓名（取第一个）
  try {
    let holderQuery = insforge.database.from('card_holders').select('name').limit(1)
    if (userId) {
      holderQuery = holderQuery.eq('created_by', userId)
    }
    const { data: holder } = await holderQuery.order('created_at', { ascending: true }).single()
    if (holder?.name) {
      ctx.holderName = holder.name
    }
  } catch {
    // 忽略，使用 undefined
  }

  // 活跃卡数量
  try {
    let cardQuery = insforge.database
      .from('credit_cards')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'active')
    if (userId) {
      // 需要通过 card_holders 关联过滤，简单方案：先拿 holderIds
      const { data: holders } = await insforge.database
        .from('card_holders')
        .select('id')
        .eq('created_by', userId)
      const holderIds = (holders || []).map(h => h.id)
      if (holderIds.length > 0) {
        const { count } = await insforge.database
          .from('credit_cards')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'active')
          .in('holder_id', holderIds)
        ctx.cardCount = count || 0
      }
    } else {
      const { count } = await cardQuery
      ctx.cardCount = count || 0
    }
  } catch {
    // 忽略
  }

  // 账单聚合（复用 getBillDashboardItems）
  try {
    const bills = await getBillDashboardItems(60, userId)
    const openBills = bills.filter(b => b.computed_status !== 'paid')
    const totalRemaining = openBills.reduce((s, b) => s + Number(b.remaining_amount || 0), 0)
    ctx.pendingBills = openBills.length
    ctx.overdueCount = openBills.filter(b => b.computed_status === 'overdue').length
    ctx.dueSoonCount = openBills.filter(
      b => b.days_until_due >= 0 && b.days_until_due <= 7
    ).length
    ctx.totalRemaining = totalRemaining
  } catch {
    // 忽略，使用 0
  }

  return ctx
}
