// lib/api/bill-emails.ts — client-side RPC wrappers (server: bill-emails.server.ts).
import type * as Server from './bill-emails.server'
import { callRpc } from './rpc-client'

export type { BillEmailSource } from './bill-emails.server'

export function getBillEmailSources(...args: Parameters<typeof Server.getBillEmailSources>) {
  return callRpc<typeof Server.getBillEmailSources>('bill-emails', 'getBillEmailSources', ...args)
}
export function addBillEmailSource(...args: Parameters<typeof Server.addBillEmailSource>) {
  return callRpc<typeof Server.addBillEmailSource>('bill-emails', 'addBillEmailSource', ...args)
}
export function setBillEmailSourceActive(...args: Parameters<typeof Server.setBillEmailSourceActive>) {
  return callRpc<typeof Server.setBillEmailSourceActive>('bill-emails', 'setBillEmailSourceActive', ...args)
}
export function deleteBillEmailSource(...args: Parameters<typeof Server.deleteBillEmailSource>) {
  return callRpc<typeof Server.deleteBillEmailSource>('bill-emails', 'deleteBillEmailSource', ...args)
}
