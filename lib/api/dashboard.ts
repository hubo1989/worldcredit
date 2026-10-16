// lib/api/dashboard.ts — client-side RPC wrappers (server: dashboard.server.ts).
import type * as Server from './dashboard.server'
import { callRpc } from './rpc-client'

export type {
  DashboardStats,
  UserActivity,
  CardProductStat,
  PromoItem,
  BenefitStat,
} from './dashboard.server'

export function getDashboardStats() {
  return callRpc<typeof Server.getDashboardStats>('dashboard', 'getDashboardStats')
}
// Registered in the RPC registry against opportunities/queries.server.ts with
// the session actor prepended; the client sends no arguments.
import type { PublicScopedRpc } from '../opportunities/types'
import type { getTodayAvailableCount } from '../opportunities/queries.server'
export function getOpportunityTodayCount() {
  return callRpc<PublicScopedRpc<typeof getTodayAvailableCount>>(
    'dashboard',
    'getOpportunityTodayCount',
  )
}
export function getUserActivity() {
  return callRpc<typeof Server.getUserActivity>('dashboard', 'getUserActivity')
}
export function getCardProductStats() {
  return callRpc<typeof Server.getCardProductStats>('dashboard', 'getCardProductStats')
}
export function getPromoList() {
  return callRpc<typeof Server.getPromoList>('dashboard', 'getPromoList')
}
export function getBenefitStats() {
  return callRpc<typeof Server.getBenefitStats>('dashboard', 'getBenefitStats')
}
