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
