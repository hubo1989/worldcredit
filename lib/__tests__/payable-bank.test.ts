import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createOpportunityDb, type SqliteD1 } from './helpers/sqlite-d1'
import { setDb } from '../db/client'
import { RpcDomainError } from '../api/errors'
import {
  createRecurringPayable,
  updateRecurringPayable,
  payRecurringPayable,
  getPayablePayments,
} from '../api/payables.server'

describe('recurring payable bank attribution', () => {
  let db: SqliteD1 | null = null

  beforeEach(() => {
    db = createOpportunityDb()
    db.exec("INSERT INTO users (id, email, password_hash) VALUES ('u1', 'u1@example.com', 'hash')")
    setDb(db as unknown as D1Database)
  })

  afterEach(() => {
    db?.close()
    db = null
  })

  const create = (bankName?: string | null) =>
    createRecurringPayable({
      created_by: 'u1',
      name: '房贷',
      category: 'loan',
      amount: 4500,
      currency: 'CNY',
      due_day: 5,
      bank_name: bankName,
    })

  it('0028 迁移为 recurring_payables 增加可空的 bank_name', async () => {
    const columns = (
      await db!.prepare('PRAGMA table_info(recurring_payables)').all<{ name: string }>()
    ).results.map(c => c.name)
    expect(columns).toContain('bank_name')
  })

  it('创建时可填银行；空串归一为 null（非银行）', async () => {
    const withBank = await create('招商银行')
    expect(withBank.bank_name).toBe('招商银行')
    const none = await create('   ')
    expect(none.bank_name).toBeNull()
  })

  it('编辑可改银行，也可清空回非银行', async () => {
    const created = await create('招商银行')
    const renamed = await updateRecurringPayable(created.id, { bank_name: ' 工商银行 ' })
    expect(renamed.bank_name).toBe('工商银行')
    const cleared = await updateRecurringPayable(created.id, { bank_name: '' })
    expect(cleared.bank_name).toBeNull()
  })

  it('过长或非字符串银行被拒（RpcDomainError 400）', async () => {
    await expect(create('银'.repeat(61))).rejects.toMatchObject({
      name: 'RpcDomainError',
      code: 'VALIDATION_FAILED',
      status: 400,
    })
    await expect(
      updateRecurringPayable('none', { bank_name: 123 as never })
    ).rejects.toBeInstanceOf(RpcDomainError)
  })
})

describe('recurring payable payment history', () => {
  it('登记还款后可按账期倒序读取历史记录', async () => {
    const db = createOpportunityDb()
    db.exec("INSERT INTO users (id, email, password_hash) VALUES ('u1', 'u1@example.com', 'hash')")
    setDb(db as unknown as D1Database)

    const payable = await createRecurringPayable({
      created_by: 'u1',
      name: '房贷',
      category: 'loan',
      amount: 4500,
      currency: 'CNY',
      due_day: 5,
    })
    await payRecurringPayable(payable.id, 4500, '十月')

    const records = await getPayablePayments(payable.id)
    expect(records.length).toBe(1)
    expect(records[0]).toMatchObject({
      payable_id: payable.id,
      period: payable.period,
      amount: 4500,
      note: '十月',
    })
    db.close()
  })

  it('无记录返回空数组；非法 ID 报 VALIDATION_FAILED', async () => {
    const db = createOpportunityDb()
    db.exec("INSERT INTO users (id, email, password_hash) VALUES ('u1', 'u1@example.com', 'hash')")
    setDb(db as unknown as D1Database)
    const payable = await createRecurringPayable({
      created_by: 'u1',
      name: '房租',
      category: 'rent',
      amount: 2000,
      currency: 'CNY',
      due_day: 10,
    })
    await expect(getPayablePayments(payable.id)).resolves.toEqual([])
    await expect(getPayablePayments('')).rejects.toMatchObject({
      name: 'RpcDomainError',
      code: 'VALIDATION_FAILED',
    })
    db.close()
  })
})
