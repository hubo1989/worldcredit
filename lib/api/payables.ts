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
export type {
  PayableCategory,
  PayableCurrency,
  PayableCycleType,
  PayableCycleSpec,
} from './payables.shared'
export {
  categoryLabel,
  CUSTOM_CATEGORY_SENTINEL,
  MAX_CUSTOM_CATEGORY_LENGTH,
  PAYABLE_CATEGORIES,
  isPayableCategory,
  resolvePresetPayableCategory,
  normalizeCustomCategoryName,
  dedupeCustomCategories,
  PAYABLE_CYCLE_TYPES,
  PAYABLE_CYCLE_LABELS,
  PAYABLE_CYCLE_OPTIONS,
  MIN_PAYABLE_CYCLE_MONTHS,
  MAX_PAYABLE_CYCLE_MONTHS,
  isPayableCycleType,
  isValidEveryNMonths,
  isValidPayablePeriod,
  payableCycleLabel,
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
export function getPayableCustomCategories(...args: Parameters<typeof Server.getPayableCustomCategories>) {
  return callRpc<typeof Server.getPayableCustomCategories>('payables', 'getPayableCustomCategories', ...args)
}
export function savePayableCustomCategory(...args: Parameters<typeof Server.savePayableCustomCategory>) {
  return callRpc<typeof Server.savePayableCustomCategory>('payables', 'savePayableCustomCategory', ...args)
}
