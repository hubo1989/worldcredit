// lib/api/passwordVault.ts — client-side RPC wrappers (server: passwordVault.server.ts).
import type * as Server from './passwordVault.server'
import { callRpc } from './rpc-client'

export type {
  StatementPasswordRuleDto,
  StatementPasswordRuleInput,
} from './passwordVault.server'

export function listPasswordRules(...args: Parameters<typeof Server.listPasswordRules>) {
  return callRpc<typeof Server.listPasswordRules>('passwordVault', 'listPasswordRules', ...args)
}
export function createPasswordRule(...args: Parameters<typeof Server.createPasswordRule>) {
  return callRpc<typeof Server.createPasswordRule>('passwordVault', 'createPasswordRule', ...args)
}
export function updatePasswordRule(...args: Parameters<typeof Server.updatePasswordRule>) {
  return callRpc<typeof Server.updatePasswordRule>('passwordVault', 'updatePasswordRule', ...args)
}
export function deletePasswordRule(...args: Parameters<typeof Server.deletePasswordRule>) {
  return callRpc<typeof Server.deletePasswordRule>('passwordVault', 'deletePasswordRule', ...args)
}
