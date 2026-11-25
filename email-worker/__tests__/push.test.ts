import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import worker from '../src/index'
import { createOpportunityDb, type SqliteD1 } from '../../lib/__tests__/helpers/sqlite-d1'
import type { BillParseResult, Env } from '../../lib/email-core/types'

const USER_ID = '11111111-1111-1111-1111-111111111111'
const RECIPIENT = `bills+${USER_ID}@20160325.xyz`
const AI_URL = 'https://ai.example.test/chat/completions'
const APNS_URL = 'https://api.sandbox.push.apple.com/3/device/device-1'
const parsed: BillParseResult = {
  is_bill: true,
  email_kind: 'statement',
  bank_name: '招商银行',
  card_last4: '1234',
  bill_amount: 6000,
  due_date: '2026-09-20',
  due_date_status: 'exact',
  confidence: 0.95,
  bill_month: '2026-08',
  statement_date: '2026-08-16',
  currency: 'CNY',
}

let keyP8: string
beforeAll(async () => {
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']
  ) as CryptoKeyPair
  const bytes = await crypto.subtle.exportKey('pkcs8', pair.privateKey) as ArrayBuffer
  keyP8 = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...new Uint8Array(bytes)))}\n-----END PRIVATE KEY-----`
})
let sqlite: SqliteD1
afterEach(() => {
  vi.restoreAllMocks()
  sqlite?.close()
})

function seed(configured = true) {
  sqlite = createOpportunityDb()
  sqlite.exec(`
    INSERT INTO users(id,email,password_hash) VALUES
      ('${USER_ID}', 'user@example.test', 'x'),
      ('other-user', 'other@example.test', 'x'),
      ('new-owner', 'new-owner@example.test', 'x');
    INSERT INTO card_holders(id,created_by,managed_by,name) VALUES ('h1','${USER_ID}','${USER_ID}','张改菊');
    INSERT INTO card_products(id,bank_name,card_name,currency) VALUES ('p1','招商银行','Test card','CNY');
    INSERT INTO credit_cards(id,holder_id,card_product_id,billing_day,card_number_last4) VALUES ('c1','h1','p1',16,'1234');
    INSERT INTO system_settings(key,value) VALUES ('ai_api_key','test-ai-key'), ('ai_base_url','https://ai.example.test');
    INSERT INTO device_tokens(id,token,user_id,platform) VALUES
      ('token-1','device-1','${USER_ID}','ios'),
      ('token-2','other-user-device','other-user','ios'),
      ('token-3','android-device','${USER_ID}','android');
  `)
  const db = sqlite as unknown as D1Database
  const tables = {
    get bills() { return sqlite.raw.prepare('SELECT * FROM bills').all() },
    get credit_cards() { return sqlite.raw.prepare('SELECT * FROM credit_cards').all() },
    get email_parse_logs() { return sqlite.raw.prepare('SELECT * FROM email_parse_logs').all() },
    get device_tokens() { return sqlite.raw.prepare('SELECT * FROM device_tokens ORDER BY id').all() },
  }
  const env: Env = configured ? {
    DB: db,
    APNS_KEY_P8: keyP8,
    APNS_KEY_ID: 'TESTKEY',
    APNS_TEAM_ID: 'TESTTEAM',
  } : { DB: db }
  const pending: Promise<unknown>[] = []
  const ctx = {
    waitUntil: vi.fn((promise: Promise<unknown>) => pending.push(promise)),
  } as unknown as ExecutionContext
  return { env, tables, ctx, pending }
}

function message(raw: string): ForwardableEmailMessage {
  const bytes = new TextEncoder().encode(raw)
  return {
    from: 'bill@bank.test',
    to: RECIPIENT,
    headers: new Headers({ subject: 'Statement' }),
    raw: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close() } }),
  } as ForwardableEmailMessage
}

function plain(trusted = true): string {
  return [
    'From: bill@bank.test',
    `To: ${RECIPIENT}`,
    'Content-Type: text/plain; charset="utf-8"',
    '',
    trusted ? '尊敬的张改菊女士，您本期应还 6000 元。' : '您本期应还 6000 元。',
  ].join('\r\n')
}

function bundle(trusted = true): string {
  return [
    'From: me@example.test',
    `To: ${RECIPIENT}`,
    'Content-Type: multipart/mixed; boundary="BUNDLE"',
    '',
    '--BUNDLE',
    'Content-Type: text/plain; charset="utf-8"',
    '',
    '见附件',
    '--BUNDLE',
    'Content-Type: message/rfc822',
    'Content-Disposition: attachment; filename="bill.eml"',
    '',
    plain(trusted),
    '--BUNDLE--',
    '',
  ].join('\r\n')
}

function mockNetwork(
  bill: BillParseResult = parsed,
  apns: () => Promise<Response> = async () => new Response(null, { status: 200 })
) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    if (url === AI_URL) {
      return Response.json({ choices: [{ message: { content: JSON.stringify(bill) } }] })
    }
    if (url.startsWith('https://api.sandbox.push.apple.com/3/device/')) return apns()
    throw new Error(`Unexpected test request: ${url}`)
  })
}

describe('邮件入库后的 APNs 静默同步', () => {
  it.each(['plain', 'bundle'])('%s 成功写入后仅异步通知当前用户的 iOS 设备', async (kind) => {
    const { env, tables, ctx, pending } = seed()
    const fetchSpy = mockNetwork()
    await worker.email(message(kind === 'plain' ? plain() : bundle()), env, ctx)
    await Promise.all(pending)

    expect(tables.bills).toHaveLength(1)
    expect(tables.email_parse_logs).toMatchObject([{ status: 'success' }])
    expect(ctx.waitUntil).toHaveBeenCalledTimes(1)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    const call = fetchSpy.mock.calls.find(([url]) => String(url) === APNS_URL)
    expect(call).toBeDefined()
    const options = call![1]!
    expect(options.headers).toMatchObject({ 'apns-push-type': 'background', 'apns-priority': '5' })
    expect(JSON.parse(String(options.body))).toMatchObject({ aps: { 'content-available': 1 }, type: 'sync' })
  })

  it('不等待推送响应即可结束邮件处理', async () => {
    const { env, tables, ctx, pending } = seed()
    let finishPush!: (value: Response) => void
    const response = new Promise<Response>(resolve => { finishPush = resolve })
    mockNetwork(parsed, () => response)
    await worker.email(message(plain()), env, ctx)
    expect(tables.bills).toHaveLength(1)
    expect(pending).toHaveLength(1)
    finishPush(new Response(null, { status: 200 }))
    await Promise.all(pending)
  })

  it('未配置 APNs 时账单照常入库且不排队发送', async () => {
    const { env, tables, ctx, pending } = seed(false)
    const fetchSpy = mockNetwork()
    await worker.email(message(plain()), env, ctx)
    expect(tables.bills).toHaveLength(1)
    expect(ctx.waitUntil).not.toHaveBeenCalled()
    expect(pending).toHaveLength(0)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it.each(['plain', 'bundle'])('%s 没有写入账单时不通知', async (kind) => {
    const { env, tables, ctx } = seed()
    const fetchSpy = mockNetwork({ is_bill: false, email_kind: 'other' })
    await worker.email(message(kind === 'plain' ? plain() : bundle()), env, ctx)
    expect(tables.bills).toHaveLength(0)
    expect(tables.email_parse_logs).toMatchObject([{ status: 'skipped' }])
    expect(ctx.waitUntil).not.toHaveBeenCalled()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('保留原账单且未改写时不通知', async () => {
    const { env, tables, ctx } = seed()
    sqlite.exec(`INSERT INTO bills(id,card_id,bill_month,bill_amount,due_date,status)
      VALUES ('existing','c1','2026-08',100,'2026-09-20','paid')`)
    mockNetwork()
    await worker.email(message(plain(false)), env, ctx)
    expect(tables.bills[0]).toMatchObject({ bill_amount: 100, status: 'paid' })
    expect(ctx.waitUntil).not.toHaveBeenCalled()
  })

  it('直发账单金额冲突时保留原账单与卡档，停泊草稿', async () => {
    const { env, tables, ctx, pending } = seed()
    sqlite.exec("UPDATE credit_cards SET billing_day=1 WHERE id='c1'")
    sqlite.exec(`INSERT INTO bills(id,card_id,bill_month,bill_amount,due_date,status)
      VALUES ('existing','c1','2026-08',100,'2026-09-20','paid')`)
    mockNetwork()
    await worker.email(message(plain(false)), env, ctx)
    await Promise.all(pending)
    expect(tables.bills[0]).toMatchObject({ bill_amount: 100, status: 'paid' })
    expect(tables.credit_cards[0].billing_day).toBe(1)
    expect(ctx.waitUntil).not.toHaveBeenCalled()
    expect(sqlite.raw.prepare('SELECT status FROM bill_import_drafts').all()).toEqual([{ status: 'draft' }])
  })

  it('转发保留账单时跳过账单日修正且不通知设备', async () => {
    const { env, tables, ctx } = seed()
    sqlite.exec("UPDATE credit_cards SET billing_day=1 WHERE id='c1'")
    sqlite.exec(`INSERT INTO bills(id,card_id,bill_month,bill_amount,due_date,status)
      VALUES ('existing','c1','2026-08',100,'2026-09-20','paid')`)
    mockNetwork()
    await worker.email(message(bundle(false)), env, ctx)
    expect(tables.bills[0]).toMatchObject({ bill_amount: 100, status: 'paid' })
    expect(tables.credit_cards[0].billing_day).toBe(1)
    expect(ctx.waitUntil).not.toHaveBeenCalled()
  })

  it.each(['plain', 'bundle'])('%s 更新账单日时通知设备', async kind => {
    const { env, tables, ctx, pending } = seed()
    sqlite.exec("UPDATE credit_cards SET billing_day=1 WHERE id='c1'")
    mockNetwork()
    await worker.email(message(kind === 'plain' ? plain() : bundle()), env, ctx)
    await Promise.all(pending)
    expect(tables.credit_cards[0].billing_day).toBe(16)
    expect(ctx.waitUntil).toHaveBeenCalledTimes(1)
  })

  it('推送网络失败不改变账单或邮件成功状态', async () => {
    const { env, tables, ctx, pending } = seed()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    mockNetwork(parsed, async () => { throw new Error('network unavailable') })
    await worker.email(message(plain()), env, ctx)
    await Promise.all(pending)
    expect(tables.bills).toHaveLength(1)
    expect(tables.email_parse_logs).toMatchObject([{ status: 'success' }])
    expect(tables.device_tokens).toHaveLength(3)
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('1/1'),
      [expect.objectContaining({ error: 'network unavailable' })]
    )
  })

  it('APNs 410 只清理对应用户的失效 token，入库仍然成功', async () => {
    const { env, tables, ctx, pending } = seed()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    mockNetwork(parsed, async () => Response.json({ reason: 'Unregistered' }, { status: 410 }))
    await worker.email(message(bundle()), env, ctx)
    await Promise.all(pending)
    expect(tables.device_tokens.map(row => row.token)).toEqual(['other-user-device', 'android-device'])
    expect(tables.bills).toHaveLength(1)
    expect(tables.email_parse_logs).toMatchObject([{ status: 'success' }])
  })

  it('发送期间换绑的失效 token 不会被旧用户任务删除', async () => {
    const { env, tables, ctx, pending } = seed()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    mockNetwork(parsed, async () => {
      sqlite.exec("UPDATE device_tokens SET user_id='new-owner' WHERE id='token-1'")
      return Response.json({ reason: 'Unregistered' }, { status: 410 })
    })
    await worker.email(message(plain()), env, ctx)
    await Promise.all(pending)
    expect(tables.device_tokens).toHaveLength(3)
    expect(tables.device_tokens[0].user_id).toBe('new-owner')
  })

  it('APNs 临时故障保留 token，后续可重试', async () => {
    const { env, tables, ctx, pending } = seed()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    mockNetwork(parsed, async () => Response.json({ reason: 'ServiceUnavailable' }, { status: 503 }))
    await worker.email(message(plain()), env, ctx)
    await Promise.all(pending)
    expect(tables.device_tokens).toHaveLength(3)
    expect(tables.email_parse_logs).toMatchObject([{ status: 'success' }])
  })

  it('后台查询失败由 waitUntil 任务记录，不回滚入库', async () => {
    const { env, tables, ctx, pending } = seed()
    const prepare = env.DB.prepare.bind(env.DB)
    vi.spyOn(env.DB, 'prepare').mockImplementation(sql => {
      if (sql.includes('FROM device_tokens')) throw new Error('D1 unavailable')
      return prepare(sql)
    })
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockNetwork()
    await worker.email(message(plain()), env, ctx)
    await expect(Promise.all(pending)).resolves.toEqual([undefined])
    expect(tables.bills).toHaveLength(1)
    expect(tables.email_parse_logs).toMatchObject([{ status: 'success' }])
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Silent sync'), expect.any(Error))
  })
})
