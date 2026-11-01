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

// ── spec 13 账单编辑（服务端由独立分支落地；RPC 名收敛在此，合并时一处改名）──

/** spec §6.2：结构化编辑入口。金额/日期类一律写 *_override 列；start/end 直接 UPDATE。 */
export type BillEditableFields = {
  amount?: number
  min_payment?: number
  due_date?: string
  statement_date?: string
  statement_start?: string
  statement_end?: string
}
export function updateBillFields(
  billId: string,
  fields: BillEditableFields,
): Promise<import('@/lib/types').Bill> {
  return callRpc<(billId: string, fields: BillEditableFields) => Promise<import('@/lib/types').Bill>>(
    'bills', 'updateBillFields', billId, fields,
  )
}

/** spec §6.2：按字段撤销钉住（start/end 不在枚举内）。 */
export type BillOverrideField = 'amount' | 'min_payment' | 'due_date' | 'statement_date'
export function clearOverride(
  billId: string,
  field: BillOverrideField,
): Promise<import('@/lib/types').Bill> {
  return callRpc<(billId: string, field: BillOverrideField) => Promise<import('@/lib/types').Bill>>(
    'bills', 'clearOverride', billId, field,
  )
}

/** spec §6.3：改状态前由服务端按已还总额重算（允许 paid 回退）。 */
export function updateBillStatusChecked(
  billId: string,
  status: import('@/lib/types').Bill['status'],
): Promise<import('@/lib/types').Bill> {
  return callRpc<
    (billId: string, status: import('@/lib/types').Bill['status']) => Promise<import('@/lib/types').Bill>
  >('bills', 'updateBillStatusChecked', billId, status)
}

/** spec §6.1：删除账单（admin；级联 payments）。 */
export function deleteBill(billId: string): Promise<void> {
  return callRpc<(billId: string) => Promise<void>>('bills', 'deleteBill', billId)
}

/** spec §6.1：改单笔还款（payment 归属在服务端校验）。签名以协调者确认为准。 */
export type PaymentPatch = { amount?: number; paid_at?: string; note?: string | null }
export function updatePayment(paymentId: string, patch: PaymentPatch): Promise<void> {
  return callRpc<(paymentId: string, patch: PaymentPatch) => Promise<void>>(
    'payments', 'updatePayment', paymentId, patch,
  )
}
/** spec §6.1：删单笔还款（删后服务端重算所属账单状态）。 */
export function deletePayment(paymentId: string): Promise<void> {
  return callRpc<(paymentId: string) => Promise<void>>('payments', 'deletePayment', paymentId)
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
