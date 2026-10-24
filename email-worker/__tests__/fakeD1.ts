/**
 * 内存版 D1 桩：只实现被测代码实际用到的那几条语句。
 *
 * 刻意与真实 SQL 一一对应（表名 + 关键条件 + 绑定参数顺序），这样测的是
 * 「落库决策」而不是「SQL 字符串长什么样」；真实 schema 的约束（如
 * credit_cards.card_product_id NOT NULL）在用例数据里体现。
 */

export type Row = Record<string, unknown>

export interface FakeDbTables {
  card_holders: Row[]
  credit_cards: Row[]
  card_products: Row[]
  bills: Row[]
  bill_import_drafts: Row[]
  system_settings: Row[]
  email_parse_logs: Row[]
  device_tokens: Row[]
}

function compareRows(a: Row, b: Row, columns: string[]): number {
  for (const col of columns) {
    const av = String(a[col] ?? '')
    const bv = String(b[col] ?? '')
    if (av < bv) return -1
    if (av > bv) return 1
  }
  return 0
}

class FakeStatement {
  constructor(
    private tables: FakeDbTables,
    private sql: string,
    private args: unknown[] = []
  ) {}

  bind(...args: unknown[]): FakeStatement {
    return new FakeStatement(this.tables, this.sql, args)
  }

  async first<T = Row>(): Promise<T | null> {
    const { results } = await this.all<T>()
    return results.length ? results[0] : null
  }

  async all<T = Row>(): Promise<{ results: T[]; success: true }> {
    const { tables, sql, args } = this
    const norm = sql.replace(/\s+/g, ' ').trim()

    if (/FROM system_settings/i.test(norm)) {
      return { results: tables.system_settings as T[], success: true }
    }

    if (/FROM device_tokens/i.test(norm)) {
      const results = tables.device_tokens.filter(r => r.user_id === args[0] && r.platform === 'ios')
      return { results: results as T[], success: true }
    }

    if (/FROM card_holders/i.test(norm)) {
      const results = tables.card_holders
        .filter(r => r.created_by === args[0])
        .sort((a, b) => compareRows(a, b, ['created_at', 'id']))
      return { results: results as T[], success: true }
    }

    if (/FROM card_products/i.test(norm)) {
      const results = tables.card_products
        .filter(r => r.is_active === 1)
        .sort((a, b) => compareRows(a, b, ['created_at', 'id']))
      return { results: results as T[], success: true }
    }

    if (/FROM credit_cards/i.test(norm)) {
      // syncBillingDayFromBill 按主键读卡；建卡路径按 持卡人+尾号 找卡
      if (/WHERE id = \?/i.test(norm)) {
        const results = tables.credit_cards.filter(r => r.id === args[0])
        return { results: results.slice(0, 1) as T[], success: true }
      }
      const results = tables.credit_cards.filter(
        r => r.holder_id === args[0] && r.card_number_last4 === args[1]
      )
      return { results: results.slice(0, 1) as T[], success: true }
    }

    if (/FROM bills/i.test(norm)) {
      // syncBillingDayFromBill 找「本期之前、有出账日」的历史账单
      if (/bill_month < \?/i.test(norm)) {
        const results = tables.bills
          .filter(
            r => r.card_id === args[0] &&
              String(r.bill_month) < String(args[1]) &&
              r.statement_date != null
          )
          .sort((a, b) => compareRows(b, a, ['bill_month']))
        return { results: results.slice(0, 6) as T[], success: true }
      }
      const results = tables.bills.filter(r => r.card_id === args[0] && r.bill_month === args[1])
      return { results: results.slice(0, 1) as T[], success: true }
    }

    throw new Error('FakeD1 未支持该查询: ' + norm)
  }

  async run(): Promise<{ success: true }> {
    const { tables, sql, args } = this
    const norm = sql.replace(/\s+/g, ' ').trim()

    if (/^INSERT INTO email_parse_logs/i.test(norm)) {
      const [id, user_id, from_email, subject, bill_id, status, error_msg, raw_ai_response] = args
      tables.email_parse_logs.push({ id, user_id, from_email, subject, bill_id, status, error_msg, raw_ai_response })
      return { success: true }
    }

    if (/^DELETE FROM device_tokens/i.test(norm)) {
      tables.device_tokens = tables.device_tokens.filter(r => !(r.token === args[0] && r.user_id === args[1]))
      return { success: true }
    }

    if (/^INSERT INTO credit_cards/i.test(norm)) {
      // 注意 credit_limit 在 SQL 里是字面量 0，不占绑定参数位
      tables.credit_cards.push({
        id: args[0],
        holder_id: args[1],
        card_product_id: args[2],
        card_number_last4: args[3],
        credit_limit: 0,
        billing_day: args[4],
        status: args[5],
        card_type: args[6],
      })
      return { success: true }
    }

    if (/^INSERT INTO bills/i.test(norm)) {
      tables.bills.push({
        id: args[0],
        card_id: args[1],
        bill_month: args[2],
        bill_amount: args[3],
        min_payment: args[4],
        due_date: args[5],
        statement_date: args[6],
        status: args[7],
      })
      return { success: true }
    }

    if (/^INSERT INTO bill_import_drafts/i.test(norm)) {
      // INSERT INTO bill_import_drafts (id, created_by, card_id, source_type, parsed_payload, confidence)
      // VALUES (?, ?, NULL, 'email', ?, ?) —— card_id 是字面量 NULL
      tables.bill_import_drafts.push({
        id: args[0],
        created_by: args[1],
        card_id: null,
        source_type: args[2] === undefined ? 'email' : undefined,
        parsed_payload: args[2],
        confidence: args[3],
      })
      const row = tables.bill_import_drafts[tables.bill_import_drafts.length - 1]
      row.source_type = 'email'
      return { success: true }
    }

    if (/^UPDATE bills/i.test(norm)) {
      const [bill_amount, min_payment, due_date, statement_date, status, id] = args
      const row = tables.bills.find(r => r.id === id)
      if (!row) throw new Error('FakeD1 UPDATE 未命中账单: ' + String(id))
      Object.assign(row, { bill_amount, min_payment, due_date, statement_date, status })
      return { success: true }
    }

    if (/^UPDATE credit_cards SET billing_day/i.test(norm)) {
      // syncBillingDayFromBill 的回写：SET billing_day = ? WHERE id = ? AND billing_day != ?
      const [billingDay, id, notDay] = args
      const row = tables.credit_cards.find(r => r.id === id)
      if (!row) throw new Error('FakeD1 UPDATE credit_cards 未命中: ' + String(id))
      if (row.billing_day === notDay) return { success: true }
      row.billing_day = billingDay
      return { success: true }
    }

    throw new Error('FakeD1 未支持该写入: ' + norm)
  }
}

export interface FakeDb {
  db: D1Database
  tables: FakeDbTables
}

export function createFakeD1(seed: Partial<FakeDbTables> = {}): FakeDb {
  const tables: FakeDbTables = {
    card_holders: [],
    credit_cards: [],
    card_products: [],
    bills: [],
    bill_import_drafts: [],
    system_settings: [],
    email_parse_logs: [],
    device_tokens: [],
    ...seed,
  }
  const db = {
    prepare: (sql: string) => new FakeStatement(tables, sql),
  } as unknown as D1Database
  return { db, tables }
}
