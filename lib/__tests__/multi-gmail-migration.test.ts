import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { handleScheduled } from '../../worker/cron'
import { createSqliteD1, SQLITE_D1_MIGRATIONS_DIR, type SqliteD1 } from './helpers/sqlite-d1'

const files = readdirSync(SQLITE_D1_MIGRATIONS_DIR).filter(file => file.endsWith('.sql')).sort()
let db: SqliteD1

function apply(migrations: string[]) {
  for (const file of migrations) db.exec(readFileSync(join(SQLITE_D1_MIGRATIONS_DIR, file), 'utf8'))
}

beforeEach(() => {
  db = createSqliteD1()
  db.exec('PRAGMA foreign_keys = ON')
  apply(files.filter(file => file < '0034'))
})
afterEach(() => db.close())

it('preserves connections, messages and legacy payments while making drafts and multi-mailbox ownership possible', () => {
  db.exec(`
    INSERT INTO users (id, email, password_hash) VALUES ('u', 'u@example.test', 'x'), ('v', 'v@example.test', 'x');
    INSERT INTO gmail_connections (user_id, google_sub, email, refresh_token_enc, scopes, last_sync_summary)
      VALUES ('u', 'sub-old', 'old@example.test', 'ciphertext', 'gmail.readonly', 'previous sync');
    INSERT INTO gmail_sync_messages (gmail_message_id, user_id, rfc_message_id, raw_r2_key, status)
      VALUES ('m1', 'u', '<Bill@Bank.Example>', 'gmail-raw/u/m1.eml', 'draft_parked');
    INSERT INTO bill_import_drafts (id, created_by, parsed_payload) VALUES ('old-draft', 'u', '{}');
    INSERT INTO card_holders (id, created_by, managed_by, name) VALUES ('h', 'u', 'u', 'Holder');
    INSERT INTO card_products (id, bank_name, card_name) VALUES ('p', 'Test Bank', 'Test Card');
    INSERT INTO credit_cards (id, holder_id, card_product_id, billing_day) VALUES ('c', 'h', 'p', 1);
    INSERT INTO bills (id, card_id, bill_month, bill_amount, due_date) VALUES ('b', 'c', '2026-10', 100, '2026-11-10');
    INSERT INTO gmail_ledger_entries
      (id, ledger_id, created_by, bank, account_tail, currency, statement_amount, paid_amount, due_date, matched_bill_id, manually_priced)
    VALUES
      ('partial', 'l1', 'u', 'Test Bank', '4321', 'USD', 100, 25, '2026-11-10', NULL, 0),
      ('duplicate', 'l2', 'u', 'Test Bank', '4321', 'USD', 100, 0, '2026-11-10', NULL, 0),
      ('other-currency', 'l3', 'u', 'Test Bank', '4321', 'HKD', 100, 0, '2026-11-10', NULL, 0),
      ('unpriced', 'l4', 'u', 'Test Bank', '4321', 'USD', 0, 0, NULL, NULL, 0),
      ('matched', 'l5', 'u', 'Test Bank', '4321', 'USD', 100, 100, '2026-11-10', 'b', 0),
      ('undated-a', 'l6', 'u', 'Test Bank', '4321', 'USD', 100, 0, NULL, NULL, 1),
      ('undated-b', 'l7', 'u', 'Test Bank', '4321', 'USD', 100, 25, NULL, NULL, 1);
  `)
  const migrations = files.filter(file => file >= '0034' && file < '0037')
  expect(migrations).toHaveLength(3)
  apply(migrations)
  expect(db.raw.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  expect(db.raw.prepare("SELECT id, refresh_token_enc, last_sync_summary FROM gmail_connections WHERE user_id='u'").get())
    .toEqual({ id: 'gconn_u', refresh_token_enc: 'ciphertext', last_sync_summary: 'previous sync' })
  expect(db.raw.prepare("SELECT connection_id, rfc_message_id, raw_r2_key FROM gmail_sync_messages WHERE gmail_message_id='m1'").get())
    .toEqual({ connection_id: 'gconn_u', rfc_message_id: 'bill@bank.example', raw_r2_key: 'gmail-raw/u/m1.eml' })
  db.exec(`
    INSERT INTO gmail_connections (id, user_id, google_sub, email, refresh_token_enc, scopes)
      VALUES ('another', 'u', 'sub-new', 'new@example.test', 'another-ciphertext', 'gmail.readonly');
    INSERT INTO gmail_sync_messages (connection_id, gmail_message_id, user_id, status)
      VALUES (NULL, 'm1', 'v', 'skipped');
    UPDATE bill_import_drafts SET source_connection_id = 'gconn_u' WHERE id = 'old-draft';
    DELETE FROM gmail_connections WHERE id = 'gconn_u';
  `)
  expect(db.raw.prepare("SELECT connection_id FROM gmail_sync_messages WHERE user_id='u'").get())
    .toEqual({ connection_id: null })
  expect(db.raw.prepare("SELECT parse_status, source_connection_id FROM bill_import_drafts WHERE id='old-draft'").get())
    .toEqual({ parse_status: 'ready', source_connection_id: null })
  expect(db.raw.prepare("SELECT id FROM gmail_connections WHERE user_id='u'").get()).toEqual({ id: 'another' })
  expect(db.raw.prepare('SELECT id, migration_status FROM gmail_ledger_entries ORDER BY id').all()).toEqual([
    { id: 'duplicate', migration_status: 'skipped_noise' },
    { id: 'matched', migration_status: 'archived_matched' },
    { id: 'other-currency', migration_status: 'migrated_to_draft' },
    { id: 'partial', migration_status: 'migrated_to_draft' },
    { id: 'undated-a', migration_status: 'migrated_to_draft' },
    { id: 'undated-b', migration_status: 'migrated_to_draft' },
    { id: 'unpriced', migration_status: 'migrated_to_draft' },
  ])
  expect(db.raw.prepare(`
    SELECT json_extract(parsed_payload, '$.legacy_ledger.paid_amount') AS paid_amount
    FROM bill_import_drafts WHERE id = 'draft_leg_partial'
  `).get()).toEqual({ paid_amount: 25 })
  expect(db.raw.prepare("SELECT COUNT(*) AS count FROM bills").get()).toEqual({ count: 1 })
  expect(db.raw.prepare("SELECT COUNT(*) AS count FROM payments").get()).toEqual({ count: 0 })
})

it('cleans only old R2 draft objects without a live draft or bill reference', async () => {
  apply(files.filter(file => file >= '0034' && file < '0037'))
  db.exec(`
    INSERT INTO bill_import_drafts (id, created_by, file_ref, parsed_payload, status) VALUES
      ('active', 'u', NULL, '{"attachment_ids":["shared"]}', 'draft'),
      ('discarded', 'u', 'discarded-file', '{}', 'discarded');
    INSERT INTO record_attachments (id, record_type, record_id, storage_path, file_name, uploaded_by) VALUES
      ('shared', 'draft', 'discarded', 'draft-files/u/shared', 'file', 'u'),
      ('discarded-file', 'draft', 'discarded', 'draft-files/u/discarded', 'file', 'u'),
      ('missing-bill', 'bill', 'deleted', 'draft-files/u/missing-bill', 'file', 'u');
  `)
  const old = new Date(Date.now() - 48 * 60 * 60 * 1000)
  const remove = vi.fn()
  const pending: Promise<unknown>[] = []
  const bucket = {
    list: async () => ({
      truncated: false,
      objects: [
        ...['shared', 'discarded', 'missing-bill', 'unregistered'].map(name => ({ key: `draft-files/u/${name}`, uploaded: old })),
        { key: 'draft-files/u/recent', uploaded: new Date() },
      ],
    }),
    delete: remove,
  } as unknown as R2Bucket
  await handleScheduled({ scheduledTime: Date.now() } as ScheduledEvent, {
    DB: db as unknown as D1Database, ATTACHMENTS: bucket,
  }, { waitUntil: (promise: Promise<unknown>) => pending.push(promise) } as unknown as ExecutionContext)
  await Promise.all(pending)
  expect(remove).toHaveBeenCalledWith(['draft-files/u/discarded', 'draft-files/u/missing-bill', 'draft-files/u/unregistered'])
  expect(db.raw.prepare('SELECT id FROM record_attachments').all()).toEqual([{ id: 'shared' }])
})
