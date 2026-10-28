// lib/api/billDrafts.ts — client-side RPC wrappers (server: billDrafts.server.ts).
import type * as Server from './billDrafts.server'
import { callRpc } from './rpc-client'

export type { BillImportDraft } from './billDrafts.server'

export function createBillImportDraft(...args: Parameters<typeof Server.createBillImportDraft>) {
  return callRpc<typeof Server.createBillImportDraft>('billDrafts', 'createBillImportDraft', ...args)
}
export function confirmBillImportDraft(...args: Parameters<typeof Server.confirmBillImportDraft>) {
  return callRpc<typeof Server.confirmBillImportDraft>('billDrafts', 'confirmBillImportDraft', ...args)
}
export function discardBillImportDraft(...args: Parameters<typeof Server.discardBillImportDraft>) {
  return callRpc<typeof Server.discardBillImportDraft>('billDrafts', 'discardBillImportDraft', ...args)
}
export function getBillImportDrafts(...args: Parameters<typeof Server.getBillImportDrafts>) {
  return callRpc<typeof Server.getBillImportDrafts>('billDrafts', 'getBillImportDrafts', ...args)
}
export function updateBillImportDraft(...args: Parameters<typeof Server.updateBillImportDraft>) {
  return callRpc<typeof Server.updateBillImportDraft>('billDrafts', 'updateBillImportDraft', ...args)
}
