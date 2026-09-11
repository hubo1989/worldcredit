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

// 表名走 ALLOWED_TABLES 白名单；其余标识符（列名等）统一校验，
// 拒绝任何非 [A-Za-z0-9_] 字符，杜绝标识符拼接注入。
function assertIdentifier(name: string, label: string): string {
  if (!/^[A-Za-z0-9_]+$/.test(name)) {
    throw new Error('不支持的' + label + ': ' + name)
  }
  return name
}

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
      if (cols.includes('!') || cols.includes('(')) {
        return Response.json({ error: 'columns 仅支持普通列名' }, { status: 400 })
      }
      let sql = `SELECT ${cols} FROM ${table}`
      const params: unknown[] = []
      if (body.filters) {
        const conditions = Object.entries(body.filters).map(([k, v]) => {
          const op = k.endsWith('__in') ? 'in' : k.endsWith('__neq') ? 'neq' : k.endsWith('__gte') ? 'gte' : k.endsWith('__lte') ? 'lte' : 'eq'
          const col = op === 'eq' ? k : k.slice(0, -(op.length + 2))
          if (!/^[A-Za-z0-9_.]+$/.test(col)) {
            throw new Error('不支持的过滤列: ' + col)
          }
          if (op === 'in') {
            if (!Array.isArray(v)) throw new Error('__in 过滤值必须是数组')
            if (v.length === 0) return '1=0'
            params.push(...v)
            return `${col} IN (${v.map(() => '?').join(',')})`
          }
          const sqlOp = op === 'neq' ? '!=' : op === 'gte' ? '>=' : op === 'lte' ? '<=' : '='
          params.push(v)
          return `${col} ${sqlOp} ?`
        })
        if (conditions.length > 0) sql += ` WHERE ${conditions.join(' AND ')}`
      }
      if (body.orderBy) {
        assertIdentifier(body.orderBy.column, '排序列')
        sql += ` ORDER BY ${body.orderBy.column} ${body.orderBy.ascending ? 'ASC' : 'DESC'}`
      }
      if (body.limit) sql += ` LIMIT ?`
      const stmt = db.prepare(sql)
      const allParams = [...params, ...(body.limit ? [body.limit] : [])]
      const result = await stmt.bind(...allParams).all()
      return Response.json({ data: result.results, error: null })
    }

    if (operation === 'insert' && data) {
      const cols = Object.keys(data).map(c => assertIdentifier(c, '插入列'))
      const placeholders = cols.map(() => '?').join(',')
      const sql = `INSERT INTO ${table} (${cols.join(',')}) VALUES (${placeholders})`
      await db.prepare(sql).bind(...Object.values(data)).run()
      return Response.json({ data, error: null })
    }

    if (operation === 'update' && data && body.filters) {
      const sets = Object.keys(data).map(k => assertIdentifier(k, '更新列') + ' = ?')
      const conditions = Object.keys(body.filters).map(k => assertIdentifier(k, '过滤列') + ' = ?')
      const sql = `UPDATE ${table} SET ${sets.join(', ')} WHERE ${conditions.join(' AND ')}`
      await db.prepare(sql).bind(...Object.values(data), ...Object.values(body.filters)).run()
      return Response.json({ data, error: null })
    }

    if (operation === 'delete' && body.filters) {
      const conditions = Object.keys(body.filters).map(k => assertIdentifier(k, '过滤列') + ' = ?')
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
