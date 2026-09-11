// lib/api/push.ts — client-side RPC wrappers (server: push.server.ts).
import type * as Server from './push.server'
import { callRpc } from './rpc-client'

export function subscribePush(input: Server.PushSubscribeInput) {
  // userId 位置由服务端 registry 以会话身份覆盖（bindUser: 1）
  return callRpc<typeof Server.subscribePush>('push', 'subscribePush', input, '')
}
