// lib/api/bills.ts — client-side RPC wrappers (server: bills.server.ts / payments.ts).
import type * as Server from './bills.server'
import type * as ServerPayments from './payments'
import { callRpc } from './rpc-client'

export type {
  BillDashboardItem,
  CardWithBillsSummary,
  BillDetail,
  UnpaidBillLite,
  BillLiteForForm,
  BillItemInput,
  BillFieldPatch,
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
export function recordPayment(...args: Parameters<typeof Server.recordPayment>) {
  return callRpc<typeof Server.recordPayment>('bills', 'recordPayment', ...args)
}
export function markAllOverdueBillsAsPaid(...args: Parameters<typeof Server.markAllOverdueBillsAsPaid>) {
  return callRpc<typeof Server.markAllOverdueBillsAsPaid>('bills', 'markAllOverdueBillsAsPaid', ...args)
}

// ── spec 13 账单编辑（服务端：lib/api/bills.server.ts；签名按服务端派生）──

/** spec §6.2：结构化编辑入口。金额/日期类一律写 *_override 列；start/end 直接 UPDATE。 */
export function updateBillFields(...args: Parameters<typeof Server.updateBillFields>) {
  return callRpc<typeof Server.updateBillFields>('bills', 'updateBillFields', ...args)
}
export type BillEditableFields = Server.BillFieldPatch

/** spec §6.2：按字段撤销钉住（服务端收字段数组，回落导入值）。 */
export function clearOverride(billId: string, fields: BillOverrideField[]) {
  return callRpc<typeof Server.clearOverride>('bills', 'clearOverride', billId, fields)
}
export type BillOverrideField = Exclude<
  keyof Server.BillFieldPatch,
  'statement_start' | 'statement_end'
>

/** spec §6.3：改状态前由服务端按已还总额重算（允许 paid 回退）。 */
export function updateBillStatusChecked(...args: Parameters<typeof Server.updateBillStatusChecked>) {
  return callRpc<typeof Server.updateBillStatusChecked>('bills', 'updateBillStatusChecked', ...args)
}

/** spec §6.1：删除账单（admin；级联 payments，sync_changes 由 0019 触发器记录）。 */
export function deleteBill(...args: Parameters<typeof Server.deleteBill>) {
  return callRpc<typeof Server.deleteBill>('bills', 'deleteBill', ...args)
}

// ── spec 13 还款记录改删（服务端：lib/api/payments.ts）──

export type { UpdatePaymentPatch as PaymentPatch } from './payments'
export function updatePayment(...args: Parameters<typeof ServerPayments.updatePayment>) {
  return callRpc<typeof ServerPayments.updatePayment>('payments', 'updatePayment', ...args)
}
/** 删单笔还款（删后服务端重算所属账单状态）。 */
export function deletePayment(...args: Parameters<typeof ServerPayments.deletePayment>) {
  return callRpc<typeof ServerPayments.deletePayment>('payments', 'deletePayment', ...args)
}
