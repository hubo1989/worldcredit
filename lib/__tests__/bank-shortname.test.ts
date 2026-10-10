// 回归：银行简称的「按真实内容补全」。
//
// 简称（「招行」「工行」）此前只能手填。实测 Wikidata 实体的 zh-cn label 常直接
// 就是简称名，zh aliases 里还有两三字简称——这是可核实、可追溯的结构化来源，
// 按现有 provenance 体系应标 thirdparty 落库；官网抓取与模型提名不产 short_name。

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pickShortNameFromWikidata } from '../api/ai.server'

const ROOT = join(__dirname, '../..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

describe('pickShortNameFromWikidata', () => {
  it('zh-cn label 比 name 短且不等时直接取 label', () => {
    // 实测中国工商银行 Q26463 的 zh-cn label 就是「工商银行」
    expect(pickShortNameFromWikidata('工商银行', ['工行', '工商银行'], '中国工商银行')).toBe('工商银行')
  })

  it('无 label 时从 zh aliases 取不以「银行」结尾的候选', () => {
    expect(pickShortNameFromWikidata(null, ['工行', '工商银行'], '中国工商银行')).toBe('工行')
  })

  it('以「银行」结尾的合法简称作为次优入选', () => {
    // 「工商银行」也是真简称，只是不如「工行」短
    expect(pickShortNameFromWikidata(null, ['工商银行'], '中国工商银行')).toBe('工商银行')
    expect(pickShortNameFromWikidata(null, ['招商银行股份有限公司'], '招商银行')).toBeNull()
  })

  it('多条候选取最短', () => {
    expect(pickShortNameFromWikidata(null, ['中国工行', '工行'], '中国工商银行')).toBe('工行')
  })

  it('无候选返回 null（不猜）', () => {
    expect(pickShortNameFromWikidata(null, [], '招商银行')).toBeNull()
    expect(pickShortNameFromWikidata('', [], '招商银行')).toBeNull()
    expect(pickShortNameFromWikidata(null, [''], '招商银行')).toBeNull()
  })

  it('等于 name 或比 name 长的候选跳过', () => {
    // label 与 name 相同：不算简称
    expect(pickShortNameFromWikidata('招商银行', ['招行'], '招商银行')).toBe('招行')
    // label 比 name 长或相等时不走 label 分支；别名里同名候选也要剔除
    expect(pickShortNameFromWikidata('中国工商银行股份有限公司', ['中国工商银行'], '中国工商银行')).toBeNull()
  })

  it('繁体「銀行」结尾同样视为次优', () => {
    expect(pickShortNameFromWikidata(null, ['工行', '工商銀行'], '中國工商銀行')).toBe('工行')
  })

  it('超出 2–6 字范围的别名不参与', () => {
    expect(pickShortNameFromWikidata(null, ['中国人民银行', '一个很长很长的别名'], '中国银行')).toBe('中国人民银行')
  })
})

describe('「按真实内容补全」接入 short_name', () => {
  const ai = read('lib/api/ai.server.ts')
  const page = read('app/admin/banks/page.tsx')

  it('ai.server.ts 导出 pickShortNameFromWikidata 并接入 lookupWikidataAliases', () => {
    expect(ai).toMatch(/export function pickShortNameFromWikidata/)
    expect(ai).toMatch(/function lookupWikidataAliases/)
    expect(ai).toMatch(/pickShortNameFromWikidata\(wikidata\.zhCnLabel, wikidata\.zhAliases, bank\.name\)/)
  })

  it('short_name 命中 Wikidata 时标 thirdparty（不冒充官网、不采信模型）', () => {
    expect(ai).toMatch(/result\.short_name = short/)
    expect(ai).toMatch(/result\.provenance\.short_name = 'thirdparty'/)
    // 官网路径不产简称：site 证据块里不能给 short_name 赋 site 来源
    const siteBlock = ai.slice(ai.indexOf('result.website_url = origin'), ai.indexOf('// 6) 全称第三方兜底'))
    expect(siteBlock).not.toMatch(/provenance\.short_name = 'site'/)
  })

  it('BankEnrichment 带 short_name 且 provenance 覆盖它', () => {
    expect(ai).toMatch(/short_name: string \| null/)
    expect(ai).toMatch(/Record<'full_name' \| 'customer_service_phone' \| 'website_url' \| 'short_name'/)
  })

  it('页面按 short_name 判缺失、按来源写入、审阅弹窗展示简称', () => {
    // 缺失判定：缺简称的银行也进入补全队列
    expect(page).toMatch(/!b\.short_name/)
    // 写入：groundedProvenance 覆盖 short_name
    expect(page).toMatch(/groundedProvenance\(row\.provenance\.short_name\) && row\.short_name/)
    // 展示：审阅弹窗表格有简称列
    expect(page).toMatch(/<th>简称<\/th>/)
    expect(page).toMatch(/row\.short_name \|\| '—'\} \{tag\(row\.provenance\.short_name\)\}/)
  })

  it('Wikidata 官网解析的语言顺序含 zh-cn（中文 label 才有简称）', () => {
    expect(ai).toMatch(/\['zh', 'zh-cn', 'en'\]/)
  })
})
