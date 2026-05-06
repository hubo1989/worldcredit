// lib/__tests__/billParser.test.ts
import { describe, it, expect } from 'vitest'
import { parseBillItemsFromText, validateBillItemDrafts } from '../billParser'

describe('parseBillItemsFromText', () => {
  it('parses normal rows with space separators', () => {
    const text = `2026-04-01 星巴克 38.00 餐饮
2026-04-03 地铁 12.00 出行`
    const items = parseBillItemsFromText(text)

    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({
      transaction_date: '2026-04-01',
      description: '星巴克',
      amount: 38.00,
      category: '餐饮',
      item_type: 'purchase',
      source: 'manual',
    })
    expect(items[1]).toMatchObject({
      transaction_date: '2026-04-03',
      description: '地铁',
      amount: 12.00,
      category: '出行',
    })
  })

  it('parses tab-separated values', () => {
    const text = '2026-04-01\t星巴克\t38.00\t餐饮'
    const items = parseBillItemsFromText(text)

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      transaction_date: '2026-04-01',
      description: '星巴克',
      amount: 38.00,
      category: '餐饮',
    })
  })

  it('parses rows with YYYY/MM/DD date format', () => {
    const text = '2026/04/01 星巴克 38.00 餐饮'
    const items = parseBillItemsFromText(text)

    expect(items).toHaveLength(1)
    expect(items[0].transaction_date).toBe('2026-04-01')
  })

  it('handles negative amounts as refunds', () => {
    const text = '2026-04-05 退款 -20.00 退款'
    const items = parseBillItemsFromText(text)

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      amount: -20.00,
      item_type: 'refund',
      category: '退款',
    })
  })

  it('skips empty lines', () => {
    const text = `2026-04-01 星巴克 38.00 餐饮

2026-04-03 地铁 12.00 出行`
    const items = parseBillItemsFromText(text)

    expect(items).toHaveLength(2)
  })

  it('marks rows with unparseable amounts as errors', () => {
    const text = '2026-04-01 星巴克 abc 餐饮'
    const items = parseBillItemsFromText(text)

    expect(items).toHaveLength(1)
    expect(items[0].error).toBe('无法解析金额')
    expect(items[0].amount).toBe(0)
  })

  it('allows missing dates', () => {
    const text = '星巴克 38.00 餐饮'
    const items = parseBillItemsFromText(text)

    expect(items).toHaveLength(1)
    expect(items[0].transaction_date).toBeUndefined()
    expect(items[0].description).toBe('星巴克')
  })

  it('handles missing categories', () => {
    const text = '2026-04-01 星巴克 38.00'
    const items = parseBillItemsFromText(text)

    expect(items).toHaveLength(1)
    expect(items[0].category).toBeUndefined()
  })

  it('uses default description when only date and amount provided', () => {
    const text = '2026-04-01 38.00'
    const items = parseBillItemsFromText(text)

    expect(items).toHaveLength(1)
    expect(items[0].description).toBe('未分类消费')
  })

  it('handles amounts with commas', () => {
    const text = '2026-04-01 大额消费 1,234.56 餐饮'
    const items = parseBillItemsFromText(text)

    expect(items).toHaveLength(1)
    expect(items[0].amount).toBe(1234.56)
  })
})

describe('validateBillItemDrafts', () => {
  it('passes validation for valid items', () => {
    const items = [
      {
        transaction_date: '2026-04-01',
        description: '星巴克',
        amount: 38.00,
        category: '餐饮',
        item_type: 'purchase' as const,
        source: 'manual' as const,
      },
    ]

    const result = validateBillItemDrafts(items)

    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('returns error for empty items list', () => {
    const result = validateBillItemDrafts([])

    expect(result.valid).toBe(false)
    expect(result.errors).toContain('至少需要一条明细')
  })

  it('returns error for missing description', () => {
    const items = [
      {
        description: '',
        amount: 38.00,
        item_type: 'purchase' as const,
        source: 'manual' as const,
      },
    ]

    const result = validateBillItemDrafts(items)

    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('缺少商户说明')
  })

  it('returns error for zero amount', () => {
    const items = [
      {
        description: '星巴克',
        amount: 0,
        item_type: 'purchase' as const,
        source: 'manual' as const,
      },
    ]

    const result = validateBillItemDrafts(items)

    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('金额不能为零')
  })

  it('returns warning for missing transaction date', () => {
    const items = [
      {
        description: '星巴克',
        amount: 38.00,
        item_type: 'purchase' as const,
        source: 'manual' as const,
      },
    ]

    const result = validateBillItemDrafts(items)

    expect(result.valid).toBe(true)
    expect(result.warnings[0]).toContain('缺少交易日期')
  })

  it('returns error for items with parsing errors', () => {
    const items = [
      {
        description: '星巴克',
        amount: 0,
        error: '无法解析金额',
        item_type: 'purchase' as const,
        source: 'manual' as const,
      },
    ]

    const result = validateBillItemDrafts(items)

    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('无法解析金额')
  })

  it('returns error for negative total', () => {
    const items = [
      {
        description: '退款',
        amount: -100,
        item_type: 'refund' as const,
        source: 'manual' as const,
      },
    ]

    const result = validateBillItemDrafts(items)

    expect(result.valid).toBe(false)
    expect(result.errors).toContain('明细合计为负数，不能作为正常账单保存')
  })
})
