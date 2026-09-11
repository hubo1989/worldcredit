// lib/db/helpers.ts — thin wrapper around D1 that mimics the PostgREST-style
// `{ data, error }` return shape used throughout lib/api/*.ts, so callers can be
// migrated with minimal diff. Does NOT support nested select(); those calls
// must be rewritten manually to JOIN or separate queries.

import { getDb } from './client'

// Server-only helpers: every module importing these runs inside the Worker
// (API routes, cron, email worker). Browser code reaches data exclusively via
// the named RPC API (lib/api/*.ts + /api/rpc/*).

export interface DbResult<T> {
  data: T | null
  error: { message: string; code?: string } | null
}

export async function query<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<DbResult<T[]>> {
  try {
    const db = getDb()
    const stmt = db.prepare(sql).bind(...params)
    const { results } = await stmt.all<T>()
    return { data: results ?? [], error: null }
  } catch (err) {
    return { data: null, error: { message: err instanceof Error ? err.message : String(err) } }
  }
}

export async function queryOne<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<DbResult<T | null>> {
  const res = await query<T>(sql, params)
  if (res.error) return { data: null, error: res.error }
  return { data: res.data?.[0] ?? null, error: null }
}

export async function execute(sql: string, params: unknown[] = []): Promise<DbResult<{ changes: number }>> {
  try {
    const db = getDb()
    const result = await db.prepare(sql).bind(...params).run()
    return { data: { changes: result.meta.changes ?? 0 }, error: null }
  } catch (err) {
    return { data: null, error: { message: err instanceof Error ? err.message : String(err) } }
  }
}

/** Batch multiple statements in a single D1 round-trip (implicit transaction). */
export async function batch(
  statements: { sql: string; params?: unknown[] }[]
): Promise<DbResult<D1Result[]>> {
  try {
    const db = getDb()
    const stmts = statements.map(s => (s.params ? db.prepare(s.sql).bind(...s.params) : db.prepare(s.sql)))
    const results = await db.batch(stmts)
    return { data: results, error: null }
  } catch (err) {
    return { data: null, error: { message: err instanceof Error ? err.message : String(err) } }
  }
}

export function uuid(): string {
  return crypto.randomUUID()
}

export function now(): string {
  return new Date().toISOString()
}

export function today(): string {
  return new Date().toISOString().slice(0, 10)
}
