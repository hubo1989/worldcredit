// lib/api/sync-gmail.ts — client-side RPC wrappers (server: sync-gmail.server.ts).
import type * as Server from './sync-gmail.server'
import { callRpc } from './rpc-client'

export function syncGmailLedgerToCardsAndBills(...args: Parameters<typeof Server.syncGmailLedgerToCardsAndBills>) {
  return callRpc<typeof Server.syncGmailLedgerToCardsAndBills>('sync-gmail', 'syncGmailLedgerToCardsAndBills', ...args)
}
