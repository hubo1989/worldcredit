import { describe, it, expect } from 'vitest'
import { createFakeD1 } from './fakeD1'
import { parseRawMessage } from '../src/mime'
import { processForwardedBundle, buildBundleLogPayload } from '../src/forwarded'
import type { BillParseResult } from '../src/types'

/**
 * 端到端：一封真实字节形态的顶层转发包 -> 解析 -> 抽取嵌套 .eml -> 认人 -> 落库。
 * 这条链路此前只有 /tmp 里的一次性 harness 覆盖（不入库），这里用合成邮件固化。
 */

const enc = (s: string) => new TextEncoder().encode(s)

/** 把字节 base64 编码（模拟邮件客户端对 .eml 附件的处理）。 */
function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

// GBK 字节（Node 无法直接编码 GBK，故硬编码）
const GBK_ZHANG_NVSHI_B64 = '1cW4xL7Vxa7Kvw==' // 张改菊女士
const GBK_BODY_B64 = 'sb7G2tOmu7m98Lbuus+8xiA2MDAwINSq' // 本期应还金额合计 6000 元

/** 构造一封嵌套的银行账单邮件（To 头是 GBK 编码的中文显示名）。 */
function nestedBillEmail(): Uint8Array {
  return enc(
    [
      'From: bill@cib.com.cn',
      'To: =?gbk?B?' + GBK_ZHANG_NVSHI_B64 + '?= <zhang@example.com>',
      'Subject: =?gbk?B?' + GBK_ZHANG_NVSHI_B64 + '?=',
      'Content-Type: text/plain; charset="gbk"',
      'Content-Transfer-Encoding: base64',
      '',
      GBK_BODY_B64,
    ].join('\r\n')
  )
}

/** 顶层转发包：正文只有「见附件」，真正的账单在 message/rfc822 附件里。 */
function forwardedBundle(): Uint8Array {
  return enc(
    [
      'From: me@example.com',
      'To: bills+11111111-1111-1111-1111-111111111111@20160325.xyz',
      'Subject: Fwd: bills',
      'Content-Type: multipart/mixed; boundary="OUT"',
      '',
      '--OUT',
      'Content-Type: text/plain; charset="utf-8"',
      '',
      '见附件',
      '--OUT',
      'Content-Type: message/rfc822',
      'Content-Disposition: attachment; filename="bill.eml"',
      'Content-Transfer-Encoding: base64',
      '',
      toBase64(nestedBillEmail()),
      '--OUT--',
      '',
    ].join('\r\n')
  )
}

const USER_ID = '11111111-1111-1111-1111-111111111111'

function seed() {
  return createFakeD1({
    card_holders: [
      { id: 'h1', name: '张改菊', aliases: '["张改菊女士"]', created_by: USER_ID, created_at: '2026-01-01' },
    ],
    card_products: [{ id: 'p1', bank_name: '中国银行', currency: 'CNY', is_active: 1, created_at: '2026-01-01' }],
    credit_cards: [{ id: 'c1', holder_id: 'h1', card_number_last4: '1234', card_product_id: 'p1' }],
    bills: [],
  })
}

const parseOk = async (): Promise<BillParseResult> => ({
  is_bill: true,
  bank_name: '中国银行',
  card_last4: '1234',
  bill_amount: 6000,
  due_date: '2026-09-20',
  bill_month: '2026-08',
  statement_date: '2026-08-16',
  currency: 'CNY',
})

describe('processForwardedBundle 端到端', () => {
  it('从真实字节的转发包里解出嵌套账单并归属到正确持卡人', async () => {
    const { db, tables } = seed()
    const top = parseRawMessage(forwardedBundle())

    // 附件被识别为嵌套邮件，正文不含账单内容
    expect(top.attachments).toHaveLength(1)
    expect(top.attachments[0].contentType).toBe('message/rfc822')

    const outcome = await processForwardedBundle({ db, userId: USER_ID, top, parse: parseOk })
    expect(outcome).not.toBeNull()
    expect(outcome!.attachmentCount).toBe(1)
    expect(outcome!.nestedCount).toBe(1)
    expect(outcome!.billsWritten).toBe(1)
    expect(outcome!.skipped).toHaveLength(0)

    // 认人走的是 To 头里 GBK 编码的显示名
    expect(outcome!.written[0].holderId).toBe('h1')
    expect(outcome!.written[0].matchSource).toBe('header_name')
    expect(outcome!.written[0].cardId).toBe('c1')

    expect(tables.bills).toHaveLength(1)
    expect(tables.bills[0]).toMatchObject({ card_id: 'c1', bill_month: '2026-08', status: 'unpaid' })
  })

  it('没有邮件附件时返回 null，让调用方回落到直发路径', async () => {
    const { db } = seed()
    const top = parseRawMessage(
      enc(['From: a@b.com', 'Content-Type: text/plain', '', '普通直发邮件'].join('\r\n'))
    )
    const outcome = await processForwardedBundle({ db, userId: USER_ID, top, parse: parseOk })
    expect(outcome).toBeNull()
  })

  it('日志载荷记录归属依据，回落默认持卡人时不隐藏事实', async () => {
    const { db } = seed()
    const top = parseRawMessage(forwardedBundle())
    const outcome = await processForwardedBundle({
      db, userId: USER_ID, top,
      parse: async () => ({ ...(await parseOk()), card_last4: '1234' }),
    })
    const payload = JSON.parse(buildBundleLogPayload(outcome!)) as {
      source: string
      written: Array<{ matchSource: string; holder: string }>
    }
    expect(payload.source).toBe('forwarded_bundle')
    expect(payload.written[0].matchSource).toBe('header_name')
    expect(payload.written[0].holder).toBe('张改菊')
  })
})
