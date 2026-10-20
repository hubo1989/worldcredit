// 回归：周期固定支出（房租 / 贷款）的账期与到期口径。
//
// 关键设计取舍：账期按「应付日所在月」固定，不做「过了应付日就滚到下期」。
// 滚动口径会把「本月该付没付」直接抹掉——房租 15 号到期，16 号就变成「下月
// 还没到期」，逾期再也表达不出来。

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  payablePeriodOf,
  payableDueDate,
  nextPayablePeriodOf,
  payableToSortCard,
  compareUnifiedBills,
} from '../utils'
import { categoryLabel, PAYABLE_CATEGORIES } from '../api/payables.shared'
import { setDb } from '../db/client'
import { resolveDisplayPeriod } from '../api/payables.server'

const ROOT = join(__dirname, '../..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

const fmt = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

describe('账期归属', () => {
  it('账期就是当月，与日期在月中/月末无关', () => {
    expect(payablePeriodOf(new Date(2026, 8, 1))).toBe('2026-09')
    expect(payablePeriodOf(new Date(2026, 8, 15))).toBe('2026-09')
    expect(payablePeriodOf(new Date(2026, 8, 30))).toBe('2026-09')
  })

  it('月份补零，跨年正确', () => {
    expect(payablePeriodOf(new Date(2026, 0, 5))).toBe('2026-01')
    expect(payablePeriodOf(new Date(2026, 11, 31))).toBe('2026-12')
  })
})

describe('到期日', () => {
  it('常规日期直接取该日', () => {
    expect(fmt(payableDueDate(15, '2026-09'))).toBe('2026-09-15')
    expect(fmt(payableDueDate(1, '2026-09'))).toBe('2026-09-01')
  })

  it('应付日大于当月天数时落到当月最后一天（如 31 日 / 2 月）', () => {
    expect(fmt(payableDueDate(31, '2026-09'))).toBe('2026-09-30') // 9 月 30 天
    expect(fmt(payableDueDate(31, '2026-02'))).toBe('2026-02-28') // 2026 非闰年
    expect(fmt(payableDueDate(30, '2026-02'))).toBe('2026-02-28')
  })

  it('闰年 2 月按 29 天', () => {
    expect(fmt(payableDueDate(31, '2028-02'))).toBe('2028-02-29')
  })

  it('逾期表达得出来：过了应付日仍属本期', () => {
    // 9/20 的应付日在 9/25 看仍然是 2026-09 账期（只是已逾期），不是 10 月
    expect(payablePeriodOf(new Date(2026, 8, 25))).toBe('2026-09')
    expect(fmt(payableDueDate(20, payablePeriodOf(new Date(2026, 8, 25))))).toBe('2026-09-20')
  })
})

describe('列表排序：登记付款后沉底（与信用卡混排口径）', () => {
  const today = new Date(2026, 9, 15) // 本期账期 2026-10
  const card = (status: 'unpaid' | 'paid' | 'overdue', days: number) =>
    payableToSortCard({ status, days_until_due: days, due_day: 15, due_date: '2026-10-15' })
  const cmp = (
    a: ReturnType<typeof card>,
    b: ReturnType<typeof card>
  ) => compareUnifiedBills(a, b, 'nearest_due', today)

  it('三段固定：逾期 → 待付 → 已付（已付沉底，与卡片区同口径）', () => {
    expect(cmp(card('overdue', -5), card('unpaid', 10))).toBeLessThan(0)
    expect(cmp(card('unpaid', 10), card('paid', -3))).toBeLessThan(0)
    expect(cmp(card('overdue', -5), card('paid', -3))).toBeLessThan(0)
  })

  it('组内按距应付日升序：逾期最久在前 / 最近到期在前', () => {
    expect(cmp(card('overdue', -9), card('overdue', -2))).toBeLessThan(0)
    expect(cmp(card('unpaid', 3), card('unpaid', 20))).toBeLessThan(0)
  })

  it('已付项的天数（可能为负）不再影响其沉底位置', () => {
    expect(cmp(card('paid', -20), card('unpaid', 25))).toBeGreaterThan(0)
  })
})

describe('下期应付日（已付文案与排序键共用）', () => {
  it('下一期账期跨年正确', () => {
    expect(nextPayablePeriodOf('2026-09')).toBe('2026-10')
    expect(nextPayablePeriodOf('2026-12')).toBe('2027-01')
  })

  it('应付日大于下月天数时落到月末（31 日 → 11-30）', () => {
    expect(fmt(payableDueDate(31, nextPayablePeriodOf('2026-10')))).toBe('2026-11-30')
  })

  it('排序卡的下期应付日同样收拢：10-31 的已付项下期是 11-30，不是 12-01', () => {
    const card = payableToSortCard({
      status: 'paid',
      days_until_due: -15,
      due_day: 31,
      due_date: '2026-10-31',
    })
    expect(fmt(new Date(card.nextDueDate))).toBe('2026-11-30')
  })
})

describe('分类标签', () => {
  it('已知分类有中文标签', () => {
    expect(categoryLabel('rent')).toBe('房租')
    expect(categoryLabel('loan')).toBe('贷款')
  })

  it('未知分类回落到「其他」而不是崩溃或显示 undefined', () => {
    expect(categoryLabel('nope' as never)).toBe('其他')
  })

  it('下拉选项由标签表派生，增删分类不会漏改界面', () => {
    expect(PAYABLE_CATEGORIES.map(c => c.value)).toEqual(['rent', 'loan', 'utility', 'insurance', 'other'])
    for (const c of PAYABLE_CATEGORIES) expect(c.label).toBe(categoryLabel(c.value))
  })
})

describe('边界：房租不进信用卡模型', () => {
  // 家庭财务审计明确要求不得把房租伪装成信用卡产品，否则它会混进卡数、
  // 额度、免息期等一切卡口径。
  it('payables 用独立表，未复用 bills / credit_cards', () => {
    const sql = read('migrations/d1/0009_recurring_payables.sql')
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS recurring_payables/)
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS recurring_payable_payments/)
    // 不应把房租塞进信用卡或账单表
    expect(sql).not.toMatch(/INSERT INTO credit_cards/)
    expect(sql).not.toMatch(/ALTER TABLE bills ADD/)
  })

  it('还款按 (payable_id, period) 唯一，重复登记天然幂等', () => {
    expect(read('migrations/d1/0009_recurring_payables.sql')).toMatch(/UNIQUE\(payable_id, period\)/)
  })

  it('纯类型/纯函数放在 .shared，不把服务端依赖带进浏览器包', () => {
    const shared = read('lib/api/payables.shared.ts')
    expect(shared).not.toMatch(/from '\.\.\/db'/)
    expect(shared).not.toMatch(/query|execute/)
    // 界面组件从 shared 取标签函数
    expect(read('components/mobile/PayableList.tsx')).toMatch(/from '@\/lib\/api\/payables'/)
  })

  it('账期由服务端决定，客户端不得传入 period', () => {
    const server = read('lib/api/payables.server.ts')
    // payRecurringPayable 的账期来自 payablePeriodOf，而不是入参
    // 账期来自展示期滚动解析（与列表展示同源），而不是入参
    expect(server).toMatch(/const \{ period \} = await resolveDisplayPeriod\(payable\.data, today\)/)
    expect(server).not.toMatch(/payRecurringPayable\([^)]*period\s*:/)
  })
})

describe('展示期滚动（2026-10-21 规则：本期付清且距下期 <30 天 → 展示下期）', () => {
  // 最小 fake D1：只支持 resolveDisplayPeriod 用到的付款汇总查询
  function fakeDb(payments: Record<string, number>) {
    const db = {
      prepare(sql: string) {
        return {
          bind(...args: unknown[]) {
            return {
              async all<T>(): Promise<{ results: T[] }> {
                if (/recurring_payable_payments/.test(sql)) {
                  const key = `${args[0]}|${args[1]}`
                  return { results: [{ total: payments[key] ?? 0 }] as T[] }
                }
                return { results: [] }
              },
            }
          },
        }
      },
    }
    return db
  }

  const row = {
    id: 'p1', created_by: 'u1', name: '房贷', category: 'loan' as const,
    amount: 5000, currency: 'CNY', due_day: 5, holder_id: null,
    note: null, is_active: 1, created_at: '2026-01-01',
  }

  it('本期未付清 + 下期临近：不滚动（逾期不被下期掩盖）', async () => {
    // 应付日 5 号，今天 10-10：下期（11-05）只剩 26 天，但本期没付 → 保持本期
    setDb(fakeDb({}) as never)
    const r = await resolveDisplayPeriod(row, new Date(2026, 9, 10))
    expect(r.period).toBe('2026-10')
    expect(r.paidAmount).toBe(0)
  })

  it('本期已付清 + 下期还有 35 天：不滚动（待出账展示本期已付）', async () => {
    // 应付日 25 号，今天 10-20：下期（11-25）还有 36 天
    const row25 = { ...row, due_day: 25 }
    setDb(fakeDb({ 'p1|2026-10': 5000 }) as never)
    const r = await resolveDisplayPeriod(row25, new Date(2026, 9, 20))
    expect(r.period).toBe('2026-10')
    expect(r.paidAmount).toBe(5000)
  })

  it('本期已付清 + 下期只剩 29 天：滚动到下期，已付归零（待还款、可登记下期）', async () => {
    // 应付日 25 号，今天 10-27：下期（11-25）只剩 29 天
    const row25 = { ...row, due_day: 25 }
    setDb(fakeDb({ 'p1|2026-10': 5000 }) as never)
    const r = await resolveDisplayPeriod(row25, new Date(2026, 9, 27))
    expect(r.period).toBe('2026-11')
    expect(r.paidAmount).toBe(0)
  })

  it('滚动恰好 30 天为界：距下期 30 天不滚动，29 天滚动', async () => {
    const row25 = { ...row, due_day: 25 }
    setDb(fakeDb({ 'p1|2026-10': 5000 }) as never)
    expect((await resolveDisplayPeriod(row25, new Date(2026, 9, 26))).period).toBe('2026-10') // 30 天
    expect((await resolveDisplayPeriod(row25, new Date(2026, 9, 27))).period).toBe('2026-11') // 29 天
  })

  it('0 元应付事项永不滚动（没有「付清」语义）', async () => {
    const zero = { ...row, amount: 0, due_day: 25 }
    setDb(fakeDb({}) as never)
    const r = await resolveDisplayPeriod(zero, new Date(2026, 9, 27))
    expect(r.period).toBe('2026-10')
  })
})
