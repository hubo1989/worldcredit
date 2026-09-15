// lib/api/emailBills.ts — client-side RPC wrappers (server: emailBills.server.ts).
import type * as Server from './emailBills.server'
import { callRpc } from './rpc-client'

export type { EmailParseLogWithParsed } from './emailBills.server'

export function syncEmailBillToAccount(...args: Parameters<typeof Server.syncEmailBillToAccount>) {
  return callRpc<typeof Server.syncEmailBillToAccount>('emailBills', 'syncEmailBillToAccount', ...args)
}
