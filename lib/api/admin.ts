// lib/api/admin.ts — client-side RPC wrappers (server: admin.server.ts).
import type * as Server from './admin.server'
import { callRpc } from './rpc-client'

export function getAdminBanks() {
  return callRpc<typeof Server.getAdminBanks>('admin', 'getAdminBanks')
}
export function createBank(...args: Parameters<typeof Server.createBank>) {
  return callRpc<typeof Server.createBank>('admin', 'createBank', ...args)
}
export function updateBank(...args: Parameters<typeof Server.updateBank>) {
  return callRpc<typeof Server.updateBank>('admin', 'updateBank', ...args)
}
export function deleteBank(...args: Parameters<typeof Server.deleteBank>) {
  return callRpc<typeof Server.deleteBank>('admin', 'deleteBank', ...args)
}
export function getAdminCardProducts() {
  return callRpc<typeof Server.getAdminCardProducts>('admin', 'getAdminCardProducts')
}
export function createCardProduct(...args: Parameters<typeof Server.createCardProduct>) {
  return callRpc<typeof Server.createCardProduct>('admin', 'createCardProduct', ...args)
}
export function updateCardProduct(...args: Parameters<typeof Server.updateCardProduct>) {
  return callRpc<typeof Server.updateCardProduct>('admin', 'updateCardProduct', ...args)
}
export function deleteCardProduct(...args: Parameters<typeof Server.deleteCardProduct>) {
  return callRpc<typeof Server.deleteCardProduct>('admin', 'deleteCardProduct', ...args)
}
export function getAdminPromos() {
  return callRpc<typeof Server.getAdminPromos>('admin', 'getAdminPromos')
}
export function createPromo(...args: Parameters<typeof Server.createPromo>) {
  return callRpc<typeof Server.createPromo>('admin', 'createPromo', ...args)
}
export function updatePromo(...args: Parameters<typeof Server.updatePromo>) {
  return callRpc<typeof Server.updatePromo>('admin', 'updatePromo', ...args)
}
export function deletePromo(...args: Parameters<typeof Server.deletePromo>) {
  return callRpc<typeof Server.deletePromo>('admin', 'deletePromo', ...args)
}
export function getAdminBenefits() {
  return callRpc<typeof Server.getAdminBenefits>('admin', 'getAdminBenefits')
}
export function createBenefit(...args: Parameters<typeof Server.createBenefit>) {
  return callRpc<typeof Server.createBenefit>('admin', 'createBenefit', ...args)
}
export function updateBenefit(...args: Parameters<typeof Server.updateBenefit>) {
  return callRpc<typeof Server.updateBenefit>('admin', 'updateBenefit', ...args)
}
export function deleteBenefit(...args: Parameters<typeof Server.deleteBenefit>) {
  return callRpc<typeof Server.deleteBenefit>('admin', 'deleteBenefit', ...args)
}
export function getSystemSettings() {
  return callRpc<typeof Server.getSystemSettings>('admin', 'getSystemSettings')
}

export function getEmailParseLogs(...args: Parameters<typeof Server.getEmailParseLogs>) {
  return callRpc<typeof Server.getEmailParseLogs>('admin', 'getEmailParseLogs', ...args)
}
export function updateSystemSettings(...args: Parameters<typeof Server.updateSystemSettings>) {
  return callRpc<typeof Server.updateSystemSettings>('admin', 'updateSystemSettings', ...args)
}
