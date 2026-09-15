// lib/api/ai.ts — client-side RPC wrappers (server: ai.server.ts).
import type * as Server from './ai.server'
import { callRpc } from './rpc-client'

export type { BankEnrichment } from './ai.server'

export function aiComplete(...args: Parameters<typeof Server.aiComplete>) {
  return callRpc<typeof Server.aiComplete>('ai', 'aiComplete', ...args)
}

export function enrichBankFromWeb(...args: Parameters<typeof Server.enrichBankFromWeb>) {
  return callRpc<typeof Server.enrichBankFromWeb>('ai', 'enrichBankFromWeb', ...args)
}
