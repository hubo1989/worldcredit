// lib/api/bills.ts — client-side RPC wrappers (server: bills.server.ts).
import type * as Server from './bills.server'
import { callRpc } from './rpc-client'

export type {
  BillDashboardItem,
  CardWithBillsSummary,
  BillDetail,
  UnpaidBillLite,
  BillLiteForForm,
  BillItemInput,
} from './bills.server'

export function getBillDashboardItems(...args: Parameters<typeof Server.getBillDashboardItems>) {
  return callRpc<typeof Server.getBillDashboardItems>('bills', 'getBillDashboardItems', ...args)
}
export function getCardsWithBillsSummary(...args: Parameters<typeof Server.getCardsWithBillsSummary>) {
  return callRpc<typeof Server.getCardsWithBillsSummary>('bills', 'getCardsWithBillsSummary', ...args)
}
export function getBillDetail(...args: Parameters<typeof Server.getBillDetail>) {
  return callRpc<typeof Server.getBillDetail>('bills', 'getBillDetail', ...args)
}
export function getUnpaidBills(...args: Parameters<typeof Server.getUnpaidBills>) {
  return callRpc<typeof Server.getUnpaidBills>('bills', 'getUnpaidBills', ...args)
}
export function getPaymentTotal(...args: Parameters<typeof Server.getPaymentTotal>) {
  return callRpc<typeof Server.getPaymentTotal>('bills', 'getPaymentTotal', ...args)
}
export function getBillByCardMonth(...args: Parameters<typeof Server.getBillByCardMonth>) {
  return callRpc<typeof Server.getBillByCardMonth>('bills', 'getBillByCardMonth', ...args)
}
export function getBillsByHolder(...args: Parameters<typeof Server.getBillsByHolder>) {
  return callRpc<typeof Server.getBillsByHolder>('bills', 'getBillsByHolder', ...args)
}
export function createBill(...args: Parameters<typeof Server.createBill>) {
  return callRpc<typeof Server.createBill>('bills', 'createBill', ...args)
}
export function updateBill(...args: Parameters<typeof Server.updateBill>) {
  return callRpc<typeof Server.updateBill>('bills', 'updateBill', ...args)
}
export function updateBillStatus(...args: Parameters<typeof Server.updateBillStatus>) {
  return callRpc<typeof Server.updateBillStatus>('bills', 'updateBillStatus', ...args)
}
export function setBillAmountOverride(...args: Parameters<typeof Server.setBillAmountOverride>) {
  return callRpc<typeof Server.setBillAmountOverride>('bills', 'setBillAmountOverride', ...args)
}
export function setCardManualBillAmount(...args: Parameters<typeof Server.setCardManualBillAmount>) {
  return callRpc<typeof Server.setCardManualBillAmount>('bills', 'setCardManualBillAmount', ...args)
}
export function createPayment(...args: Parameters<typeof Server.createPayment>) {
  return callRpc<typeof Server.createPayment>('bills', 'createPayment', ...args)
}
export function markBillAsPaid(...args: Parameters<typeof Server.markBillAsPaid>) {
  return callRpc<typeof Server.markBillAsPaid>('bills', 'markBillAsPaid', ...args)
}
export function markAllOverdueBillsAsPaid(...args: Parameters<typeof Server.markAllOverdueBillsAsPaid>) {
  return callRpc<typeof Server.markAllOverdueBillsAsPaid>('bills', 'markAllOverdueBillsAsPaid', ...args)
}
