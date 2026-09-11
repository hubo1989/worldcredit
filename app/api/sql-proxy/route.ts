// app/api/sql-proxy/route.ts
// Browser bridge for the D1 migration: client components share the server-side
// lib/api modules, whose SQL goes through lib/db helpers. In the browser those
// helpers forward statements here so they execute against D1 in the Worker.
// Guardrails: requires the wc_user session cookie, forbids the users table and
// SQLite internals, and relies on D1 single-statement semantics (no stacking).
// TODO(replace): retire this bridge once client pages use dedicated API routes.

import { getDb } from '@/lib/db'

interface Statement {
  sql: string
  params?: unknown[]
}

interface SqlProxyRequest extends Statement {
  batch?: Statement[]
}

// Never let browser queries touch credentials or SQLite internals.
const BLOCKED_PATTERNS = ['users', 'sqlite_']

function isAllowed(sql: string): boolean {
  const lowered = sql.toLowerCase()
  return !BLOCKED_PATTERNS.some(p => lowered.includes(p))
}

function isReadStatement(sql: string): boolean {
  const cmd = sql.trimStart().slice(0, 6).toLowerCase()
  return cmd === 'select' || cmd === 'with '
}

export async function POST(request: Request) {
  const cookie = request.headers.get('Cookie') ?? ''
  if (!/(^|;\s*)wc_user=/.test(cookie)) {
    return Response.json({ data: null, error: { message: '未登录' } }, { status: 401 })
  }

  let body: SqlProxyRequest
  try {
    body = (await request.json()) as SqlProxyRequest
  } catch {
    return Response.json({ data: null, error: { message: '请求体不是合法 JSON' } }, { status: 400 })
  }

  const statements = body.batch ?? (body.sql ? [body] : [])
  if (statements.length === 0) {
    return Response.json({ data: null, error: { message: '缺少 SQL 语句' } }, { status: 400 })
  }
  for (const stmt of statements) {
    if (typeof stmt.sql !== 'string' || !isAllowed(stmt.sql)) {
      return Response.json({ data: null, error: { message: '语句包含不允许的表' } }, { status: 403 })
    }
  }

  try {
    const db = getDb()

    if (body.batch) {
      const stmts = statements.map(s => {
        const prepared = db.prepare(s.sql)
        return s.params && s.params.length > 0 ? prepared.bind(...s.params) : prepared
      })
      const results = await db.batch(stmts)
      const data = results.map(r => ({ results: r.results ?? [], meta: { changes: r.meta?.changes ?? 0 } }))
      return Response.json({ data, error: null })
    }

    const prepared = db.prepare(body.sql).bind(...(body.params ?? []))
    if (isReadStatement(body.sql)) {
      const { results } = await prepared.all()
      return Response.json({ data: results ?? [], error: null })
    }
    const result = await prepared.run()
    return Response.json({ data: { changes: result.meta?.changes ?? 0 }, error: null })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return Response.json({ data: null, error: { message } })
  }
}
