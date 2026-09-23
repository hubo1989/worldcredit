import { describe, it, expect, vi, beforeEach } from 'vitest'

const db = vi.hoisted(() => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn(),
}))

vi.mock('../db', () => ({
  query: db.query,
  queryOne: db.queryOne,
  execute: db.execute,
  uuid: vi.fn(() => 'generated-id'),
  now: vi.fn(() => '2026-09-23T00:00:00.000Z'),
}))

import { discardEmailParseLog, createCardFromEmailParseLog } from '../api/admin.server'

const failedLog = {
  id: 'log-1',
  user_id: 'user-1',
  status: 'failed' as const,
  error_msg: '未匹配到银行「浦发银行」，请在界面手动添加该卡',
  raw_ai_response: JSON.stringify({
    is_bill: true,
    bank_name: '浦发银行',
    card_last4: '6225',
    bill_amount: 5950.82,
    min_payment: 119.02,
    due_date: '2026-09-17',
    bill_month: '2026-08',
    statement_date: '2026-08-28',
    currency: 'CNY',
  }),
}

function okQueryOne<T>(value: T | null) {
  return { data: value, error: null }
}

beforeEach(() => {
  db.query.mockReset()
  db.queryOne.mockReset()
  db.execute.mockReset()
  db.execute.mockResolvedValue({ data: { changes: 1 }, error: null })
})

describe('email parse log manual resolution', () => {
  it('discards only an unresolved-bank failure and preserves the audit reason', async () => {
    db.queryOne.mockReturnValueOnce(okQueryOne(failedLog)).mockReturnValueOnce(
      okQueryOne({
        ...failedLog,
        status: 'skipped',
        error_msg: `${failedLog.error_msg}；用户已丢弃，不创建卡片，不写入账单`,
      }),
    )

    const result = await discardEmailParseLog('log-1')

    expect(result.status).toBe('skipped')
    expect(result.error_msg).toContain('用户已丢弃')
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE email_parse_logs SET status = 'skipped'"),
      expect.arrayContaining(['log-1']),
    )
  })

  it('creates bank/product/card, imports the bill, and marks the log success', async () => {
    db.queryOne
      .mockReturnValueOnce(okQueryOne(failedLog))
      .mockReturnValueOnce(okQueryOne({ id: 'holder-1', name: '呼博' }))
      .mockReturnValueOnce(okQueryOne(null))
      .mockReturnValueOnce(okQueryOne(null))
      .mockReturnValueOnce(okQueryOne(null))
      .mockReturnValueOnce(okQueryOne(null))

    const result = await createCardFromEmailParseLog({
      logId: 'log-1',
      holderId: 'holder-1',
      cardName: '浦发银行信用卡',
    })

    expect(result).toMatchObject({
      holderName: '呼博',
      createdBank: true,
      createdProduct: true,
      createdCard: true,
    })

    const executed = db.execute.mock.calls.map(([sql]) => sql as string)
    expect(executed.some((sql) => sql.includes('INSERT INTO banks'))).toBe(true)
    expect(executed.some((sql) => sql.includes('INSERT INTO card_products'))).toBe(true)
    expect(executed.some((sql) => sql.includes('INSERT INTO credit_cards'))).toBe(true)
    expect(executed.some((sql) => sql.includes('INSERT INTO bills'))).toBe(true)
    expect(
      executed.some((sql) => sql.includes("UPDATE email_parse_logs SET status = 'success'")),
    ).toBe(true)

    const billInsert = db.execute.mock.calls.find(([sql]) =>
      (sql as string).includes('INSERT INTO bills'),
    )
    expect(billInsert?.[1]).toContain(5950.82)
    expect(billInsert?.[1]).toContain(119.02)
  })

  it('never accepts a holder outside the log owner', async () => {
    db.queryOne.mockReturnValueOnce(okQueryOne(failedLog)).mockReturnValueOnce(okQueryOne(null))

    await expect(
      createCardFromEmailParseLog({
        logId: 'log-1',
        holderId: 'other-owner-holder',
        cardName: '浦发银行信用卡',
      }),
    ).rejects.toThrow('请选择这封邮件所属用户的持卡人')

    const holderSql = db.queryOne.mock.calls[1][0] as string
    expect(holderSql).toContain('created_by = ?')
    expect(holderSql).toContain('id = ?')
  })
})
