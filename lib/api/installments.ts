// lib/api/installments.ts — client-side RPC wrappers (server: installments.server.ts).
import type * as Server from './installments.server'
import { callRpc } from './rpc-client'

export type {
  CreateInstallmentInput,
  InstallmentBillingMode,
  InstallmentFeeMode,
  InstallmentFilters,
  InstallmentPlan,
  InstallmentPlanType,
  InstallmentPlanWithSummary,
  UpdateInstallmentPatch,
} from './installments.server'

export function getInstallmentPlans(...args: Parameters<typeof Server.getInstallmentPlans>) {
  return callRpc<typeof Server.getInstallmentPlans>('installments', 'getInstallmentPlans', ...args)
}

export function createInstallmentPlan(...args: Parameters<typeof Server.createInstallmentPlan>) {
  return callRpc<typeof Server.createInstallmentPlan>(
    'installments',
    'createInstallmentPlan',
    ...args,
  )
}

export function updateInstallmentPlan(...args: Parameters<typeof Server.updateInstallmentPlan>) {
  return callRpc<typeof Server.updateInstallmentPlan>(
    'installments',
    'updateInstallmentPlan',
    ...args,
  )
}

export function advanceInstallmentPeriod(
  ...args: Parameters<typeof Server.advanceInstallmentPeriod>
) {
  return callRpc<typeof Server.advanceInstallmentPeriod>(
    'installments',
    'advanceInstallmentPeriod',
    ...args,
  )
}

export function settleInstallmentEarly(...args: Parameters<typeof Server.settleInstallmentEarly>) {
  return callRpc<typeof Server.settleInstallmentEarly>(
    'installments',
    'settleInstallmentEarly',
    ...args,
  )
}

export function deleteInstallmentPlan(...args: Parameters<typeof Server.deleteInstallmentPlan>) {
  return callRpc<typeof Server.deleteInstallmentPlan>(
    'installments',
    'deleteInstallmentPlan',
    ...args,
  )
}

export function getInstallmentSchedule(...args: Parameters<typeof Server.getInstallmentSchedule>) {
  return callRpc<typeof Server.getInstallmentSchedule>(
    'installments',
    'getInstallmentSchedule',
    ...args,
  )
}
