import { describe, it, expect } from 'vitest'
import { normalizeAliases } from '../utils'

/**
 * 回归：D1 中 card_holders.aliases 是 TEXT，读回来是 JSON 字符串。
 * 组件用数组语义（join/length/forEach）消费该字段，字符串会直接抛
 * "aliases.join is not a function"，导致 /holders 页面整页白屏。
 */
describe('normalizeAliases', () => {
  it('keeps a real array intact', () => {
    expect(normalizeAliases(['呼金堂', '呼博'])).toEqual(['呼金堂', '呼博'])
  })

  it('parses the JSON string form that D1 returns', () => {
    expect(normalizeAliases('["呼金堂","呼博"]')).toEqual(['呼金堂', '呼博'])
  })

  it('returns an empty array for null / undefined / empty string', () => {
    expect(normalizeAliases(null)).toEqual([])
    expect(normalizeAliases(undefined)).toEqual([])
    expect(normalizeAliases('')).toEqual([])
    expect(normalizeAliases('   ')).toEqual([])
  })

  it('never returns a non-array for malformed or non-array JSON', () => {
    // 历史脏值不能让页面崩，也不能把字符串泄漏成数组
    expect(normalizeAliases('呼金堂')).toEqual([])
    expect(normalizeAliases('{"a":1}')).toEqual([])
    expect(normalizeAliases('["unterminated')).toEqual([])
    expect(normalizeAliases(42)).toEqual([])
  })

  it('drops non-string and empty entries from a mixed array', () => {
    expect(normalizeAliases(['呼博', '', null, 3, '呼金堂'])).toEqual(['呼博', '呼金堂'])
    expect(normalizeAliases('["呼博","",null,3]')).toEqual(['呼博'])
  })

  it('produces a value that is always safe for join / length', () => {
    for (const input of [null, undefined, '', '["a"]', 'garbage', 42, ['a']]) {
      const result = normalizeAliases(input)
      expect(Array.isArray(result)).toBe(true)
      expect(() => result.join('、')).not.toThrow()
      expect(typeof result.length).toBe('number')
    }
  })
})
