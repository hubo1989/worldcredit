// lib/api/analytics.ts — client-side RPC wrappers (server: analytics.server.ts).
import type * as Server from './analytics.server'
import { callRpc } from './rpc-client'

export type {
  AnalyticsSummary,
  MonthlyDebtPoint,
  CategoryBreakdown,
} from './analytics.server'

export function getAnalyticsSummary(...args: Parameters<typeof Server.getAnalyticsSummary>) {
  return callRpc<typeof Server.getAnalyticsSummary>('analytics', 'getAnalyticsSummary', ...args)
}
export function getMonthlyDebtTrend(...args: Parameters<typeof Server.getMonthlyDebtTrend>) {
  return callRpc<typeof Server.getMonthlyDebtTrend>('analytics', 'getMonthlyDebtTrend', ...args)
}
export function getCategoryBreakdown(...args: Parameters<typeof Server.getCategoryBreakdown>) {
  return callRpc<typeof Server.getCategoryBreakdown>('analytics', 'getCategoryBreakdown', ...args)
}
export function getAnalyticsByHolder(...args: Parameters<typeof Server.getAnalyticsByHolder>) {
  return callRpc<typeof Server.getAnalyticsByHolder>('analytics', 'getAnalyticsByHolder', ...args)
}
