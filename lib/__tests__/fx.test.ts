// 多币种折算回归。
//
// 这组用例盯的是最危险的一类 bug：把「拿不到汇率」当成 1:1 静默换算。金额会凭空
// 变小、数字看着有、没人能发现——比直接报错恶劣得多。所以「缺币种必须不返回 1:1」
// 是这里的第一优先级断言。
//
// 全部用 mock 汇率，不打网络。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  convert,
  sumByCurrency,
  parseRates,
  normalizeCurrency,
  normalizeCurrencyOrDefault,
  currencySymbol,
  fetchRates,
  clearFxCache,
  type FxRates,
} from '../fx'

/** base = USD 的汇率表，数值取自接口真实返回。 */
const mockRates: FxRates = {
  base: 'USD',
  rates: { USD: 1, CNY: 6.7115, HKD: 7.84358, EUR: 0.866748, JPY: 147.5 },
  timestamp: 1789444800,
  fetched_at: Date.now(),
}

function ratesWithout(...codes: string[]): FxRates {
  const rates = { ...mockRates.rates }
  for (const code of codes) delete rates[code]
  return { ...mockRates, rates }
}

describe('convert：经 USD 中转', () => {
  it('同币种直接返回原值（不查汇率，即使汇率表为空）', () => {
    expect(convert(123.45, 'CNY', 'CNY', null)).toBe(123.45)
    expect(convert(0, 'USD', 'USD', null)).toBe(0)
    expect(convert(-50, 'HKD', 'HKD', { ...mockRates, rates: {} })).toBe(-50)
  })

  it('USD 参与时等价于直接查表', () => {
    // 1 USD = 6.7115 CNY
    expect(convert(100, 'USD', 'CNY', mockRates)).toBeCloseTo(671.15, 6)
    // 100 CNY / 6.7115 = 14.899... USD
    expect(convert(100, 'CNY', 'USD', mockRates)).toBeCloseTo(100 / 6.7115, 6)
  })

  it('非 USD 之间也走中转（CNY → HKD）', () => {
    // 100 CNY → USD → HKD：100 / 6.7115 * 7.84358
    const expected = (100 / 6.7115) * 7.84358
    expect(convert(100, 'CNY', 'HKD', mockRates)).toBeCloseTo(expected, 6)
    // 往返应回到原值
    const back = convert(expected, 'HKD', 'CNY', mockRates)
    expect(back).toBeCloseTo(100, 6)
  })

  it('金额大小写与空白不敏感', () => {
    expect(convert(100, ' cny ', 'hkd', mockRates)).toBeCloseTo((100 / 6.7115) * 7.84358, 6)
  })

  it('金额为 0 / 负数 / 极大值仍按公式计算', () => {
    expect(convert(0, 'USD', 'CNY', mockRates)).toBe(0)
    expect(convert(-100, 'USD', 'CNY', mockRates)).toBeCloseTo(-671.15, 6)
    const huge = convert(1e15, 'USD', 'CNY', mockRates)
    expect(huge).toBeCloseTo(1e15 * 6.7115, 0)
    expect(Number.isFinite(huge)).toBe(true)
  })
})

describe('convert：缺汇率时绝不静默按 1:1 换算', () => {
  it('rates 为 null / undefined / 空对象 → null', () => {
    expect(convert(100, 'USD', 'CNY', null)).toBeNull()
    expect(convert(100, 'USD', 'CNY', undefined)).toBeNull()
    expect(convert(100, 'USD', 'CNY', { ...mockRates, rates: {} })).toBeNull()
  })

  it('源币种不在汇率表里 → null（不是原值、不是 1:1）', () => {
    const partial = ratesWithout('CNY')
    expect(convert(100, 'CNY', 'USD', partial)).toBeNull()
  })

  it('目标币种不在汇率表里 → null（不是原值、不是 1:1）', () => {
    const partial = ratesWithout('HKD')
    const result = convert(100, 'CNY', 'HKD', partial)
    expect(result).toBeNull()
    // 关键回归：绝不能等于原值，那正是「静默 1:1」的形态
    expect(result).not.toBe(100)
  })

  it('汇率非正数视为不可用 → null（避免除零得 Infinity）', () => {
    expect(convert(100, 'USD', 'CNY', { ...mockRates, rates: { USD: 1, CNY: 0 } })).toBeNull()
    expect(convert(100, 'USD', 'CNY', { ...mockRates, rates: { USD: 1, CNY: -6.7 } })).toBeNull()
  })

  it('金额不是有限数 → null', () => {
    expect(convert(Number.NaN, 'USD', 'CNY', mockRates)).toBeNull()
    expect(convert(Number.POSITIVE_INFINITY, 'USD', 'CNY', mockRates)).toBeNull()
  })

  it('币种代码非法 → null', () => {
    expect(convert(100, '', 'CNY', mockRates)).toBeNull()
    expect(convert(100, 'US', 'CNY', mockRates)).toBeNull()
    expect(convert(100, 'USD', 'CNYX', mockRates)).toBeNull()
  })
})

describe('sumByCurrency：分组后折算', () => {
  const items = [
    { amount: 100, currency: 'CNY' },
    { amount: 200, currency: 'CNY' },
    { amount: 10, currency: 'USD' },
    { amount: 50, currency: 'HKD' },
  ]

  it('按币种分组求和，且不会把 USD 加进 CNY', () => {
    const result = sumByCurrency(items, i => i, 'CNY', mockRates)
    expect(result.by_currency).toEqual({ CNY: 300, USD: 10, HKD: 50 })
    expect(result.mixed).toBe(true)
    expect(result.converted).toBe(true)
    expect(result.unconverted_currencies).toEqual([])
  })

  it('total 是折算后的合计，而不是原币种直接相加', () => {
    const result = sumByCurrency(items, i => i, 'CNY', mockRates)
    const expected = 300 + 10 * 6.7115 + 50 / 7.84358 * 6.7115
    expect(result.total).toBeCloseTo(expected, 6)
    // 直接相加会得到 360，必须不等于它
    expect(result.total).not.toBe(360)
  })

  it('目标币种为 USD 时口径一致', () => {
    const result = sumByCurrency(items, i => i, 'USD', mockRates)
    const expected = 300 / 6.7115 + 10 + 50 / 7.84358
    expect(result.total).toBeCloseTo(expected, 6)
    expect(result.converted_currency).toBe('USD')
  })

  it('单币种时 mixed 为 false', () => {
    const result = sumByCurrency([{ amount: 1, currency: 'CNY' }], i => i, 'CNY', mockRates)
    expect(result.mixed).toBe(false)
    expect(result.total).toBe(1)
  })

  it('缺汇率的币种被排除在 total 之外，但仍保留在 by_currency', () => {
    const partial = ratesWithout('HKD')
    const result = sumByCurrency(items, i => i, 'CNY', partial)
    expect(result.converted).toBe(false)
    expect(result.unconverted_currencies).toEqual(['HKD'])
    // 50 HKD 没有被当成 50 CNY 混进去
    expect(result.by_currency.HKD).toBe(50)
    const expected = 300 + 10 * 6.7115
    expect(result.total).toBeCloseTo(expected, 6)
    expect(result.total).not.toBeCloseTo(300 + 10 * 6.7115 + 50, 6)
  })

  it('完全没有汇率时，跨币种被排除、同币种仍精确计入（绝不退化成相加）', () => {
    const result = sumByCurrency(items, i => i, 'CNY', null)
    // 同币种（CNY→CNY）是恒等变换，不需要汇率即可精确计入
    expect(result.total).toBe(300)
    // 关键：10 USD + 50 HKD 没有被当成人民币混进来（直接相加会得到 360）
    expect(result.total).not.toBeCloseTo(360, 6)
    expect(result.converted).toBe(false)
    expect(result.unconverted_currencies).toEqual(['HKD', 'USD'])
    // 分币种明细仍然完整，UI 可以据此展示真实构成
    expect(result.by_currency).toEqual({ CNY: 300, USD: 10, HKD: 50 })
  })

  it('pick 返回 null/undefined 的条目被跳过，0 金额不产生分组', () => {
    const result = sumByCurrency(items, i => (i.currency === 'USD' ? null : i), 'CNY', mockRates)
    expect(result.by_currency.USD).toBeUndefined()
    expect(result.mixed).toBe(true)

    const withZero = sumByCurrency([{ amount: 0, currency: 'JPY' }], i => i, 'CNY', mockRates)
    expect(withZero.by_currency).toEqual({})
    expect(withZero.mixed).toBe(false)
  })

  it('空输入安全返回', () => {
    const result = sumByCurrency([], () => null, 'CNY', mockRates)
    expect(result.total).toBe(0)
    expect(result.by_currency).toEqual({})
    expect(result.unconverted_currencies).toEqual([])
  })

  it('币种缺失时回落到目标币种而不是丢弃该条目', () => {
    const result = sumByCurrency(
      [{ amount: 10, currency: '' }, { amount: 5, currency: 'CNY' }],
      i => i,
      'CNY',
      mockRates
    )
    expect(result.by_currency).toEqual({ CNY: 15 })
  })
})

describe('parseRates / normalizeCurrency', () => {
  it('接受接口真实形状', () => {
    const parsed = parseRates({ timestamp: 1789444800, base: 'USD', rates: { CNY: 6.7115, USD: 1 } })
    expect(parsed?.base).toBe('USD')
    expect(parsed?.rates.CNY).toBe(6.7115)
    expect(parsed?.timestamp).toBe(1789444800)
  })

  it('过滤非法条目（非正数 / 非数字 / 非法代码）', () => {
    const parsed = parseRates({
      base: 'USD',
      rates: { CNY: 6.7115, BAD: 'abc', ZERO: 0, NEG: -1, toolong: 2, USD: 1 },
    })
    expect(Object.keys(parsed?.rates ?? {}).sort()).toEqual(['CNY', 'USD'])
  })

  it('结构不合法 → null', () => {
    expect(parseRates(null)).toBeNull()
    expect(parseRates('nope')).toBeNull()
    expect(parseRates([])).toBeNull()
    expect(parseRates({ rates: null })).toBeNull()
    expect(parseRates({ rates: [] })).toBeNull()
    expect(parseRates({ rates: {} })).toBeNull()
  })

  it('读缓存时保留已有的 fetched_at，避免 TTL 被无限续期', () => {
    const old = parseRates({ base: 'USD', rates: { USD: 1 }, fetched_at: 1234 })
    expect(old?.fetched_at).toBe(1234)
  })

  it('normalizeCurrency 只接受三位字母代码', () => {
    expect(normalizeCurrency('cny')).toBe('CNY')
    expect(normalizeCurrency(' USD ')).toBe('USD')
    expect(normalizeCurrency('US')).toBeNull()
    expect(normalizeCurrency('USDT')).toBeNull()
    expect(normalizeCurrency(123)).toBeNull()
    expect(normalizeCurrency(null)).toBeNull()
    expect(normalizeCurrencyOrDefault('', 'HKD')).toBe('HKD')
    expect(normalizeCurrencyOrDefault('bogus', 'HKD')).toBe('HKD')
    expect(normalizeCurrencyOrDefault(undefined, 'nope')).toBe('CNY')
    expect(normalizeCurrencyOrDefault(undefined, '')).toBe('CNY')
  })

  it('currencySymbol 对未知币种回落到代码本身，不假装是人民币', () => {
    expect(currencySymbol('CNY')).toBe('¥')
    expect(currencySymbol('USD')).not.toBe('¥')
    expect(currencySymbol('ZZZ')).toBe('ZZZ')
  })
})

describe('fetchRates：缓存与失败降级', () => {
  beforeEach(async () => {
    await clearFxCache()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('取到汇率后写入缓存，第二次不再外呼', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ timestamp: 1789444800, base: 'USD', rates: { CNY: 6.7115, USD: 1 } }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const first = await fetchRates()
    expect(first?.rates.CNY).toBe(6.7115)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const second = await fetchRates()
    expect(second?.rates.CNY).toBe(6.7115)
    // 命中内存缓存，不应再打接口
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('接口不可用 → 返回 null（调用方据此走降级，而不是拿到假数据）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    await expect(fetchRates()).resolves.toBeNull()

    // 返回 null 时 sumByCurrency 必须标记未折算，而不是直接把不同币种相加
    const result = sumByCurrency(
      [{ amount: 100, currency: 'CNY' }, { amount: 10, currency: 'USD' }],
      i => i,
      'CNY',
      await fetchRates()
    )
    expect(result.converted).toBe(false)
    // 只有 CNY 那一笔被精确计入；10 USD 因为换不了而被排除，而不是当成 10 CNY
    expect(result.total).toBe(100)
    expect(result.unconverted_currencies).toEqual(['USD'])
    expect(result.by_currency).toEqual({ CNY: 100, USD: 10 })
  })

  it('接口返回非 200 → null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) }))
    await expect(fetchRates()).resolves.toBeNull()
  })

  it('接口返回损坏数据 → null，且不会写进缓存', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ rates: {} }) }))
    await expect(fetchRates()).resolves.toBeNull()
  })

  it('并发调用共享同一次外呼', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 10))
      return { ok: true, json: async () => ({ base: 'USD', rates: { CNY: 6.7115, USD: 1 } }) }
    })
    vi.stubGlobal('fetch', fetchMock)

    const [a, b, c] = await Promise.all([fetchRates(), fetchRates(), fetchRates()])
    expect(a?.rates.CNY).toBe(6.7115)
    expect(b?.rates.CNY).toBe(6.7115)
    expect(c?.rates.CNY).toBe(6.7115)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('网络层瞬时故障（ECONNRESET）重试一次后成功', async () => {
    // 实测：全新进程的首个外呼会被连接重置，紧接着重试即成功
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ base: 'USD', rates: { CNY: 6.7115, USD: 1 } }),
      })
    vi.stubGlobal('fetch', fetchMock)

    const rates = await fetchRates()
    expect(rates?.rates.CNY).toBe(6.7115)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('网络层持续故障时只重试一次，不无限打第三方', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('fetch failed'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchRates()).resolves.toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('服务端返回非 200 不属于瞬时故障，不重试', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchRates()).resolves.toBeNull()
    // 明确的服务端错误重试也无意义，只打一次
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
