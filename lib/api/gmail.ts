// lib/api/gmail.ts — client-side RPC wrappers (server: gmail.server.ts).
import type * as Server from './gmail.server'
import { callRpc } from './rpc-client'

export type { GmailConnectionStatus, GmailConnectionItem } from './gmail.server'
export type { GmailSyncSummary } from '../gmail/sync.server'

export function getGmailConnection(...args: Parameters<typeof Server.getGmailConnection>) {
  return callRpc<typeof Server.getGmailConnection>('gmail', 'getGmailConnection', ...args)
}
export function getGmailConnections(...args: Parameters<typeof Server.getGmailConnections>) {
  return callRpc<typeof Server.getGmailConnections>('gmail', 'getGmailConnections', ...args)
}
export function updateGmailConnection(...args: Parameters<typeof Server.updateGmailConnection>) {
  return callRpc<typeof Server.updateGmailConnection>('gmail', 'updateGmailConnection', ...args)
}
export function syncGmailConnection(...args: Parameters<typeof Server.syncGmailConnection>) {
  return callRpc<typeof Server.syncGmailConnection>('gmail', 'syncGmailConnection', ...args)
}
export function syncGmailNow(...args: Parameters<typeof Server.syncGmailNow>) {
  return callRpc<typeof Server.syncGmailNow>('gmail', 'syncGmailNow', ...args)
}
export function disconnectGmail(...args: Parameters<typeof Server.disconnectGmail>) {
  return callRpc<typeof Server.disconnectGmail>('gmail', 'disconnectGmail', ...args)
}
export function disconnectGmailConnection(...args: Parameters<typeof Server.disconnectGmailConnection>) {
  return callRpc<typeof Server.disconnectGmailConnection>('gmail', 'disconnectGmailConnection', ...args)
}
