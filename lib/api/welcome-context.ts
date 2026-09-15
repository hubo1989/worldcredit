import { query, queryOne } from '../db'
import { getBillDashboardItems } from './bills.server'
import type { AiWelcomeContext } from '../types'

/**
 * 获取 AI 助手欢迎横幅所需的真实个性化上下文。
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

  // 持卡人姓名
  try {
    const conditions: string[] = []
    const params: unknown[] = []
    if (userId) { conditions.push('created_by = ?'); params.push(userId) }
    const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : ''
    const { data: holder } = await queryOne<{ name: string }>(
      `SELECT name FROM card_holders${where} ORDER BY created_at ASC LIMIT 1`, params
    )
    if (holder?.name) ctx.holderName = holder.name
  } catch { /* ignore */ }

  // 活跃卡数量
  try {
    if (userId) {
      const { data } = await query<{ count: number }>(
        `SELECT COUNT(*) AS count FROM credit_cards cc
         JOIN card_holders ch ON cc.holder_id = ch.id
         WHERE cc.status = 'active' AND ch.created_by = ?`, [userId]
      )
      ctx.cardCount = data?.[0]?.count || 0
    } else {
      const { data } = await query<{ count: number }>(
        "SELECT COUNT(*) AS count FROM credit_cards WHERE status = 'active'"
      )
      ctx.cardCount = data?.[0]?.count || 0
    }
  } catch { /* ignore */ }

  // 账单聚合
  try {
    const bills = await getBillDashboardItems(60, userId)
    const openBills = bills.filter(b => b.computed_status !== 'paid')
    ctx.pendingBills = openBills.length
    ctx.overdueCount = openBills.filter(b => b.computed_status === 'overdue').length
    ctx.dueSoonCount = openBills.filter(b => b.days_until_due >= 0 && b.days_until_due <= 7).length
    ctx.totalRemaining = openBills.reduce((s, b) => s + Number(b.remaining_amount || 0), 0)
  } catch { /* ignore */ }

  return ctx
}
