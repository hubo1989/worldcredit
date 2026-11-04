// lib/email-core/cmb.ts — 招商银行信用卡电子账单识别与专用解析器

import type { BillParseResult } from './types'

export interface CmbRecognitionParams {
  fromEmail?: string | null
  subject?: string | null
  text: string
}

/**
 * 招商银行账单邮件识别规则：
 * 1. 发件域特征：from 包含 cmbchina.com，或正文包含 cmbchina.com / 招商银行
 * 2. 主题/关键词特征：主题或正文包含「个人消费卡账户」「信用卡账单已出」「最后还款日」等关键词
 */
export function isCmbStatement(params: CmbRecognitionParams): boolean {
  const { fromEmail, subject, text } = params
  const from = (fromEmail ?? '').toLowerCase()
  const subj = subject ?? ''
  const body = text ?? ''

  const isCmbDomainOrBrand =
    from.includes('cmbchina.com') ||
    body.includes('cmbchina.com') ||
    body.includes('招商银行')

  if (!isCmbDomainOrBrand) return false

  const hasStatementKeywords =
    /个人消费卡账户|信用卡账单已出|最后还款日/.test(subj) ||
    /个人消费卡账户.*账单|信用卡账单已出|最后还款日\(Payment Due Date\)/.test(body)

  return hasStatementKeywords
}

interface ParsedTransaction {
  amount: number
  cardTail: string
  kind: 'payment' | 'installment' | 'consumption'
}

/**
 * 招商银行专用结构化账单解析器
 */
export function parseCmbStatement(text: string): BillParseResult {
  // 1. 账单月（bill_month）
  let billMonth: string | null = null
  const monthMatch = text.match(/(\d{4})年\s*(\d{1,2})月(?:信用卡)?账单已出/)
  if (monthMatch) {
    billMonth = `${monthMatch[1]}-${monthMatch[2].padStart(2, '0')}`
  } else {
    const accMonthMatch = text.match(/个人消费卡账户\s*(\d{1,2})月账单/)
    if (accMonthMatch) {
      const yearMatch = text.match(/(\d{4})[年/-]/)
      const year = yearMatch ? yearMatch[1] : String(new Date().getFullYear())
      billMonth = `${year}-${accMonthMatch[1].padStart(2, '0')}`
    }
  }

  // 2. 最后还款日（due_date），年份按账单月推导
  const dueMatch = text.match(/最后还款日(?:\(Payment Due Date\))?\s*(\d{1,2})月(\d{1,2})日/)
  let dueDate: string | null = null
  let dueDateStatus: 'exact' | 'missing' = 'missing'
  if (dueMatch && billMonth) {
    const billYear = parseInt(billMonth.slice(0, 4), 10)
    const billMon = parseInt(billMonth.slice(5, 7), 10)
    const dueMon = parseInt(dueMatch[1], 10)
    const dueDay = parseInt(dueMatch[2], 10)
    // 若还款月小于账单月（如 12 月账单 1 月还款），年份顺延到下一年
    const dueYear = dueMon < billMon ? billYear + 1 : billYear
    dueDate = `${dueYear}-${String(dueMon).padStart(2, '0')}-${String(dueDay).padStart(2, '0')}`
    dueDateStatus = 'exact'
  }

  // 3. 信用额度（credit_limit）
  const limitMatch = text.match(/信用额度\s*(?:Credit Limit)?\s*[¥￥\s]*([0-9,]+(?:\.[0-9]{2})?)/i)
  const creditLimit = limitMatch ? parseFloat(limitMatch[1].replace(/,/g, '')) : null

  // 4. 本期应还金额（bill_amount）
  const amountMatch = text.match(/本期应还金额\s*(?:New Balance)?\s*[¥￥\s]*([0-9,-]+(?:\.[0-9]{2})?)/i)
  const billAmount = amountMatch ? parseFloat(amountMatch[1].replace(/,/g, '')) : 0

  // 5. 最低还款额（min_payment）
  const minMatch = text.match(/(?:本期)?最低还款额\s*(?:Min\.?\s*Payment)?\s*[¥￥\s]*([0-9,]+(?:\.[0-9]{2})?)/i)
  const minPayment = minMatch ? parseFloat(minMatch[1].replace(/,/g, '')) : null

  // 6. 应还公式分解（上期/还款/新增/调整/利息）能提则提
  let formula: BillParseResult['formula_breakdown'] = null
  const formulaSectionMatch = text.match(/Balance B\/F[\s\S]*?Interest\s+([¥￥\s0-9,.-]+)/i)
  if (formulaSectionMatch) {
    const numbers = formulaSectionMatch[1].match(/[¥￥]?\s*([0-9,-]+\.[0-9]{2})/g)
    if (numbers && numbers.length >= 6) {
      const vals = numbers.map(s => parseFloat(s.replace(/[¥￥\s,]/g, '')))
      formula = {
        previous_balance: vals[1],
        previous_payment: vals[2],
        new_charges: vals[3],
        adjustment: vals[4],
        interest: vals[5],
      }
    }
  }

  // 7. 交易明细与分卡小计（bill_card_subtotals）
  const subtotals: NonNullable<BillParseResult['card_subtotals']> = []
  let cardLast4: string | null = null

  const txHeaderIdx = text.search(/交易日[\s\S]*?记账日[\s\S]*?交易摘要/)
  if (txHeaderIdx !== -1) {
    const txSection = text.slice(txHeaderIdx)
    const payIdx = txSection.search(/\n\s*还款/)
    const instIdx = txSection.search(/\n\s*分期/)
    const consIdx = txSection.search(/\n\s*消费/)
    const endIdx = txSection.search(/\n\s*上述交易摘要中的商户名称/)

    // 匹配格式：¥ 金额，其后紧跟 4 位卡号
    const txRegex = /¥\s*([0-9,-]+(?:\.[0-9]{2})?)\s*(?:\n|\s+)(\d{4})/g
    let match: RegExpExecArray | null
    const items: ParsedTransaction[] = []

    while ((match = txRegex.exec(txSection)) !== null) {
      const pos = match.index
      if (endIdx !== -1 && pos > endIdx) break
      const amt = parseFloat(match[1].replace(/,/g, ''))
      const tail = match[2]

      let kind: ParsedTransaction['kind'] = 'consumption'
      if (payIdx !== -1 && pos >= payIdx && (instIdx === -1 || pos < instIdx)) {
        kind = 'payment'
      } else if (instIdx !== -1 && pos >= instIdx && (consIdx === -1 || pos < consIdx)) {
        kind = 'installment'
      }
      items.push({ amount: amt, cardTail: tail, kind })
    }

    const uniqueTails = [...new Set(items.map(i => i.cardTail))]
    if (uniqueTails.length === 1) {
      // 单卡样本小计 = 账户总额
      cardLast4 = uniqueTails[0]
      subtotals.push({
        card_last4: uniqueTails[0],
        amount: billAmount,
        currency: 'CNY',
      })
    } else if (uniqueTails.length > 1) {
      // 多卡时各尾号求和（分期 + 消费新增额），与总额差额作为未归卡差额呈现，不反向覆写总额
      cardLast4 = uniqueTails[0]
      for (const tail of uniqueTails) {
        const tailItems = items.filter(i => i.cardTail === tail && i.kind !== 'payment')
        const sum = tailItems.reduce((acc, i) => acc + i.amount, 0)
        subtotals.push({
          card_last4: tail,
          amount: Math.round(sum * 100) / 100,
          currency: 'CNY',
        })
      }
    }
  }

  return {
    is_bill: true,
    email_kind: 'statement',
    bank_name: '招商银行',
    statement_scope: 'account_merged',
    card_last4: cardLast4,
    bill_month: billMonth ?? undefined,
    due_date: dueDate,
    due_date_status: dueDateStatus,
    credit_limit: creditLimit,
    bill_amount: billAmount,
    min_payment: minPayment,
    currency: 'CNY',
    confidence: 0.98,
    card_subtotals: subtotals,
    formula_breakdown: formula,
  }
}
