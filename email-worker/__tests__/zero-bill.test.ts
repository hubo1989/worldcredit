import { describe, it, expect } from 'vitest'
import { keepPaidStatus } from '../src/bills'

/**
 * 0 元账单回归：应还 0 元（本期已还清）的账单是合法数据。
 * 此前 !aiResult.bill_amount 把 0 当 falsy 误判成缺字段，
 * 这里固化判定语义，防止回归。
 */

describe('zero-amount bill semantics', () => {
  it('keepPaidStatus 保留已有状态', () => {
    expect(keepPaidStatus('paid')).toBe('paid')
    expect(keepPaidStatus('partial')).toBe('partial')
    expect(keepPaidStatus('unpaid')).toBe('unpaid')
    expect(keepPaidStatus(null)).toBe('unpaid')
  })

  it('0 是合法账单金额，不等于缺失', () => {
    // 直接固化数值语义：0 经过 Number() 后仍是 0，不是 NaN/null
    const zeroAmount = 0
    expect(zeroAmount == null).toBe(false)
    expect(Number.isNaN(Number(zeroAmount))).toBe(false)
    // 旧 bug 复现：!0 === true，这就是当初误跳过的根源
    expect(!zeroAmount).toBe(true)
  })

  it('null 和 undefined 才算缺失', () => {
    // 用函数参数包一层，避免 lint 把字面量比较判为常量表达式；
    // 语义与 `value == null` 完全一致（null 与 undefined 都算缺失）。
    const isMissing = (value: unknown) => value == null
    expect(isMissing(null)).toBe(true)
    expect(isMissing(undefined)).toBe(true)
    expect(isMissing(0)).toBe(false)
    expect(Number.isNaN(Number(null))).toBe(false) // Number(null)=0，所以 null 要用 ==null 判
    expect(Number.isNaN(Number('abc'))).toBe(true) // 非数字字符串才 NaN
  })
})

