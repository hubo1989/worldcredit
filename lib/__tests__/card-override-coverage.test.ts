// 回归：卡级别覆盖（name_override / annual_fee_override 及既有 override_* 列）
// 必须在「会在界面上展示卡名或算还款日」的每个查询里被 select 出来。
//
// 这次的坑：卡片详情页把卡名改成 getEffectiveCardName 之后，getBillDetail 的 SQL
// 忘了带 override 列，于是 card.name_override 恒为 undefined，账单详情页静默回落到
// 卡产品原名——改动看着生效，实际没生效。纯函数单测抓不到，所以在源码层加不变量。

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '../..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

/** 按 `export async function name(` 切出每个查询函数体，便于逐个断言。 */
function fnBody(src: string, name: string): string {
  const start = src.indexOf(`export async function ${name}(`)
  expect(start, `${name} 不存在，测试需要同步维护`).toBeGreaterThan(-1)
  const rest = src.slice(start + 1)
  const next = rest.indexOf('\nexport ')
  return next === -1 ? rest : rest.slice(0, next)
}

describe('账单/卡片查询必须携带卡级别覆盖列', () => {
  const bills = read('lib/api/bills.server.ts')

  // 这些 loader 的返回值会喂给 getEffectiveCardName / getEffectiveBillingDay /
  // getEffectiveDueConfig，缺列就会静默回落到卡产品默认值。
  const loaders = ['getRecentBills', 'getBillDashboardItems', 'getBillById', 'getBillsByHolder', 'getBillDetail']

  for (const name of loaders) {
    it(`${name} 选中了 override 列`, () => {
      const body = fnBody(bills, name)
      // 必须匹配到 SELECT 的 AS 别名，而不是只匹配到映射代码里的字段名——
      // 否则「SQL 漏列但映射还留着」这种回归会漏网（这正是本次的坑）。
      expect(body, `${name} 的 SQL 缺少 override 列，卡级别修改不会生效`).toMatch(/AS \w*_override/)
      expect(body, `${name} 的 SQL 缺少 name_override，卡名会回落到卡产品原名`).toMatch(/AS \w*name_override/)
    })
  }

  it('getBillDetail 把覆盖列落进了返回的 card 对象', () => {
    const body = fnBody(bills, 'getBillDetail')
    for (const field of ['name_override', 'override_due_type', 'override_due_value']) {
      expect(body, `getBillDetail 返回的 card 缺 ${field}`).toMatch(new RegExp(`\\b${field}:`))
    }
  })

  it('账单读路径的卡名优先级与 withCreditCardProductFields 一致', () => {
    expect(bills).toMatch(/card_name: card\.name_override \?\? card\.card_name \?\? card\.card_product\?\.card_name/)
  })
})

describe('推送与提醒路径必须优先使用卡级别名称', () => {
  it('每日推送 cron 选中并优先使用 name_override', () => {
    const cron = read('worker/cron.ts')
    expect(cron, 'cron 没查 name_override，推送标题会显示卡产品原名').toMatch(/cc\.name_override/)
    expect(cron).toMatch(/name_override \|\|/)
    // 标题里的三个分支都要用生效名，不能残留 bill.card_name
    expect(cron).not.toMatch(/\$\{bill\.card_name \|\| ''\}/)
  })

  it('站内提醒的两条查询都带 name_override，且消费端优先取它', () => {
    const server = read('lib/api/reminders.server.ts')
    // 还款提醒 + 贷款提醒两条 SQL
    expect(server.match(/cc\.name_override/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
    const client = read('lib/reminders.ts')
    expect(client.match(/name_override \|\|/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
  })

  it('还款导出不再读一个不存在的字段（「卡片」列曾经恒为空）', () => {
    const payments = read('lib/api/payments.ts')
    expect(payments, 'payments 查询没带 name_override').toMatch(/cc\.name_override/)
    // 顶层 card_name 必须拼出来，lib/export.ts:176 读的就是它
    expect(payments).toMatch(/card_name:/)
    const exp = read('lib/export.ts')
    expect(exp).toMatch(/payment\.bill\.credit_cards\.card_name \?\?/)
  })

  it('lib/notifications 按扁平列读取（D1 helper 不支持嵌套 select）', () => {
    const src = read('lib/notifications.ts')
    // 嵌套写法在扁平结果上恒为 undefined，会抛 TypeError；这里锁死不再出现
    expect(src).not.toMatch(/bill\.credit_cards\.card_products/)
    expect(src).not.toMatch(/bill\.credit_cards\.name_override/)
    expect(src).toMatch(/bill\.name_override \|\| bill\.card_name/)
  })
})

describe('analytics / 录账单选卡器显示生效卡名', () => {
  it('analytics 卡片下拉用 card_name（已含覆盖）而非 card_product.card_name', () => {
    const src = read('app/(mobile)/analytics/page.tsx')
    expect(src).toMatch(/c\.card_name \?\? c\.card_product\?\.card_name/)
  })

  it('BillForm 选卡器优先用 card_name', () => {
    const src = read('components/mobile/BillForm.tsx')
    expect(src).toMatch(/c\.card_name \|\| c\.card_product\.card_name/)
  })
})

describe('迁移文件与列清单一致', () => {
  it('0006 迁移声明了本次新增的两个卡级别覆盖列', () => {
    const sql = read('migrations/d1/0006_credit_cards_overrides.sql')
    expect(sql).toMatch(/ADD COLUMN name_override TEXT/)
    expect(sql).toMatch(/ADD COLUMN annual_fee_override REAL/)
  })
})
