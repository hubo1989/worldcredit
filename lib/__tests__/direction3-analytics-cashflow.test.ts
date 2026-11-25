// 方向 3 / HUB-170：消费分类聚合、30/60/90 天现金流预测、还款汇率锁定。
//
// 全部跑在真实 SQLite（叠加既有 D1 迁移）上：bill_items 是 0001 就有的表，
// installment_plans 与 payments 的汇率锁定三列按 HUB-168 冻结 DDL 在测试内补齐
//（正式迁移 0040–0042 归 HUB-169，不随本 PR 提交）。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createOpportunityDb, type SqliteD1 } from './helpers/sqlite-d1'
import { setDb } from '../db/client'
import { clearFxCache } from '../fx'
import {
  getCategoryBreakdown,
  getCategoryBreakdownReport,
  getCategoryDrilldownItems,
  getCashflowForecast,
} from '../api/analytics.server'
import { updatePayment } from '../api/payments'
import { RpcDomainError } from '../api/errors'
import {
  generateInstallmentSchedule,
  sumPaymentsWithLockedFx,
  validateAndNormalizeFxLock,
} from '../api/direction3.shared'

/** 冻结基准日，让 30/60/90 天窗口与账期推演可断言。 */
const FROZEN_NOW = new Date('2026-11-15T09:00:00+08:00')
const TODAY = '2026-11-15'

const RATES = { USD: 1, CNY: 7, HKD: 7.8 }

async function ensureDirection3Schema(db: SqliteD1): Promise<void> {
  const columns = db.raw.prepare('PRAGMA table_info(payments)').all() as { name: string }[]
  const names = new Set(columns.map(column => column.name))
  if (!names.has('settled_currency')) {
    db.exec('ALTER TABLE payments ADD COLUMN settled_currency TEXT;')
  }
  if (!names.has('settled_amount')) {
    db.exec('ALTER TABLE payments ADD COLUMN settled_amount REAL;')
  }
  if (!names.has('locked_fx_rate')) {
    db.exec('ALTER TABLE payments ADD COLUMN locked_fx_rate REAL;')
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS installment_plans (
      id TEXT PRIMARY KEY,
      card_id TEXT NOT NULL REFERENCES credit_cards(id) ON DELETE CASCADE,
      source_bill_id TEXT REFERENCES bills(id) ON DELETE SET NULL,
      source_item_id TEXT REFERENCES bill_items(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      plan_type TEXT NOT NULL DEFAULT 'purchase' CHECK (plan_type IN ('purchase','bill','cash')),
      currency TEXT NOT NULL CHECK (length(currency) = 3),
      principal_amount REAL NOT NULL CHECK (principal_amount > 0),
      total_periods INTEGER NOT NULL CHECK (total_periods BETWEEN 2 AND 60),
      paid_periods INTEGER NOT NULL DEFAULT 0 CHECK (paid_periods >= 0 AND paid_periods <= total_periods),
      fee_mode TEXT NOT NULL DEFAULT 'equal_principal_fee'
        CHECK (fee_mode IN ('interest_free','equal_principal_fee','equal_installment_apr')),
      fee_charge_mode TEXT NOT NULL DEFAULT 'per_period'
        CHECK (fee_charge_mode IN ('per_period','upfront')),
      fee_rate_per_period REAL,
      custom_period_fee REAL,
      apr REAL,
      start_month TEXT NOT NULL,
      due_day INTEGER NOT NULL CHECK (due_day BETWEEN 1 AND 31),
      due_month_offset INTEGER NOT NULL DEFAULT 0 CHECK (due_month_offset IN (0, 1)),
      billing_mode TEXT NOT NULL DEFAULT 'included_in_statement'
        CHECK (billing_mode IN ('included_in_statement','independent')),
      status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active','completed','early_settled','cancelled')),
      early_settled_at TEXT,
      early_settled_amount REAL,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_installment_plans_card_status
      ON installment_plans(card_id, status);
  `)
}

describe('direction 3 · 分类聚合 / 现金流预测 / 汇率锁定', () => {
  let db: SqliteD1

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(FROZEN_NOW)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ timestamp: 1789444800, base: 'USD', rates: RATES }),
      }),
    )
    db = createOpportunityDb()
    await ensureDirection3Schema(db)
    setDb(db as unknown as D1Database)
    await clearFxCache()
    await db.exec(`
      INSERT INTO users (id, email, password_hash) VALUES
        ('u1', 'u1@example.com', 'hash'),
        ('u2', 'u2@example.com', 'hash');
      INSERT INTO banks (id, name) VALUES ('bank1', '招商银行');
      INSERT INTO card_products (id, bank_id, bank_name, card_name, currency, payment_due_type, payment_due_value)
      VALUES ('cp_cny', 'bank1', '招商银行', '经典白', 'CNY', 'after_billing', 20),
             ('cp_usd', 'bank1', '招商银行', '全币种', 'USD', 'after_billing', 20);
      INSERT INTO card_holders (id, created_by, managed_by, name) VALUES
        ('h1', 'u1', 'u1', '本人'),
        ('h2', 'u2', 'u2', '家人');
      INSERT INTO credit_accounts (id, holder_id, bank_id, bank_name, currency, statement_mode, quota_mode)
      VALUES ('acc1', 'h1', 'bank1', '招商银行', 'CNY', 'independent', 'independent'),
             ('acc2', 'h2', 'bank1', '招商银行', 'CNY', 'independent', 'independent');
      INSERT INTO credit_cards (id, holder_id, account_id, card_product_id, card_number_last4, billing_day, status)
      VALUES ('card1', 'h1', 'acc1', 'cp_cny', '1234', 10, 'active'),
             ('card2', 'h1', 'acc1', 'cp_usd', '5678', 10, 'active'),
             ('card3', 'h2', 'acc2', 'cp_cny', '9999', 10, 'active');
    `)
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
    await clearFxCache()
    db.close()
  })

  async function seedBill(
    id: string,
    cardId: string,
    billMonth: string,
    amount: number,
    dueDate: string,
    status = 'unpaid',
  ): Promise<void> {
    await db
      .prepare(
        `INSERT INTO bills (id, card_id, bill_month, bill_amount, min_payment, due_date, status)
         VALUES (?, ?, ?, ?, 0, ?, ?)`,
      )
      .bind(id, cardId, billMonth, amount, dueDate, status)
      .run()
  }

  async function seedItem(
    id: string,
    billId: string,
    description: string,
    category: string | null,
    amount: number,
    itemType: string,
    merchant: string | null = null,
    currency = 'CNY',
  ): Promise<void> {
    await db
      .prepare(
        `INSERT INTO bill_items (id, bill_id, transaction_date, description, merchant_name, category, amount, currency, item_type, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual')`,
      )
      .bind(id, billId, TODAY, description, merchant, category, amount, currency, itemType)
      .run()
  }

  // ── 分类聚合 ──────────────────────────────────────────────────────────────

  it('按分类聚合消费，退款优先冲减同账单同分类并钳制为 0', async () => {
    await seedBill('b1', 'card1', '2026-11', 1000, '2026-11-20')
    await seedItem('i1', 'b1', '午餐', 'dining', 300, 'purchase')
    await seedItem('i2', 'b1', '网购', 'shopping', 200, 'purchase')
    await seedItem('i3', 'b1', '分期手续费', 'other', 50, 'fee')
    await seedItem('i4', 'b1', '退款-午餐', 'dining', 100, 'refund')
    // 无分类退款：按同账单同归一化商户的消费分类回冲（星巴克 → dining）
    await seedItem('i5', 'b1', '星巴克', 'dining', 80, 'purchase', '星巴克')
    await seedItem('i6', 'b1', '星巴克退款', null, 50, 'refund', '星巴克')

    const report = await getCategoryBreakdownReport({ from_month: '2026-11', to_month: '2026-11' })
    const byCategory = new Map(report.items.map(item => [item.category, item]))

    expect(byCategory.get('dining')?.amount).toBe(230) // 300 + 80 - 100 - 50
    expect(byCategory.get('shopping')?.amount).toBe(200)
    expect(byCategory.get('fees_interest')?.amount).toBe(50)
    expect(report.total_amount).toBe(480)
    expect(report.covered_bills).toBe(1)
    expect(report.total_bills).toBe(1)
    expect(report.fx_converted).toBe(true)
    expect(byCategory.get('dining')?.item_count).toBe(4)
  })

  it('无法归属的退款进入 unallocated_refunds_by_currency，不污染分类占比', async () => {
    await seedBill('b1', 'card1', '2026-11', 500, '2026-11-20')
    await seedItem('i1', 'b1', '纯退款', 'travel', 500, 'refund')

    const report = await getCategoryBreakdownReport({ from_month: '2026-11', to_month: '2026-11' })

    expect(report.items).toHaveLength(0)
    expect(report.unallocated_refunds_by_currency.CNY).toBe(500)
    expect(report.total_amount).toBe(0)
    // 兼容旧调用方：数组形态仍然返回
    expect(await getCategoryBreakdown({ from_month: '2026-11', to_month: '2026-11' })).toEqual([])
  })

  it('include_fees=false 时整体剔除手续费与利息', async () => {
    await seedBill('b1', 'card1', '2026-11', 300, '2026-11-20')
    await seedItem('i1', 'b1', '餐饮', 'dining', 100, 'purchase')
    await seedItem('i2', 'b1', '利息', 'other', 30, 'interest')
    await seedItem('i3', 'b1', '手续费', 'other', 20, 'fee')

    const report = await getCategoryBreakdownReport({
      from_month: '2026-11',
      to_month: '2026-11',
      include_fees: false,
    })

    expect(report.items.map(item => item.category)).toEqual(['dining'])
    expect(report.total_amount).toBe(100)
  })

  it('跨币种缺汇率时不 1:1 混算，金额排除未折算币种并标记', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('fx down')),
    )
    await clearFxCache()
    await seedBill('b1', 'card1', '2026-11', 300, '2026-11-20')
    await seedBill('b2', 'card2', '2026-11', 100, '2026-11-20')
    await seedItem('i1', 'b1', '餐饮', 'dining', 300, 'purchase', null, 'CNY')
    await seedItem('i2', 'b2', '酒店', 'travel', 100, 'purchase', null, 'USD')

    const report = await getCategoryBreakdownReport({
      from_month: '2026-11',
      to_month: '2026-11',
      display_currency: 'CNY',
    })
    const travel = report.items.find(item => item.category === 'travel')

    expect(report.fx_converted).toBe(false)
    expect(report.fx_unconverted_currencies).toEqual(['USD'])
    // USD 的 100 没有被当成 100 CNY 混进合计
    expect(report.total_amount).toBe(300)
    expect(travel?.amount).toBe(0)
    expect(travel?.by_currency?.USD).toBe(100)
  })

  it('超过 100 张账单时按 80 分片查询，不触发 D1 参数上限', async () => {
    for (let index = 1; index <= 110; index++) {
      const billId = `bulk_${index}`
      // 110 个互不相同的账期（bills 有 UNIQUE(card_id, bill_month)）
      const year = 2020 + Math.floor(index / 12)
      const month = String((index % 12) + 1).padStart(2, '0')
      await seedBill(billId, 'card1', `${year}-${month}`, 10, '2026-12-05')
      await seedItem(`bulk_item_${index}`, billId, '消费', 'dining', 10, 'purchase')
    }

    const report = await getCategoryBreakdownReport({})

    expect(report.total_bills).toBe(110)
    expect(report.covered_bills).toBe(110)
    expect(report.total_amount).toBe(1100)
  })

  it('分类下钻按分类过滤并按交易日期倒序', async () => {
    await seedBill('b1', 'card1', '2026-11', 400, '2026-11-20')
    await seedItem('i1', 'b1', '早餐', 'dining', 20, 'purchase')
    await seedItem('i2', 'b1', '打车', 'transport', 30, 'purchase')
    await seedItem('i3', 'b1', '午餐', 'dining', 50, 'purchase')
    await db.prepare("UPDATE bill_items SET transaction_date = '2026-11-03' WHERE id = 'i1'").run()
    await db.prepare("UPDATE bill_items SET transaction_date = '2026-11-10' WHERE id = 'i3'").run()

    const items = await getCategoryDrilldownItems({
      from_month: '2026-11',
      to_month: '2026-11',
      category: 'dining',
    })

    expect(items.map(item => item.item_id)).toEqual(['i3', 'i1'])
    expect(items[0].amount).toBe(50)
    expect(items[0].holder_id).toBe('h1')
  })

  // ── 现金流预测 ────────────────────────────────────────────────────────────

  it('三源展开：账单 + 分期 + 固定支出，按币种准备金与分桶', async () => {
    await seedBill('b1', 'card1', '2026-11', 1000, '2026-11-20')
    await db
      .prepare(
        `INSERT INTO payments (id, bill_id, amount, paid_at, idempotency_key) VALUES ('p1', 'b1', 200, ?, 'k1')`,
      )
      .bind(TODAY)
      .run()
    await db
      .prepare(
        `INSERT INTO installment_plans (id, card_id, title, currency, principal_amount, total_periods,
           fee_mode, start_month, due_day, billing_mode, status)
         VALUES ('plan1', 'card1', 'iPhone 分期', 'CNY', 900, 3, 'interest_free', '2026-11', 20, 'independent', 'active')`,
      )
      .run()
    await db
      .prepare(
        `INSERT INTO recurring_payables (id, created_by, name, category, amount, currency, due_day, holder_id, is_active)
         VALUES ('pay1', 'u1', '房租', 'rent', 3000, 'CNY', 18, 'h1', 1)`,
      )
      .run()
    await db
      .prepare(
        `INSERT INTO recurring_payable_payments (id, payable_id, period, amount, paid_at)
         VALUES ('pp1', 'pay1', '2026-11', 3000, '2026-11-10')`,
      )
      .run()

    const forecast = await getCashflowForecast(
      { horizon_days: 90, display_currency: 'CNY' },
      'u1',
    )

    // 账单剩余 800（已还 200），逾期 0
    expect(forecast.reserves_by_currency.CNY.bill).toBe(800)
    // 分期 3 期，每期 300，全部落在 90 天窗口内
    expect(forecast.reserves_by_currency.CNY.installment).toBe(900)
    // 房租当期已付清，后两期各 3000
    expect(forecast.reserves_by_currency.CNY.payable).toBe(6000)
    expect(forecast.reserves_by_currency.CNY.total).toBe(7700)
    expect(forecast.overdue_alert.count).toBe(0)
    expect(forecast.timeline.map(event => event.source)).toEqual(
      expect.arrayContaining(['bill', 'installment', 'payable']),
    )
    // 90 天窗口从 2026-11 起：11 / 12 / 01 / 02 四个月桶
    expect(forecast.buckets.map(bucket => bucket.label)).toEqual([
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
    ])
    const nov = forecast.buckets.find(bucket => bucket.label === '2026-11')
    expect(nov?.bill).toBe(800)
    expect(nov?.installment).toBe(300)
    expect(nov?.payable).toBe(0)
  })

  it('逾期账单硬隔离：只进 overdue_alert，绝不计入准备金与柱状图', async () => {
    await seedBill('b_overdue', 'card1', '2026-10', 500, '2026-11-10', 'overdue')
    await seedBill('b_future', 'card1', '2026-11', 200, '2026-11-20')

    const forecast = await getCashflowForecast({ horizon_days: 30 }, 'u1')

    expect(forecast.reserves_by_currency.CNY.bill).toBe(200)
    expect(forecast.overdue_alert.count).toBe(1)
    expect(forecast.overdue_alert.by_currency.CNY).toBe(500)
    expect(forecast.timeline.some(event => event.ref_id === 'b_overdue')).toBe(false)
    expect(forecast.buckets.reduce((sum, bucket) => sum + bucket.bill, 0)).toBe(200)
  })

  it('included_in_statement 分期遇已出账单当月不再双计', async () => {
    // 该卡 2026-11 已出账单，分期第 1 期由账单承接，不应再进现金流
    await seedBill('b1', 'card1', '2026-11', 1000, '2026-11-20')
    await db
      .prepare(
        `INSERT INTO installment_plans (id, card_id, title, currency, principal_amount, total_periods,
           fee_mode, start_month, due_day, billing_mode, status)
         VALUES ('plan1', 'card1', '分期', 'CNY', 900, 3, 'interest_free', '2026-11', 20, 'included_in_statement', 'active')`,
      )
      .run()

    const forecast = await getCashflowForecast({ horizon_days: 90 }, 'u1')
    const installmentEvents = forecast.timeline.filter(event => event.source === 'installment')

    // 第 1 期被账单覆盖，只剩 12 月与 1 月两期
    expect(installmentEvents).toHaveLength(2)
    expect(installmentEvents.every(event => event.due_date >= '2026-12-01')).toBe(true)
    expect(forecast.reserves_by_currency.CNY.installment).toBe(600)
  })

  it('固定支出隐私：成员只看到自己名下或自己创建且未绑定 holder 的支出', async () => {
    await db
      .prepare(
        `INSERT INTO recurring_payables (id, created_by, name, category, amount, currency, due_day, holder_id, is_active)
         VALUES ('own', 'u1', '自己的房租', 'rent', 1000, 'CNY', 18, 'h1', 1),
                ('shared', 'u2', '管理员公共支出', 'utility', 500, 'CNY', 18, NULL, 1),
                ('other_holder', 'u2', '家人支出', 'rent', 700, 'CNY', 18, 'h2', 1)`,
      )
      .run()

    const memberView = await getCashflowForecast(
      { horizon_days: 30, holder_id: 'h1' },
      'u1',
    )
    expect(memberView.reserves_by_currency.CNY.payable).toBe(1000)
    expect(
      memberView.timeline.some(event => event.ref_id === 'shared' || event.ref_id === 'other_holder'),
    ).toBe(false)

    const adminView = await getCashflowForecast({ horizon_days: 30 }, 'u2')
    expect(adminView.reserves_by_currency.CNY.payable).toBe(1200)
  })

  // ── 汇率锁定 ──────────────────────────────────────────────────────────────

  it('updatePayment 写入汇率锁定三列，且只改备注时不抹掉锁定', async () => {
    await seedBill('b1', 'card1', '2026-11', 100, '2026-11-20')
    await db
      .prepare(
        `INSERT INTO payments (id, bill_id, amount, paid_at, idempotency_key) VALUES ('p1', 'b1', 100, ?, 'k1')`,
      )
      .bind(TODAY)
      .run()

    const locked = await updatePayment('p1', {
      settled_currency: 'USD',
      settled_amount: 14,
      locked_fx_rate: 0.14,
    })
    expect(locked.settled_currency).toBe('USD')
    expect(locked.settled_amount).toBe(14)
    expect(locked.locked_fx_rate).toBe(0.14)

    const noteOnly = await updatePayment('p1', { note: '事后补录' })
    expect(noteOnly.settled_currency).toBe('USD')
    expect(noteOnly.settled_amount).toBe(14)

    const cleared = await updatePayment('p1', {
      settled_currency: null,
      settled_amount: null,
      locked_fx_rate: null,
    })
    expect(cleared.settled_currency).toBeNull()
    expect(cleared.settled_amount).toBeNull()
    expect(cleared.locked_fx_rate).toBeNull()
  })

  it('汇率锁定校验：三列必须齐全且与账单金额自洽', async () => {
    await seedBill('b1', 'card1', '2026-11', 100, '2026-11-20')
    await db
      .prepare(
        `INSERT INTO payments (id, bill_id, amount, paid_at, idempotency_key) VALUES ('p1', 'b1', 100, ?, 'k1')`,
      )
      .bind(TODAY)
      .run()

    await expect(
      updatePayment('p1', { settled_currency: 'USD' }),
    ).rejects.toBeInstanceOf(RpcDomainError)

    await expect(
      updatePayment('p1', { settled_currency: 'USD', settled_amount: 999, locked_fx_rate: 0.14 }),
    ).rejects.toBeInstanceOf(RpcDomainError)

    // 与账单币种相同 → 归一为「未锁定」
    expect(
      validateAndNormalizeFxLock(
        { settled_currency: 'CNY', settled_amount: 100, locked_fx_rate: 1 },
        100,
        'CNY',
      ),
    ).toEqual({ settled_currency: null, settled_amount: null, locked_fx_rate: null })
  })

  it('已结清账单仅补录汇率不会触发 PAYMENT_EXCEEDS_REMAINING', async () => {
    await seedBill('b1', 'card1', '2026-11', 100, '2026-11-20', 'unpaid')
    await db
      .prepare(
        `INSERT INTO payments (id, bill_id, amount, paid_at, idempotency_key) VALUES ('p1', 'b1', 100, ?, 'k1')`,
      )
      .bind(TODAY)
      .run()
    // 还款先落库，再把账单置为 paid（0022 的 BEFORE INSERT 触发器会拒绝向已结清账单还款）
    await db.prepare("UPDATE bills SET status = 'paid' WHERE id = 'b1'").run()

    const updated = await updatePayment('p1', {
      settled_currency: 'USD',
      settled_amount: 14,
      locked_fx_rate: 0.14,
    })

    expect(updated.settled_amount).toBe(14)
  })

  it('sumPaymentsWithLockedFx：目标币种锁定金额免疫汇率缺失', () => {
    const payments = [
      {
        amount: 100,
        bill_currency: 'USD',
        settled_currency: 'CNY',
        settled_amount: 700,
        locked_fx_rate: 7,
      },
    ]

    expect(sumPaymentsWithLockedFx(payments, 'CNY', null).total).toBe(700)
    expect(sumPaymentsWithLockedFx(payments, 'CNY', { base: 'USD', rates: { USD: 1 }, timestamp: 0, fetched_at: 0 }).total).toBe(700)
    // 未锁定的还款缺汇率 → 标记未折算而不是 1:1 相加
    const unconverted = sumPaymentsWithLockedFx(
      [{ amount: 100, bill_currency: 'USD' }],
      'CNY',
      null,
    )
    expect(unconverted.converted).toBe(false)
    expect(unconverted.unconverted_currencies).toEqual(['USD'])
    expect(unconverted.total).toBe(0)
  })

  // ── 分期摊销纯函数 ────────────────────────────────────────────────────────

  it('免息分期本金守恒（末期尾差兜底）', () => {
    const schedule = generateInstallmentSchedule({
      currency: 'CNY',
      principal_amount: 1000,
      total_periods: 3,
      paid_periods: 0,
      fee_mode: 'interest_free',
      start_month: '2026-11',
      due_day: 20,
    })

    expect(schedule.map(period => period.principal)).toEqual([333.33, 333.33, 333.34])
    expect(schedule.reduce((sum, period) => sum + period.principal, 0)).toBe(1000)
    expect(schedule.map(period => period.fee)).toEqual([0, 0, 0])
    expect(schedule.map(period => period.due_date)).toEqual([
      '2026-11-20',
      '2026-12-20',
      '2027-01-20',
    ])
  })

  it('等额本息分期末期本金清零，总本金守恒', () => {
    const schedule = generateInstallmentSchedule({
      currency: 'CNY',
      principal_amount: 12000,
      total_periods: 12,
      paid_periods: 0,
      fee_mode: 'equal_installment_apr',
      apr: 0.18,
      start_month: '2026-11',
      due_day: 10,
    })

    expect(schedule).toHaveLength(12)
    expect(Math.round(schedule.reduce((sum, period) => sum + period.principal, 0) * 100) / 100).toBe(12000)
    expect(schedule[11].principal).toBeGreaterThan(0)
    // 每期总还款额（本金+利息）近似相等
    const totals = schedule.map(period => period.total)
    expect(Math.max(...totals) - Math.min(...totals)).toBeLessThan(0.1)
  })

  it('upfront 手续费只在首期收取', () => {
    const schedule = generateInstallmentSchedule({
      currency: 'CNY',
      principal_amount: 1200,
      total_periods: 12,
      paid_periods: 0,
      fee_mode: 'equal_principal_fee',
      fee_charge_mode: 'upfront',
      custom_period_fee: 120,
      start_month: '2026-11',
      due_day: 5,
    })

    expect(schedule[0].fee).toBe(120)
    expect(schedule.slice(1).every(period => period.fee === 0)).toBe(true)
    expect(schedule.reduce((sum, period) => sum + period.principal, 0)).toBe(1200)
  })
})
