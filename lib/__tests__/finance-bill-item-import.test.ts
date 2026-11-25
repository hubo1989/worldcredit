import { describe, expect, it } from 'vitest'
import {
  aggregateCategoryBreakdown, classifyBillItem, computeBillItemsDiscrepancy, normalizeBillItemInput,
  normalizeMerchantKey, parseCsvBillItems, parseCsvMatrix, parsePastedBillItems, signedItemAmount,
  type SpendCategory,
} from '../finance'

describe('bill item classification and preview', () => {
  it('follows remembered, explicit, keyword and default categories', () => {
    const rules = new Map<string, SpendCategory>([['starbucks', 'other']])
    expect(normalizeMerchantKey('  ＳＱ  * Starbucks ＃0012  ')).toBe('starbucks')
    expect(classifyBillItem({ merchant_name: '支付宝- Starbucks #12', category: '餐饮' }, rules)).toBe('other')
    expect(classifyBillItem({ description: 'Uber Eats' })).toBe('dining')
    expect(classifyBillItem({ description: 'Uber', category: '日常购物' })).toBe('shopping')
    expect(classifyBillItem({ description: 'Starbucks', item_type: 'fee' }, rules)).toBe('fees_interest')
    expect(classifyBillItem({ category: '教育培训', item_type: 'fee' })).toBe('education')
    expect(classifyBillItem({ description: 'Unknown #424' })).toBeNull()
    expect(classifyBillItem({ category: 'constructor' })).toBeNull()
  })

  it('stores refunds once and preserves the sign of adjustments', () => {
    const refund = normalizeBillItemInput({ description: '淘宝退款', amount: -100 }, undefined, 'USD')
    const adjustment = normalizeBillItemInput({ description: '积分', amount: -20.125, item_type: 'adjustment' })
    expect(refund).toMatchObject({ amount: 100, category: 'shopping', item_type: 'refund', currency: 'USD' })
    expect(signedItemAmount({ ...refund, amount: -100 })).toBe(-100)
    expect(signedItemAmount(adjustment)).toBe(-20.13)
    expect(computeBillItemsDiscrepancy(1234, [])).toEqual({ hasDiscrepancy: false, itemsNetTotal: 0, diff: 0 })
    expect(computeBillItemsDiscrepancy(-100.01, [refund]).hasDiscrepancy).toBe(false)
    expect(computeBillItemsDiscrepancy(-100.02, [refund]).hasDiscrepancy).toBe(true)
  })

  it('compares the authoritative amount with its own currency only', () => {
    const items = [
      { currency: 'USD', amount: 50, item_type: 'purchase' },
      { currency: 'CNY', amount: 10, item_type: 'purchase' },
    ] as const
    expect(computeBillItemsDiscrepancy(50, items, 'USD')).toEqual({
      hasDiscrepancy: false, itemsNetTotal: 50, diff: 0,
    })
    expect(computeBillItemsDiscrepancy(50, items).hasDiscrepancy).toBe(false)
  })

  it('previews mixed text separators, a January year boundary and normalized duplicates', () => {
    const rows = parsePastedBillItems(
      '12/31 星巴克 38.00 餐饮\n12/31\t星巴克\t38\n01/02,淘宝退款,-100\n01/03  华贸  1,234.50\n02/30 impossible 8',
      {
        billMonth: '2027-01', defaultCurrency: 'HKD',
        existingItems: [{ transaction_date: '2026-12-31', description: '  星巴克 ', amount: 38, item_type: 'purchase' }],
      },
    )
    expect(rows.map(row => row.default_checked)).toEqual([false, false, true, true])
    expect(rows.map(row => row.item.transaction_date)).toEqual(['2026-12-31', '2026-12-31', '2027-01-02', '2027-01-03'])
    expect(rows.map(row => row.item.amount)).toEqual([38, 38, 100, 1234.5])
    expect(rows[2].item).toMatchObject({ currency: 'HKD', item_type: 'refund' })
  })

  it('keeps thousands groups intact and skips an unmatched quote in pasted rows', () => {
    const rows = parsePastedBillItems('华贸,1,234.50\n"断行,45\n超市,01,234,567.89,购物\n书店,40', { defaultCurrency: 'CNY' })
    expect(rows.map(row => [row.item.description, row.item.amount])).toEqual([
      ['华贸', 1234.5], ['超市', 1234567.89], ['书店', 40],
    ])
  })

  it('handles BOM, quoted line breaks, credit indicators and custom headerless mappings', () => {
    const csv = '\uFEFFDate,Description,Amount,Debit/Credit,Currency,Category\r\n' +
      '2027-01-02,"Coffee, ""East""\nMall",38,Debit,USD,餐饮\r\n01/03,Refund,"(1,234.56)",Credit,,'
    const options = { billMonth: '2027-01', defaultCurrency: 'HKD' }
    expect(parseCsvMatrix(csv)[1][1]).toBe('Coffee, "East"\nMall')
    expect(parseCsvBillItems(csv, options).map(row => row.item)).toMatchObject([
      { amount: 38, category: 'dining', currency: 'USD', item_type: 'purchase' },
      { amount: 1234.56, currency: 'HKD', item_type: 'refund' },
    ])
    expect(parseCsvBillItems('5,商户', {
      amountCol: 0, descCol: 1, dateCol: null, debitCreditCol: null, currencyCol: null, categoryCol: null,
    }, { ...options, hasHeader: false })[0].item.amount).toBe(5)
    expect(() => parseCsvMatrix('date,"unfinished')).toThrow(/引号/)
  })

  it('caps refunds against their own bill and currency and reports unconverted category totals', () => {
    const result = aggregateCategoryBreakdown([
      { bill_id: 'a', currency: 'CNY', category: 'dining', amount: 100, item_type: 'purchase', merchant_name: '星巴克' },
      { bill_id: 'a', currency: 'CNY', amount: 110, item_type: 'refund', merchant_name: '支付宝-星巴克 #12' },
      { bill_id: 'b', currency: 'CNY', category: 'dining', amount: 1000, item_type: 'purchase' },
      { bill_id: 'b', currency: 'USD', category: 'shopping', amount: 100, item_type: 'purchase' },
      { bill_id: 'b', currency: 'CNY', amount: 10, item_type: 'fee' },
      { bill_id: 'b', currency: 'USD', amount: 20, item_type: 'refund' },
    ], { rates: null, displayCurrency: 'CNY', totalBills: 3, includeFeesAndInterest: false })
    expect(result).toMatchObject({
      covered_bills: 2, total_bills: 3, fx_converted: false, fx_unconverted_currencies: ['USD'],
      unallocated_refunds_by_currency: { USD: 20, CNY: 10 },
      items: [
        { category: 'dining', amount: 1000, percentage: 100, by_currency: { CNY: 1000 } },
        { category: 'shopping', amount: 0, percentage: 0, by_currency: { USD: 100 } },
      ],
    })
  })
})
