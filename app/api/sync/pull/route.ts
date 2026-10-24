// app/api/sync/pull/route.ts — Incremental sync with optional authoritative recovery.

import { getDb } from '@/lib/db'
import { readSession } from '@/lib/session'

const DEFAULT_LIMIT = 500
const MAX_LIMIT = 1000
const MAX_RECONCILE_TARGETS = 100
const MAX_ROW_ID_LENGTH = 256

// SQL identifiers and predicates come exclusively from this server-owned allowlist.
// Recheck current ownership: a historical change can outlive a holder transfer.
const SYNCABLE_TABLES = {
  banks: { pk: 'id', owner: null },
  card_products: { pk: 'id', owner: null },
  benefits: { pk: 'id', owner: null },
  promos: { pk: 'id', owner: null },
  card_holders: { pk: 'id', owner: 't.managed_by = ?' },
  credit_cards: {
    pk: 'id',
    owner: `EXISTS (SELECT 1 FROM card_holders ch
      WHERE ch.id = t.holder_id AND ch.managed_by = ?)`,
  },
  bills: {
    pk: 'id',
    owner: `EXISTS (SELECT 1 FROM credit_cards cc
      JOIN card_holders ch ON ch.id = cc.holder_id
      WHERE cc.id = t.card_id AND ch.managed_by = ?)`,
  },
  payments: {
    pk: 'id',
    owner: `EXISTS (SELECT 1 FROM bills b
      JOIN credit_cards cc ON cc.id = b.card_id
      JOIN card_holders ch ON ch.id = cc.holder_id
      WHERE b.id = t.bill_id AND ch.managed_by = ?)`,
  },
  user_preferences: { pk: 'user_id', owner: 't.user_id = ?' },
  notification_preferences: { pk: 'user_id', owner: 't.user_id = ?' },
  recurring_payables: { pk: 'id', owner: 't.created_by = ?' },
  recurring_payable_payments: {
    pk: 'id',
    owner: `EXISTS (SELECT 1 FROM recurring_payables rp
      WHERE rp.id = t.payable_id AND rp.created_by = ?)`,
  },
} as const

type SyncTable = keyof typeof SYNCABLE_TABLES
interface EntityTarget {
  tbl: SyncTable
  row_id: string
}

interface ChangeRow {
  seq: number
  tbl: string
  row_id: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isSyncTable(value: unknown): value is SyncTable {
  return typeof value === 'string' && Object.hasOwn(SYNCABLE_TABLES, value)
}

function isEntityTarget(value: unknown): value is EntityTarget {
  return isRecord(value) && isSyncTable(value.tbl) &&
    typeof value.row_id === 'string' && value.row_id.trim().length > 0 &&
    value.row_id.length <= MAX_ROW_ID_LENGTH
}

export async function POST(request: Request) {
  const session = await readSession(request)
  if (!session) {
    return Response.json({ error: '未登录' }, { status: 401 })
  }

  const parsed: unknown = await request.json().catch(() => ({}))
  const body = isRecord(parsed) ? parsed : {}
  const reconcile = body.reconcile === undefined ? [] : body.reconcile
  if (!Array.isArray(reconcile) || reconcile.length > MAX_RECONCILE_TARGETS ||
      !reconcile.every(isEntityTarget)) {
    return Response.json({ error: 'reconcile 必须是最多 100 个合法的 {tbl,row_id} 实体' }, { status: 400 })
  }

  const cursor = Math.max(0, Number(body.cursor) || 0)
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(body.limit) || DEFAULT_LIMIT))
  const db = getDb()
  const rawChanges = await db
    .prepare(
      `SELECT seq, tbl, row_id FROM sync_changes
       WHERE (owner_id = ? OR owner_id IS NULL) AND seq > ?
       ORDER BY seq ASC LIMIT ?`
    )
    .bind(session.id, cursor, limit)
    .all<ChangeRow>()

  const rows = rawChanges.results || []
  const maxSeq = rows.length ? rows[rows.length - 1].seq : cursor
  const entities = new Map<string, EntityTarget>()
  for (const change of rows) {
    if (isSyncTable(change.tbl)) {
      entities.set(`${change.tbl}:${change.row_id}`, { tbl: change.tbl, row_id: change.row_id })
    }
  }
  for (const target of reconcile) {
    entities.set(`${target.tbl}:${target.row_id}`, { tbl: target.tbl, row_id: target.row_id })
  }

  const changes: Array<EntityTarget & {
    op: 'upsert' | 'delete'
    row?: Record<string, unknown>
  }> = []

  // Both incremental and explicitly reconciled entities use current authoritative
  // state. Missing and inaccessible entities are indistinguishable to clients.
  for (const target of entities.values()) {
    const { pk, owner } = SYNCABLE_TABLES[target.tbl]
    const statement = db.prepare(`SELECT t.* FROM ${target.tbl} t
      WHERE t.${pk} = ?${owner ? ` AND ${owner}` : ''}`)
    const current = await statement
      .bind(...(owner ? [target.row_id, session.id] : [target.row_id]))
      .first<Record<string, unknown>>()

    changes.push(current
      ? { ...target, op: 'upsert', row: current }
      : { ...target, op: 'delete' })
  }

  return Response.json({
    cursor: maxSeq,
    has_more: rows.length === limit,
    changes,
    server_time: new Date().toISOString(),
  })
}
