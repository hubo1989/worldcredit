import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildAnnualFeeDecisionCandidates } from '../annual-fee-notifications.server'
import { createSqliteD1, SQLITE_D1_MIGRATIONS_DIR, type SqliteD1 } from './helpers/sqlite-d1'

const RULES = '0043_card_product_structured_rules.sql'
const ROI = '0044_card_annual_fee_roi_and_valuations.sql'
const SEED = '0045_seed_mainstream_card_rules.sql'

let db: SqliteD1

function apply(...files: string[]) {
  for (const file of files) db.exec(readFileSync(join(SQLITE_D1_MIGRATIONS_DIR, file), 'utf8'))
}

beforeEach(() => {
  db = createSqliteD1()
  db.exec('PRAGMA trusted_schema = OFF')
  const baseline = readdirSync(SQLITE_D1_MIGRATIONS_DIR).filter(file => /^00(?:0[1-9]|[12]\d|3[0-3])_.+\.sql$/.test(file)).sort()
  expect(new Set(baseline.map(file => file.slice(0, 4))).size).toBe(33)
  apply(...baseline)
})

afterEach(() => db.close())

describe('0043–0045 D1 migrations', () => {
  it('preserves legacy columns and foreign keys and validates date, JSON and valuation types', () => {
    db.exec(`
      INSERT INTO users (id, email, password_hash) VALUES ('u', 'u@example.test', 'hash');
      INSERT INTO card_holders (id, created_by, managed_by, name) VALUES ('h', 'u', 'u', 'Test');
      INSERT INTO card_products (id, bank_name, card_name, annual_fee, annual_fee_waiver, rewards_summary)
      VALUES ('legacy', 'Chase', 'Sapphire Preferred', 95, 'legacy waiver', 'legacy rewards');
      INSERT INTO credit_cards (id, holder_id, card_product_id, billing_day) VALUES ('card', 'h', 'legacy', 1);
      INSERT INTO opportunity_definitions (id, kind, visibility, created_by, created_at)
      VALUES ('definition', 'benefit', 'shared', 'u', '2026-01-01T00:00:00Z');
    `)
    apply(RULES, ROI, SEED)
    expect(db.raw.prepare(`
      SELECT annual_fee, annual_fee_waiver, rewards_summary, ftf_rate FROM card_products WHERE id = 'legacy'
    `).get()).toEqual({ annual_fee: 95, annual_fee_waiver: 'legacy waiver', rewards_summary: 'legacy rewards', ftf_rate: 0 })
    expect(db.raw.prepare(`
      SELECT next_annual_fee_date, annual_fee_status, waiver_progress_json FROM credit_cards WHERE id = 'card'
    `).get()).toEqual({ next_annual_fee_date: null, annual_fee_status: null, waiver_progress_json: null })

    expect(() => db.exec("UPDATE credit_cards SET next_annual_fee_date = '2026-02-29'")).toThrow(/CHECK/)
    expect(() => db.exec("UPDATE credit_cards SET next_annual_fee_date = '2026-04-31'")).toThrow(/CHECK/)
    expect(() => db.exec("UPDATE credit_cards SET next_annual_fee_date = '2026-01-01T00:00:00Z'")).toThrow(/CHECK/)
    expect(() => db.exec("UPDATE credit_cards SET next_annual_fee_date = '2028-02-29'")).not.toThrow()
    expect(() => db.exec("UPDATE credit_cards SET waiver_progress_json = '[]'")).toThrow(/CHECK/)
    expect(() => db.exec("UPDATE credit_cards SET annual_fee_status = 'future'")).toThrow(/CHECK/)
    expect(() => db.exec("UPDATE card_products SET ftf_rate = 11 WHERE id = 'legacy'")).toThrow(/CHECK/)
    expect(() => db.exec("UPDATE card_products SET reward_rules_json = 'invalid' WHERE id = 'legacy'")).toThrow(/CHECK/)
    expect(() => db.exec("UPDATE card_products SET fx_free_currencies_json = '{}' WHERE id = 'legacy'")).toThrow(/CHECK/)
    expect(() => db.exec('UPDATE opportunity_definitions SET estimated_unit_value_minor = 0.5')).toThrow(/CHECK/)
    expect(() => db.exec('UPDATE opportunity_definitions SET estimated_unit_value_minor = 150')).not.toThrow()
    expect(db.raw.prepare('PRAGMA foreign_key_check').all()).toEqual([])

    expect(db.raw.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'index' AND name IN
      ('idx_credit_cards_next_annual_fee', 'idx_opportunity_usages_card_used',
       'idx_promo_usages_card_used', 'idx_opportunity_fulfillments_holder_recorded')
    `).all()).toHaveLength(4)
  })

  it('backfills normalized matches, protects administrator changes and emits no sync changes on replay', () => {
    apply(RULES, ROI)
    db.exec(`
      INSERT INTO banks (id, name, country) VALUES ('bank-chase', ' cHaSe ', 'US');
      INSERT INTO card_products (id, bank_name, card_name, rules_updated_at, ftf_rate, annual_fee_cycle_type)
      VALUES ('legacy', ' CHASE ', ' sApPhIrE pReFeRrEd ', NULL, NULL, 'custom_date'),
             ('manual-cleared', 'Chase', 'Freedom Unlimited', '2026-11-01', NULL, NULL),
             ('manual-ftf', 'Chase', 'Freedom Flex', NULL, 5, NULL),
             ('unrelated', 'Other Bank', 'Sapphire Preferred', NULL, NULL, NULL),
             ('similar', 'Chase', 'Sapphire Preferred Plus', NULL, NULL, NULL);
    `)
    const read = (id: string) => db.raw.prepare(`
      SELECT bank_id, reward_rules_json, ftf_rate, fx_free_currencies_json, annual_fee_cycle_type, rules_updated_at
      FROM card_products WHERE id = ?
    `).get(id)

    apply(SEED)
    expect(read('legacy')).toMatchObject({ ftf_rate: 0, annual_fee_cycle_type: 'custom_date', rules_updated_at: null })
    expect(JSON.parse(String(read('legacy')?.reward_rules_json))).toMatchObject({ schema_version: 1, base_rate_pct: 1 })
    expect(read('cp_seed_chase_csp')).toBeUndefined()
    expect(read('cp_seed_chase_csr')).toMatchObject({ bank_id: 'bank-chase', ftf_rate: 0 })
    expect(read('cp_seed_hsbc_pulse')).toMatchObject({
      ftf_rate: 1.95, fx_free_currencies_json: '["CNY","MOP"]',
    })
    expect(read('manual-cleared')).toMatchObject({ ftf_rate: null, reward_rules_json: null, rules_updated_at: '2026-11-01' })
    expect(read('manual-ftf')).toMatchObject({ ftf_rate: 5, reward_rules_json: null })
    expect(read('unrelated')).toMatchObject({ ftf_rate: null, reward_rules_json: null })
    expect(read('similar')).toMatchObject({ ftf_rate: null, reward_rules_json: null })
    expect(db.raw.prepare("SELECT row_id FROM sync_changes WHERE tbl = 'card_products' AND row_id = 'legacy'").all()).toHaveLength(2)

    const snapshot = () => db.raw.prepare('SELECT * FROM card_products ORDER BY id').all()
    const changes = () => db.raw.prepare('SELECT COUNT(*) AS n FROM sync_changes').get()
    const products = snapshot()
    const syncCount = changes()
    apply(SEED)
    expect(snapshot()).toEqual(products)
    expect(changes()).toEqual(syncCount)
    expect(db.raw.prepare("SELECT name FROM sqlite_master WHERE name = '_hub176_card_rule_seed'").get()).toBeUndefined()
  })

  it('keeps the notification builder compatible until the schema migration is applied', async () => {
    const d1 = db as unknown as D1Database
    db.exec("INSERT INTO users (id, email, password_hash) VALUES ('u', 'u@example.test', 'hash')")
    await expect(buildAnnualFeeDecisionCandidates(d1, 'u', '2026-11-25')).resolves.toEqual([])
    apply(RULES, ROI, SEED)
    db.exec(`
      INSERT INTO card_holders (id, created_by, managed_by, name) VALUES ('h', 'u', 'u', 'Test');
      INSERT INTO credit_cards (id, holder_id, card_product_id, billing_day, next_annual_fee_date)
      VALUES ('c', 'h', 'cp_seed_chase_csp', 1, '2026-12-25');
    `)
    await expect(buildAnnualFeeDecisionCandidates(d1, 'u', '2026-11-25')).resolves.toMatchObject([
      { notification_key: 'annual_fee_decision:c:2026-12-25:30' },
    ])
  })

  it('seeds at least 30 mainstream products across CNY, HKD and USD from an empty catalog', () => {
    apply(RULES, ROI, SEED)
    const coverage = db.raw.prepare(`
      SELECT country, currency, COUNT(*) AS count
      FROM card_products WHERE id GLOB 'cp_seed_*' GROUP BY country, currency ORDER BY country
    `).all()
    expect(coverage).toEqual([
      { country: 'CN', currency: 'CNY', count: expect.any(Number) },
      { country: 'HK', currency: 'HKD', count: expect.any(Number) },
      { country: 'US', currency: 'USD', count: expect.any(Number) },
    ])
    expect(coverage.reduce((total, row) => total + Number(row.count), 0)).toBeGreaterThanOrEqual(30)
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM card_products WHERE rules_updated_at IS NOT NULL").get()).toEqual({ n: 0 })
    expect(db.raw.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' })
  })
})
