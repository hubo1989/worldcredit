import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { POST as pullHandler } from '../../app/api/sync/pull/route'
import { setDb, setWorkerEnv } from '../db/client'
import { createSessionValue } from '../session'
import { RpcDomainError } from '../api/errors'
import {
  PAYABLE_CATEGORIES,
  categoryLabel,
  dedupeCustomCategories,
  payableCycleLabel,
} from '../api/payables.shared'
import {
  createRecurringPayable,
  deleteRecurringPayable,
  getPayableCustomCategories,
  getRecurringPayables,
  payRecurringPayable,
  savePayableCustomCategory,
  updateRecurringPayable,
} from '../api/payables.server'
import {
  nextPayableDueDate,
  nextPayablePeriodOf,
  payableDueDate,
  payablePeriodOf,
  payableToSortCard,
} from '../utils'
import {
  SQLITE_D1_MIGRATIONS_DIR,
  createOpportunityDb,
  createSqliteD1,
  type SqliteD1,
} from './helpers/sqlite-d1'

const fmt = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

describe('payable cycles (monthly / every_n_months / yearly) & custom categories', () => {
  const openDbs: SqliteD1[] = []

  beforeAll(() => {
    setWorkerEnv({ SESSION_SECRET: 'test-payable-cycles-secret-at-least-16-chars' })
  })

  afterEach(() => {
    for (const db of openDbs.splice(0)) db.close()
  })

  function mountDb(): SqliteD1 {
    const db = createOpportunityDb()
    openDbs.push(db)
    db.exec(`
      INSERT INTO users (id, email, password_hash) VALUES
        ('u1', 'u1@example.com', 'hash'),
        ('u2', 'u2@example.com', 'hash');
    `)
    setDb(db as unknown as D1Database)
    return db
  }

  describe('0030 迁移对旧版「每月」数据的无损兼容', () => {
    it('先跑 0001..0029 写入旧数据，再执行 0030：旧记录默认 monthly 且状态/还款不变', async () => {
      const db = createSqliteD1()
      openDbs.push(db)
      const files = readdirSync(SQLITE_D1_MIGRATIONS_DIR)
        .filter(f => f.endsWith('.sql'))
        .sort()
      const migration0030 = files.find(f => f.startsWith('0030_'))
      expect(migration0030).toBe('0030_payable_cycles_and_custom_categories.sql')

      for (const file of files) {
        if (file >= migration0030!) break
        db.exec(readFileSync(join(SQLITE_D1_MIGRATIONS_DIR, file), 'utf8'))
      }

      db.exec(`
        INSERT INTO users (id, email, password_hash) VALUES ('u-legacy', 'legacy@example.com', 'hash');
        INSERT INTO recurring_payables (id, created_by, name, category, amount, currency, due_day, bank_name, bank_account)
        VALUES
          ('leg-rent', 'u-legacy', '深圳房租', 'rent', 4500, 'CNY', 15, '招商银行', '62258800'),
          ('leg-eur', 'u-legacy', '德国服务器', 'utility', 29.9, 'EUR', 28, NULL, NULL);
        INSERT INTO recurring_payable_payments (id, payable_id, period, amount, paid_at)
        VALUES ('pay-1', 'leg-rent', '2026-10', 4500, '2026-10-14');
      `)

      db.exec(readFileSync(join(SQLITE_D1_MIGRATIONS_DIR, migration0030!), 'utf8'))
      setDb(db as unknown as D1Database)

      const list = await getRecurringPayables('u-legacy', new Date(2026, 9, 16))
      expect(list).toHaveLength(2)

      const rent = list.find(p => p.id === 'leg-rent')!
      expect(rent).toMatchObject({
        name: '深圳房租',
        category: 'rent',
        custom_category: null,
        cycle_type: 'monthly',
        cycle_months: 1,
        due_month: null,
        anchor_period: null,
        due_day: 15,
        period: '2026-10',
        due_date: '2026-10-15',
        paid_amount: 4500,
        status: 'paid',
      })

      const eur = list.find(p => p.id === 'leg-eur')!
      expect(eur).toMatchObject({
        currency: 'EUR',
        cycle_type: 'monthly',
        cycle_months: 1,
        period: '2026-10',
        due_date: '2026-10-28',
        status: 'unpaid',
      })

      // D1 SQLite CHECK 约束兜底拦截非法周期字段
      expect(() =>
        db.exec(
          "INSERT INTO recurring_payables (id,created_by,name,amount,due_day,cycle_type) VALUES ('bad1','u-legacy','x',10,5,'weekly')"
        )
      ).toThrow()
      expect(() =>
        db.exec(
          "INSERT INTO recurring_payables (id,created_by,name,amount,due_day,cycle_type,cycle_months) VALUES ('bad2','u-legacy','x',10,5,'every_n_months',0)"
        )
      ).toThrow()
      expect(() =>
        db.exec(
          "INSERT INTO recurring_payables (id,created_by,name,amount,due_day,cycle_type,due_month) VALUES ('bad3','u-legacy','x',10,5,'yearly',13)"
        )
      ).toThrow()
    })
  })

  describe('三种周期（每月 / 每 X 月 / 每年）校验与下一次推导', () => {
    it('每 X 月：严格校验 X 为合理整数（2–60），拒绝 0/负数/1/小数/超大值', async () => {
      mountDb()

      for (const bad of [0, -1, -6, 1, 1.5, 3.2, Number.NaN, 61, 999, null, undefined, '3' as never]) {
        await expect(
          createRecurringPayable({
            created_by: 'u1',
            name: '季度物业',
            category: 'utility',
            amount: 900,
            currency: 'CNY',
            cycle_type: 'every_n_months',
            cycle_months: bad as number,
            due_day: 10,
          }),
          `cycle_months=${String(bad)} 应被拒绝`
        ).rejects.toMatchObject({
          name: 'RpcDomainError',
          code: 'VALIDATION_FAILED',
          status: 400,
        })
      }

      const valid = await createRecurringPayable(
        {
          created_by: 'u1',
          name: '押一付三房租',
          category: 'rent',
          amount: 12000,
          currency: 'CNY',
          cycle_type: 'every_n_months',
          cycle_months: 3,
          due_day: 15,
          anchor_period: '2026-10',
        },
        new Date(2026, 9, 5)
      )
      expect(valid).toMatchObject({
        cycle_type: 'every_n_months',
        cycle_months: 3,
        anchor_period: '2026-10',
        period: '2026-10',
        due_date: '2026-10-15',
        status: 'unpaid',
      })
      expect(payableCycleLabel(valid)).toBe('每 3 个月 · 15 日')
    })

    it('每 X 月：未付跨月保持原账期并标逾期，付清后按 +X 月推导下期并遵守 30 天滚动窗口', async () => {
      mountDb()

      const created = await createRecurringPayable(
        {
          created_by: 'u1',
          name: '季度宽带',
          category: 'utility',
          amount: 600,
          currency: 'CNY',
          cycle_type: 'every_n_months',
          cycle_months: 3,
          due_day: 15,
          anchor_period: '2026-10',
        },
        new Date(2026, 9, 5)
      )

      // 到了 11 月仍未付 10 月那期：必须保留 2026-10 逾期，绝不跳到 11 月或 1 月掩盖逾期
      const novUnpaid = (await getRecurringPayables('u1', new Date(2026, 10, 10)))[0]
      expect(novUnpaid.period).toBe('2026-10')
      expect(novUnpaid.due_date).toBe('2026-10-15')
      expect(novUnpaid.status).toBe('overdue')
      expect(novUnpaid.days_until_due).toBe(-26)

      // 补登记还款：写进 2026-10，距下期 2027-01-15 还有 66 天 >= 30，保持 paid 待出账
      const paid = await payRecurringPayable(created.id, 600, 'Q4 宽带', new Date(2026, 10, 10))
      expect(paid.period).toBe('2026-10')
      expect(paid.status).toBe('paid')

      // 12 月 20 日：距下期 2027-01-15 剩 26 天 < 30，自动滚动到 2027-01 待还款
      const decWindow = (await getRecurringPayables('u1', new Date(2026, 11, 20)))[0]
      expect(decWindow.period).toBe('2027-01')
      expect(decWindow.due_date).toBe('2027-01-15')
      expect(decWindow.status).toBe('unpaid')
      expect(decWindow.paid_amount).toBe(0)

      // 短月月末收拢：2025-11 的 31 日 + 3 个月 → 2026-02-28
      expect(
        fmt(
          nextPayableDueDate(31, '2025-11', {
            cycle_type: 'every_n_months',
            cycle_months: 3,
          })
        )
      ).toBe('2026-02-28')
    })

    it('每年：校验月份 1–12，按同月同日推导下一次（含闰年 2 月 29 日与新建已过月跨年锚定）', async () => {
      mountDb()

      for (const badMonth of [0, 13, -1, 6.5, null, undefined]) {
        await expect(
          createRecurringPayable({
            created_by: 'u1',
            name: '重疾险',
            category: 'insurance',
            amount: 8000,
            currency: 'HKD',
            cycle_type: 'yearly',
            due_month: badMonth as number,
            due_day: 20,
          })
        ).rejects.toBeInstanceOf(RpcDomainError)
      }

      // 11 月 4 日新建每年 3 月 15 日的保险：今年 3-15 已过，首期自动定在明年同月同日 2027-03-15
      const futureYearly = await createRecurringPayable(
        {
          created_by: 'u1',
          name: '车险续保',
          category: 'insurance',
          amount: 4200,
          currency: 'CNY',
          cycle_type: 'yearly',
          due_month: 3,
          due_day: 15,
        },
        new Date(2026, 10, 4)
      )
      expect(futureYearly.period).toBe('2027-03')
      expect(futureYearly.due_date).toBe('2027-03-15')
      expect(futureYearly.status).toBe('unpaid')
      expect(payableCycleLabel(futureYearly)).toBe('每年 3 月 15 日')

      // 6 月 1 日新建每年 6 月 18 日的年费：当年尚未到期，首期为 2026-06-18
      const thisYear = await createRecurringPayable(
        {
          created_by: 'u1',
          name: '云服务器年付',
          category: 'utility',
          amount: 199,
          currency: 'USD',
          cycle_type: 'yearly',
          due_month: 6,
          due_day: 18,
        },
        new Date(2026, 5, 1)
      )
      expect(thisYear.period).toBe('2026-06')
      expect(thisYear.due_date).toBe('2026-06-18')

      // 登记付款后，下一次严格推导到 2027-06-18（同月同日）
      await payRecurringPayable(thisYear.id, 199, '2026 年费', new Date(2026, 5, 18))
      const afterPaid = (await getRecurringPayables('u1', new Date(2026, 10, 4))).find(
        p => p.id === thisYear.id
      )!
      expect(afterPaid.status).toBe('paid')
      expect(afterPaid.period).toBe('2026-06')
      expect(nextPayablePeriodOf(afterPaid.period, afterPaid)).toBe('2027-06')
      expect(fmt(nextPayableDueDate(afterPaid.due_day, afterPaid.period, afterPaid))).toBe(
        '2027-06-18'
      )

      // 到 2027-05-25（距 2027-06-18 仅 24 天 < 30），滚动到 2027-06 待还款
      const nextYearWindow = (await getRecurringPayables('u1', new Date(2027, 4, 25))).find(
        p => p.id === thisYear.id
      )!
      expect(nextYearWindow.period).toBe('2027-06')
      expect(nextYearWindow.due_date).toBe('2027-06-18')
      expect(nextYearWindow.status).toBe('unpaid')

      // 闰年 2 月 29 日：2028-02-29 → 2029-02-28 → ... → 2032-02-29
      const leapSpec = { cycle_type: 'yearly' as const, due_month: 2, due_day: 29, anchor_period: '2028-02' }
      expect(fmt(payableDueDate(29, payablePeriodOf(new Date(2028, 1, 1), leapSpec)))).toBe('2028-02-29')
      expect(fmt(nextPayableDueDate(29, '2028-02', leapSpec))).toBe('2029-02-28')
      expect(fmt(nextPayableDueDate(29, '2031-02', leapSpec))).toBe('2032-02-29')

      // 排序卡适配同样按真实周期算 nextDueDate
      const sortCard = payableToSortCard(afterPaid)
      expect(fmt(new Date(sortCard.nextDueDate))).toBe('2027-06-18')
    })

    it('编辑切换周期时清理旧周期专属字段，不留脏状态', async () => {
      mountDb()
      const created = await createRecurringPayable(
        {
          created_by: 'u1',
          name: '会员费',
          category: 'other',
          amount: 300,
          currency: 'CNY',
          cycle_type: 'every_n_months',
          cycle_months: 6,
          due_day: 10,
          anchor_period: '2026-08',
        },
        new Date(2026, 7, 1)
      )

      const toYearly = await updateRecurringPayable(
        created.id,
        { cycle_type: 'yearly', due_month: 12, due_day: 25 },
        new Date(2026, 10, 4)
      )
      expect(toYearly).toMatchObject({
        cycle_type: 'yearly',
        cycle_months: 12,
        due_month: 12,
        due_day: 25,
        anchor_period: '2026-12',
      })

      const backToMonthly = await updateRecurringPayable(
        created.id,
        { cycle_type: 'monthly', due_day: 8 },
        new Date(2026, 10, 4)
      )
      expect(backToMonthly).toMatchObject({
        cycle_type: 'monthly',
        cycle_months: 1,
        due_month: null,
        anchor_period: null,
        due_day: 8,
      })
    })
  })

  describe('自定义分类：保存、去重、持久化、下次可选与预设/iOS 兼容', () => {
    it('保存新自定义分类后去重持久化，删除原支出后下次仍可选，且 category 保持 iOS 兼容枚举 other', async () => {
      mountDb()

      expect(PAYABLE_CATEGORIES.map(c => c.value)).toEqual([
        'rent',
        'loan',
        'utility',
        'insurance',
        'other',
      ])

      const created = await createRecurringPayable({
        created_by: 'u1',
        name: '电信千兆宽带',
        category: 'other',
        custom_category: '  宽带网络  ',
        amount: 199,
        currency: 'CNY',
        due_day: 1,
      })
      // category 必须保持 5 个预设枚举之一（other），不破坏旧版 iOS PayableCategory 解码
      expect(created.category).toBe('other')
      expect(created.custom_category).toBe('宽带网络')
      expect(categoryLabel(created.category, created.custom_category)).toBe('宽带网络')

      // 大小写与多余空白重复提交：去重不重复入库，统一复用首次保存的展示写法
      await savePayableCustomCategory('u1', 'iCloud 订阅')
      const second = await createRecurringPayable({
        created_by: 'u1',
        name: '苹果云空间',
        category: 'other',
        custom_category: '  icloud   订阅 ',
        amount: 68,
        currency: 'CNY',
        due_day: 12,
      })
      expect(second.custom_category).toBe('iCloud 订阅')

      // 输入预设分类同名值（如「房租」或「LOAN」）：自动归一到预设分类，不污染自定义词典
      const matchedPreset = await createRecurringPayable({
        created_by: 'u1',
        name: '新公寓',
        category: 'other',
        custom_category: ' 房租 ',
        amount: 5000,
        currency: 'CNY',
        due_day: 5,
      })
      expect(matchedPreset.category).toBe('rent')
      expect(matchedPreset.custom_category).toBeNull()

      expect(await getPayableCustomCategories('u1')).toEqual(['宽带网络', 'iCloud 订阅'])
      // 用户隔离：u2 看不到 u1 的自定义分类
      expect(await getPayableCustomCategories('u2')).toEqual([])

      // 删除使用该分类的固定支出后，持久化的自定义分类依然保留供下次选择
      await deleteRecurringPayable(created.id)
      await deleteRecurringPayable(second.id)
      expect(await getPayableCustomCategories('u1')).toEqual(['宽带网络', 'iCloud 订阅'])

      // 纯函数去重契约
      expect(
        dedupeCustomCategories([' 宽带 ', '宽带', '房租', 'rent', 'iCloud', 'ICLOUD', ''])
      ).toEqual(['宽带', 'iCloud'])
    })

    it('拒绝空串或超长自定义分类名称', async () => {
      mountDb()
      await expect(savePayableCustomCategory('u1', '   ')).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        status: 400,
      })
      await expect(savePayableCustomCategory('u1', '分'.repeat(31))).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        status: 400,
      })
    })
  })

  describe('sync/pull 增量同步与旧客户端忽略新字段兼容', () => {
    it('下发新增周期列与自定义分类表变更，且严格旧客户端解码器忽略未知字段/表不会崩溃', async () => {
      mountDb()

      const payable = await createRecurringPayable(
        {
          created_by: 'u1',
          name: '香港保单',
          category: 'other',
          custom_category: '跨境医疗险',
          amount: 1500,
          currency: 'HKD',
          cycle_type: 'yearly',
          due_month: 9,
          due_day: 20,
        },
        new Date(2026, 8, 1)
      )

      const token = await createSessionValue({
        id: 'u1',
        email: 'u1@example.com',
        name: 'u1',
        role: 'admin',
        created_at: '2026-10-01T00:00:00Z',
      })

      const res = await pullHandler(
        new Request('https://app.all-bill.com/api/sync/pull', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: JSON.stringify({ cursor: 0 }),
        })
      )
      expect(res.status).toBe(200)
      const payload = (await res.json()) as {
        cursor: number
        has_more: boolean
        changes: Array<{ tbl: string; row_id: string; op: string; row?: Record<string, unknown> }>
      }

      const payableChange = payload.changes.find(
        c => c.tbl === 'recurring_payables' && c.row_id === payable.id
      )
      expect(payableChange).toMatchObject({
        tbl: 'recurring_payables',
        row_id: payable.id,
        op: 'upsert',
        row: {
          id: payable.id,
          category: 'other',
          custom_category: '跨境医疗险',
          cycle_type: 'yearly',
          cycle_months: 12,
          due_month: 9,
          due_day: 20,
          anchor_period: '2026-09',
        },
      })

      const customCatChange = payload.changes.find(c => c.tbl === 'payable_custom_categories')
      expect(customCatChange).toMatchObject({
        tbl: 'payable_custom_categories',
        op: 'upsert',
        row: {
          user_id: 'u1',
          name: '跨境医疗险',
          normalized_name: '跨境医疗险',
        },
      })

      // 模拟旧客户端（旧版 iOS SyncEngine + PayableItem 严格枚举解码器）：
      // 1) SyncEngine 跳过未知表 payable_custom_categories，不抛错且正常推进 cursor；
      // 2) RPC / 已知表解码器只识别旧字段，要求 category 属于 5 枚举、due_day 属于 1..31、status 属于 3 枚举。
      const legacySupportedCategories = new Set(['rent', 'loan', 'utility', 'insurance', 'other'])
      const legacySupportedStatuses = new Set(['unpaid', 'paid', 'overdue'])

      for (const change of payload.changes) {
        if (change.tbl === 'recurring_payables' && change.op === 'upsert') {
          const r = change.row!
          expect(typeof r.id).toBe('string')
          expect(legacySupportedCategories.has(String(r.category))).toBe(true)
          expect(Number.isInteger(r.due_day) && Number(r.due_day) >= 1 && Number(r.due_day) <= 31).toBe(
            true
          )
        }
      }

      const rpcItems = await getRecurringPayables('u1', new Date(2026, 8, 1))
      for (const item of rpcItems) {
        expect(legacySupportedCategories.has(item.category)).toBe(true)
        expect(legacySupportedStatuses.has(item.status)).toBe(true)
        expect(item.due_day).toBeGreaterThanOrEqual(1)
        expect(item.due_day).toBeLessThanOrEqual(31)
      }

      // 另一用户 u2 reconcile u1 的自定义分类返回 delete，严防越权读取
      const tokenU2 = await createSessionValue({
        id: 'u2',
        email: 'u2@example.com',
        name: 'u2',
        role: 'member',
        created_at: '2026-10-01T00:00:00Z',
      })
      const reconcileRes = await pullHandler(
        new Request('https://app.all-bill.com/api/sync/pull', {
          method: 'POST',
          headers: { Authorization: `Bearer ${tokenU2}` },
          body: JSON.stringify({
            cursor: payload.cursor,
            reconcile: [{ tbl: 'payable_custom_categories', row_id: customCatChange!.row_id }],
          }),
        })
      )
      expect(reconcileRes.status).toBe(200)
      const reconcileData = (await reconcileRes.json()) as {
        changes: Array<{ tbl: string; row_id: string; op: string; row?: unknown }>
      }
      expect(reconcileData.changes).toEqual([
        {
          tbl: 'payable_custom_categories',
          row_id: customCatChange!.row_id,
          op: 'delete',
        },
      ])
    })
  })
})
