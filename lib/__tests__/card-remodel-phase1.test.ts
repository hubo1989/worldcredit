import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createOpportunityDb, type SqliteD1 } from './helpers/sqlite-d1'
import { seedOpportunityFixtures, FIXTURE_IDS } from './helpers/opportunity-fixtures'
import { setDb } from '../db/client'
import { createCard, updateCard } from '../api/cards.server'
import { createHolder } from '../api/holders.server'
import { getBanks } from '../api/banks.server'

let db: SqliteD1
const f = FIXTURE_IDS

beforeEach(async () => {
  db = createOpportunityDb()
  await seedOpportunityFixtures(db)
  setDb(db as unknown as D1Database)
})

afterEach(() => {
  setDb(null)
  db.close()
})

describe('Phase 1: 卡片模型与服务端重构测试', () => {
  it('0031 迁移验证：存量 override_billing_day 归一', async () => {
    // 存量 override_billing_day 应该为 null
    const remainingOverrides = db.raw.prepare('SELECT COUNT(*) as cnt FROM credit_cards WHERE override_billing_day IS NOT NULL').get() as { cnt: number }
    expect(remainingOverrides.cnt).toBe(0)
  })

  it('createCard: 仅传 bank_id 自动解析兜底卡产品，且自定义卡名落库', async () => {
    const card = await createCard({
      holder_id: f.holders.self,
      bank_id: f.banks.cmb,
      name_override: '招行家庭主卡',
      card_number_last4: '8888',
      credit_limit: 50000,
      billing_day: 10,
    })

    expect(card.id).toBeTruthy()
    expect(card.name_override).toBe('招行家庭主卡')
    expect(card.card_name).toBe('招行家庭主卡')
    expect(card.billing_day).toBe(10)
    expect(card.override_billing_day).toBeUndefined()
    expect(card.card_product).toBeDefined()
  })

  it('createCard: 卡名等于产品默认名时 name_override 置 null', async () => {
    // 获取招行产品默认名
    const prod = db.raw.prepare('SELECT id, card_name FROM card_products WHERE bank_id = ? LIMIT 1').get(f.banks.cmb) as { id: string; card_name: string }
    expect(prod).toBeDefined()

    const card = await createCard({
      holder_id: f.holders.self,
      card_product_id: prod.id,
      name_override: prod.card_name,
      billing_day: 5,
    })

    expect(card.name_override).toBeUndefined()
    expect(card.card_name).toBe(prod.card_name)
  })

  it('updateCard: 同币种切换银行/卡产品成功', async () => {
    // 从招行切到工行（均为 CNY）
    const targetProd = db.raw.prepare('SELECT id FROM card_products WHERE bank_id = ? AND currency = ? LIMIT 1').get(f.banks.icbc, 'CNY') as { id: string }
    expect(targetProd).toBeDefined()

    const updated = await updateCard(f.cards.selfMain, {
      card_product_id: targetProd.id,
    })

    expect(updated.card_product_id).toBe(targetProd.id)
    expect(updated.card_product?.bank_id).toBe(f.banks.icbc)
  })

  it('updateCard: 已有账单跨币种切换时阻断拦截 (Q3 规则)', async () => {
    // 为当前卡插入账单
    await db
      .prepare('INSERT INTO bills (id, card_id, bill_month, bill_amount, min_payment, due_date, status) VALUES (?,?,?,?,?,?,?)')
      .bind('b-currency-test', f.cards.selfMain, '2026-09', 200, 20, '2026-10-16', 'unpaid')
      .run()

    // 尝试切换到 USD 产品
    const usdProd = db.raw.prepare("SELECT id FROM card_products WHERE currency = 'USD' LIMIT 1").get() as { id: string }
    if (usdProd) {
      await expect(
        updateCard(f.cards.selfMain, { card_product_id: usdProd.id })
      ).rejects.toThrow(/仅允许切换到同币种卡产品/)
    }
  })

  it('updateCard: 修改 billing_day 时清空 override_billing_day (Q2 规则)', async () => {
    // 人工先写入 override_billing_day
    db.raw.prepare('UPDATE credit_cards SET override_billing_day = 12 WHERE id = ?').run(f.cards.selfMain)

    const updated = await updateCard(f.cards.selfMain, {
      billing_day: 25,
    })

    expect(updated.billing_day).toBe(25)
    expect(updated.override_billing_day).toBeUndefined()

    const row = db.raw.prepare('SELECT billing_day, override_billing_day FROM credit_cards WHERE id = ?').get(f.cards.selfMain) as { billing_day: number; override_billing_day: number | null }
    expect(row.billing_day).toBe(25)
    expect(row.override_billing_day).toBeNull()
  })

  it('updateCard: 跨账户篡改 holder_id 予以拒绝', async () => {
    await expect(
      updateCard(f.cards.selfMain, { holder_id: f.holders.adminB })
    ).rejects.toThrow(/不存在，或不属于同一账户/)
  })

  it('holders.createHolder: 登录用户可成功创建归属自己的持卡人', async () => {
    const newHolder = await createHolder({
      created_by: f.users.adminA,
      managed_by: f.users.adminA,
      name: '李小四',
      avatar_color: '#3b82f6',
    })

    expect(newHolder.id).toBeTruthy()
    expect(newHolder.name).toBe('李小四')
    expect(newHolder.created_by).toBe(f.users.adminA)
  })

  it('banks.getBanks: 返回完整银行列表及配置字段', async () => {
    const banks = await getBanks()
    expect(banks.length).toBeGreaterThan(0)
    const first = banks[0]
    expect(first.id).toBeTruthy()
    expect(first.name).toBeTruthy()
    expect('quota_mode' in first).toBe(true)
    expect('statement_mode' in first).toBe(true)
  })
})
