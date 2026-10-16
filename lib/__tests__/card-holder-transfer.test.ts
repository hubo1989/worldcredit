// lib/__tests__/card-holder-transfer.test.ts — updateCardHolder 的双端 scope
// 校验与幂等/冲突语义（真实 SQLite 迁移库）：
//   - 名下两持卡人之间可转移，卡片连同 bills 一起改挂
//   - 越权目标（他人持卡人）与越权卡（他人卡）统一“不存在或不属于”
//   - 同持卡人幂等；权益台账关联触发器报错转成可读提示
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createOpportunityDb, type SqliteD1 } from './helpers/sqlite-d1'
import { seedOpportunityFixtures, FIXTURE_IDS } from './helpers/opportunity-fixtures'
import { setDb } from '../db/client'
import { updateCardHolder } from '../api/cards.server'
import { createOpportunityAccount } from '../opportunities/accounts.server'

let db: SqliteD1
const f = FIXTURE_IDS
const NOW = '2026-10-15T08:00:00Z'

beforeEach(async () => {
  db = createOpportunityDb()
  await seedOpportunityFixtures(db)
  setDb(db as unknown as D1Database)
})

afterEach(() => {
  setDb(null)
  db.close()
})

describe('updateCardHolder', () => {
  it('名下持卡人之间转移：卡片与历史账单一起改挂', async () => {
    await db
      .prepare('INSERT INTO bills (id, card_id, bill_month, bill_amount, min_payment, due_date, status) VALUES (?,?,?,?,?,?,?)')
      .bind('b-move', f.cards.selfMain, '2026-09', 100, 10, '2026-10-16', 'unpaid')
      .run()

    const moved = await updateCardHolder(f.users.adminA, f.cards.selfMain, f.holders.family)
    expect(moved.holder_id).toBe(f.holders.family)

    const card = db.raw.prepare('SELECT holder_id FROM credit_cards WHERE id = ?').get(f.cards.selfMain) as { holder_id: string }
    expect(card.holder_id).toBe(f.holders.family)
    const bill = db.raw.prepare('SELECT card_id FROM bills WHERE id = ?').get('b-move') as { card_id: string }
    expect(bill.card_id).toBe(f.cards.selfMain) // 账单随卡，不动 bill 行
  })

  it('同持卡人幂等；越权目标与越权卡统一拒绝', async () => {
    const same = await updateCardHolder(f.users.adminA, f.cards.selfMain, f.holders.self)
    expect(same.holder_id).toBe(f.holders.self)

    // 目标是他人（adminB）的持卡人：统一口径，不泄漏存在性
    await expect(
      updateCardHolder(f.users.adminA, f.cards.selfMain, f.holders.adminB)
    ).rejects.toThrow(/不存在，或不属于当前账户/)

    // 卡是他人（adminB）的卡：同样拒绝
    await expect(
      updateCardHolder(f.users.adminA, f.cards.adminBUsd, f.holders.self)
    ).rejects.toThrow(/不存在，或不属于当前账户/)
  })

  it('卡上挂着权益台账关联时：数据库触发器拒绝并转成可读提示', async () => {
    const n = 1
    await db.batch([
      db.prepare(
        `INSERT INTO opportunity_definitions (id, kind, visibility, private_holder_id, created_by, created_at)
         VALUES ('odef-move', 'benefit', 'shared', NULL, ?, '2026-01-01T00:00:00Z')`
      ).bind(f.users.adminA),
      db.prepare(
        `INSERT INTO opportunity_rule_versions (id, definition_id, version, effective_from, rules_json, verification, published_at)
         VALUES ('orv-move', 'odef-move', 1, '2026-01-01', ?, 'user_confirmed', '2026-01-01T00:00:00Z')`
      ).bind(JSON.stringify({
        schema_version: 1, title: '转移测试', description: null, category: 'other', time_zone: 'Asia/Shanghai',
        bank_id: null, card_product_ids: [f.products.cmbClassic], valid_from: null, valid_until_before: null,
        open_ended: true, weekdays: null,
        cycle: { kind: 'monthly', anchor_month: null, anchor_day: 1, anchor_source: null },
        allocation: 'recurring', count_limit: 4, amount_limit_minor: null, currency: null, unit_label: '次',
        eligibility_text: null, requires_personal_confirmation: false, claim_window: null, booking_window: null,
        workflow_time_basis: 'fixed', booking_consumes: 'reserve_then_use', cancellation_rule: 'confirm_with_issuer',
        entry: { website_url: null, app_name: null, app_path: null },
      })),
    ])
    void n
    await createOpportunityAccount(
      { user_id: f.users.adminA, role: 'admin' },
      {
        definition_id: 'odef-move', holder_id: f.holders.self,
        card_ids: [f.cards.selfMain], scope_kind: 'card',
        request_key: 'transfer-guard-key-0001',
      },
      { now: NOW },
    )

    await expect(
      updateCardHolder(f.users.adminA, f.cards.selfMain, f.holders.family)
    ).rejects.toThrow(/权益台账/)
  })
})
