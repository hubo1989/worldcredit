#!/usr/bin/env node
// scripts/opportunities-backfill.mjs — legacy promo-usage backfill (plan Task 10,
// tech spec §6.3). Maps OLD promo_usages rows that carry a provable card into
// the opportunity ledger; everything ambiguous lands in needs_review and stays
// for the admin assignment flow (assignLegacyUsage RPC) with human evidence.
//
// Safety contract:
//   - dry-run by default: prints classification only, writes nothing
//   - writes require BOTH --persist-to <dir> (local SQLite file) AND --apply
//   - --remote is refused: production follows the release runbook
//     (docs/runbooks/opportunities-release.md) under separate authorization
//   - every mapped row commits command → write_checks → event → usage →
//     legacy_link in ONE transaction, so a source row maps exactly once or
//     not at all; re-running maps nothing new
//
// Usage:
//   node scripts/opportunities-backfill.mjs --persist-to /tmp/wc-backfill
//   node scripts/opportunities-backfill.mjs --persist-to /tmp/wc-backfill --apply

import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations', 'd1')
const WRAP_FILE = '0015_opportunity_legacy_catalog.sql'

// ---------------------------------------------------------------------------
// Local database (shared with tests)
// ---------------------------------------------------------------------------

export function openLocalDatabase(persistDir) {
  if (!existsSync(persistDir)) mkdirSync(persistDir, { recursive: true })
  const db = new DatabaseSync(join(persistDir, 'worldcredit.sqlite3'))
  db.exec('PRAGMA foreign_keys = ON')
  return db
}

export function applyLocalMigrations(db, dir = MIGRATIONS_DIR) {
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(dir, file), 'utf8'))
  }
}

/** Re-runs the idempotent catalog wrap (captures promos added after 0015). */
export function wrapLegacyCatalog(db, dir = MIGRATIONS_DIR) {
  db.exec(readFileSync(join(dir, WRAP_FILE), 'utf8'))
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

function parseRules(db, definitionId) {
  const row = db
    .prepare('SELECT rules_json FROM opportunity_rule_versions WHERE definition_id = ? ORDER BY version DESC LIMIT 1')
    .get(definitionId)
  return row ? JSON.parse(row.rules_json) : null
}

function validCivilDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [y, m, d] = value.split('-').map(Number)
  const days = [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]
  return m >= 1 && m <= 12 && d >= 1 && d <= days
}

/**
 * Classifies every unmapped promo_usages row. A row is mappable only when the
 * card still exists, its product matches (or the promo is bank-level), and the
 * used_at date sits inside the wrapped rule's usable window.
 */
export function classifyPromoUsages(db) {
  const rows = db
    .prepare(
      `SELECT pu.id AS source_id, pu.used_at, pu.card_id, p.id AS promo_id,
              p.card_product_id AS promo_product_id
       FROM promo_usages pu
       JOIN promos p ON p.id = pu.promo_id
       WHERE NOT EXISTS (
         SELECT 1 FROM opportunity_legacy_links l
         WHERE l.source_table = 'promo_usages' AND l.source_id = pu.id)
       ORDER BY pu.id`,
    )
    .all()

  const classified = rows.map((row) => {
    if (!validCivilDate(row.used_at)) return { ...row, status: 'needs_review', reason: 'invalid_date' }
    if (row.card_id === null) return { ...row, status: 'needs_review', reason: 'no_card' }
    const card = db
      .prepare('SELECT id, holder_id, card_product_id, status FROM credit_cards WHERE id = ?')
      .get(row.card_id)
    if (!card) return { ...row, status: 'needs_review', reason: 'card_deleted' }
    if (row.promo_product_id !== null && card.card_product_id !== row.promo_product_id) {
      return { ...row, status: 'needs_review', reason: 'product_mismatch' }
    }
    const def = db
      .prepare("SELECT id FROM opportunity_definitions WHERE legacy_promo_id = ?")
      .get(row.promo_id)
    if (!def) return { ...row, status: 'needs_review', reason: 'definition_missing' }
    const rules = parseRules(db, def.id)
    if (!rules) return { ...row, status: 'needs_review', reason: 'rule_version_missing' }
    const { valid_from, valid_until_before } = rules
    if (valid_from !== null && row.used_at < valid_from) {
      return { ...row, status: 'needs_review', reason: 'outside_window' }
    }
    if (valid_until_before !== null && row.used_at >= valid_until_before) {
      return { ...row, status: 'needs_review', reason: 'outside_window' }
    }
    return {
      ...row,
      status: 'would_map',
      definition_id: def.id,
      rules,
      card,
    }
  })

  const benefitUnassigned = db
    .prepare(
      `SELECT COUNT(*) AS n FROM benefit_usages bu
       WHERE NOT EXISTS (
         SELECT 1 FROM opportunity_legacy_links l
         WHERE l.source_table = 'benefit_usages' AND l.source_id = bu.id)`,
    )
    .get().n

  const byReason = {}
  for (const row of classified) {
    if (row.status === 'needs_review') byReason[row.reason] = (byReason[row.reason] ?? 0) + 1
  }
  return {
    rows: classified,
    summary: {
      promo_total: classified.length,
      would_map: classified.filter((r) => r.status === 'would_map').length,
      needs_review: classified.filter((r) => r.status === 'needs_review').length,
      by_reason: byReason,
      benefit_usages_never_auto_mapped: Number(benefitUnassigned),
    },
  }
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

function findOrCreateAccount(db, row, now) {
  // Card-scoped account keyed by definition + this card; the card's holder is
  // provable from the row itself.
  const existing = db
    .prepare(
      `SELECT a.id FROM opportunity_accounts a
       WHERE a.definition_id = ? AND a.scope_key = ? AND a.status = 'active'`,
    )
    .get(row.definition_id, `card:${row.card_id}`)
  if (existing) {
    const linked = db
      .prepare(
        'SELECT 1 AS ok FROM opportunity_account_cards WHERE account_id = ? AND card_id = ? AND retired_at IS NULL',
      )
      .get(existing.id, row.card_id)
    if (linked) return existing.id
    return null // account exists but card not linked — needs human review
  }
  const holder = db
    .prepare('SELECT created_by FROM card_holders WHERE id = ?')
    .get(row.card.holder_id)
  if (!holder) return null
  const accountId = `oacc_${randomUUID()}`
  db.prepare(
    `INSERT INTO opportunity_accounts (id, definition_id, holder_id, scope_kind, scope_key, created_by, created_at)
     VALUES (?,?,?,?,?,?,?)`,
  ).run(accountId, row.definition_id, row.card.holder_id, 'card', `card:${row.card_id}`, holder.created_by, now)
  db.prepare(
    `INSERT INTO opportunity_account_cards (account_id, definition_id, holder_id, card_id)
     VALUES (?,?,?,?)`,
  ).run(accountId, row.definition_id, row.card.holder_id, row.card_id)
  return accountId
}

function findOrCreateCycle(db, row, accountId, version, now) {
  const periodStart = row.rules.valid_from
  const periodEnd = row.rules.valid_until_before ?? null
  const cycleKey = `regular:${periodStart}`
  const existing = db
    .prepare('SELECT id FROM opportunity_cycles WHERE account_id = ? AND cycle_key = ?')
    .get(accountId, cycleKey)
  if (existing) return existing.id
  const cycleId = `ocyc_${randomUUID()}`
  db.prepare(
    `INSERT INTO opportunity_cycles (id, account_id, version_id, version_as_of_on, cycle_key, allocation_kind, period_start_on, period_end_before, usable_start_on, usable_end_before, time_zone, count_limit, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    cycleId, accountId, version.id, periodStart, cycleKey, 'regular',
    periodStart, periodEnd, periodStart, periodEnd, row.rules.time_zone ?? 'Asia/Shanghai',
    row.rules.count_limit ?? null, now,
  )
  return cycleId
}

/**
 * Applies every would_map row. Each row is one explicit transaction mirroring
 * the command protocol (§7.1); any failure rolls back that row only and is
 * reported, never silently skipped.
 */
export function applyPromoBackfill(db, { now = new Date().toISOString() } = {}) {
  const { rows } = classifyPromoUsages(db)
  const mappable = rows.filter((r) => r.status === 'would_map')
  const results = { mapped: 0, failed: [] }
  for (const row of mappable) {
    const version = db
      .prepare('SELECT id FROM opportunity_rule_versions WHERE definition_id = ? ORDER BY version DESC LIMIT 1')
      .get(row.definition_id)
    try {
      db.exec('BEGIN')
      const accountId = findOrCreateAccount(db, row, now)
      if (!accountId) throw new Error('account_conflict')
      const cycleId = findOrCreateCycle(db, row, accountId, version, now)
      const holder = db.prepare('SELECT created_by FROM card_holders WHERE id = ?').get(row.card.holder_id)
      const commandId = `cmd_${randomUUID()}`
      const usageId = `ousg_${randomUUID()}`
      const resultJson = JSON.stringify({ usage_id: usageId, cycle_id: cycleId, reclassified: false })

      db.prepare(
        `INSERT INTO opportunity_commands (id, actor_user_id, request_key, request_hash, command_type, result_json, created_at)
         VALUES (?,?,?,?,?,?,?)`,
      ).run(commandId, holder.created_by, `backfill:promo:${row.source_id}`, 'backfill', 'assignLegacyUsage', resultJson, now)
      db.prepare(
        `INSERT INTO opportunity_write_checks (command_id, ok)
         SELECT ?, CASE WHEN NOT EXISTS (
           SELECT 1 FROM opportunity_legacy_links l
           WHERE l.source_table = 'promo_usages' AND l.source_id = ?)
           AND EXISTS (SELECT 1 FROM credit_cards c WHERE c.id = ?)
         THEN 1 ELSE 0 END`,
      ).run(commandId, row.source_id, row.card_id)
      db.prepare(
        `INSERT INTO opportunity_events (id, command_id, entity_kind, entity_id, event_type, account_id, cycle_id, delta_used_count, before_json, after_json, reason, created_at)
         VALUES (?,?,?,?,?,?,?,1,?,?,?,?)`,
      ).run(
        `evt_${randomUUID()}`, commandId, 'legacy', `promo_usages:${row.source_id}`, 'legacy.assigned',
        accountId, cycleId,
        JSON.stringify({ source_id: row.source_id, used_at: row.used_at }),
        JSON.stringify({ usage_id: usageId, card_id: row.card_id }),
        '结构回填：旧活动使用记录带可证明卡片', now,
      )
      db.prepare(
        `INSERT INTO opportunity_usages (id, account_id, cycle_id, card_id, used_on, quantity, note, created_by, updated_by, created_at, updated_at)
         VALUES (?,?,?,?,?,1,?,?,?,?,?)`,
      ).run(
        usageId, accountId, cycleId, row.card_id, row.used_at,
        `legacy:promo_usages:${row.source_id}`, holder.created_by, holder.created_by, now, now,
      )
      db.prepare(
        `INSERT INTO opportunity_legacy_links (source_table, source_id, target_usage_id, included_in_opening, offset_opening_count, offset_opening_minor, assigned_by, reason, assigned_at)
         VALUES ('promo_usages',?,?,0,0,0,?,?,?)`,
      ).run(row.source_id, usageId, holder.created_by, '结构回填：旧活动使用记录带可证明卡片', now)
      db.prepare('DELETE FROM opportunity_write_checks WHERE command_id = ?').run(commandId)
      db.exec('COMMIT')
      results.mapped += 1
    } catch (err) {
      db.exec('ROLLBACK')
      results.failed.push({ source_id: row.source_id, error: String(err.message ?? err) })
    }
  }
  return results
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function printSummary(classification, applyResult) {
  const s = classification.summary
  console.log('=== 旧数据回填汇总（promo_usages） ===')
  console.log(`待处理活动使用记录: ${s.promo_total}`)
  console.log(`可自动映射: ${s.would_map}`)
  console.log(`需人工核对: ${s.needs_review}`)
  for (const [reason, n] of Object.entries(s.byReason)) console.log(`  - ${reason}: ${n}`)
  console.log(`旧权益使用记录（不自动归属，走管理端人工分配）: ${s.benefit_usages_never_auto_mapped}`)
  if (applyResult) {
    console.log(`已写入: ${applyResult.mapped}`)
    for (const f of applyResult.failed) console.log(`  写入失败 ${f.source_id}: ${f.error}`)
  } else {
    console.log('（dry-run：未写入任何数据；加 --apply 执行写入）')
  }
}

export async function main(argv) {
  const flags = new Set(argv.filter((a) => a.startsWith('--')))
  if (flags.has('--remote')) {
    console.error('拒绝 --remote：生产回填必须按 docs/runbooks/opportunities-release.md 在单独授权下执行。')
    process.exitCode = 2
    return
  }
  const dirIndex = argv.indexOf('--persist-to')
  const persistDir = dirIndex !== -1 ? argv[dirIndex + 1] : null
  if (!persistDir) {
    console.error('用法: node scripts/opportunities-backfill.mjs --persist-to <目录> [--apply]')
    console.error('默认 dry-run 只打印汇总；写入需要 --apply。不支持隐式 remote。')
    process.exitCode = 2
    return
  }
  const db = openLocalDatabase(persistDir)
  applyLocalMigrations(db)
  wrapLegacyCatalog(db)
  const classification = classifyPromoUsages(db)
  const applyResult = flags.has('--apply') ? applyPromoBackfill(db) : null
  printSummary(classification, applyResult)
  db.close()
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main(process.argv.slice(2))
}
