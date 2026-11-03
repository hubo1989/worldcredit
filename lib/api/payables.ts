// lib/api/payables.ts — client-side RPC wrappers (server: payables.server.ts).
import type * as Server from './payables.server'
import { callRpc } from './rpc-client'

export type {
  RecurringPayable,
  RecurringPayableInput,
  CreateRecurringPayableInput,
  PayableWithStatus,
  PayablePaymentRecord,
} from './payables.server'

// 纯类型与纯函数走 .shared，避免把服务端依赖带进浏览器包。
export type { PayableCategory, PayableCurrency } from './payables.shared'
export {
  categoryLabel,
  PAYABLE_CATEGORIES,
  PAYABLE_CURRENCIES,
  PAYABLE_CURRENCY_LABELS,
  isPayableCurrency,
  normalizePayableCurrency,
  PAYABLE_HISTORY_LIMIT,
} from './payables.shared'

export function getRecurringPayables(...args: Parameters<typeof Server.getRecurringPayables>) {
  return callRpc<typeof Server.getRecurringPayables>('payables', 'getRecurringPayables', ...args)
}
export function createRecurringPayable(...args: Parameters<typeof Server.createRecurringPayable>) {
  return callRpc<typeof Server.createRecurringPayable>('payables', 'createRecurringPayable', ...args)
}
export function updateRecurringPayable(...args: Parameters<typeof Server.updateRecurringPayable>) {
  return callRpc<typeof Server.updateRecurringPayable>('payables', 'updateRecurringPayable', ...args)
}
export function deleteRecurringPayable(...args: Parameters<typeof Server.deleteRecurringPayable>) {
  return callRpc<typeof Server.deleteRecurringPayable>('payables', 'deleteRecurringPayable', ...args)
}
export function payRecurringPayable(...args: Parameters<typeof Server.payRecurringPayable>) {
  return callRpc<typeof Server.payRecurringPayable>('payables', 'payRecurringPayable', ...args)
}
export function getPayablePayments(...args: Parameters<typeof Server.getPayablePayments>) {
  return callRpc<typeof Server.getPayablePayments>('payables', 'getPayablePayments', ...args)
}
