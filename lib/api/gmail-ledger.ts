// lib/api/gmail-ledger.ts — client-side RPC wrappers (server: gmail-ledger.server.ts).
import type * as Server from './gmail-ledger.server'
import { callRpc } from './rpc-client'

export type { GmailLedgerEntry, GmailLedgerSummary } from './gmail-ledger.server'

export function getGmailLedgerEntries(...args: Parameters<typeof Server.getGmailLedgerEntries>) {
  return callRpc<typeof Server.getGmailLedgerEntries>('gmail-ledger', 'getGmailLedgerEntries', ...args)
}
export function getGmailLedgerSummary() {
  return callRpc<typeof Server.getGmailLedgerSummary>('gmail-ledger', 'getGmailLedgerSummary')
}
export function markPayment(...args: Parameters<typeof Server.markPayment>) {
  return callRpc<typeof Server.markPayment>('gmail-ledger', 'markPayment', ...args)
}
export function updateLedgerAmount(...args: Parameters<typeof Server.updateLedgerAmount>) {
  return callRpc<typeof Server.updateLedgerAmount>('gmail-ledger', 'updateLedgerAmount', ...args)
}
export function getGmailLedgerBanks() {
  return callRpc<typeof Server.getGmailLedgerBanks>('gmail-ledger', 'getGmailLedgerBanks')
}
