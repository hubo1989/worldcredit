// lib/api/banks.ts — client-side RPC wrappers (server: banks.server.ts).
import type * as Server from './banks.server'
import { callRpc } from './rpc-client'

export type { BankOption } from './banks.server'

export function getBankNames(...args: Parameters<typeof Server.getBankNames>) {
  return callRpc<typeof Server.getBankNames>('banks', 'getBankNames', ...args)
}
