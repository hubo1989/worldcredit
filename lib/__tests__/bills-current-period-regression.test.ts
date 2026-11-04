// lib/__tests__/bills-current-period-regression.test.ts
// 回归测试：
// 1. 202608 已还完旧账单不再占位当前期，当前期正确指向 10 月账单；
// 2. 待出账且已还款的账单不判定/显示为逾期；
// 3. 待出账账单在未到出账日前不判为 overdue。

import { describe, it, expect, beforeEach } from 'vitest'
import { createOpportunityDb } from './helpers/sqlite-d1'
import { setDb } from '../db/client'
import { getCardsWithBillsSummary } from '../api/bills.server'

let db: ReturnType<typeof createOpportunityDb>

beforeEach(async () => {
  db = createOpportunityDb()
  setDb(db as unknown as D1Database)
  await db.exec(`
    INSERT INTO users (id, email, password_hash) VALUES ('u1', 'u1@example.com', 'hash');
    INSERT INTO banks (id, name) VALUES ('b_mintai', '浙江民泰商业银行');
    INSERT INTO card_products (id, bank_id, bank_name, card_name, payment_due_type, payment_due_value)
    VALUES ('cp_mintai_pu', 'b_mintai', '浙江民泰商业银行', '民泰普卡', 'after_billing', 20);
    INSERT INTO card_holders (id, created_by, managed_by, name) VALUES ('h1', 'u1', 'u1', '本人');
    INSERT INTO credit_cards (id, holder_id, card_product_id, card_number_last4, billing_day)
    VALUES ('cc_2104', 'h1', 'cp_mintai_pu', '2104', 15);
  `)
})

describe('A2 账单周期与逾期显示回归测试', () => {
  it('202608 已还完 + 10 月当前期已还完：activeBill 必须为 10 月账单，旧账单不再占位', async () => {
    await db.exec(`
      INSERT INTO bills (id, card_id, bill_month, due_date, statement_date, bill_amount, status)
      VALUES
        ('b_202608', 'cc_2104', '2026-08', '2026-08-25', '2026-08-05', 1000, 'paid'),
        ('b_202610', 'cc_2104', '2026-10', '2026-10-25', '2026-10-05', 2000, 'paid');
    `)

    const summaries = await getCardsWithBillsSummary('u1')
    expect(summaries).toHaveLength(1)
    const cardSummary = summaries[0]
    expect(cardSummary.card.card_number_last4).toBe('2104')
    expect(cardSummary.activeBill).not.toBeNull()
    expect(cardSummary.activeBill?.bill_month).toBe('2026-10')
    expect(cardSummary.activeBill?.id).toBe('b_202610')
    expect(cardSummary.historyBills[0].bill_month).toBe('2026-10')
    expect(cardSummary.historyBills[1].bill_month).toBe('2026-08')
  })

  it('202608 已还完 + 10 月当前期待还款（未到期）：activeBill 必须为 10 月账单且状态为 unpaid', async () => {
    await db.exec(`
      INSERT INTO bills (id, card_id, bill_month, due_date, statement_date, bill_amount, status)
      VALUES
        ('b_202608', 'cc_2104', '2026-08', '2026-08-25', '2026-08-05', 1000, 'paid'),
        ('b_202610', 'cc_2104', '2026-10', '2099-11-25', '2026-10-05', 2000, 'unpaid');
    `)

    const summaries = await getCardsWithBillsSummary('u1')
    const cardSummary = summaries[0]
    expect(cardSummary.activeBill?.bill_month).toBe('2026-10')
    expect(cardSummary.activeBill?.id).toBe('b_202610')
    expect(cardSummary.status).toBe('unpaid')
  })

  it('待出账单（未到出账日）即使到期日异常，不判为 overdue，卡片状态不为 overdue', async () => {
    // statement_date 在未来（9999-12-31），due_date 异常写在过去
    await db.exec(`
      INSERT INTO bills (id, card_id, bill_month, due_date, statement_date, bill_amount, status)
      VALUES ('b_unissued', 'cc_2104', '2026-11', '2020-01-01', '2099-11-15', 500, 'unpaid');
    `)

    const summaries = await getCardsWithBillsSummary('u1')
    const cardSummary = summaries[0]
    expect(cardSummary.activeBill?.computed_status).toBe('unpaid')
    expect(cardSummary.status).toBe('unpaid')
    expect(cardSummary.status).not.toBe('overdue')
  })

  it('待出账且已还款的账单：状态为 paid，卡片为 unissued（已结清），绝不显示逾期', async () => {
    await db.exec(`
      INSERT INTO bills (id, card_id, bill_month, due_date, statement_date, bill_amount, status)
      VALUES ('b_future_paid', 'cc_2104', '2026-12', '2099-12-25', '2099-12-05', 500, 'paid');
    `)

    const summaries = await getCardsWithBillsSummary('u1')
    const cardSummary = summaries[0]
    expect(cardSummary.activeBill?.computed_status).toBe('paid')
    expect(cardSummary.status).toBe('unissued')
  })
})
