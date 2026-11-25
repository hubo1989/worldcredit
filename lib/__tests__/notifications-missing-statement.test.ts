import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createOpportunityDb, type SqliteD1 } from './helpers/sqlite-d1'
import { setDb } from '../db/client'
import {
  DEFAULT_NOTIFICATION_ITEM_SWITCHES,
  NOTIFICATION_CATEGORY_META,
  NOTIFICATION_SWITCH_ITEMS,
} from '../notifications.shared'
import {
  buildDailyNotificationCandidates,
  ensureDailyNotificationsForUser,
} from '../notifications-engine.server'
import { getUserPreferences, updateUserPreferences } from '../api/preferences.server'
import { supplementMissingBill } from '../api/bills.server'

describe('超期未获得账单通知引擎与偏好设置', () => {
  let db: SqliteD1

  beforeEach(async () => {
    db = createOpportunityDb()
    setDb(db as unknown as D1Database)

    await db.batch([
      db
        .prepare(`INSERT INTO users (id, email, password_hash, name, role) VALUES (?, ?, ?, ?, ?)`)
        .bind('u-admin', 'admin@test.local', 'h', '管理员', 'admin'),
      db
        .prepare(`INSERT INTO users (id, email, password_hash, name, role) VALUES (?, ?, ?, ?, ?)`)
        .bind('u-member', 'member@test.local', 'h', '成员', 'member'),
      db
        .prepare(
          `INSERT INTO card_holders (id, created_by, managed_by, auth_user_id, name) VALUES (?, ?, ?, ?, ?)`,
        )
        .bind('h-admin', 'u-admin', 'u-admin', null, '持卡人A'),
      db
        .prepare(
          `INSERT INTO card_holders (id, created_by, managed_by, auth_user_id, name) VALUES (?, ?, ?, ?, ?)`,
        )
        .bind('h-member', 'u-admin', 'u-admin', 'u-member', '持卡人B'),
      db.prepare(`INSERT INTO banks (id, name) VALUES (?, ?)`).bind('bank-cmb', '招商银行'),
      db
        .prepare(
          `INSERT INTO card_products (id, bank_id, bank_name, card_name, currency, payment_due_type, payment_due_value)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind('prod-cmb', 'bank-cmb', '招商银行', '经典白', 'CNY', 'after_billing', 20),
    ])
  })

  afterEach(() => {
    setDb(null)
    db.close()
  })

  it('暴露 bill_missing_statement 开关、分类元数据与宽限天数 0..15 校验', async () => {
    expect(DEFAULT_NOTIFICATION_ITEM_SWITCHES.bill_missing_statement).toBe(true)
    expect(NOTIFICATION_CATEGORY_META.bill_missing_statement).toEqual({
      label: '未收账单',
      tone: 'gold',
    })
    expect(NOTIFICATION_SWITCH_ITEMS.some((i) => i.key === 'bill_missing_statement')).toBe(true)

    const initial = await getUserPreferences('u-admin')
    expect(initial.reminder_config.missing_statement_grace_days).toBe(3)

    const zeroGrace = await updateUserPreferences('u-admin', {
      reminder_config: { missing_statement_grace_days: 0 },
    })
    expect(zeroGrace.reminder_config.missing_statement_grace_days).toBe(0)

    const invalidFallback = await updateUserPreferences('u-admin', {
      reminder_config: { missing_statement_grace_days: 99 },
    })
    expect(invalidFallback.reminder_config.missing_statement_grace_days).toBe(3)
  })

  it('AC-11: 单卡精准直达补录、多卡汇总防轰炸、合并账户去重及补录后立即消警', async () => {
    await db.batch([
      db
        .prepare(
          `INSERT INTO credit_accounts (id, holder_id, bank_id, bank_name, currency, statement_mode, quota_mode, billing_day, due_type, due_value, primary_card_id, status)
           VALUES ('acc-m', 'h-admin', 'bank-cmb', '招商银行', 'CNY', 'merged', 'shared', 10, 'after_billing', 20, NULL, 'active')`,
        ),
      db
        .prepare(
          `INSERT INTO credit_cards (id, holder_id, account_id, card_product_id, card_number_last4, billing_day, status, card_type, created_at)
           VALUES ('c-m1', 'h-admin', 'acc-m', 'prod-cmb', '1111', 10, 'active', 'credit', '2026-01-01T00:00:00Z')`,
        ),
      db
        .prepare(
          `INSERT INTO credit_cards (id, holder_id, account_id, card_product_id, card_number_last4, billing_day, status, card_type, created_at)
           VALUES ('c-m2', 'h-admin', 'acc-m', 'prod-cmb', '2222', 10, 'active', 'credit', '2026-01-02T00:00:00Z')`,
        ),
      db
        .prepare(`UPDATE credit_accounts SET primary_card_id = 'c-m1' WHERE id = 'acc-m'`),
      db
        .prepare(
          `INSERT INTO bills (id, account_id, card_id, bill_month, bill_amount, due_date, status)
           VALUES ('b-m-09', 'acc-m', 'c-m1', '2026-09', 1000, '2026-09-30', 'paid')`,
        ),
    ])

    const d1 = db as unknown as D1Database
    // 1) 单卡（合并账户 2 张卡去重为 1 条）命中 → 精准直达补录
    const single = await buildDailyNotificationCandidates(d1, 'u-admin', '2026-10-14')
    const missingSingle = single.candidates.filter((c) => c.category === 'bill_missing_statement')
    expect(missingSingle).toHaveLength(1)
    expect(missingSingle[0].notification_key).toBe('bill_missing_statement:acc-m:2026-10:2026-10-14')
    expect(missingSingle[0].target_url).toBe('/bills?action=supplement&cardId=c-m1&billMonth=2026-10')

    // 2) 再新增 1 张独立超期卡 → 聚合为 1 条汇总通知
    await db.batch([
      db
        .prepare(
          `INSERT INTO credit_cards (id, holder_id, card_product_id, card_number_last4, billing_day, status, card_type, created_at)
           VALUES ('c-ind', 'h-admin', 'prod-cmb', '3333', 8, 'active', 'credit', '2026-01-01T00:00:00Z')`,
        ),
      db
        .prepare(
          `INSERT INTO bills (id, card_id, bill_month, bill_amount, due_date, status)
           VALUES ('b-ind-09', 'c-ind', '2026-09', 500, '2026-09-28', 'paid')`,
        ),
    ])

    const multi = await buildDailyNotificationCandidates(d1, 'u-admin', '2026-10-14')
    const missingMulti = multi.candidates.filter((c) => c.category === 'bill_missing_statement')
    expect(missingMulti).toHaveLength(1)
    expect(missingMulti[0].notification_key).toBe('bill_missing_statement_summary:2026-10-14')
    expect(missingMulti[0].target_url).toBe('/bills?status=missing_statement')
    const meta = JSON.parse(missingMulti[0].metadata_json!)
    expect(meta.missing_statements).toHaveLength(2)

    // 同日重复入库幂等
    const inserted1 = await ensureDailyNotificationsForUser(d1, 'u-admin', '2026-10-14')
    const inserted2 = await ensureDailyNotificationsForUser(d1, 'u-admin', '2026-10-14')
    expect(inserted1).toBe(1)
    expect(inserted2).toBe(0)

    // 3) 关闭开关不再生成
    await updateUserPreferences('u-admin', {
      reminder_config: { items: { bill_missing_statement: false } },
    })
    const muted = await buildDailyNotificationCandidates(d1, 'u-admin', '2026-10-14')
    expect(muted.candidates.some((c) => c.category === 'bill_missing_statement')).toBe(false)

    // 恢复开关并补录 0 元账单后，合并账户自动消警，仅剩独立卡 1 条
    await updateUserPreferences('u-admin', {
      reminder_config: { items: { bill_missing_statement: true } },
    })
    await supplementMissingBill({
      user_id: 'u-admin',
      card_id: 'c-m2',
      bill_month: '2026-10',
      bill_amount: 0,
      due_date: '2026-10-30',
    })
    const afterSupp = await buildDailyNotificationCandidates(d1, 'u-admin', '2026-10-14')
    const afterMissing = afterSupp.candidates.filter((c) => c.category === 'bill_missing_statement')
    expect(afterMissing).toHaveLength(1)
    expect(afterMissing[0].notification_key).toBe('bill_missing_statement:c-ind:2026-10:2026-10-14')
  })

  it('AC-14: 成员仅收到自己名下绑定持卡人的缺账通知，绝不泄露管理员或其他人卡片', async () => {
    await db.batch([
      db
        .prepare(
          `INSERT INTO credit_cards (id, holder_id, card_product_id, card_number_last4, billing_day, status, card_type, created_at)
           VALUES ('c-admin-only', 'h-admin', 'prod-cmb', '9999', 5, 'active', 'credit', '2026-01-01T00:00:00Z')`,
        ),
      db
        .prepare(
          `INSERT INTO bills (id, card_id, bill_month, bill_amount, due_date, status)
           VALUES ('b-admin', 'c-admin-only', '2026-09', 100, '2026-09-25', 'paid')`,
        ),
      db
        .prepare(
          `INSERT INTO credit_cards (id, holder_id, card_product_id, card_number_last4, billing_day, status, card_type, created_at)
           VALUES ('c-member-own', 'h-member', 'prod-cmb', '8888', 5, 'active', 'credit', '2026-01-01T00:00:00Z')`,
        ),
      db
        .prepare(
          `INSERT INTO bills (id, card_id, bill_month, bill_amount, due_date, status)
           VALUES ('b-mem', 'c-member-own', '2026-09', 100, '2026-09-25', 'paid')`,
        ),
    ])

    const res = await buildDailyNotificationCandidates(
      db as unknown as D1Database,
      'u-member',
      '2026-10-14',
    )
    const missing = res.candidates.filter((c) => c.category === 'bill_missing_statement')
    expect(missing).toHaveLength(1)
    expect(missing[0].target_url).toContain('c-member-own')
    expect(missing[0].body).not.toContain('9999')
  })
})
