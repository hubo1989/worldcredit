// lib/api/promos.ts — client-side RPC wrappers (server: promos.server.ts).
import type * as Server from './promos.server'
import { callRpc } from './rpc-client'

export type { PromosWithBanks } from './promos.server'

export function getPromosWithBanks() {
  return callRpc<typeof Server.getPromosWithBanks>('promos', 'getPromosWithBanks')
}
export function createUserPromo(...args: Parameters<typeof Server.createUserPromo>) {
  return callRpc<typeof Server.createUserPromo>('promos', 'createUserPromo', ...args)
}
