// 回归：用户手填的账单金额必须优先于一切导入来源（邮件解析 / Gmail 同步 / LLM）。
//
// 实现要点是「覆盖值单独存一列」：导入方只写 bills.bill_amount，手填写
// bills.bill_amount_override，读取时按优先级合成。若改成「导入时判断是不是人工
// 填的」，任何一条导入路径漏判都会把用户的数字悄悄改掉，所以这里把规则锁死。

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  effectiveBillAmount,
  hasManualBillAmount,
  canManuallySetBillAmount,
  nextBillingDateOf,
} from '../utils'

const ROOT = join(__dirname, '../..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

describe('effectiveBillAmount：手填值优先', () => {
  it('没有手填值时用导入金额', () => {
    expect(effectiveBillAmount({ bill_amount: 1200 })).toBe(1200)
    expect(effectiveBillAmount({ bill_amount: 1200, bill_amount_override: null })).toBe(1200)
    expect(effectiveBillAmount({ bill_amount: 1200, bill_amount_override: undefined })).toBe(1200)
  })

  it('有手填值时用 手填值，即使导入值与它不同', () => {
    expect(effectiveBillAmount({ bill_amount: 1200, bill_amount_override: 800 })).toBe(800)
  })

  it('手填 0 仍然生效（0 是合法覆盖值，不能被当作「未设置」）', () => {
    // 这是最容易写错的一处：用 `bill_amount_override || bill_amount` 会让 0 回落到导入值。
    expect(effectiveBillAmount({ bill_amount: 1200, bill_amount_override: 0 })).toBe(0)
    expect(hasManualBillAmount({ bill_amount_override: 0 })).toBe(true)
  })

  it('缺失与 null 都视为未手填', () => {
    expect(hasManualBillAmount({})).toBe(false)
    expect(hasManualBillAmount({ bill_amount_override: null })).toBe(false)
    expect(hasManualBillAmount({ bill_amount_override: undefined })).toBe(false)
    expect(hasManualBillAmount({ bill_amount_override: 800 })).toBe(true)
  })
})

describe('canManuallySetBillAmount：账单日前 5 天内可手填', () => {
  // 用固定日期，避免测试随真实日期漂移
  const today = new Date(2026, 8, 14) // 2026-09-14

  it('账单日 = 当月 10 日时，下一次是 10-10，距今 26 天 → 不可', () => {
    expect(canManuallySetBillAmount(10, today)).toBe(false)
  })

  it('账单日 = 当月 18 日，距今 4 天 → 可（不足 5 天）', () => {
    expect(canManuallySetBillAmount(18, today)).toBe(true)
  })

  it('账单日 = 当天 → 可', () => {
    expect(canManuallySetBillAmount(14, today)).toBe(true)
  })

  it('账单日 = 距今正好 5 天 → 不可（边界取「不足 5 天」）', () => {
    expect(canManuallySetBillAmount(19, today)).toBe(false)
  })

  it('账单日 = 距今 1 天 → 可', () => {
    expect(canManuallySetBillAmount(15, today)).toBe(true)
  })

  it('与账单页排序共用同一口径（nextBillingDateOf）', () => {
    expect(nextBillingDateOf(18, today).getDate()).toBe(18)
    expect(nextBillingDateOf(18, today).getMonth()).toBe(8) // 仍是 9 月
    expect(nextBillingDateOf(10, today).getMonth()).toBe(9) // 已过 → 10 月
  })
})

describe('导入路径不得触碰手填覆写列', () => {
  // 只要导入侧从来不写 bill_amount_override，手填值就天然不会被覆盖。
  const importPaths = [
    'lib/email-core/bills.ts',
    'email-worker/src/index.ts',
    'lib/api/sync-gmail.server.ts',
    'lib/api/billDrafts.server.ts',
  ]

  it.each(importPaths)('%s 不写 bill_amount_override', rel => {
    expect(read(rel)).not.toMatch(/bill_amount_override\s*=/)
  })

  it('只有「设置手填值」的入口写这一列', () => {
    const server = read('lib/api/bills.server.ts')
    // setBillAmountOverride 是唯一写入点
    expect(server).toMatch(/UPDATE bills SET bill_amount_override = \?/)
    expect(server.match(/SET bill_amount_override/g)?.length).toBe(1)
  })
})

describe('读路径统一按生效金额投影', () => {
  // 漏掉一处就会出现「账单页显示 800、持卡人页显示 1200」。
  it('账单主页映射使用 COALESCE 语义（手填优先）', () => {
    const server = read('lib/api/bills.server.ts')
    expect(server).toMatch(/bill_amount: row\.bill_amount_override != null \? row\.bill_amount_override : row\.bill_amount/)
  })

  it.each([
    'lib/api/cards.server.ts',
    'lib/api/holders.server.ts',
    'lib/api/analytics.server.ts',
    'worker/cron.ts',
  ])('%s 在 SQL 层做 COALESCE(bill_amount_override, bill_amount)', rel => {
    // 允许表别名前缀（joins 里写成 b.bill_amount_override）
    expect(read(rel)).toMatch(/COALESCE\(\w*\.?bill_amount_override,\s*\w*\.?bill_amount\)/)
  })

  it('还款校验用生效金额（否则手填 800 却按导入 1200 拒绝还款）', () => {
    const server = read('lib/api/bills.server.ts')
    expect(server).toMatch(/const billAmount = effectiveBillAmount\(bill\)/)
  })

  it('状态判定用生效金额', () => {
    const server = read('lib/api/bills.server.ts')
    expect(server).toMatch(/const amount = effectiveBillAmount\(bill\)/)
  })
})
