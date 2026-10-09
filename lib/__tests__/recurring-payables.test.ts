// 回归：周期固定支出（房租 / 贷款）的账期与到期口径。
//
// 关键设计取舍：账期按「应付日所在月」固定，不做「过了应付日就滚到下期」。
// 滚动口径会把「本月该付没付」直接抹掉——房租 15 号到期，16 号就变成「下月
// 还没到期」，逾期再也表达不出来。

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { payablePeriodOf, payableDueDate, nextPayablePeriodOf, comparePayablesList } from '../utils'
import { categoryLabel, PAYABLE_CATEGORIES } from '../api/payables.shared'

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

describe('列表排序：登记付款后沉底', () => {
  const item = (status: 'unpaid' | 'paid' | 'overdue', days: number) => ({
    status,
    days_until_due: days,
  })

  it('三段固定：逾期 → 待付 → 已付（与卡片区同口径）', () => {
    const paid = item('paid', -3)
    const unpaid = item('unpaid', 10)
    const overdue = item('overdue', -5)
    expect([unpaid, paid, overdue].sort(comparePayablesList)).toEqual([overdue, unpaid, paid])
  })

  it('组内按距应付日升序：逾期最久在前 / 最近到期在前', () => {
    expect(comparePayablesList(item('overdue', -9), item('overdue', -2))).toBeLessThan(0)
    expect(comparePayablesList(item('unpaid', 3), item('unpaid', 20))).toBeLessThan(0)
  })

  it('已付项的天数（可能为负）不再影响其沉底位置', () => {
    expect(comparePayablesList(item('paid', -20), item('unpaid', 25))).toBeGreaterThan(0)
  })
})

describe('下期应付日（待出账单文案）', () => {
  it('下一期账期跨年正确', () => {
    expect(nextPayablePeriodOf('2026-09')).toBe('2026-10')
    expect(nextPayablePeriodOf('2026-12')).toBe('2027-01')
  })

  it('应付日大于下月天数时落到月末（31 日 → 11-30）', () => {
    expect(fmt(payableDueDate(31, nextPayablePeriodOf('2026-10')))).toBe('2026-11-30')
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
    expect(server).toMatch(/const period = payablePeriodOf\(today\)/)
    expect(server).not.toMatch(/payRecurringPayable\([^)]*period\s*:/)
  })
})
