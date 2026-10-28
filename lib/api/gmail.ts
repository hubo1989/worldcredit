// lib/api/gmail.ts — client-side RPC wrappers (server: gmail.server.ts).
import type * as Server from './gmail.server'
import { callRpc } from './rpc-client'

export type { GmailConnectionStatus } from './gmail.server'
export type { GmailSyncSummary } from '../gmail/sync.server'

export function getGmailConnection(...args: Parameters<typeof Server.getGmailConnection>) {
  return callRpc<typeof Server.getGmailConnection>('gmail', 'getGmailConnection', ...args)
}
export function syncGmailNow(...args: Parameters<typeof Server.syncGmailNow>) {
  return callRpc<typeof Server.syncGmailNow>('gmail', 'syncGmailNow', ...args)
}
export function disconnectGmail(...args: Parameters<typeof Server.disconnectGmail>) {
  return callRpc<typeof Server.disconnectGmail>('gmail', 'disconnectGmail', ...args)
}
