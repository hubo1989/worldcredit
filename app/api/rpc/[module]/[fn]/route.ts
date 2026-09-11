// app/api/rpc/[module]/[fn]/route.ts — the single entry point for the named
// RPC API. Replaces the migration-era /api/sql-proxy and /api/db-proxy
// bridges: the browser can only invoke functions that are allowlisted in
// lib/api/registry.ts, and user identity always comes from the session cookie.

import { RPC_REGISTRY, type RpcEntry } from '@/lib/api/registry'

interface SessionUser {
  id: string
  role: string
}

function sessionFromCookie(request: Request): SessionUser | null {
  const cookie = request.headers.get('Cookie') ?? ''
  const match = cookie.match(/wc_user=([^;]+)/)
  if (!match) return null
  try {
    const parsed = JSON.parse(decodeURIComponent(match[1])) as Partial<SessionUser>
    if (!parsed || typeof parsed.id !== 'string' || !parsed.id) return null
    return { id: parsed.id, role: typeof parsed.role === 'string' ? parsed.role : 'member' }
  } catch {
    return null
  }
}

function bindEntryArgs(args: unknown[], entry: RpcEntry, user: SessionUser): unknown[] {
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

export async function POST(
  request: Request,
  { params }: { params: Promise<{ module: string; fn: string }> }
) {
  const user = sessionFromCookie(request)
  if (!user) {
    return Response.json({ error: '未登录' }, { status: 401 })
  }

  const { module, fn } = await params
  const entry = RPC_REGISTRY[module]?.[fn]
  if (!entry) {
    return Response.json({ error: '接口不存在' }, { status: 404 })
  }
  if (entry.admin && user.role !== 'admin') {
    return Response.json({ error: '需要管理员权限' }, { status: 403 })
  }

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

  const impl = entry.impl as (...args: unknown[]) => unknown
  const finalArgs = bindEntryArgs(body.args, entry, user)
  try {
    const data = await impl(...finalArgs)
    return Response.json({ data, error: null })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return Response.json({ data: null, error: message }, { status: 500 })
  }
}
