// lib/__tests__/payment-editing.test.ts — spec 13 §6.1/§6.2/§6.3
// payments.updatePayment / payments.deletePayment：改/删还款后按
// computePaymentDrivenStatus 重算账单状态（去掉 paid 短路，允许回退）。
// 跑在真实 SQLite（D1 迁移全量套用）上，触发器/约束/事务回滚由库本身兜底。

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createOpportunityDb } from './helpers/sqlite-d1'
import { setDb } from '../db/client'
import { updatePayment, deletePayment, assertPaymentAccess } from '../api/payments'
import { RPC_REGISTRY } from '../api/registry'
import { MemberScopeError } from '../api/member-scope'
import { RpcDomainError } from '../api/errors'
import type { MemberContext } from '../api/member-scope'

describe('payments.updatePayment / deletePayment (spec 13)', () => {
  let db: ReturnType<typeof createOpportunityDb>

  const seedBill = async (
    id: string,
    opts: { amount: number; due_date: string; status?: string; override?: number | null },
  ) => {
    await db.exec(`
      INSERT INTO bills (id, card_id, bill_month, due_date, bill_amount, bill_amount_override, status)
      VALUES ('${id}', 'cc1', '2026-10-01', '${opts.due_date}', ${opts.amount}, ${opts.override ?? 'NULL'}, '${opts.status ?? 'unpaid'}');
    `)
  }

  const seedPayment = async (
    id: string,
    billId: string,
    amount: number,
    paidAt = '2026-10-20',
  ) => {
    await db.exec(`
      INSERT INTO payments (id, bill_id, amount, paid_at, idempotency_key)
      VALUES ('${id}', '${billId}', ${amount}, '${paidAt}', 'idem_${id}');
    `)
  }

  const billStatus = async (id: string) =>
    (await db.prepare('SELECT status FROM bills WHERE id = ?').bind(id).first<{ status: string }>())?.status

  const paymentTotal = async (billId: string) =>
    Number(
      (
        await db
          .prepare('SELECT SUM(amount) AS total FROM payments WHERE bill_id = ?')
          .bind(billId)
          .first<{ total: number | null }>()
      )?.total ?? 0,
    )

  beforeEach(async () => {
    db = createOpportunityDb()
    setDb(db as unknown as D1Database)

    // Base data（与 record-payment.test.ts 同一 fixture 形状）
    await db.exec(`
      INSERT INTO users (id, email, password_hash) VALUES ('u1', 'u1@example.com', 'hash');
      INSERT INTO banks (id, name) VALUES ('b1', '招商银行');
      INSERT INTO card_products (id, bank_id, bank_name, card_name, payment_due_type, payment_due_value)
      VALUES ('cp1', 'b1', '招商银行', '经典白', 'after_billing', 20);
      INSERT INTO card_holders (id, created_by, managed_by, name) VALUES ('h1', 'u1', 'u1', '本人');
      INSERT INTO credit_cards (id, holder_id, card_product_id, billing_day) VALUES ('cc1', 'h1', 'cp1', 5);
    `)
  })

  afterEach(() => {
    setDb(null)
    db.close()
  })

  describe('updatePayment: 状态重算', () => {
    it('partial -> paid：把 400 改成 1000，账单转为已结清', async () => {
      await seedBill('b1', { amount: 1000, due_date: '2026-10-25' })
      await seedPayment('p1', 'b1', 400)
      await db.exec(`UPDATE bills SET status = 'partial' WHERE id = 'b1';`)

      const updated = await updatePayment('p1', { amount: 1000 })

      expect(updated.amount).toBe(1000)
      expect(await billStatus('b1')).toBe('paid')
    })

    it('paid -> partial 回退：已结清账单里那笔 1000 改成 400，状态自愈为 partial', async () => {
      await seedBill('b1', { amount: 1000, due_date: '2026-10-25' })
      await seedPayment('p1', 'b1', 1000)
      await db.exec(`UPDATE bills SET status = 'paid' WHERE id = 'b1';`)

      await updatePayment('p1', { amount: 400 })

      // 旧 computeStatus 的 paid 短路会把状态钉死在 paid；新口径必须回退
      expect(await billStatus('b1')).toBe('partial')
    })

    it('部分还款未还清且到期日已过 -> 保持 partial（partial 优先于 overdue，与展示层 computeStatus 同口径）', async () => {
      await seedBill('b1', { amount: 1000, due_date: '2020-01-01' })
      await seedPayment('p1', 'b1', 400)

      await updatePayment('p1', { amount: 500 })

      expect(await billStatus('b1')).toBe('partial')
    })

    it('0.01 浮点容差内视为结清：999.995 改动后仍 paid', async () => {
      await seedBill('b1', { amount: 1000, due_date: '2026-10-25' })
      await seedPayment('p1', 'b1', 999)

      await updatePayment('p1', { amount: 999.995 })

      expect(await billStatus('b1')).toBe('paid')
    })

    it('只改 channel/note 不动金额：paid 保持 paid', async () => {
      await seedBill('b1', { amount: 1000, due_date: '2026-10-25' })
      await seedPayment('p1', 'b1', 1000)
      await db.exec(`UPDATE bills SET status = 'paid' WHERE id = 'b1';`)

      const updated = await updatePayment('p1', { channel: '支付宝', note: '改个备注' })

      expect(updated.channel).toBe('支付宝')
      expect(updated.note).toBe('改个备注')
      expect(await billStatus('b1')).toBe('paid')
    })

    it('override 生效金额参与判定：bill_amount=1000 但 override=500，还 500 即 paid', async () => {
      await seedBill('b1', { amount: 1000, override: 500, due_date: '2026-10-25' })
      await seedPayment('p1', 'b1', 300)
      await db.exec(`UPDATE bills SET status = 'partial' WHERE id = 'b1';`)

      await updatePayment('p1', { amount: 500 })

      expect(await billStatus('b1')).toBe('paid')
    })
  })

  describe('updatePayment: 金额上限与校验', () => {
    it('改成超剩余应还被拒且错误可读，原记录与状态不被破坏', async () => {
      await seedBill('b1', { amount: 1000, due_date: '2026-10-25' })
      await seedPayment('p1', 'b1', 800)
      await db.exec(`UPDATE bills SET status = 'partial' WHERE id = 'b1';`)

      await expect(updatePayment('p1', { amount: 1200 })).rejects.toThrow(
        /超过该账单剩余可还额度（本笔最多 ¥1000\.00）/,
      )

      const p = await db
        .prepare('SELECT amount FROM payments WHERE id = ?')
        .bind('p1')
        .first<{ amount: number }>()
      expect(p?.amount).toBe(800)
      expect(await billStatus('b1')).toBe('partial')
    })

    it('多笔还款时上限按「其他已还 + 本笔改后值」计算', async () => {
      await seedBill('b1', { amount: 1000, due_date: '2026-10-25' })
      await seedPayment('p1', 'b1', 400)
      await seedPayment('p2', 'b1', 400)

      // 其他已还 400，p2 最多改到 600.01；改 700 拒绝
      await expect(updatePayment('p2', { amount: 700 })).rejects.toThrow(/本笔最多 ¥600\.00/)

      // 改到 600 正好还清 -> paid
      await updatePayment('p2', { amount: 600 })
      expect(await billStatus('b1')).toBe('paid')
    })

    it('金额 <= 0 或非 finite 拒绝（VALIDATION_FAILED）', async () => {
      await seedBill('b1', { amount: 1000, due_date: '2026-10-25' })
      await seedPayment('p1', 'b1', 400)

      for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
        await expect(updatePayment('p1', { amount: bad })).rejects.toBeInstanceOf(RpcDomainError)
      }
    })

    it('日期必须 YYYY-MM-DD 真实日历日：2026-02-30 拒绝', async () => {
      await seedBill('b1', { amount: 1000, due_date: '2026-10-25' })
      await seedPayment('p1', 'b1', 400)

      await expect(updatePayment('p1', { paid_at: '2026-02-30' })).rejects.toThrow(/真实日历日/)
      await expect(updatePayment('p1', { paid_at: '2026/10/20' })).rejects.toThrow(/YYYY-MM-DD/)
      await expect(updatePayment('p1', { paid_at: '2026-10-20' })).resolves.toMatchObject({
        paid_at: '2026-10-20',
      })
    })

    it('空 patch / 非对象 patch / 不存在的记录都给出明确错误', async () => {
      await seedBill('b1', { amount: 1000, due_date: '2026-10-25' })
      await seedPayment('p1', 'b1', 400)

      await expect(updatePayment('p1', {})).rejects.toThrow('没有可更新的字段')
      await expect(updatePayment('p1', null as never)).rejects.toThrow('缺少合法的编辑参数')
      await expect(updatePayment('nope', { amount: 100 })).rejects.toThrow('还款记录不存在')
    })
  })

  describe('deletePayment: 状态与统计收敛', () => {
    it('删掉唯一一笔还款：paid -> unpaid，Σpayments 归零（未到期的账单）', async () => {
      // 远期到期日，避免随真实时间流逝账单过期后正确地落为 overdue
      await seedBill('b1', { amount: 1000, due_date: '2099-01-01' })
      await seedPayment('p1', 'b1', 1000)
      await db.exec(`UPDATE bills SET status = 'paid' WHERE id = 'b1';`)

      await expect(deletePayment('p1')).resolves.toEqual({ ok: true })

      expect(await paymentTotal('b1')).toBe(0)
      expect(await billStatus('b1')).toBe('unpaid')
      const left = await db.prepare('SELECT COUNT(*) AS c FROM payments WHERE id = ?').bind('p1').first<{ c: number }>()
      expect(left?.c).toBe(0)
    })

    it('删掉多笔中的一笔：paid -> partial，剩余还款保留', async () => {
      await seedBill('b1', { amount: 1000, due_date: '2026-10-25' })
      await seedPayment('p1', 'b1', 600)
      await seedPayment('p2', 'b1', 400)
      await db.exec(`UPDATE bills SET status = 'paid' WHERE id = 'b1';`)

      await deletePayment('p2')

      expect(await paymentTotal('b1')).toBe(600)
      expect(await billStatus('b1')).toBe('partial')
    })

    it('删干净后到期日已过的账单落为 overdue 而非 unpaid', async () => {
      await seedBill('b1', { amount: 1000, due_date: '2020-01-01' })
      await seedPayment('p1', 'b1', 400)
      await db.exec(`UPDATE bills SET status = 'partial' WHERE id = 'b1';`)

      await deletePayment('p1')

      expect(await paymentTotal('b1')).toBe(0)
      expect(await billStatus('b1')).toBe('overdue')
    })

    it('删除不存在的记录报 NOT_FOUND', async () => {
      await expect(deletePayment('ghost')).rejects.toThrow('还款记录不存在')
    })
  })

  describe('成员隔离（memberGuard 链路）', () => {
    // member 绑定 h1（本人）；p_other 挂在 h-other 的卡上，对他人是越权
    const memberCtx: MemberContext = { userId: 'u-member', role: 'member', holderIds: ['h1'] }

    beforeEach(async () => {
      await db.exec(`
        INSERT INTO card_holders (id, created_by, managed_by, name) VALUES ('h-other', 'u1', 'u1', '家人');
        INSERT INTO credit_cards (id, holder_id, card_product_id, billing_day) VALUES ('cc2', 'h-other', 'cp1', 5);
        INSERT INTO bills (id, card_id, bill_month, due_date, bill_amount, status)
        VALUES ('b_other', 'cc2', '2026-10-01', '2026-10-25', 1000, 'unpaid');
        INSERT INTO payments (id, bill_id, amount, paid_at, idempotency_key)
        VALUES ('p_other', 'b_other', 400, '2026-10-20', 'idem_p_other');
      `)
    })

    it('member 改/删他人还款记录 -> MemberScopeError（经 registry guard 实际调用）', async () => {
      const updateGuard = RPC_REGISTRY.payments?.updatePayment?.memberGuard
      const deleteGuard = RPC_REGISTRY.payments?.deletePayment?.memberGuard
      expect(updateGuard).toBeDefined()
      expect(deleteGuard).toBeDefined()

      await expect(updateGuard!(['p_other', { amount: 1 }], memberCtx)).rejects.toBeInstanceOf(
        MemberScopeError,
      )
      await expect(deleteGuard!(['p_other'], memberCtx)).rejects.toBeInstanceOf(MemberScopeError)
    })

    it('归属链校验直达 impl：本人记录放行，他人记录与非法 ID 拒绝', async () => {
      await seedBill('b1', { amount: 1000, due_date: '2026-10-25' })
      await seedPayment('p_mine', 'b1', 400)

      await expect(assertPaymentAccess('p_mine', memberCtx)).resolves.toBeUndefined()
      await expect(assertPaymentAccess('p_other', memberCtx)).rejects.toBeInstanceOf(MemberScopeError)
      await expect(assertPaymentAccess(123, memberCtx)).rejects.toBeInstanceOf(MemberScopeError)
    })

    it('guard 放行后 impl 才执行：越权路径下 impl 永远碰不到那行数据', async () => {
      await expect(updatePayment('p_other', { amount: 1 })).resolves.toMatchObject({ amount: 1 })
      await deletePayment('p_other')
      // impl 无内建隔离（隔离由 registry guard 承担），guard 必须存在且先行
      expect(RPC_REGISTRY.payments.updatePayment.memberGuard).toBeDefined()
      expect(RPC_REGISTRY.payments.deletePayment.memberGuard).toBeDefined()
    })

    it('registry 注册了独立 payments 模块的两个入口', () => {
      expect(RPC_REGISTRY.payments.updatePayment.impl).toBeDefined()
      expect(RPC_REGISTRY.payments.deletePayment.impl).toBeDefined()
    })
  })
})
