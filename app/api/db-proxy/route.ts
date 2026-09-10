// app/api/db-proxy/route.ts
// Generic D1 proxy for client components during migration.
// TODO(replace): Refactor client components to use dedicated API routes and remove this proxy.

import { getDb } from '@/lib/db'

interface ProxyRequest {
  table: string
  operation: 'select' | 'insert' | 'update' | 'delete'
  columns?: string
  filters?: Record<string, unknown>
  data?: Record<string, unknown>
  limit?: number
  orderBy?: { column: string; ascending: boolean }
}

const ALLOWED_TABLES = new Set([
  'banks', 'card_products', 'benefits', 'promos', 'card_holders', 'credit_cards',
  'bills', 'bill_items', 'payments', 'benefit_usages', 'promo_usages',
  'push_subscriptions', 'gmail_ledger_entries', 'bill_import_drafts',
  'record_attachments', 'email_parse_logs', 'user_preferences',
  'bill_email_sources', 'notification_preferences', 'notification_history',
  'system_settings',
])

export async function POST(request: Request) {
  const body = await request.json() as ProxyRequest
  const { table, operation, data } = body

  if (!ALLOWED_TABLES.has(table)) {
    return Response.json({ error: `Table "${table}" not allowed` }, { status: 403 })
  }

  const db = getDb()

  try {
    if (operation === 'select') {
      const cols = body.columns || '*'
      let sql = `SELECT ${cols} FROM ${table}`
      const params: unknown[] = []
      if (body.filters) {
        const conditions = Object.entries(body.filters).map(([k]) => {
          params.push(k)
          return `${k} = ?`
        })
        if (conditions.length > 0) sql += ` WHERE ${conditions.join(' AND ')}`
      }
      if (body.orderBy) {
        sql += ` ORDER BY ${body.orderBy.column} ${body.orderBy.ascending ? 'ASC' : 'DESC'}`
      }
      if (body.limit) sql += ` LIMIT ?`
      const stmt = db.prepare(sql)
      const allParams = [
        ...Object.values(body.filters || {}),
        ...(body.limit ? [body.limit] : []),
      ]
      const result = await stmt.bind(...allParams).all()
      return Response.json({ data: result.results, error: null })
    }

    if (operation === 'insert' && data) {
      const cols = Object.keys(data)
      const placeholders = cols.map(() => '?').join(',')
      const sql = `INSERT INTO ${table} (${cols.join(',')}) VALUES (${placeholders})`
      await db.prepare(sql).bind(...Object.values(data)).run()
      return Response.json({ data, error: null })
    }

    if (operation === 'update' && data && body.filters) {
      const sets = Object.keys(data).map(k => `${k} = ?`)
      const conditions = Object.keys(body.filters).map(k => `${k} = ?`)
      const sql = `UPDATE ${table} SET ${sets.join(', ')} WHERE ${conditions.join(' AND ')}`
      await db.prepare(sql).bind(...Object.values(data), ...Object.values(body.filters)).run()
      return Response.json({ data, error: null })
    }

    if (operation === 'delete' && body.filters) {
      const conditions = Object.keys(body.filters).map(k => `${k} = ?`)
      const sql = `DELETE FROM ${table} WHERE ${conditions.join(' AND ')}`
      await db.prepare(sql).bind(...Object.values(body.filters)).run()
      return Response.json({ data: null, error: null })
    }

    return Response.json({ error: 'Invalid operation' }, { status: 400 })
  } catch (err) {
    return Response.json({
      data: null,
      error: { message: err instanceof Error ? err.message : String(err) }
    }, { status: 500 })
  }
}
