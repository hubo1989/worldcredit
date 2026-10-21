// app/api/sync/pull/route.ts — Incremental sync pull endpoint.

import { getDb } from '@/lib/db'
import { readSession } from '@/lib/session'

const DEFAULT_LIMIT = 500
const MAX_LIMIT = 1000

const SYNCABLE_TABLES: Record<string, string> = {
  banks: 'id',
  card_products: 'id',
  benefits: 'id',
  promos: 'id',
  card_holders: 'id',
  credit_cards: 'id',
  bills: 'id',
  payments: 'id',
  user_preferences: 'user_id',
  notification_preferences: 'user_id',
  recurring_payables: 'id',
  recurring_payable_payments: 'id',
}

interface ChangeRow {
  seq: number
  tbl: string
  row_id: string
  op: 'upsert' | 'delete'
}

export async function POST(request: Request) {
  const session = await readSession(request)
  if (!session) {
    return Response.json({ error: '未登录' }, { status: 401 })
  }

  const body = (await request.json().catch(() => ({}))) as {
    cursor?: number
    limit?: number
  }

  const cursor = Math.max(0, Number(body.cursor) || 0)
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(body.limit) || DEFAULT_LIMIT))
  const db = getDb()

  const rawChanges = await db
    .prepare(
      `SELECT seq, tbl, row_id, op FROM sync_changes
       WHERE (owner_id = ? OR owner_id IS NULL) AND seq > ?
       ORDER BY seq ASC LIMIT ?`
    )
    .bind(session.id, cursor, limit)
    .all<ChangeRow>()

  const rows = rawChanges.results || []
  if (!rows.length) {
    return Response.json({
      cursor,
      has_more: false,
      changes: [],
      server_time: new Date().toISOString(),
    })
  }

  const maxSeq = rows[rows.length - 1].seq

  // Deduplicate by (tbl, row_id) keeping latest op
  const latestByEntity = new Map<string, ChangeRow>()
  for (const r of rows) {
    if (!SYNCABLE_TABLES[r.tbl]) continue
    latestByEntity.set(`${r.tbl}:${r.row_id}`, r)
  }

  const changes: Array<{
    tbl: string
    row_id: string
    op: 'upsert' | 'delete'
    row?: Record<string, unknown>
  }> = []

  for (const change of latestByEntity.values()) {
    const pkCol = SYNCABLE_TABLES[change.tbl]
    if (change.op === 'delete') {
      changes.push({
        tbl: change.tbl,
        row_id: change.row_id,
        op: 'delete',
      })
    } else {
      // Upsert: fetch current row
      const current = await db
        .prepare(`SELECT * FROM ${change.tbl} WHERE ${pkCol} = ?`)
        .bind(change.row_id)
        .first<Record<string, unknown>>()

      if (current) {
        changes.push({
          tbl: change.tbl,
          row_id: change.row_id,
          op: 'upsert',
          row: current,
        })
      } else {
        // If row no longer exists in DB, it was deleted in the meantime
        changes.push({
          tbl: change.tbl,
          row_id: change.row_id,
          op: 'delete',
        })
      }
    }
  }

  return Response.json({
    cursor: maxSeq,
    has_more: rows.length === limit,
    changes,
    server_time: new Date().toISOString(),
  })
}
