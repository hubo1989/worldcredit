import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { isCmbStatement, parseCmbStatement } from '../../lib/email-core/cmb'
import {
  CMB_SINGLE_CARD_SYNTHETIC,
  CMB_MULTI_CARD_SYNTHETIC,
  CMB_YEAR_ROLLOVER_SYNTHETIC,
} from './fixtures/cmb-synthetic'

describe('招商银行账单识别与专用解析器 (Phase 3)', () => {
  describe('isCmbStatement (识别规则)', () => {
    it('命中发件域 cmbchina.com + 账单主题关键词', () => {
      expect(
        isCmbStatement({
          fromEmail: 'bill@cmbchina.com',
          subject: '尊敬的客户，您的个人消费卡账户08月账单已出',
          text: '正文内容',
        })
      ).toBe(true)

      expect(
        isCmbStatement({
          fromEmail: 'noreply@cmbchina.com',
          subject: '您2026年08月信用卡账单已出',
          text: '正文内容',
        })
      ).toBe(true)

      expect(
        isCmbStatement({
          fromEmail: 'service@cmbchina.com',
          subject: '招商银行信用卡最后还款日提醒',
          text: '正文内容',
        })
      ).toBe(true)
    })

    it('正文中包含招商银行与个人消费卡账户关键词时也能识别（如转发或内联邮件）', () => {
      expect(
        isCmbStatement({
          fromEmail: null,
          subject: 'Fwd: 信用卡账单',
          text: '《招商银行信用卡章程》... 个人消费卡账户08月账单 ... 最后还款日(Payment Due Date)09月13日',
        })
      ).toBe(true)
    })

    it('非招行或营销邮件不命中', () => {
      expect(
        isCmbStatement({
          fromEmail: 'notice@icbc.com.cn',
          subject: '中国工商银行电子对账单',
          text: '工商银行账单内容',
        })
      ).toBe(false)

      expect(
        isCmbStatement({
          fromEmail: 'promo@cmbchina.com',
          subject: '招商银行掌上生活邀您参与天天抽奖',
          text: '抽奖活动详情',
        })
      ).toBe(false)
    })
  })

  describe('parseCmbStatement 单卡合成样本字段提取', () => {
    it('精确提取账户级字段、公式分解与单卡小计', () => {
      const res = parseCmbStatement(CMB_SINGLE_CARD_SYNTHETIC)

      expect(res.is_bill).toBe(true)
      expect(res.email_kind).toBe('statement')
      expect(res.bank_name).toBe('招商银行')
      expect(res.statement_scope).toBe('account_merged')
      expect(res.currency).toBe('CNY')

      // 账户级核心字段
      expect(res.bill_month).toBe('2026-08')
      expect(res.due_date).toBe('2026-09-15')
      expect(res.due_date_status).toBe('exact')
      expect(res.credit_limit).toBe(80000)
      expect(res.bill_amount).toBe(18888.88)
      expect(res.min_payment).toBe(1888.88)

      // 公式分解
      expect(res.formula_breakdown).toEqual({
        previous_balance: 2000,
        previous_payment: 2000,
        new_charges: 18888.88,
        adjustment: 0,
        interest: 0,
      })

      // 单卡分卡小计：单卡小计 = 账户总额
      expect(res.card_last4).toBe('6688')
      expect(res.card_subtotals).toHaveLength(1)
      expect(res.card_subtotals?.[0]).toEqual({
        card_last4: '6688',
        amount: 18888.88,
        currency: 'CNY',
      })
    })
  })

  describe('parseCmbStatement 多卡合成样本分卡小计聚合', () => {
    it('按各卡尾号聚合消费，不反向覆写总额（保留未归卡差额）', () => {
      const res = parseCmbStatement(CMB_MULTI_CARD_SYNTHETIC)

      expect(res.bill_amount).toBe(25000.0)
      expect(res.card_subtotals).toHaveLength(2)

      const card6688 = res.card_subtotals?.find((s) => s.card_last4 === '6688')
      const card7799 = res.card_subtotals?.find((s) => s.card_last4 === '7799')

      expect(card6688?.amount).toBe(15000.0)
      expect(card7799?.amount).toBe(9500.0)

      // 多卡各尾号总和 24,500 与总额 25,000 的差额为 500，总额依然以 bill_amount 为权威真源
      const subtotalsSum = (card6688?.amount ?? 0) + (card7799?.amount ?? 0)
      expect(subtotalsSum).toBe(24500.0)
      expect(res.bill_amount).toBe(25000.0)
    })
  })

  describe('parseCmbStatement 跨年还款日推导', () => {
    it('12月账单对应次年1月还款，年份顺延 +1', () => {
      const res = parseCmbStatement(CMB_YEAR_ROLLOVER_SYNTHETIC)
      expect(res.bill_month).toBe('2026-12')
      expect(res.due_date).toBe('2027-01-10')
      expect(res.due_date_status).toBe('exact')
    })
  })

  describe('本地真实招行样本开发验证（若存在于 /tmp）', () => {
    const realSamplePath = '/tmp/wc-cmb-sample/cmb-statement-2026-08.txt'
    const hasRealSample = fs.existsSync(realSamplePath)

    it.runIf(hasRealSample)('真实样本字段提取结构验证（不硬编码个人数值）', () => {
      const content = fs.readFileSync(realSamplePath, 'utf8')
      const res = parseCmbStatement(content)

      expect(res.is_bill).toBe(true)
      expect(res.email_kind).toBe('statement')
      expect(res.bank_name).toBe('招商银行')
      expect(res.statement_scope).toBe('account_merged')
      expect(res.currency).toBe('CNY')

      // 结构断言：真实金额/尾号只留在 /tmp 样本，不进仓库
      expect(res.bill_month).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/)
      expect(res.due_date_status).toBe('exact')
      expect(res.due_date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(res.credit_limit ?? 0).toBeGreaterThan(0)
      expect(res.bill_amount ?? 0).toBeGreaterThan(0)
      expect(res.min_payment ?? 0).toBeGreaterThan(0)
      expect((res.min_payment ?? 0) <= (res.bill_amount ?? 0)).toBe(true)

      const fb = res.formula_breakdown
      if (fb) {
        expect(fb.new_charges).toBeGreaterThan(0)
        expect(fb.adjustment).toBeGreaterThanOrEqual(0)
        expect(fb.interest).toBeGreaterThanOrEqual(0)
      }

      // 分卡小计：尾号恒为 4 位；小计合计为正且不超过账户总额
      expect(res.card_last4).toMatch(/^\d{4}$/)
      const subtotals = res.card_subtotals ?? []
      expect(subtotals.length).toBeGreaterThanOrEqual(1)
      const sum = subtotals.reduce((s, x) => s + x.amount, 0)
      expect(sum).toBeGreaterThan(0)
      expect(sum <= (res.bill_amount ?? 0)).toBe(true)
      expect(subtotals.every((x) => /^\d{4}$/.test(x.card_last4) && x.currency === 'CNY')).toBe(true)
    })
  })
})
