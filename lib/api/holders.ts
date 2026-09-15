// lib/api/holders.ts — client-side RPC wrappers (server: holders.server.ts).
import type * as Server from './holders.server'
import { callRpc } from './rpc-client'

export type { StatsPageData } from './holders.server'

export function getHolders(...args: Parameters<typeof Server.getHolders>) {
  return callRpc<typeof Server.getHolders>('holders', 'getHolders', ...args)
}
export function getHolder(...args: Parameters<typeof Server.getHolder>) {
  return callRpc<typeof Server.getHolder>('holders', 'getHolder', ...args)
}
export function getHolderStatsPageData(...args: Parameters<typeof Server.getHolderStatsPageData>) {
  return callRpc<typeof Server.getHolderStatsPageData>('holders', 'getHolderStatsPageData', ...args)
}
export function getHolderCardCounts(...args: Parameters<typeof Server.getHolderCardCounts>) {
  return callRpc<typeof Server.getHolderCardCounts>('holders', 'getHolderCardCounts', ...args)
}
export function createHolder(...args: Parameters<typeof Server.createHolder>) {
  return callRpc<typeof Server.createHolder>('holders', 'createHolder', ...args)
}
export function updateHolder(...args: Parameters<typeof Server.updateHolder>) {
  return callRpc<typeof Server.updateHolder>('holders', 'updateHolder', ...args)
}
export function mergeHolders(...args: Parameters<typeof Server.mergeHolders>) {
  return callRpc<typeof Server.mergeHolders>('holders', 'mergeHolders', ...args)
}
