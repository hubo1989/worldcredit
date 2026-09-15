// lib/fx.ts
// 多币种折算：把不同币种的金额换算到同一个目标币种后再聚合。
//
// 背景：WorldCredit 真实同时存在 CNY / USD / HKD 三种币种的卡（生产库 28 / 9 / 2 张）。
// 此前所有聚合层都把不同币种的金额直接相加，再用硬编码的 ¥ 渲染——数字看着有，
// 实际是错的，而且错得很安静。
//
// 两条硬约束：
// 1) 绝不把「拿不到汇率」当成 1:1 静默换算。那是这类 bug 里最危险的形态：金额凭空
//    变小且无人察觉。缺汇率时 convert() 返回 null，sumByCurrency() 把该币种记进
//    unconverted_currencies 并排除在 total 之外，由调用方决定怎么向用户交代。
// 2) 不把页面加载绑死在第三方可用性上：汇率有缓存、有超时、失败即降级。
//
// 本模块只有纯函数 + 一个取数函数，不 import lib/db，所以服务端（Worker / SSR）
// 和浏览器可以共用同一份逻辑。

export interface FxRates {
  /** 汇率基准币种，数据源固定返回 USD。 */
  base: string
  /** rates[X] = 1 base 等于多少 X。 */
  rates: Record<string, number>
  /** 数据源给出的时间戳（秒），该接口是日粒度。 */
  timestamp: number
  /** 本地写入缓存的毫秒时间戳，用于判断 TTL。 */
  fetched_at: number
}

/** 汇率缓存有效期。接口是日粒度，6 小时足够新，又能大幅压低外呼次数。 */
export const FX_TTL_MS = 6 * 60 * 60 * 1000

const FX_ENDPOINT = 'https://api.exchangerate.fun/latest'
/** 合成缓存键：Cloudflare Cache API 只认 URL，用一个不会被真实请求命中的域名。 */
const FX_CACHE_KEY = 'https://worldcredit.internal/__fx/latest'
const FX_LOCAL_STORAGE_KEY = 'worldcredit_fx_rates_v1'
/** 第三方不可用时不该拖住页面：4 秒拿不到就降级。 */
const FX_FETCH_TIMEOUT_MS = 4000

/** 归一化币种代码；非法输入返回 null（绝不猜一个默认币种）。 */
export function normalizeCurrency(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const code = raw.trim().toUpperCase()
  return /^[A-Z]{3}$/.test(code) ? code : null
}

/** 归一化币种代码，非法时回落到给定默认值。 */
export function normalizeCurrencyOrDefault(raw: unknown, fallback: string): string {
  return normalizeCurrency(raw) ?? normalizeCurrency(fallback) ?? 'CNY'
}

function isFresh(rates: FxRates | null | undefined, now: number): rates is FxRates {
  return !!rates && Number.isFinite(rates.fetched_at) && now - rates.fetched_at < FX_TTL_MS
}

/**
 * 校验并归一化接口返回体。
 *
 * 同时用于解析「刚取回来的响应」和「缓存里的记录」：缓存记录会带上我们自己写的
 * fetched_at，必须原样保留，否则每次读缓存都会把它刷成「刚取到」，TTL 永远不过期。
 */
export function parseRates(payload: unknown): FxRates | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const raw = payload as { base?: unknown; rates?: unknown; timestamp?: unknown; fetched_at?: unknown }
  const rawRates = raw.rates
  if (!rawRates || typeof rawRates !== 'object' || Array.isArray(rawRates)) return null

  const rates: Record<string, number> = {}
  for (const [key, value] of Object.entries(rawRates as Record<string, unknown>)) {
    const code = normalizeCurrency(key)
    const numeric = typeof value === 'number' ? value : Number(value)
    // 汇率必须为正数：0 或负数只可能是异常数据，收进来会算出无穷大或反向金额。
    if (!code || !Number.isFinite(numeric) || numeric <= 0) continue
    rates[code] = numeric
  }
  if (Object.keys(rates).length === 0) return null

  const fetchedAt = typeof raw.fetched_at === 'number' && Number.isFinite(raw.fetched_at)
    ? raw.fetched_at
    : Date.now()

  return {
    base: normalizeCurrency(raw.base) ?? 'USD',
    rates,
    timestamp: typeof raw.timestamp === 'number' && Number.isFinite(raw.timestamp) ? raw.timestamp : 0,
    fetched_at: fetchedAt,
  }
}

/**
 * 把 amount 从 from 折算到 to，经 USD 中转（amount / rate[from] * rate[to]）。
 *
 * 该公式对任意基准币种都成立：rate[from] 表示「1 基准币 = 多少 from」，相除即换回
 * 基准币，再乘以 rate[to] 得到目标币种。
 *
 * 返回 null 的三种情况——同币种直接返回原值，任何跨币种失败都必须是 null：
 *   - rates 不可用（没取到汇率）
 *   - from 或 to 不在 rates 里（接口有 160+ 币种但不是无限）
 *   - 汇率非正数 / 金额不是有限数
 */
export function convert(
  amount: number,
  from: string,
  to: string,
  rates: FxRates | null | undefined
): number | null {
  if (!Number.isFinite(amount)) return null
  const source = normalizeCurrency(from)
  const target = normalizeCurrency(to)
  if (!source || !target) return null
  if (source === target) return amount
  if (!rates) return null

  const sourceRate = rates.rates[source]
  const targetRate = rates.rates[target]
  if (!Number.isFinite(sourceRate) || !Number.isFinite(targetRate)) return null
  if (sourceRate <= 0 || targetRate <= 0) return null

  return (amount / sourceRate) * targetRate
}

/** sumByCurrency 的输入：一条待聚合的金额。 */
export interface FxBucketInput {
  amount: number
  currency: string
}

export interface FxSum {
  /** 本次折算的目标币种。 */
  converted_currency: string
  /** 按原币种分别求和，不做任何折算——汇率不可用时用它直接向用户交代。 */
  by_currency: Record<string, number>
  /**
   * 折算到 converted_currency 的合计。
   *
   * 永远是「真数」而非混币相加：缺汇率的币种被排除在外，而不是当成 1:1 混进来。
   * 注意同币种条目不需要汇率即可精确计入（CNY 金额加到 CNY 合计是恒等变换，不是猜测），
   * 所以汇率完全不可用时 total 通常等于目标币种自身的小计，而不是 0——判断 total
   * 是否完整一律看 converted / unconverted_currencies，不要只看数字。
   */
  total: number
  /** true 表示每个币种都拿到了汇率，total 就是完整合计。 */
  converted: boolean
  /** 缺汇率因而未计入 total 的币种（已按原币保留在 by_currency 里）。 */
  unconverted_currencies: string[]
  /** 是否存在多个币种：UI 用它决定要不要展示分币种明细。 */
  mixed: boolean
}

/**
 * 按币种分组求和，再逐币种折算到目标币种。
 *
 * 这是替代「reduce 直接相加」的核心助手。返回的 by_currency 无论汇率是否可用都
 * 是完整的按币种小计，所以调用方永远有办法向用户展示真实构成。
 */
export function sumByCurrency<T>(
  items: readonly T[],
  pick: (item: T) => FxBucketInput | null | undefined,
  target: string,
  rates: FxRates | null | undefined
): FxSum {
  const convertedCurrency = normalizeCurrencyOrDefault(target, 'CNY')
  const byCurrency: Record<string, number> = {}
  const unconverted = new Set<string>()
  let total = 0

  for (const item of items) {
    const picked = pick(item)
    if (!picked) continue
    const amount = Number(picked.amount)
    if (!Number.isFinite(amount) || amount === 0) continue

    const currency = normalizeCurrencyOrDefault(picked.currency, convertedCurrency)
    byCurrency[currency] = (byCurrency[currency] ?? 0) + amount

    const convertedAmount = convert(amount, currency, convertedCurrency, rates)
    if (convertedAmount === null) {
      unconverted.add(currency)
      continue
    }
    total += convertedAmount
  }

  return {
    converted_currency: convertedCurrency,
    by_currency: byCurrency,
    total,
    converted: unconverted.size === 0,
    unconverted_currencies: Array.from(unconverted).sort(),
    mixed: Object.keys(byCurrency).length > 1,
  }
}

const SYMBOL_CACHE = new Map<string, string>()

/** 取币种符号（¥ / US$ / HK$）。未知币种回落到币种代码本身，不假装它是人民币。 */
export function currencySymbol(currency: string): string {
  const code = normalizeCurrencyOrDefault(currency, 'CNY')
  const cached = SYMBOL_CACHE.get(code)
  if (cached) return cached

  let symbol: string
  try {
    const parts = new Intl.NumberFormat('zh-CN', { style: 'currency', currency: code }).formatToParts(0)
    symbol = parts.find(part => part.type === 'currency')?.value ?? code
  } catch {
    symbol = code
  }
  SYMBOL_CACHE.set(code, symbol)
  return symbol
}

// ---- 取数与缓存 ----

/** 读 Cloudflare Cache API（Worker 环境）。浏览器 / SSR 下不存在，返回 null 走降级。 */
function getWorkerCache(): Cache | null {
  try {
    const scope = globalThis as unknown as { caches?: { default?: Cache } }
    return scope.caches?.default ?? null
  } catch {
    return null
  }
}

/** 浏览器侧持久化：localStorage 在 window 上存在，但没有 caches.default。 */
function readLocalStorage(): FxRates | null {
  try {
    if (typeof localStorage === 'undefined') return null
    const raw = localStorage.getItem(FX_LOCAL_STORAGE_KEY)
    if (!raw) return null
    return parseRates(JSON.parse(raw))
  } catch {
    return null
  }
}

/**
 * 模块级内存缓存，最后一道防线。
 *
 * 缓存路由为：Worker 用 Cloudflare Cache API；浏览器用 localStorage；两者都不可用时
 * 只剩这块内存（进程/页面存活期间有效）。任何一层都不改数据库 schema。
 */
let memoryRates: FxRates | null = null
let inFlight: Promise<FxRates | null> | null = null

async function readPersistentCache(now: number): Promise<FxRates | null> {
  const workerCache = getWorkerCache()
  if (workerCache) {
    try {
      const hit = await workerCache.match(FX_CACHE_KEY)
      if (hit) {
        const parsed = parseRates(await hit.json())
        if (isFresh(parsed, now)) return parsed
      }
    } catch {
      // 缓存读失败不影响主流程，继续走下一层
    }
  }
  const stored = readLocalStorage()
  return isFresh(stored, now) ? stored : null
}

async function writePersistentCache(rates: FxRates): Promise<void> {
  const workerCache = getWorkerCache()
  if (workerCache) {
    try {
      await workerCache.put(
        FX_CACHE_KEY,
        new Response(JSON.stringify(rates), {
          headers: { 'content-type': 'application/json; charset=utf-8' },
        })
      )
    } catch {
      // 写缓存失败（例如 dev 下无缓存作用域）不影响本次结果
    }
  }
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(FX_LOCAL_STORAGE_KEY, JSON.stringify(rates))
    }
  } catch {
    // 隐私模式 / 配额满：忽略
  }
}

/**
 * 一次取数尝试的结果。
 *
 * 区分「值得重试」和「重试也没用」：网络层失败（连接重置 / 超时 / DNS）往往是瞬时的，
 * 再试一次通常就好了；而服务端明确返回非 200、或返回体损坏，重试不会有不同结果。
 */
type Attempt = { rates: FxRates } | { retryable: boolean }

async function attemptRates(): Promise<Attempt> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FX_FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(FX_ENDPOINT, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    })
    if (!res.ok) return { retryable: false }
    const parsed = parseRates(await res.json())
    return parsed ? { rates: parsed } : { retryable: false }
  } catch {
    return { retryable: true }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 取一次汇率，网络层瞬时失败时重试一次。
 *
 * 重试针对的是实测到的真实故障：全新进程的首个外呼会被 ECONNRESET，紧接着重试即成功。
 * 只重试一次，避免在第三方持续不可用时把它打得更狠；仍然失败就返回 null，
 * 由调用方走「未含汇率」的降级展示。
 */
async function requestRates(): Promise<FxRates | null> {
  const first = await attemptRates()
  if ('rates' in first) return first.rates
  if (!first.retryable) return null
  const second = await attemptRates()
  return 'rates' in second ? second.rates : null
}

/**
 * 取汇率（优先缓存）。
 *
 * 返回 null 表示这次真的拿不到汇率——调用方必须走「分币种展示 / 明确标注未折算」的
 * 降级路径，不能退化成直接把不同币种相加。
 */
export async function fetchRates(options: { force?: boolean } = {}): Promise<FxRates | null> {
  const now = Date.now()
  if (!options.force) {
    if (isFresh(memoryRates, now)) return memoryRates
    const cached = await readPersistentCache(now)
    if (cached) {
      memoryRates = cached
      return cached
    }
    // 并发调用共享同一次外呼，避免一屏多个组件各打一次
    if (inFlight) return inFlight
  }

  const request = requestRates()
    .then(result => {
      if (result) {
        memoryRates = result
        void writePersistentCache(result)
      }
      return result
    })
    .finally(() => {
      inFlight = null
    })
  inFlight = request
  return request
}

/** 清空各层缓存（手动刷新汇率 / 测试隔离用）。 */
export async function clearFxCache(): Promise<void> {
  memoryRates = null
  inFlight = null
  const workerCache = getWorkerCache()
  if (workerCache) {
    try {
      await workerCache.delete(FX_CACHE_KEY)
    } catch {
      // ignore
    }
  }
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(FX_LOCAL_STORAGE_KEY)
  } catch {
    // ignore
  }
}
