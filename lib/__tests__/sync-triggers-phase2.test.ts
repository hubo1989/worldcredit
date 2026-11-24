import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FIXTURE_IDS, LEDGER_IDS, seedOpportunityFixtures, seedOpportunityLedgerWorld } from './helpers/opportunity-fixtures'
import { createSqliteD1, SQLITE_D1_MIGRATIONS_DIR, type SqliteD1 } from './helpers/sqlite-d1'

const apnsMigration = '0037_opportunity_apns_deliveries.sql'
const syncMigration = '0038_sync_triggers_opportunities_notifications.sql'
const sql = (migration: string) => readFileSync(join(SQLITE_D1_MIGRATIONS_DIR, migration), 'utf8')
const rollback = (migration: string) => sql(migration).split('\n')
  .filter(line => line.startsWith('-- rollback: ')).map(line => line.slice('-- rollback: '.length)).join('\n')

const tables = [
  'opportunity_definitions', 'opportunity_rule_versions', 'opportunity_accounts', 'opportunity_account_cards',
  'opportunity_cycles', 'opportunity_usages', 'opportunity_tasks', 'opportunity_task_cycles',
  'opportunity_fulfillments', 'opportunity_user_states', 'opportunity_reminder_states', 'notification_history',
]
const { users, holders, cards } = FIXTURE_IDS
const { definitions, versions, accounts, cycles } = LEDGER_IDS
const NOW = '2026-10-15T01:00:00Z'
let db: SqliteD1

function phase2Changes(after = 0) {
  return db.raw.prepare(
    `SELECT owner_id, tbl, row_id, op FROM sync_changes
     WHERE seq > ? AND tbl IN (${tables.map(() => '?').join(', ')}) ORDER BY seq`,
  ).all(after, ...tables)
}

function cursor() {
  return Number(db.raw.prepare('SELECT max(seq) AS seq FROM sync_changes').get()?.seq ?? 0)
}

function changesFor(table: string, id: string, after = 0) {
  return db.raw.prepare(
    'SELECT owner_id, op FROM sync_changes WHERE seq > ? AND tbl = ? AND row_id = ? ORDER BY owner_id, seq',
  ).all(after, table, id)
}

async function seedAdditionalRows() {
  await db.batch([
    db.prepare(`INSERT INTO opportunity_tasks
      (id, holder_id, task_type, title, card_ids_json, rules_json, reward_json, created_by, created_at, updated_at)
      VALUES ('task', ?, 'custom', 'Test', '[]', '{}', '{}', ?, ?, ?)`).bind(holders.self, users.adminA, NOW, NOW),
    db.prepare(`INSERT INTO opportunity_task_cycles
      (id, task_id, cycle_key, rules_snapshot_json, reward_snapshot_json, period_start_on, period_end_before, deadline_at, updated_at)
      VALUES ('task-cycle', 'task', 'cycle', '{}', '{}', '2026-10-01', '2026-11-01', ?, ?)`).bind(NOW, NOW),
    db.prepare(`INSERT INTO opportunity_fulfillments
      (id, holder_id, kind, task_cycle_id, reward_key, source_key, status, recorded_on, created_by, updated_by, created_at, updated_at)
      VALUES ('reward', ?, 'task_result', 'task-cycle', 'gift', 'source', 'recorded', '2026-10-15', ?, ?, ?, ?)`)
      .bind(holders.self, users.adminA, users.adminA, NOW, NOW),
    db.prepare(`INSERT INTO opportunity_user_states (user_id, account_id, followed, updated_at) VALUES (?, ?, 1, ?)`)
      .bind(users.adminA, accounts.self, NOW),
    db.prepare(`INSERT INTO opportunity_reminder_states (user_id, event_key, updated_at) VALUES (?, ?, ?)`)
      .bind(users.adminA, 'event:"\\test', NOW),
    db.prepare(`INSERT INTO notification_history (id, user_id, notification_key, title, deleted_at)
      VALUES ('notice', ?, 'notice', 'Hello', NULL), ('removed-notice', ?, 'removed', 'Removed', ?)`)
      .bind(users.adminA, users.adminA, NOW),
  ])
}

beforeEach(async () => {
  db = createSqliteD1()
  const files = readdirSync(SQLITE_D1_MIGRATIONS_DIR).filter(file => file.endsWith('.sql') && file < apnsMigration).sort()
  for (const file of files) db.exec(sql(file))
  await seedOpportunityFixtures(db)
  await seedOpportunityLedgerWorld(db)
  await seedAdditionalRows()
})

afterEach(() => db.close())

describe('Phase 2 D1 migrations', () => {
  it('preserves old Web Push deliveries and enforces the APNs channel enum', () => {
    db.raw.prepare(`INSERT INTO opportunity_notification_jobs
      (id, user_id, holder_id, event_key, delivery_key, object_kind, object_id, business_version, scheduled_at, created_at, updated_at)
      VALUES ('job', ?, ?, 'event', 'delivery', 'account', ?, 'v1', ?, ?, ?)`)
      .run(users.adminA, holders.self, accounts.self, NOW, NOW, NOW)
    db.exec(`INSERT INTO opportunity_notification_deliveries (id, job_id, subscription_id, status)
      VALUES ('existing', 'job', 'web-device', 'accepted')`)
    db.exec(sql(apnsMigration))
    db.exec(`INSERT INTO opportunity_notification_deliveries (id, job_id, subscription_id, status, channel)
      VALUES ('ios', 'job', 'apns:device', 'accepted', 'apns')`)
    expect(db.raw.prepare('SELECT id, channel FROM opportunity_notification_deliveries ORDER BY id').all())
      .toEqual([{ id: 'existing', channel: 'web_push' }, { id: 'ios', channel: 'apns' }])
    expect(() => db.exec(`INSERT INTO opportunity_notification_deliveries (id, job_id, subscription_id, status, channel)
      VALUES ('bad', 'job', 'another', 'accepted', 'unknown')`)).toThrow(/CHECK/)
    db.exec(rollback(apnsMigration))
    expect(db.raw.prepare('SELECT id FROM opportunity_notification_deliveries ORDER BY id').all())
      .toEqual([{ id: 'existing' }, { id: 'ios' }])
    db.exec(sql(apnsMigration))
    expect(db.raw.prepare('SELECT id, channel FROM opportunity_notification_deliveries ORDER BY id').all())
      .toEqual([{ id: 'existing', channel: 'web_push' }, { id: 'ios', channel: 'apns' }])
  })

  it('backfills all 12 tables in dependency order with private scopes and canonical tuple keys', () => {
    expect(phase2Changes()).toEqual([])
    db.exec(sql(syncMigration))
    const changes = phase2Changes()
    expect([...new Set(changes.map(row => row.tbl))]).toEqual(tables)
    expect(changesFor('opportunity_definitions', definitions.shared)).toEqual([{ owner_id: null, op: 'upsert' }])
    expect(changesFor('opportunity_rule_versions', versions.privateB)).toEqual([{ owner_id: users.adminB, op: 'upsert' }])
    expect(changesFor('opportunity_account_cards', JSON.stringify([accounts.self, cards.selfMain])))
      .toEqual([{ owner_id: users.adminA, op: 'upsert' }])
    expect(changesFor('opportunity_user_states', JSON.stringify([users.adminA, accounts.self])))
      .toEqual([{ owner_id: users.adminA, op: 'upsert' }])
    expect(changesFor('opportunity_reminder_states', JSON.stringify([users.adminA, 'event:"\\test'])))
      .toEqual([{ owner_id: users.adminA, op: 'upsert' }])
    expect(changesFor('notification_history', 'notice')).toEqual([{ owner_id: users.adminA, op: 'upsert' }])
    expect(changesFor('notification_history', 'removed-notice')).toEqual([])

    const before = cursor()
    db.exec(rollback(syncMigration))
    expect(db.raw.prepare(`SELECT name FROM sqlite_master WHERE name LIKE 'trg_phase2_%' OR name LIKE 'phase2_sync_%'`).all())
      .toEqual([])
    expect(db.raw.prepare('PRAGMA table_info(notification_history)').all().some(row => row.name === 'push_lease_until')).toBe(false)
    db.exec(sql(syncMigration))
    expect(cursor()).toBe(before)
  })

  it('fans out live writes and emits tombstones on member and manager transfers', () => {
    db.exec(sql(syncMigration))
    const member = users.memberA
    const beforeBind = cursor()
    db.raw.prepare('UPDATE card_holders SET auth_user_id = ? WHERE id = ?').run(member, holders.self)
    expect(changesFor('opportunity_accounts', accounts.self, beforeBind)).toEqual([{ owner_id: member, op: 'upsert' }])
    expect(changesFor('opportunity_user_states', JSON.stringify([users.adminA, accounts.self]), beforeBind)).toEqual([])

    const beforeUpdate = cursor()
    db.raw.prepare('UPDATE opportunity_cycles SET revision = revision + 1 WHERE id = ?').run(cycles.self)
    expect(changesFor('opportunity_cycles', cycles.self, beforeUpdate)).toEqual(
      [users.adminA, member].sort().map(owner_id => ({ owner_id, op: 'upsert' })),
    )
    const beforeUnbind = cursor()
    db.raw.prepare('UPDATE card_holders SET auth_user_id = NULL WHERE id = ?').run(holders.self)
    expect(changesFor('opportunity_cycles', cycles.self, beforeUnbind)).toEqual([{ owner_id: member, op: 'delete' }])

    const beforeTransfer = cursor()
    db.raw.prepare('UPDATE card_holders SET created_by = ?, managed_by = ? WHERE id = ?')
      .run(users.adminB, users.adminB, holders.self)
    expect(changesFor('opportunity_accounts', accounts.self, beforeTransfer)).toEqual([
      { owner_id: users.adminA, op: 'delete' }, { owner_id: users.adminB, op: 'upsert' },
    ])
    expect(changesFor('opportunity_user_states', JSON.stringify([users.adminA, accounts.self]), beforeTransfer))
      .toEqual([{ owner_id: users.adminA, op: 'delete' }])
  })

  it('records personal deletes and soft deletes while suppressing notification lease changes', () => {
    db.exec(sql(syncMigration))
    const before = cursor()
    db.exec(`UPDATE notification_history SET push_lease_until = '2026-10-15T01:05:00Z' WHERE id = 'notice'`)
    expect(phase2Changes(before)).toEqual([])
    db.raw.prepare('UPDATE notification_history SET deleted_at = ? WHERE id = ?').run(NOW, 'notice')
    db.raw.prepare('DELETE FROM opportunity_reminder_states WHERE user_id = ?').run(users.adminA)
    expect(phase2Changes(before)).toEqual([
      { owner_id: users.adminA, tbl: 'notification_history', row_id: 'notice', op: 'delete' },
      { owner_id: users.adminA, tbl: 'opportunity_reminder_states',
        row_id: JSON.stringify([users.adminA, 'event:"\\test']), op: 'delete' },
    ])
  })
})
