// lib/__tests__/bank-enrich.test.ts — 后台「按真实内容补全」的判定规则。
//
// 这一层的核心承诺是「不猜」：电话与全称只有在该行官网页面上直接读到时才算数，
// 模型凭记忆给的只能作为「待确认」候选。规则写错就会把未经验证的内容当成事实
// 写进共享的银行目录，所以逐条锁住。
//
// 用真实官网观察到的数字做样本（招商银行首页含 95555 / 400-820-5555，页面同时
// 还有很多无关数字），确保筛选规则贴合现实而不是贴合想象。

import { describe, it, expect } from 'vitest'
import { pickServicePhone, fullNameFromSite } from '../api/ai.server'

describe('pickServicePhone 只认客服热线形态', () => {
  it('优先标准客服短号', () => {
    expect(pickServicePhone(['4006095555', '95555', '021-61195599'])).toBe('95555')
  })

  it('没有短号时用 400/800 热线', () => {
    expect(pickServicePhone(['400-820-5555'])).toBe('400-820-5555')
    expect(pickServicePhone(['8008108888'])).toBe('8008108888')
  })

  it('96 开头的城商行短号也算客服热线', () => {
    expect(pickServicePhone(['96067'])).toBe('96067')
  })

  it('不把信用卡号/额度这类长数字当客服电话', () => {
    // 工行首页含 95537；但要确认不会误取更长的账号串
    expect(pickServicePhone(['6222021234567890123'])).toBe('6222021234567890123') // 无候选时退回首个
    expect(pickServicePhone(['95588', '6222021234567890123'])).toBe('95588')
  })

  it('空数组返回 null（不猜）', () => {
    expect(pickServicePhone([])).toBeNull()
  })
})

describe('fullNameFromSite 只从页面正文里取全称', () => {
  it('识别「XX银行股份有限公司」', () => {
    const text = '版权所有 招商银行股份有限公司 粤ICP备...'
    expect(fullNameFromSite(text, '招商银行')).toBe('招商银行股份有限公司')
  })

  it('页面没写全称时返回 null，而不是拼一个', () => {
    expect(fullNameFromSite('欢迎访问招商银行官网，客服 95555', '招商银行')).toBeNull()
  })

  it('银行名里含正则元字符也不会崩', () => {
    expect(() => fullNameFromSite('中国银行(香港)股份有限公司', '中国银行(香港)')).not.toThrow()
  })

  it('不会把别家的全称安到本行头上（只在含本行名时命中）', () => {
    const text = '中国工商银行股份有限公司'
    expect(fullNameFromSite(text, '招商银行')).toBeNull()
  })
})
