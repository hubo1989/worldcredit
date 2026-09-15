// lib/api/ai.ts — client-side RPC wrappers (server: ai.server.ts).
import type * as Server from './ai.server'
import { callRpc } from './rpc-client'

export function aiComplete(...args: Parameters<typeof Server.aiComplete>) {
  return callRpc<typeof Server.aiComplete>('ai', 'aiComplete', ...args)
}
