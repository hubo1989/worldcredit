import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createOpportunityDb, type SqliteD1 } from '../../lib/__tests__/helpers/sqlite-d1'
import { parseRawMessage } from '../../lib/email-core/mime'
import { processEmailDelivery } from '../src/forwarded'
import worker from '../src/index'
import { encryptVaultPassword } from '../../lib/email-core/vault-crypto'
import type { BillParseResult } from '../../lib/email-core/types'

/**
 * 端到端：一封真实字节形态的顶层转发包 -> 解析 -> 抽取嵌套 .eml -> 认人 -> 落库。
 * 这条链路此前只有 /tmp 里的一次性 harness 覆盖（不入库），这里用合成邮件固化。
 */

const enc = (s: string) => new Uint8Array(new TextEncoder().encode(s))

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
function forwardedBundle(attachment = nestedBillEmail()): Uint8Array<ArrayBuffer> {
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
      toBase64(attachment),
      '--OUT--',
      '',
    ].join('\r\n')
  )
}

const USER_ID = '11111111-1111-1111-1111-111111111111'

let sqlite: SqliteD1
let db: D1Database
beforeEach(() => {
  sqlite = createOpportunityDb()
  db = sqlite as unknown as D1Database
  sqlite.exec(`
    INSERT INTO users(id, email, password_hash) VALUES ('${USER_ID}', 'user@example.test', 'x');
    INSERT INTO card_holders(id, created_by, managed_by, name, aliases)
      VALUES ('h1', '${USER_ID}', '${USER_ID}', '张改菊', '["张改菊女士"]'),
             ('h2', '${USER_ID}', '${USER_ID}', '高敏', NULL);
    INSERT INTO card_products(id, bank_name, card_name, currency) VALUES ('p1', '中国银行', 'Credit card', 'CNY');
    INSERT INTO credit_cards(id, holder_id, card_product_id, billing_day, card_number_last4)
      VALUES ('c1', 'h1', 'p1', 16, '1234'), ('c2', 'h2', 'p1', 16, '1234');
  `)
})
afterEach(() => {
  sqlite.close()
  vi.unstubAllGlobals()
})

const parseOk = async (): Promise<BillParseResult> => ({
  is_bill: true, email_kind: 'statement', confidence: 0.96,
  bank_name: '中国银行', card_last4: '1234', bill_amount: 6000,
  due_date: '2026-09-20', due_date_status: 'exact', bill_month: '2026-08',
  statement_date: '2026-08-16', currency: 'CNY',
})

describe('邮箱转发入账', () => {
  it('从真实字节的转发包解出 GBK 收件人并消歧两张同尾号卡', async () => {
    const raw = forwardedBundle()
    expect(parseRawMessage(raw).attachments[0].contentType).toBe('message/rfc822')
    const parseText = vi.fn(parseOk)
    const result = await processEmailDelivery(raw, { db, userId: USER_ID, parseText })
    expect(result).toMatchObject({ nestedCount: 1, billIds: [expect.any(String)], draftIds: [] })
    expect(parseText).toHaveBeenCalledWith(expect.stringContaining('6000'))
    expect(sqlite.raw.prepare('SELECT card_id, bill_month, status FROM bills').get())
      .toEqual({ card_id: 'c1', bill_month: '2026-08', status: 'unpaid' })
  })

  it('有明确收件人但尾号为新卡时留草稿，重试保持幂等', async () => {
    const raw = forwardedBundle()
    const options = { db, userId: USER_ID, parseText: async () => ({ ...await parseOk(), card_last4: '5678' }) }
    const first = await processEmailDelivery(raw, options)
    const second = await processEmailDelivery(raw, options)
    expect(second.draftIds).toEqual(first.draftIds)
    expect(second.billIds).toEqual([])
    expect(sqlite.raw.prepare(
      'SELECT holder_id, card_id, attribution_source, attribution_trusted FROM bill_import_drafts',
    ).all()).toEqual([{ holder_id: 'h1', card_id: null, attribution_source: 'header_name', attribution_trusted: 1 }])
    expect(sqlite.raw.prepare('SELECT COUNT(*) AS count FROM credit_cards').get()).toEqual({ count: 2 })
  })

  it('对直发还款提醒不建账单或草稿', async () => {
    const raw = enc('From: sender@example.test\r\nTo: me@example.test\r\n\r\nYour autopay is scheduled')
    const result = await processEmailDelivery(raw, {
      db, userId: USER_ID,
      parseText: async () => ({ ...await parseOk(), is_bill: false, email_kind: 'autopay_scheduled' }),
    })
    expect(result).toMatchObject({ nestedCount: 0, billIds: [], draftIds: [], reason: '非账单邮件' })
  })

  it('实际 Email Worker 保留嵌套加密 PDF，缺 SESSION_SECRET 时建立草稿和通知', async () => {
    const encrypted = readFileSync(join(__dirname, 'fixtures/statement-aes-128.pdf'))
    const nested = enc([
      'From: letters@hsbc.example', 'To: Customer <me@example.test>', 'Subject: HSBC statement',
      'Content-Type: multipart/mixed; boundary="INNER"', '',
      '--INNER', 'Content-Type: text/plain', '', 'Your PDF statement is attached.',
      '--INNER', 'Content-Type: application/pdf', 'Content-Disposition: attachment; filename="statement.pdf"',
      'Content-Transfer-Encoding: base64', '', toBase64(encrypted), '--INNER--', '',
    ].join('\r\n'))
    const raw = forwardedBundle(nested)
    const put = vi.fn(async () => {})
    const model = vi.fn()
    vi.stubGlobal('fetch', model)
    const message = {
      to: `bills+${USER_ID}@20160325.xyz`, from: 'me@example.test', headers: new Headers(),
      raw: new ReadableStream({ start(controller) { controller.enqueue(raw); controller.close() } }),
    } as unknown as ForwardableEmailMessage
    await worker.email(message, { DB: db, ATTACHMENTS: { put } as unknown as R2Bucket }, {} as ExecutionContext)
    const draft = sqlite.raw.prepare('SELECT id, parse_status, password_hint, file_ref FROM bill_import_drafts').get()
    expect(draft).toMatchObject({
      parse_status: 'needs_password', password_hint: expect.stringContaining('密码说明'), file_ref: expect.any(String),
    })
    expect(put).toHaveBeenCalledWith(expect.stringContaining(`draft-files/${USER_ID}/`), new Uint8Array(encrypted), {
      httpMetadata: { contentType: 'application/pdf' },
    })
    expect(model).not.toHaveBeenCalled()
    expect(sqlite.raw.prepare('SELECT category, target_url FROM notification_history').get())
      .toEqual({ category: 'system', target_url: `/bills?draftId=${draft?.id}` })
  })
})

it('解锁 PDF 后按币种建立共享附件的两条草稿', async () => {
  const encrypted = readFileSync(join(__dirname, 'fixtures/statement-aes-128.pdf'))
  sqlite.exec("INSERT INTO system_settings (key, value) VALUES ('ai_api_key', 'test-api-key')")
  const password = 'fixture-7491'
  const secret = 'worker-test-secret'
  await db.prepare(
    "INSERT INTO statement_password_vault (id, user_id, label, password_ciphertext) VALUES ('rule', ?, 'test', ?)",
  ).bind(USER_ID, await encryptVaultPassword(password, secret, USER_ID)).run()
  const raw = enc([
    'From: chase@example.test', 'To: Customer <me@example.test>', 'Subject: Statement',
    'Content-Type: multipart/mixed; boundary="PDF"', '',
    '--PDF', 'Content-Type: application/pdf', 'Content-Disposition: attachment; filename="statement.pdf"',
    'Content-Transfer-Encoding: base64', '', toBase64(encrypted), '--PDF--', '',
  ].join('\r\n'))
  const model = vi.fn(async (_url: string, init?: RequestInit) => {
    const request = String(init?.body)
    expect(request).not.toContain(password)
    expect(request).toContain('1234.56 USD')
    return Response.json({ choices: [{ message: { content: JSON.stringify({
      is_bill: true, email_kind: 'statement', statements: [
        { ...await parseOk(), bill_amount: 6000, currency: 'CNY' },
        { ...await parseOk(), bill_amount: 99, currency: 'USD' },
      ],
    }) } }] })
  })
  vi.stubGlobal('fetch', model)
  const put = vi.fn(async () => {})
  const result = await processEmailDelivery(raw, { db, userId: USER_ID, secret, bucket: { put } as unknown as R2Bucket })
  expect(result.billIds).toEqual([])
  expect(result.draftIds).toHaveLength(2)
  expect(put).toHaveBeenCalledOnce()
  expect(model).toHaveBeenCalledOnce()
  const drafts = sqlite.raw.prepare(`SELECT batch_id, file_ref,
    json_extract(parsed_payload, '$.currency') AS currency, json_extract(parsed_payload, '$.bill_amount') AS amount
    FROM bill_import_drafts ORDER BY currency`).all()
  expect(drafts).toEqual([
    { batch_id: expect.any(String), file_ref: expect.any(String), currency: 'CNY', amount: 6000 },
    { batch_id: drafts[0].batch_id, file_ref: drafts[0].file_ref, currency: 'USD', amount: 99 },
  ])
  expect(sqlite.raw.prepare("SELECT use_count FROM statement_password_vault WHERE id = 'rule'").get())
    .toEqual({ use_count: 1 })
})
