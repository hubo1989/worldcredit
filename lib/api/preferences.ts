// lib/api/preferences.ts — client-side RPC wrappers (server: preferences.server.ts).
import type * as Server from './preferences.server'
import { callRpc } from './rpc-client'

export type { UserPreferences } from '../types'
export {
  DEFAULT_DISPLAY_CONFIG,
  DEFAULT_REMINDER_CONFIG,
} from './preferences.shared'

export function getUserPreferences(...args: Parameters<typeof Server.getUserPreferences>) {
  return callRpc<typeof Server.getUserPreferences>('preferences', 'getUserPreferences', ...args)
}
export function updateUserPreferences(...args: Parameters<typeof Server.updateUserPreferences>) {
  return callRpc<typeof Server.updateUserPreferences>('preferences', 'updateUserPreferences', ...args)
}
