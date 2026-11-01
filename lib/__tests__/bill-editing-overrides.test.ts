// spec 13 §6.1/§6.2/§6.4：账单结构化编辑（updateBillFields / clearOverride /
// updateBillStatusChecked / deleteBill）。
//
// 核心不变量：编辑只写 *_override 列，导入值列（bill_amount / due_date /
// statement_date / min_payment）分毫不动——下一封账单邮件覆盖导入值时，
// 用户改过的数字必须还在。清空 override 即回落导入值，撤销可逆。

import { describe, it, expect, beforeEach } from 'vitest'
import { createOpportunityDb } from './helpers/sqlite-d1'
import { setDb } from '../db/client'
import {
  updateBillFields,
  clearOverride,
  updateBillStatusChecked,
  deleteBill,
} from '../api/bills.server'

let db: ReturnType<typeof createOpportunityDb>

beforeEach(async () => {
  db = createOpportunityDb()
  setDb(db as unknown as D1Database)
  await db.exec(`
    INSERT INTO users (id, email, password_hash) VALUES ('u1', 'u1@example.com', 'hash');
    INSERT INTO banks (id, name) VALUES ('b1', '招商银行');
    INSERT INTO card_products (id, bank_id, bank_name, card_name, payment_due_type, payment_due_value)
    VALUES ('cp1', 'b1', '招商银行', '经典白', 'after_billing', 20);
    INSERT INTO card_holders (id, created_by, managed_by, name) VALUES ('h1', 'u1', 'u1', '本人');
    INSERT INTO credit_cards (id, holder_id, card_product_id, billing_day) VALUES ('cc1', 'h1', 'cp1', 5);
    INSERT INTO bills (id, card_id, bill_month, due_date, bill_amount, status)
    VALUES ('b_ed', 'cc1', '2026-10', '2026-10-25', 1200, 'unpaid');
  `)
})

const row = () =>
  db.prepare('SELECT * FROM bills WHERE id = ?').bind('b_ed').first<Record<string, unknown>>()

describe('updateBillFields：编辑一律写 override 列', () => {
  it('金额写入 bill_amount_override，导入值 bill_amount 原样保留', async () => {
    const updated = await updateBillFields('b_ed', { amount: 800 })
    expect(updated.bill_amount_override).toBe(800)
    // Bill 读边界把 bill_amount 归一化为生效金额（手填优先），库里的导入原值不变
    expect(updated.bill_amount).toBe(800)
    const raw = await row()
    expect(raw?.bill_amount).toBe(1200)
    expect(raw?.bill_amount_override).toBe(800)
  })

  it('日期字段写对应 *_override 列，原列不动', async () => {
    await updateBillFields('b_ed', {
      due_date: '2026-11-05',
      statement_date: '2026-10-08',
      min_payment: 66.5,
    })
    const raw = await row()
    expect(raw?.due_date).toBe('2026-10-25')
    expect(raw?.due_date_override).toBe('2026-11-05')
    expect(raw?.statement_date).toBeNull()
    expect(raw?.statement_date_override).toBe('2026-10-08')
    expect(raw?.min_payment).toBe(0)
    expect(raw?.min_payment_override).toBe(66.5)
  })

  it('statement_start/end 无自动化争抢，直接 UPDATE 原列', async () => {
    await updateBillFields('b_ed', { statement_start: '2026-09-06', statement_end: '2026-10-05' })
    const raw = await row()
    expect(raw?.statement_start).toBe('2026-09-06')
    expect(raw?.statement_end).toBe('2026-10-05')
  })

  it('非法日历日（2 月 30 日）被拒', async () => {
    await expect(updateBillFields('b_ed', { due_date: '2026-02-30' })).rejects.toThrow('YYYY-MM-DD')
  })

  it('非日期格式被拒', async () => {
    await expect(updateBillFields('b_ed', { due_date: '2026/10/25' })).rejects.toThrow('YYYY-MM-DD')
    await expect(updateBillFields('b_ed', { statement_date: '25-10-2026' })).rejects.toThrow(
      'YYYY-MM-DD',
    )
  })

  it('负金额被拒', async () => {
    await expect(updateBillFields('b_ed', { amount: -1 })).rejects.toThrow('不小于 0')
    await expect(updateBillFields('b_ed', { min_payment: -0.01 })).rejects.toThrow('不小于 0')
  })

  it('NaN / Infinity 金额被拒', async () => {
    await expect(updateBillFields('b_ed', { amount: Number.NaN })).rejects.toThrow('不小于 0')
    await expect(updateBillFields('b_ed', { amount: Infinity })).rejects.toThrow('不小于 0')
  })

  it('白名单外字段被拒', async () => {
    await expect(updateBillFields('b_ed', { bill_month: '2026-11' } as never)).rejects.toThrow(
      '不支持编辑字段',
    )
  })

  it('空 patch 被拒', async () => {
    await expect(updateBillFields('b_ed', {})).rejects.toThrow('没有需要更新的字段')
  })

  it('账单不存在时 NOT_FOUND', async () => {
    await expect(updateBillFields('b_none', { amount: 1 })).rejects.toThrow('账单不存在')
  })
})

describe('clearOverride：清空回落导入值', () => {
  it('清空后读回导入值，导入值列在钉住期间未被改过', async () => {
    await updateBillFields('b_ed', {
      amount: 800,
      due_date: '2026-11-05',
      statement_date: '2026-10-08',
      min_payment: 66.5,
    })
    const updated = await clearOverride('b_ed', [
      'amount',
      'due_date',
      'statement_date',
      'min_payment',
    ])
    expect(updated.bill_amount_override).toBeUndefined()
    expect(updated.bill_amount).toBe(1200)
    expect(updated.due_date).toBe('2026-10-25')
    const raw = await row()
    expect(raw?.bill_amount_override).toBeNull()
    expect(raw?.due_date_override).toBeNull()
    expect(raw?.statement_date_override).toBeNull()
    expect(raw?.min_payment_override).toBeNull()
  })

  it('部分清空：只撤销指定字段', async () => {
    await updateBillFields('b_ed', { amount: 800, due_date: '2026-11-05' })
    const updated = await clearOverride('b_ed', ['amount'])
    expect(updated.bill_amount_override).toBeUndefined()
    // due_date 的 override 未撤销：raw 列仍钉着，读边界经 billEffectiveDueDate 合成
    const raw = await row()
    expect(raw?.due_date).toBe('2026-10-25')
    expect(raw?.due_date_override).toBe('2026-11-05')
  })

  it('不支持的字段被拒', async () => {
    await expect(clearOverride('b_ed', ['bill_month'])).rejects.toThrow('不支持撤销字段')
    await expect(clearOverride('b_ed', [])).rejects.toThrow('没有需要撤销的字段')
  })
})

describe('updateBillStatusChecked：去掉 paid 短路，允许回退', () => {
  it('已结清账单改变生效金额后，按 Σpayments 重算（含从 paid 回退）', async () => {
    // 还款 1000 → 自动结清（0022 守护触发器禁止向 paid 账单追加还款，
    // 所以先插还款再置 paid，模拟「先结清后被改小/改大」的存量数据）
    await db.exec(
      "INSERT INTO payments (id, bill_id, amount, paid_at, idempotency_key) VALUES ('p1', 'b_ed', 1000, '2026-10-20', 'k1')",
    )
    await db.exec("UPDATE bills SET status = 'paid'")
    // 钉成 800：已还 1000 ≥ 800 − 0.01 → paid
    await updateBillFields('b_ed', { amount: 800 })
    const updated = await updateBillStatusChecked('b_ed')
    expect(updated.status).toBe('paid')

    // 钉成 1500：已还 1000 < 1500 → 从 paid 回退到 partial
    await updateBillFields('b_ed', { amount: 1500 })
    const downgraded = await updateBillStatusChecked('b_ed')
    expect(downgraded.status).toBe('partial')
  })

  it('无还款且到期日已过 → overdue；显式入参覆盖重算值', async () => {
    await db.exec("UPDATE bills SET due_date = '2026-09-25'")
    const overdue = await updateBillStatusChecked('b_ed')
    expect(overdue.status).toBe('overdue')

    const forced = await updateBillStatusChecked('b_ed', 'unpaid')
    expect(forced.status).toBe('unpaid')
  })

  it('overdue 判定用生效到期日（override 优先）', async () => {
    await db.exec("UPDATE bills SET due_date = '2027-01-01', due_date_override = '2026-09-25'")
    const overdue = await updateBillStatusChecked('b_ed')
    expect(overdue.status).toBe('overdue')
  })

  it('非法状态值被拒；账单不存在 NOT_FOUND', async () => {
    await expect(updateBillStatusChecked('b_ed', 'weird' as never)).rejects.toThrow(
      'unpaid/partial/paid/overdue',
    )
    await expect(updateBillStatusChecked('b_none')).rejects.toThrow('账单不存在')
  })
})

describe('deleteBill：级联 payments + sync_changes', () => {
  beforeEach(async () => {
    await db.exec(`
      INSERT INTO payments (id, bill_id, amount, paid_at, idempotency_key) VALUES ('p_del', 'b_ed', 300, '2026-10-20', 'k_del');
      DELETE FROM sync_changes;
    `)
  })

  it('bills 行删除，payments 级联消失，sync_changes 记录两类 delete', async () => {
    await deleteBill('b_ed')

    expect(await row()).toBeNull()
    const payCount = await db
      .prepare('SELECT COUNT(*) AS n FROM payments WHERE bill_id = ?')
      .bind('b_ed')
      .first<{ n: number }>()
    expect(payCount?.n).toBe(0)

    const changes = (
      await db
        .prepare(
          "SELECT owner_id, tbl, row_id, op FROM sync_changes WHERE op = 'delete' ORDER BY seq",
        )
        .all()
    ).results as Array<{ owner_id: string; tbl: string; row_id: string; op: string }>
    expect(changes).toEqual([
      { owner_id: 'u1', tbl: 'payments', row_id: 'p_del', op: 'delete' },
      { owner_id: 'u1', tbl: 'bills', row_id: 'b_ed', op: 'delete' },
    ])
  })

  it('账单不存在时 NOT_FOUND，不产生副作用', async () => {
    await expect(deleteBill('b_none')).rejects.toThrow('账单不存在')
    const n = await db.prepare('SELECT COUNT(*) AS n FROM sync_changes').first<{ n: number }>()
    expect(n?.n).toBe(0)
  })
})
