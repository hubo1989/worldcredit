// 方向 3 / HUB-170：全家庭报表导出的权限隔离与 CSV 防公式注入。
//
// 权限断言分两层：纯守卫函数（guardFamilyExport）与真实 RPC 分发（dispatchRpc），
// 后者验证 MemberScopeError 确实被映射成 HTTP 403，而不是只在单元层抛异常。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createOpportunityDb, type SqliteD1 } from './helpers/sqlite-d1'
import { setDb } from '../db/client'
import { clearFxCache } from '../fx'
import {
  buildCsv,
  sanitizeCsvCell,
  sanitizeFilename,
  statementReportToCsv,
} from '../export'
import { MemberScopeError, guardFamilyExport, type MemberContext } from '../api/member-scope'
import { exportFamilyCsvRows, getStatementReport } from '../api/exports.server'
import { dispatchRpc } from '../api/rpc-dispatch'
import { RPC_REGISTRY } from '../api/registry'
import type { FamilyStatementReport } from '../api/exports.server'

const TODAY = '2026-11-15'

describe('direction 3 · CSV 防公式注入', () => {
  it('拦截首字符与前导空白后的公式注入', () => {
    expect(sanitizeCsvCell('=1+1')).toBe("'=1+1")
    // 值里带逗号，中和后还要按 RFC 4180 加引号
    expect(sanitizeCsvCell('+SUM(1,2)')).toBe("\"'+SUM(1,2)\"")
    expect(sanitizeCsvCell('-1+1')).toBe("'-1+1")
    expect(sanitizeCsvCell('@test')).toBe("'@test")
    // 既有实现漏掉的向量：前导空格 / tab 后接公式符
    expect(sanitizeCsvCell(' =1+1')).toBe("' =1+1")
    expect(sanitizeCsvCell('\t=1+1')).toBe("'\t=1+1")
    expect(sanitizeCsvCell('  =CMD|\'/C calc\'!A0')).toBe("'  =CMD|'/C calc'!A0")
    // 独立的控制字符同样中和
    expect(sanitizeCsvCell('\rfoo')).toBe("\"'\rfoo\"")
  })

  it('正常值不被改写，含逗号/引号/换行时按 RFC 4180 加引号', () => {
    expect(sanitizeCsvCell('餐饮')).toBe('餐饮')
    expect(sanitizeCsvCell(123.45)).toBe('123.45')
    expect(sanitizeCsvCell(null)).toBe('')
    expect(sanitizeCsvCell(undefined)).toBe('')
    expect(sanitizeCsvCell('a,b')).toBe('"a,b"')
    expect(sanitizeCsvCell('a"b')).toBe('"a""b"')
    expect(sanitizeCsvCell('a\nb')).toBe('"a\nb"')
  })

  it('buildCsv 输出带 UTF-8 BOM 且逐格转义', () => {
    const csv = buildCsv(['描述', '金额'], [
      { 描述: ' =1+1', 金额: 12.5 },
      { 描述: '普通,值', 金额: 0 },
    ])

    expect(csv.charCodeAt(0)).toBe(0xfeff)
    const lines = csv.slice(1).split('\n').filter(line => line.length > 0)
    expect(lines[0]).toBe('描述,金额')
    expect(lines[1]).toBe("' =1+1,12.5")
    expect(lines[2]).toBe('"普通,值",0')
  })

  it('文件名清洗去掉路径分隔符与控制字符', () => {
    expect(sanitizeFilename('a/b\\c:d*e?f"g<h>i|j')).toBe('a_b_c_d_e_f_g_h_i_j')
    expect(sanitizeFilename('')).toBe('worldcredit-export.csv')
    expect(sanitizeFilename('报表\u0001.csv')).toBe('报表_.csv')
  })
})

describe('direction 3 · 全家庭导出权限隔离', () => {
  const memberCtx: MemberContext = { userId: 'u2', role: 'member', holderIds: ['h2'] }

  it('member 请求 scope=family 直接 403', () => {
    expect(() => guardFamilyExport({ scope: 'family' }, memberCtx)).toThrow(MemberScopeError)
    expect(() => guardFamilyExport({ scope: 'family' }, memberCtx)).toThrow(/全家庭/)
  })

  it('member 请求非本人 holder_id 直接 403', () => {
    expect(() =>
      guardFamilyExport({ scope: 'holder', holder_id: 'h1' }, memberCtx),
    ).toThrow(/无权访问其他成员/)
  })

  it('member 只绑定一个持卡人时自动补全 holder_id', () => {
    const request: { scope: 'holder'; holder_id?: string } = { scope: 'holder' }
    guardFamilyExport(request, memberCtx)
    expect(request.holder_id).toBe('h2')
  })

  it('member 绑定多个持卡人且未选择时拒绝（不默认取第一个）', () => {
    const multiCtx: MemberContext = { userId: 'u2', role: 'member', holderIds: ['h2', 'h3'] }
    expect(() => guardFamilyExport({ scope: 'holder' }, multiCtx)).toThrow(/请选择你自己的持卡人/)
  })

  it('exports.* 在 RPC 注册表里显式声明 bindUser + memberGuard', () => {
    for (const fn of ['exportFamilyCsvRows', 'getStatementReport'] as const) {
      const entry = RPC_REGISTRY.exports[fn]
      expect(entry, fn).toBeTruthy()
      expect(entry.bindUser, fn).toBe(1)
      expect(entry.memberGuard, fn).toBeDefined()
      expect(entry.admin, fn).not.toBe(true)
    }
  })
})

describe('direction 3 · 报表导出与 RPC 分发', () => {
  let db: SqliteD1

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-15T09:00:00+08:00'))
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ timestamp: 1789444800, base: 'USD', rates: { USD: 1, CNY: 7 } }),
      }),
    )
    db = createOpportunityDb()
    const columns = db.raw.prepare('PRAGMA table_info(payments)').all() as { name: string }[]
    const names = new Set(columns.map(column => column.name))
    if (!names.has('settled_currency')) db.exec('ALTER TABLE payments ADD COLUMN settled_currency TEXT;')
    if (!names.has('settled_amount')) db.exec('ALTER TABLE payments ADD COLUMN settled_amount REAL;')
    if (!names.has('locked_fx_rate')) db.exec('ALTER TABLE payments ADD COLUMN locked_fx_rate REAL;')
    db.exec(`
      CREATE TABLE IF NOT EXISTS installment_plans (
        id TEXT PRIMARY KEY,
        card_id TEXT NOT NULL REFERENCES credit_cards(id) ON DELETE CASCADE,
        source_bill_id TEXT REFERENCES bills(id) ON DELETE SET NULL,
        source_item_id TEXT REFERENCES bill_items(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        plan_type TEXT NOT NULL DEFAULT 'purchase',
        currency TEXT NOT NULL,
        principal_amount REAL NOT NULL,
        total_periods INTEGER NOT NULL,
        paid_periods INTEGER NOT NULL DEFAULT 0,
        fee_mode TEXT NOT NULL DEFAULT 'equal_principal_fee',
        fee_charge_mode TEXT NOT NULL DEFAULT 'per_period',
        fee_rate_per_period REAL,
        custom_period_fee REAL,
        apr REAL,
        start_month TEXT NOT NULL,
        due_day INTEGER NOT NULL,
        due_month_offset INTEGER NOT NULL DEFAULT 0,
        billing_mode TEXT NOT NULL DEFAULT 'included_in_statement',
        status TEXT NOT NULL DEFAULT 'active',
        early_settled_at TEXT,
        early_settled_amount REAL,
        note TEXT,
        created_at TEXT NOT NULL DEFAULT 'x',
        updated_at TEXT NOT NULL DEFAULT 'x'
      );
    `)
    setDb(db as unknown as D1Database)
    await clearFxCache()
    await db.exec(`
      INSERT INTO users (id, email, password_hash, role) VALUES
        ('u1', 'admin@example.com', 'hash', 'admin'),
        ('u2', 'member@example.com', 'hash', 'member');
      INSERT INTO banks (id, name) VALUES ('bank1', '招商银行');
      INSERT INTO card_products (id, bank_id, bank_name, card_name, currency, payment_due_type, payment_due_value)
      VALUES ('cp1', 'bank1', '招商银行', '经典白', 'CNY', 'after_billing', 20);
      INSERT INTO card_holders (id, created_by, managed_by, name, auth_user_id) VALUES
        ('h1', 'u1', 'u1', '管理员', 'u1'),
        ('h2', 'u1', 'u1', '成员', 'u2');
      INSERT INTO credit_accounts (id, holder_id, bank_id, bank_name, currency, statement_mode, quota_mode)
      VALUES ('acc1', 'h1', 'bank1', '招商银行', 'CNY', 'independent', 'independent'),
             ('acc2', 'h2', 'bank1', '招商银行', 'CNY', 'independent', 'independent');
      INSERT INTO credit_cards (id, holder_id, account_id, card_product_id, card_number_last4, billing_day, status)
      VALUES ('card1', 'h1', 'acc1', 'cp1', '1111', 10, 'active'),
             ('card2', 'h2', 'acc2', 'cp1', '2222', 10, 'active');
      INSERT INTO bills (id, card_id, bill_month, bill_amount, due_date, status)
      VALUES ('b1', 'card1', '2026-11', 1000, '2026-11-20', 'partial'),
             ('b2', 'card2', '2026-11', 500, '2026-11-22', 'unpaid');
      INSERT INTO payments (id, bill_id, amount, paid_at, idempotency_key)
      VALUES ('p1', 'b1', 400, '${TODAY}', 'k1');
      INSERT INTO bill_items (id, bill_id, transaction_date, description, merchant_name, category, amount, currency, item_type, source)
      VALUES ('i1', 'b1', '${TODAY}', ' =1+1', '星巴克', 'dining', 300, 'CNY', 'purchase', 'manual');
      INSERT INTO installment_plans (id, card_id, title, currency, principal_amount, total_periods, fee_mode, start_month, due_day, status)
      VALUES ('plan1', 'card1', 'iPhone 分期', 'CNY', 900, 3, 'interest_free', '2026-11', 20, 'active');
      INSERT INTO recurring_payables (id, created_by, name, category, amount, currency, due_day, holder_id, is_active)
      VALUES ('pay1', 'u1', '房租', 'rent', 3000, 'CNY', 18, 'h1', 1);
    `)
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
    await clearFxCache()
    db.close()
  })

  it('管理员导出 7 类表均返回表头与行', async () => {
    const tables = [
      'bills',
      'payments',
      'bill_items',
      'installments',
      'benefit_usages',
      'promo_usages',
      'opportunity_usages',
    ] as const

    for (const table of tables) {
      const result = await exportFamilyCsvRows(
        { scope: 'family', mode: 'monthly', period: '2026-11', table },
        'u1',
      )
      expect(result.headers.length, table).toBeGreaterThan(0)
      expect(result.filename, table).toContain('2026-11')
      expect(Array.isArray(result.rows), table).toBe(true)
    }

    const billRows = await exportFamilyCsvRows(
      { scope: 'family', mode: 'monthly', period: '2026-11', table: 'bills' },
      'u1',
    )
    expect(billRows.rows).toHaveLength(2)
    expect(billRows.rows[0]['账单月份']).toBe('2026-11')

    const paymentRows = await exportFamilyCsvRows(
      { scope: 'family', mode: 'monthly', period: '2026-11', table: 'payments' },
      'u1',
    )
    expect(paymentRows.rows[0]['还款金额']).toBe('400.00')
  })

  it('交易明细导出对公式注入做中和（描述 =1+1 变成文本）', async () => {
    const result = await exportFamilyCsvRows(
      { scope: 'family', mode: 'monthly', period: '2026-11', table: 'bill_items' },
      'u1',
    )
    // 服务端只负责结构化行；中和发生在 buildCsv（lib/export.ts），这里验证行原样传递
    expect(result.rows[0]['描述']).toBe(' =1+1')
    const csv = buildCsv(result.headers, result.rows)
    expect(csv).toContain("' =1+1")
    expect(csv).not.toContain('\n =1+1,')
  })

  it('statementReportToCsv 输出多段结构且金额按币种分列', async () => {
    const report = await getStatementReport(
      { scope: 'family', mode: 'monthly', period: '2026-11' },
      'u1',
    )
    const csv = statementReportToCsv(report as FamilyStatementReport)

    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(csv).toContain('# 分币种总览')
    expect(csv).toContain('# 持卡人小计')
    expect(csv).toContain('# 账单')
    expect(csv).toContain('# 还款')
    expect(csv).toContain('# 交易明细')
    expect(csv).toContain('# 分期计划')
    expect(csv).toContain('# 固定支出')
    expect(csv).toContain('# 消费分类汇总')
    expect(csv).toContain("' =1+1")
  })

  it('成员请求 scope=family 经 dispatchRpc 返回 403', async () => {
    const result = await dispatchRpc(
      'exports',
      'exportFamilyCsvRows',
      [{ scope: 'family', mode: 'monthly', period: '2026-11', table: 'bills' }],
      { id: 'u2', email: 'member@example.com', name: null, role: 'member', created_at: '' },
    )

    expect(result.ok).toBe(false)
    expect(result.status).toBe(403)
    expect(result.error).toContain('全家庭')
  })

  it('管理员请求 scope=family 正常返回（memberGuard 只对成员生效）', async () => {
    const result = await dispatchRpc(
      'exports',
      'exportFamilyCsvRows',
      [{ scope: 'family', mode: 'monthly', period: '2026-11', table: 'bills' }],
      { id: 'u1', email: 'admin@example.com', name: null, role: 'admin', created_at: '' },
    )

    expect(result.ok).toBe(true)
    const data = result.data as { rows: Record<string, string | number | null | undefined>[] }
    expect(data.rows).toHaveLength(2)
  })

  it('成员导出自己的持卡人数据成功，且看不到管理员的持卡人', async () => {
    const result = await dispatchRpc(
      'exports',
      'exportFamilyCsvRows',
      [{ scope: 'holder', holder_id: 'h2', mode: 'monthly', period: '2026-11', table: 'bills' }],
      { id: 'u2', email: 'member@example.com', name: null, role: 'member', created_at: '' },
    )

    expect(result.ok).toBe(true)
    const data = result.data as { rows: Record<string, string | number | null | undefined>[] }
    expect(data.rows).toHaveLength(1)
    expect(data.rows[0]['持卡人']).toBe('成员')
  })
})
