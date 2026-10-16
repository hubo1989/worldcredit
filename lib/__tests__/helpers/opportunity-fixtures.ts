// lib/__tests__/helpers/opportunity-fixtures.ts — fixed fictional seed for the
// opportunity suite. All *.example.test users, banks and cards are invented.
//
// World shape (P0 reproduction + P1/P2 scenarios):
//   u-admin-a   admin  -> h-self (2 credit cards + 1 loan card), h-family
//   u-member-a  member -> h-member-self (bound, NO cards)
//   u-admin-b   admin  -> h-admin-b (one USD card) — a fully separate world
// Same product held by two holders, a second card on one holder, a loan card,
// a frozen card and a foreign-currency card are all present.

import type { SqliteD1 } from './sqlite-d1'

/** Frozen "today" for the whole suite — dates below are relative to this. */
export const FIXTURE_NOW_ON = '2026-10-15'

export const FIXTURE_IDS = {
  users: {
    adminA: 'u-admin-a',
    memberA: 'u-member-a',
    adminB: 'u-admin-b',
  },
  banks: {
    cmb: 'bk-cmb',
    icbc: 'bk-icbc',
    chase: 'bk-chase',
    /** Bank with a live promo but no card from any fixture user. */
    minsheng: 'bk-minsheng',
  },
  products: {
    cmbClassic: 'p-cmb-classic',
    cmbLife: 'p-cmb-life',
    icbcGold: 'p-icbc-gold',
    chaseSapphire: 'p-chase-sapphire',
  },
  holders: {
    self: 'h-self',
    family: 'h-family',
    memberSelf: 'h-member-self',
    adminB: 'h-admin-b',
  },
  cards: {
    selfMain: 'c-self-main',
    selfSecond: 'c-self-second',
    selfLoan: 'c-self-loan',
    familyClassic: 'c-family-classic',
    familyFrozen: 'c-family-frozen',
    adminBUsd: 'c-adminb-usd',
  },
  benefits: {
    cmbClassicLounge: 'b-cmb-classic-lounge',
    cmbLifeMovie: 'b-cmb-life-movie',
    chaseSapphireHotel: 'b-chase-sapphire-hotel',
  },
  promos: {
    live: 'pr-live',
    expired: 'pr-expired',
    future: 'pr-future',
    disabled: 'pr-disabled',
    bankOnly: 'pr-bank-only',
  },
} as const

export interface SeedOptions {
  /** Skip promos (some tasks want a bare user/card world). */
  withoutPromos?: boolean
  /** Skip benefits. */
  withoutBenefits?: boolean
}

/** Insert the full fixture world in one atomic batch. Idempotent per db instance. */
export async function seedOpportunityFixtures(db: SqliteD1, opts: SeedOptions = {}): Promise<void> {
  const f = FIXTURE_IDS
  const userRows = [
    ['users', f.users.adminA, 'admin-a@example.test', 'x-hash', '管理员 A', 'admin'],
    ['users', f.users.memberA, 'member-a@example.test', 'x-hash', '成员 A', 'member'],
    ['users', f.users.adminB, 'admin-b@example.test', 'x-hash', '管理员 B', 'admin'],
  ] as const

  const bankRows = [
    ['banks', f.banks.cmb, '招商银行', 'CN'],
    ['banks', f.banks.icbc, '工商银行', 'CN'],
    ['banks', f.banks.chase, 'Chase', 'US'],
    ['banks', f.banks.minsheng, '民生银行', 'CN'],
  ] as const

  const productRows = [
    [f.products.cmbClassic, f.banks.cmb, '招商银行', '经典白金卡', 'CNY'],
    [f.products.cmbLife, f.banks.cmb, '招商银行', '生活卡', 'CNY'],
    [f.products.icbcGold, f.banks.icbc, '工商银行', '金卡', 'CNY'],
    [f.products.chaseSapphire, f.banks.chase, 'Chase', 'Sapphire Reserve', 'USD'],
  ] as const

  const holderRows = [
    // id, created_by, managed_by, name, auth_user_id
    [f.holders.self, f.users.adminA, f.users.adminA, '我', null],
    [f.holders.family, f.users.adminA, f.users.adminA, '家庭成员', null],
    [f.holders.memberSelf, f.users.memberA, f.users.memberA, '成员本人', f.users.memberA],
    [f.holders.adminB, f.users.adminB, f.users.adminB, 'B 本人', null],
  ] as const

  const cardRows = [
    // id, holder, product, last4, limit, billing_day, status, type, loan_due_day
    [f.cards.selfMain, f.holders.self, f.products.cmbClassic, '0001', 50000, 5, 'active', 'credit', null],
    [f.cards.selfSecond, f.holders.self, f.products.cmbLife, '0002', 20000, 10, 'active', 'credit', null],
    [f.cards.selfLoan, f.holders.self, f.products.icbcGold, '0003', 0, 1, 'active', 'loan', 10],
    [f.cards.familyClassic, f.holders.family, f.products.cmbClassic, '0004', 30000, 5, 'active', 'credit', null],
    [f.cards.familyFrozen, f.holders.family, f.products.cmbLife, '0005', 10000, 10, 'frozen', 'credit', null],
    [f.cards.adminBUsd, f.holders.adminB, f.products.chaseSapphire, '0006', 10000, 20, 'active', 'credit', null],
  ] as const

  const statements = [
    ...userRows.map(
      (r) =>
        db
          .prepare('INSERT INTO users (id, email, password_hash, name, role) VALUES (?,?,?,?,?)')
          .bind(...(r.slice(1) as [string, string, string, string, string])),
    ),
    ...bankRows.map(
      (r) => db.prepare('INSERT INTO banks (id, name, country) VALUES (?,?,?)').bind(r[1], r[2], r[3]),
    ),
    ...productRows.map(
      (r) =>
        db
          .prepare('INSERT INTO card_products (id, bank_id, bank_name, card_name, currency) VALUES (?,?,?,?,?)')
          .bind(r[0], r[1], r[2], r[3], r[4]),
    ),
    ...holderRows.map(
      (r) =>
        db
          .prepare('INSERT INTO card_holders (id, created_by, managed_by, name, auth_user_id) VALUES (?,?,?,?,?)')
          .bind(r[0], r[1], r[2], r[3], r[4]),
    ),
    ...cardRows.map(
      (r) =>
        db
          .prepare(
            `INSERT INTO credit_cards (id, holder_id, card_product_id, card_number_last4, credit_limit, billing_day, status, card_type, loan_due_day)
             VALUES (?,?,?,?,?,?,?,?,?)`,
          )
          .bind(r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8]),
    ),
  ]

  if (!opts.withoutBenefits) {
    statements.push(
      db
        .prepare(
          `INSERT INTO benefits (id, card_product_id, name, description, quota, period) VALUES (?,?,?,?,?,?)`,
        )
        .bind(f.benefits.cmbClassicLounge, f.products.cmbClassic, '机场贵宾厅', '每年 6 次免费贵宾厅', 6, 'yearly'),
      db
        .prepare(
          `INSERT INTO benefits (id, card_product_id, name, description, quota, period) VALUES (?,?,?,?,?,?)`,
        )
        .bind(f.benefits.cmbLifeMovie, f.products.cmbLife, '观影优惠', '每月 2 次观影立减', 2, 'monthly'),
      db
        .prepare(
          `INSERT INTO benefits (id, card_product_id, name, description, quota, period) VALUES (?,?,?,?,?,?)`,
        )
        .bind(f.benefits.chaseSapphireHotel, f.products.chaseSapphire, '年度酒店积分', '每年 1 次酒店积分包', 1, 'yearly'),
    )
  }

  if (!opts.withoutPromos) {
    statements.push(
      db
        .prepare(
          `INSERT INTO promos (id, card_product_id, bank_id, bank_name, title, start_date, end_date, is_active) VALUES (?,?,?,?,?,?,?,?)`,
        )
        .bind(f.promos.live, f.products.cmbClassic, f.banks.cmb, '招商银行', '经典白金餐饮 5 折', '2026-10-01', '2026-12-31', 1),
      db
        .prepare(
          `INSERT INTO promos (id, card_product_id, bank_id, bank_name, title, start_date, end_date, is_active) VALUES (?,?,?,?,?,?,?,?)`,
        )
        .bind(f.promos.expired, f.products.cmbLife, f.banks.cmb, '招商银行', '生活卡加油返现（已过期）', '2026-08-01', '2026-09-30', 1),
      db
        .prepare(
          `INSERT INTO promos (id, card_product_id, bank_id, bank_name, title, start_date, end_date, is_active) VALUES (?,?,?,?,?,?,?,?)`,
        )
        .bind(f.promos.future, f.products.cmbClassic, f.banks.cmb, '招商银行', '双 11 立减（未开始）', '2026-11-01', '2026-11-15', 1),
      db
        .prepare(
          `INSERT INTO promos (id, card_product_id, bank_id, bank_name, title, start_date, end_date, is_active) VALUES (?,?,?,?,?,?,?,?)`,
        )
        .bind(f.promos.disabled, f.products.cmbClassic, f.banks.cmb, '招商银行', '已下线活动', '2026-09-01', '2026-12-31', 0),
      db
        .prepare(
          `INSERT INTO promos (id, card_product_id, bank_id, bank_name, title, start_date, end_date, is_active) VALUES (?,?,?,?,?,?,?,?)`,
        )
        .bind(f.promos.bankOnly, null, f.banks.minsheng, '民生银行', '民生银行满 200 减 30', '2026-10-01', '2026-10-31', 1),
    )
  }

  await db.batch(statements)
}

/**
 * Ledger objects on top of the base fixture world (0013 tables), for scope and
 * later account tests. Two worlds:
 *   - shared def + account on h-self (admin A), card-scoped to c-self-main
 *   - private def held by h-admin-b (admin B), with its own usage
 * All fictional; caller decides what to seed.
 */
export const LEDGER_IDS = {
  definitions: { shared: 'odef-shared', privateB: 'odef-private-b' },
  versions: { shared: 'orv-shared', privateB: 'orv-private-b' },
  accounts: { self: 'oacc-self', adminB: 'oacc-admin-b' },
  cycles: { self: 'ocyc-self', adminB: 'ocyc-admin-b' },
  usages: { self: 'ousg-self', adminB: 'ousg-admin-b' },
} as const

export async function seedOpportunityLedgerWorld(db: SqliteD1): Promise<void> {
  const f = FIXTURE_IDS
  const l = LEDGER_IDS
  await db.batch([
    db
      .prepare(
        `INSERT INTO opportunity_definitions (id, kind, visibility, private_holder_id, created_by, created_at)
         VALUES ('odef-shared','benefit','shared',NULL,?, '2026-10-01T00:00:00Z')`,
      )
      .bind(f.users.adminA),
    db
      .prepare(
        `INSERT INTO opportunity_rule_versions (id, definition_id, version, effective_from, rules_json, verification, published_at)
         VALUES (?, 'odef-shared', 1, '2026-01-01', '{"v":1}', 'unverified', '2026-10-01T00:00:00Z')`,
      )
      .bind(l.versions.shared),
    db
      .prepare(
        `INSERT INTO opportunity_accounts (id, definition_id, holder_id, scope_kind, scope_key, created_by, created_at)
         VALUES (?, 'odef-shared', ?, 'card', 'card:c-self-main', ?, '2026-10-01T00:00:00Z')`,
      )
      .bind(l.accounts.self, f.holders.self, f.users.adminA),
    db
      .prepare(
        `INSERT INTO opportunity_account_cards (account_id, definition_id, holder_id, card_id)
         VALUES (?, 'odef-shared', ?, ?)`,
      )
      .bind(l.accounts.self, f.holders.self, f.cards.selfMain),
    db
      .prepare(
        `INSERT INTO opportunity_cycles (id, account_id, version_id, version_as_of_on, cycle_key, allocation_kind, period_start_on, period_end_before, usable_start_on, usable_end_before, time_zone, count_limit, created_at)
         VALUES (?, ?, ?, '2026-10-01', '2026-10', 'regular', '2026-10-01', '2026-11-01', '2026-10-01', '2026-11-01', 'Asia/Shanghai', 6, '2026-10-01T00:00:00Z')`,
      )
      .bind(l.cycles.self, l.accounts.self, l.versions.shared),
    db
      .prepare(
        `INSERT INTO opportunity_definitions (id, kind, visibility, private_holder_id, created_by, created_at)
         VALUES ('odef-private-b','private_reward','private',?, ?, '2026-10-01T00:00:00Z')`,
      )
      .bind(f.holders.adminB, f.users.adminB),
    db
      .prepare(
        `INSERT INTO opportunity_rule_versions (id, definition_id, version, effective_from, rules_json, verification, published_at)
         VALUES (?, 'odef-private-b', 1, '2026-01-01', '{"v":1}', 'user_confirmed', '2026-10-01T00:00:00Z')`,
      )
      .bind(l.versions.privateB),
    db
      .prepare(
        `INSERT INTO opportunity_accounts (id, definition_id, holder_id, scope_kind, scope_key, created_by, created_at)
         VALUES (?, 'odef-private-b', ?, 'holder', 'holder:h-admin-b', ?, '2026-10-01T00:00:00Z')`,
      )
      .bind(l.accounts.adminB, f.holders.adminB, f.users.adminB),
    db
      .prepare(
        `INSERT INTO opportunity_account_cards (account_id, definition_id, holder_id, card_id)
         VALUES (?, 'odef-private-b', ?, ?)`,
      )
      .bind(l.accounts.adminB, f.holders.adminB, f.cards.adminBUsd),
    db
      .prepare(
        `INSERT INTO opportunity_cycles (id, account_id, version_id, version_as_of_on, cycle_key, allocation_kind, period_start_on, period_end_before, usable_start_on, usable_end_before, time_zone, count_limit, created_at)
         VALUES (?, ?, ?, '2026-10-01', '2026-10', 'regular', '2026-10-01', '2026-11-01', '2026-10-01', '2026-11-01', 'America/New_York', NULL, '2026-10-01T00:00:00Z')`,
      )
      .bind(l.cycles.adminB, l.accounts.adminB, l.versions.privateB),
    db
      .prepare(
        `INSERT INTO opportunity_usages (id, account_id, cycle_id, card_id, used_on, quantity, created_by, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, '2026-10-05', 1, ?, ?, '2026-10-05T00:00:00Z', '2026-10-05T00:00:00Z')`,
      )
      .bind(l.usages.adminB, l.accounts.adminB, l.cycles.adminB, f.cards.adminBUsd, f.users.adminB, f.users.adminB),
    db
      .prepare(
        `INSERT INTO opportunity_usages (id, account_id, cycle_id, card_id, used_on, quantity, created_by, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, '2026-10-05', 1, ?, ?, '2026-10-05T00:00:00Z', '2026-10-05T00:00:00Z')`,
      )
      .bind(l.usages.self, l.accounts.self, l.cycles.self, f.cards.selfMain, f.users.adminA, f.users.adminA),
  ])
}
