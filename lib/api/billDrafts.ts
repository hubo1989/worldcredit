// lib/api/billDrafts.ts — client-side RPC wrappers (server: billDrafts.server.ts).
import type * as Server from './billDrafts.server'
import { callRpc } from './rpc-client'

export type {
  BillImportDraft,
  BillDraftPayload,
  BillDraftItem,
  ImportAndParseBillInput,
  ImportAndParseBillResult,
  UnlockDraftInput,
  ConfirmDraftOptions,
  UpdateDraftInput,
  DraftParseStatus,
  DraftSourceType,
  DuplicateBillPreview,
} from './billDrafts.server'

export function createBillImportDraft(...args: Parameters<typeof Server.createBillImportDraft>) {
  return callRpc<typeof Server.createBillImportDraft>('billDrafts', 'createBillImportDraft', ...args)
}
export function importAndParseBill(...args: Parameters<typeof Server.importAndParseBill>) {
  return callRpc<typeof Server.importAndParseBill>('billDrafts', 'importAndParseBill', ...args)
}
export function unlockEncryptedDraft(...args: Parameters<typeof Server.unlockEncryptedDraft>) {
  return callRpc<typeof Server.unlockEncryptedDraft>('billDrafts', 'unlockEncryptedDraft', ...args)
}
export function retryParseDraft(...args: Parameters<typeof Server.retryParseDraft>) {
  return callRpc<typeof Server.retryParseDraft>('billDrafts', 'retryParseDraft', ...args)
}
export function getBillImportDrafts(...args: Parameters<typeof Server.getBillImportDrafts>) {
  return callRpc<typeof Server.getBillImportDrafts>('billDrafts', 'getBillImportDrafts', ...args)
}
export function getBillImportDraftById(...args: Parameters<typeof Server.getBillImportDraftById>) {
  return callRpc<typeof Server.getBillImportDraftById>('billDrafts', 'getBillImportDraftById', ...args)
}
export function updateBillImportDraft(...args: Parameters<typeof Server.updateBillImportDraft>) {
  return callRpc<typeof Server.updateBillImportDraft>('billDrafts', 'updateBillImportDraft', ...args)
}
export function confirmBillImportDraft(...args: Parameters<typeof Server.confirmBillImportDraft>) {
  return callRpc<typeof Server.confirmBillImportDraft>('billDrafts', 'confirmBillImportDraft', ...args)
}
export function discardBillImportDraft(...args: Parameters<typeof Server.discardBillImportDraft>) {
  return callRpc<typeof Server.discardBillImportDraft>('billDrafts', 'discardBillImportDraft', ...args)
}
export function batchDiscardBillDrafts(...args: Parameters<typeof Server.batchDiscardBillDrafts>) {
  return callRpc<typeof Server.batchDiscardBillDrafts>('billDrafts', 'batchDiscardBillDrafts', ...args)
}
