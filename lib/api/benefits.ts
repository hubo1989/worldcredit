// lib/api/benefits.ts — client-side RPC wrappers (server: benefits.server.ts).
import type * as Server from './benefits.server'
import { callRpc } from './rpc-client'

export function getAllMyBenefits(...args: Parameters<typeof Server.getAllMyBenefits>) {
  return callRpc<typeof Server.getAllMyBenefits>('benefits', 'getAllMyBenefits', ...args)
}
export function recordBenefitUsage(...args: Parameters<typeof Server.recordBenefitUsage>) {
  return callRpc<typeof Server.recordBenefitUsage>('benefits', 'recordBenefitUsage', ...args)
}
export function autoEnrichCardBenefits(...args: Parameters<typeof Server.autoEnrichCardBenefits>) {
  return callRpc<typeof Server.autoEnrichCardBenefits>('benefits', 'autoEnrichCardBenefits', ...args)
}
export function createBenefit(...args: Parameters<typeof Server.createBenefit>) {
  return callRpc<typeof Server.createBenefit>('benefits', 'createBenefit', ...args)
}
export function updateBenefit(...args: Parameters<typeof Server.updateBenefit>) {
  return callRpc<typeof Server.updateBenefit>('benefits', 'updateBenefit', ...args)
}
export function deleteBenefit(...args: Parameters<typeof Server.deleteBenefit>) {
  return callRpc<typeof Server.deleteBenefit>('benefits', 'deleteBenefit', ...args)
}
