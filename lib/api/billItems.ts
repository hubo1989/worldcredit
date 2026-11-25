import type * as Server from './billItems.server'
import { callRpc } from './rpc-client'

export type { BillItemInput } from '../finance/bill-item-import'
export type { UpdateBillItemPatch } from './billItems.server'

export function getBillItems(...args: Parameters<typeof Server.getBillItems>) {
  return callRpc<typeof Server.getBillItems>('billItems', 'getBillItems', ...args)
}

export function createBillItem(...args: Parameters<typeof Server.createBillItem>) {
  return callRpc<typeof Server.createBillItem>('billItems', 'createBillItem', ...args)
}

export function updateBillItem(...args: Parameters<typeof Server.updateBillItem>) {
  return callRpc<typeof Server.updateBillItem>('billItems', 'updateBillItem', ...args)
}

export function deleteBillItem(...args: Parameters<typeof Server.deleteBillItem>) {
  return callRpc<typeof Server.deleteBillItem>('billItems', 'deleteBillItem', ...args)
}

export function batchImportBillItems(...args: Parameters<typeof Server.batchImportBillItems>) {
  return callRpc<typeof Server.batchImportBillItems>('billItems', 'batchImportBillItems', ...args)
}

export function clearBillItems(...args: Parameters<typeof Server.clearBillItems>) {
  return callRpc<typeof Server.clearBillItems>('billItems', 'clearBillItems', ...args)
}

export function getMerchantCategoryRules() {
  return callRpc<typeof Server.getMerchantCategoryRules>('billItems', 'getMerchantCategoryRules')
}
