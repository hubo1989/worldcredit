// lib/api/banks.ts — client-side RPC wrappers (server: banks.server.ts).
import type * as Server from './banks.server'
import { callRpc } from './rpc-client'

export type { BankOption, BankItem } from './banks.server'

export function getBankNames(...args: Parameters<typeof Server.getBankNames>) {
  return callRpc<typeof Server.getBankNames>('banks', 'getBankNames', ...args)
}

export function getBanks(...args: Parameters<typeof Server.getBanks>) {
  return callRpc<typeof Server.getBanks>('banks', 'getBanks', ...args)
}
