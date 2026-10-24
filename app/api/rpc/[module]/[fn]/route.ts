// app/api/rpc/[module]/[fn]/route.ts — the single entry point for the named
// RPC API. The browser can only invoke functions allowlisted in
// lib/api/registry.ts. Identity comes from the HMAC-signed wc_user session
// cookie; members additionally pass per-entry memberGuard checks and get
// memberFilter applied to responses before they leave the server.

import { RPC_REGISTRY, type RpcEntry } from '@/lib/api/registry'
import { readSession } from '@/lib/session'
import { buildMemberContext, MemberScopeError, type MemberContext } from '@/lib/api/member-scope'
import { OpportunityError } from '@/lib/opportunities/errors'
import { RpcDomainError } from '@/lib/api/errors'
import type { OpportunityActor } from '@/lib/opportunities/types'
import type { SessionUser } from '@/lib/session'

export interface RpcDispatchResult {
  ok: boolean
  data?: unknown
  error?: string
  code?: string
  details?: unknown
  status: number
}

export function bindEntryArgs(args: unknown[], entry: RpcEntry, user: { id: string }): unknown[] {
  const finalArgs = [...args]
  if (entry.bindUser !== undefined) {
    finalArgs[entry.bindUser] = user.id
  }
  if (entry.bindField) {
    const { arg, field } = entry.bindField
    const target = finalArgs[arg]
    if (target && typeof target === 'object' && !Array.isArray(target)) {
      finalArgs[arg] = { ...(target as Record<string, unknown>), [field]: user.id }
    }
  }
  return finalArgs
}

export async function dispatchRpc(
  module: string,
  fn: string,
  args: unknown[],
  session: SessionUser
): Promise<RpcDispatchResult> {
  const entry = RPC_REGISTRY[module]?.[fn]
  if (!entry) {
    return { ok: false, error: '接口不存在', status: 404 }
  }
  if (entry.admin && session.role !== 'admin') {
    return { ok: false, error: '需要管理员权限', status: 403 }
  }

  const impl = entry.impl as (...args: unknown[]) => unknown
  const finalArgs = bindEntryArgs(args, entry, session)

  // Member isolation: resolve bound holders, validate args, and prepare the
  // response filter. Admins skip all of this.
  let memberCtx: MemberContext | null = null
  if (session.role === 'member') {
    memberCtx = await buildMemberContext(session)
    if (entry.memberGuard) {
      try {
        await entry.memberGuard(finalArgs, memberCtx)
      } catch (err) {
        if (err instanceof MemberScopeError) {
          return { ok: false, error: err.message, status: 403 }
        }
        throw err
      }
    }
  }

  try {
    const actor: OpportunityActor | null = entry.prependActor
      ? { user_id: session.id, role: session.role }
      : null
    const implArgs = actor ? [actor, ...finalArgs] : finalArgs
    let data = await impl(...implArgs)
    if (memberCtx && entry.memberFilter) data = await entry.memberFilter(data, memberCtx)
    return { ok: true, data, status: 200 }
  } catch (err) {
    if (err instanceof MemberScopeError) {
      return { ok: false, error: err.message, status: 403 }
    }
    if (err instanceof OpportunityError || err instanceof RpcDomainError) {
      return {
        ok: false,
        error: err.message,
        code: err.code,
        details: err.details,
        status: err.status,
      }
    }
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: message, status: 500 }
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ module: string; fn: string }> }
) {
  const session = await readSession(request)
  if (!session) {
    return Response.json({ error: '未登录' }, { status: 401 })
  }

  const { module, fn } = await params

  const contentLength = Number(request.headers.get('Content-Length') ?? '0')
  if (contentLength > 1_000_000) {
    return Response.json({ error: '请求体过大' }, { status: 413 })
  }

  let body: { args?: unknown }
  try {
    body = (await request.json()) as { args?: unknown }
  } catch {
    return Response.json({ error: '请求体不是合法 JSON' }, { status: 400 })
  }
  if (!Array.isArray(body.args)) {
    return Response.json({ error: '缺少 args 数组' }, { status: 400 })
  }

  const result = await dispatchRpc(module, fn, body.args, session)
  if (!result.ok) {
    if (result.code || result.details) {
      return Response.json(
        {
          data: null,
          error: result.error,
          code: result.code,
          details: result.details,
          request_id: crypto.randomUUID(),
        },
        { status: result.status }
      )
    }
    return Response.json({ data: null, error: result.error }, { status: result.status })
  }

  return Response.json({ data: result.data, error: null })
}
