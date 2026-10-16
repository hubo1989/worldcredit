// lib/__tests__/opportunity-view-model.test.ts — presentation-layer rules
// (plan Task 12 step 6): minor-unit amounts, balance copy for counts/amounts/
// unlimited/unknown, status and action labels, deadline copy, shared-scope
// copy, and URL filter round-trips. No snapshot strings — every expectation
// names the exact rule it protects.

import { describe, it, expect } from 'vitest'
import {
  formatMinorAmount,
  formatBalance,
  STATUS_LABELS,
  ACTION_LABELS,
  deadlineText,
  sharedScopeText,
  toRowVm,
  filtersToQuery,
  queryToFilters,
} from '../opportunities/view-model'
import type { OpportunityDto } from '../opportunities/queries.server'

describe('formatMinorAmount', () => {
  it('CNY/默认货币用 ¥，USD 用 $，保留两位小数', () => {
    expect(formatMinorAmount(38_800, 'CNY')).toBe('¥388.00')
    expect(formatMinorAmount(9_99, null)).toBe('¥9.99')
    expect(formatMinorAmount(15_00, 'USD')).toBe('$15.00')
    expect(formatMinorAmount(-4_50, 'CNY')).toBe('-¥4.50')
  })
})

describe('formatBalance', () => {
  const base = {
    cycle_id: 'c1',
    status: 'available_today' as const,
    count_limit: null,
    amount_limit_minor: null,
    currency: null,
    remaining_count: null,
    remaining_minor: null,
  }

  it('次数型：剩余/共 N 次', () => {
    const r = formatBalance({ ...base, count_limit: 6, remaining_count: 4 })
    expect(r.main).toBe('剩余 4 次')
    expect(r.sub).toBe('共 6 次')
  })

  it('金额型：minor 单位换算为元并带货币符号', () => {
    const r = formatBalance({
      ...base,
      amount_limit_minor: 100_00,
      remaining_minor: 38_50,
      currency: 'CNY',
    })
    expect(r.main).toBe('剩余 ¥38.50')
    expect(r.sub).toBe('共 ¥100.00')
  })

  it('null 限额 = 不限次数；无周期按状态显示', () => {
    expect(formatBalance({ ...base }).main).toBe('不限次数')
    expect(
      formatBalance({ ...base, cycle_id: null, status: 'needs_confirmation' as const }).main,
    ).toBe('待确认')
  })
})

describe('labels', () => {
  it('状态与动作文案覆盖全部枚举，无空串', () => {
    for (const label of Object.values(STATUS_LABELS)) expect(label.length).toBeGreaterThan(0)
    for (const label of Object.values(ACTION_LABELS)) expect(label.length).toBeGreaterThan(0)
    expect(STATUS_LABELS.expiring_soon).toBe('即将到期')
    expect(ACTION_LABELS.record_claim).toBe('记录已领取')
    expect(ACTION_LABELS.view_entry).toBe('查看参与方式')
  })
})

describe('deadlineText', () => {
  it('今天/明天/N 天/无截止', () => {
    expect(deadlineText(0, '2026-10-31')).toBe('今天截止')
    expect(deadlineText(1, '2026-11-01')).toBe('明天截止')
    expect(deadlineText(7, '2026-11-07')).toBe('7 天后截止（2026-11-07）')
    expect(deadlineText(null, null)).toBe('无固定截止')
    expect(deadlineText(null, '2026-12-31')).toBe('截止 2026-12-31')
  })
})

describe('sharedScopeText', () => {
  it('卡级或单卡为空；holder 级多卡提示共享', () => {
    expect(sharedScopeText('card', 1)).toBe('')
    expect(sharedScopeText('holder', 1)).toBe('')
    expect(sharedScopeText('holder', 3)).toBe('3 张卡共享额度')
  })
})

describe('toRowVm', () => {
  const dto = {
    account_id: 'a1',
    definition_id: 'd1',
    kind: 'benefit',
    title: '机场贵宾厅',
    category: 'travel',
    bank_id: null,
    card_ids: ['c1', 'c2'],
    holder_id: 'h1',
    holder_name: '我',
    scope_kind: 'holder',
    revision: 1,
    status: 'available_today',
    action: 'record_usage',
    reason: '今天可用',
    usable_today: true,
    needs_review: false,
    days_left: 2,
    deadline_on: '2026-10-17',
    cycle_id: 'cy1',
    cycle_key: 'regular:2026-10-01',
    period_start_on: '2026-10-01',
    period_end_before: '2026-11-01',
    count_limit: 6,
    amount_limit_minor: null,
    currency: null,
    used_count: 1,
    reserved_count: 0,
    opening_used_count: 0,
    remaining_count: 5,
    remaining_minor: null,
    unit_label: '次',
    entry: { website_url: 'https://x', app_name: null, app_path: null },
    followed: false,
    today_on: '2026-10-15',
  } as unknown as OpportunityDto

  it('组合 meta 行（类型·持卡人·截止）与共享提示', () => {
    const vm = toRowVm(dto)
    expect(vm.metaLine).toBe('权益 · 我 · 2 天后截止（2026-10-17）')
    expect(vm.sharedText).toBe('2 张卡共享额度')
    expect(vm.balance.main).toBe('剩余 5 次')
    expect(vm.statusLabel).toBe('今天可用')
    expect(vm.actionLabel).toBe('记录使用')
    expect(vm.reviewHint).toBeNull()
  })
})

describe('URL filter round-trip', () => {
  it('snake_case DTO ↔ URL 参数固定名（§6.2）', () => {
    const q = filtersToQuery({ kind: 'promo', status: 'available_today', q: '贵宾', holder: null })
    expect(q).toBe('?kind=promo&status=available_today&q=%E8%B4%B5%E5%AE%BE')
    const back = queryToFilters(new URLSearchParams(q.slice(1)))
    expect(back).toEqual({
      holder_id: null, card_id: null, bank_id: null,
      category: null, kind: 'promo', status: 'available_today', q: '贵宾',
    })
    // 空查询返回全空筛选
    expect(queryToFilters(new URLSearchParams())).toEqual({
      holder_id: null, card_id: null, bank_id: null,
      category: null, kind: null, status: null, q: null,
    })
  })
})
