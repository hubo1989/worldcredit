// 回归：官网拒绝抓取时，银行补全必须能退到权威第三方来源，并且如实标出来源。
//
// 背景：此前「只有官网页面上直接读到的字段才写」被当成硬规则，导致对抓取不友好的
// 银行永远补不上（实测民泰 412、建行/交行返回空壳页）。但用户要的是**可核实的
// 证据**，不是**银行自己的域名**——这些银行的注册全称在维基条目里是明确可查的。
//
// 同时锁住一条边界：第三方来源**只用于全称与官网，不用于客服电话**。
// 实测中文维基正文里的 95xxx 号码不可信（中信银行条目里是 95032/95034，
// 而不是其真实客服 95558），采信它会把错号码写进共享目录。

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fullNameFromWikipedia } from '../api/ai.server'

const ROOT = join(__dirname, '../..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

describe('fullNameFromWikipedia', () => {
  it('取到「XX银行股份有限公司」这类注册全称', () => {
    const text = '交通银行股份有限公司，简称交通银行、交行，是中国大陸歷史最悠久的银行之一……'
    expect(fullNameFromWikipedia(text, '交通银行')).toBe('交通银行股份有限公司')
  })

  it('银行名带前缀/后缀时也能取全称', () => {
    const text = '浙江民泰商业银行股份有限公司成立于 1988 年。'
    expect(fullNameFromWikipedia(text, '浙江民泰商业银行')).toBe('浙江民泰商业银行股份有限公司')
  })

  it('正文里没有注册全称时返回 null（不猜）', () => {
    expect(fullNameFromWikipedia('招商银行是一家银行。', '招商银行')).toBeNull()
    expect(fullNameFromWikipedia('', '中国银行')).toBeNull()
  })

  it('不会把别的银行的全称当成自己的', () => {
    const text = '中国建设银行股份有限公司与交通银行同属国有大行。'
    expect(fullNameFromWikipedia(text, '中国银行')).toBeNull()
  })

  it('名称里的正则元字符不会破坏匹配', () => {
    expect(fullNameFromWikipedia('某某(测试)银行股份有限公司', '某某(测试)银行')).toBe('某某(测试)银行股份有限公司')
  })
})

describe('来源分层（site / thirdparty / model）', () => {
  const ai = read('lib/api/ai.server.ts')

  it('provenance 类型包含 thirdparty 档', () => {
    expect(ai).toMatch(/'site' \| 'thirdparty' \| 'model' \| 'none'/)
  })

  it('Wikidata 用于取官网，且经 wbsearchentities 解析 QID（不猜 QID）', () => {
    expect(ai).toMatch(/function lookupWikidataSite/)
    expect(ai).toMatch(/wbsearchentities/)
    expect(ai).toMatch(/claims\?\.P856/)
  })

  it('维基正文用于取全称', () => {
    expect(ai).toMatch(/function lookupWikipediaText/)
    expect(ai).toMatch(/function fullNameFromWikipedia/)
  })

  it('第三方来源登记在 thirdPartySources 里，供界面交代依据', () => {
    expect(ai).toMatch(/thirdPartySources: \[\]/)
    expect(ai).toMatch(/result\.thirdPartySources\.push/)
  })

  it('客服电话不采信第三方（维基 95xxx 实测不是真客服号）', () => {
    // 电话兜底只能走官网（site）或模型候选并标 model，不能出现 thirdparty
    const phoneBlock = ai.slice(ai.indexOf("provenance.customer_service_phone = 'site'"))
    const nextAssign = phoneBlock.slice(0, phoneBlock.indexOf('return result'))
    expect(nextAssign).not.toMatch(/customer_service_phone = 'thirdparty'/)
    expect(ai).not.toMatch(/customer_service_phone: 'thirdparty'|provenance\.customer_service_phone = 'thirdparty'/)
  })

  it('官网抓取失败时保留域名候选，但不冒充官网', () => {
    // 来自 Wikidata 的域名标 thirdparty，模型提名的标 model，用户已填的不动
    expect(ai).toMatch(/originFrom === 'model' \? 'model' : originFrom === 'wikidata' \? 'thirdparty' : 'none'/)
  })

  it('候选官网来源顺序：用户已填 > Wikidata > 模型提名（更可靠的来源优先）', () => {
    const i = ai.indexOf('let originFrom')
    const wikidata = ai.indexOf('lookupWikidataSite(bank.name)', i)
    const model = ai.indexOf('nominateWebsite(cfg, bank.name', i)
    expect(i).toBeGreaterThan(-1)
    expect(wikidata).toBeGreaterThan(i)
    expect(model).toBeGreaterThan(wikidata)
  })
})
