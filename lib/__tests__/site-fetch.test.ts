// lib/__tests__/site-fetch.test.ts — 抓官网内容时的编码与提取回归。
//
// 为什么重要：后台「按真实内容补全」依赖抓到的页面文本。中文银行官网大量是
// GBK，而 fetch().text() 一律按 UTF-8 解码——中文会变成替换字符，正则什么都
// 匹配不到，界面只会显示「没查到」，把编码问题伪装成数据缺失。

import { describe, it, expect } from 'vitest'
import { decodePage, htmlToText, extractPhones, extractDomains, rootDomain } from '../site-fetch'

/** 把 GBK 字节序列构造出来（不依赖外部 fixture）。 */
const gbk = (arr: number[]) => new Uint8Array(arr)

describe('decodePage 处理中文编码', () => {
  it('声明的 GBK 能正确解出中文', () => {
    // 「招商银行」的 GBK 编码
    const bytes = gbk([0xD5, 0xD0, 0xC9, 0xCC, 0xD2, 0xF8, 0xD0, 0xD0])
    expect(decodePage(bytes, 'gbk').text).toBe('招商银行')
  })

  it('声明的 GB18030 能正确解出中文', () => {
    const bytes = gbk([0xD5, 0xD0, 0xC9, 0xCC, 0xD2, 0xF8, 0xD0, 0xD0])
    expect(decodePage(bytes, 'gb18030').text).toBe('招商银行')
  })

  it('声明 utf-8 但实际是 GBK 时，不会把中文变成替换字符', () => {
    // 这是最危险的形态：声明与内容不符。UTF-8 解 GBK 字节会产出 U+FFFD，
    // 必须回退到能解干净的字符集。
    const bytes = gbk([0xD5, 0xD0, 0xC9, 0xCC, 0xD2, 0xF8, 0xD0, 0xD0])
    const { text, used } = decodePage(bytes, 'utf-8')
    expect(text).toBe('招商银行')
    expect(used).not.toBe('utf-8')
  })

  it('合法 UTF-8 保持不动', () => {
    const bytes = new TextEncoder().encode('官网首页')
    const { text, used } = decodePage(bytes, 'utf-8')
    expect(text).toBe('官网首页')
    expect(used).toBe('utf-8')
  })

  it('不认识的字符集 label 不会抛错', () => {
    const bytes = new TextEncoder().encode('hello')
    expect(() => decodePage(bytes, 'not-a-real-charset')).not.toThrow()
  })
})

describe('htmlToText 去标签', () => {
  it('剥掉 script/style，不把它们的内容当正文', () => {
    const html = '<html><head><style>.a{color:red}</style><script>var x="95555"</script></head><body>客服 95555</body></html>'
    const text = htmlToText(html)
    expect(text).toContain('客服')
    expect(text).not.toContain('var x')
    expect(text).not.toContain('color:red')
  })

  it('解掉常见实体并压缩空白', () => {
    expect(htmlToText('<p>招商&nbsp;&amp;&nbsp;工商</p>')).toBe('招商 & 工商')
  })

  it('空输入返回空串', () => {
    expect(htmlToText('')).toBe('')
  })
})

describe('extractPhones 只认像电话号码的形态', () => {
  it('抓出 5 位短号与 400 号', () => {
    const text = '客服热线 95555，信用卡专线 400-820-5555，另见 4008205555。'
    const phones = extractPhones(text)
    expect(phones).toContain('95555')
    expect(phones.some(p => p.replace(/\D/g, '') === '4008205555')).toBe(true)
  })

  it('去重', () => {
    expect(extractPhones('95555 95555 95555')).toEqual(['95555'])
  })

  it('不把普通四位数当电话', () => {
    expect(extractPhones('信用额度 20000 元，账单日 25 号')).toEqual([])
  })

  it('空文本返回空数组', () => {
    expect(extractPhones('')).toEqual([])
  })
})

describe('extractDomains 与 rootDomain', () => {
  it('抓出正文里的域名并小写化', () => {
    expect(extractDomains('访问 WWW.CMBSChina.COM 或 cmbchina.com')).toContain('cmbchina.com')
  })

  it('rootDomain 去掉 www. 便于比较', () => {
    expect(rootDomain('https://www.cmbchina.com/abc')).toBe('cmbchina.com')
    expect(rootDomain('WWW.Cmbchina.com')).toBe('cmbchina.com')
  })

  it('rootDomain 处理裸域名与非法输入不抛错', () => {
    expect(rootDomain('cmbchina.com')).toBe('cmbchina.com')
    expect(() => rootDomain('')).not.toThrow()
  })
})
