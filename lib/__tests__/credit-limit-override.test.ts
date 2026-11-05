import { describe, it, expect } from 'vitest'
import { getEffectiveCreditLimit, isCreditLimitManuallySet } from '../utils'
import { syncCreditLimitFromBill } from '../email-core/bills'
import { extractValidCreditLimit } from '../email-core/due-date'
import type { CreditCard } from '../types'

describe('信用额度字段与持久化规则', () => {
  describe('extractValidCreditLimit', () => {
    it('正数返回数字，0 / 负数 / null / 空值一律视为未获取 (null)', () => {
      expect(extractValidCreditLimit(50000)).toBe(50000)
      expect(extractValidCreditLimit('30000')).toBe(30000)
      expect(extractValidCreditLimit(0)).toBeNull()
      expect(extractValidCreditLimit('0')).toBeNull()
      expect(extractValidCreditLimit(-100)).toBeNull()
      expect(extractValidCreditLimit(null)).toBeNull()
      expect(extractValidCreditLimit(undefined)).toBeNull()
      expect(extractValidCreditLimit('')).toBeNull()
      expect(extractValidCreditLimit('NaN')).toBeNull()
    })
  })

  describe('getEffectiveCreditLimit 与 isCreditLimitManuallySet', () => {
    it('未获取时（credit_limit 为 0 且无 override）返回 null，绝不伪装为 0', () => {
      const card: Pick<CreditCard, 'credit_limit' | 'credit_limit_override'> = {
        credit_limit: 0,
        credit_limit_override: null,
      }
      expect(getEffectiveCreditLimit(card)).toBeNull()
      expect(isCreditLimitManuallySet(card)).toBe(false)
    })

    it('邮件或建卡回填正数 credit_limit 时，生效额度为该值，未标记手动设置', () => {
      const card: Pick<CreditCard, 'credit_limit' | 'credit_limit_override'> = {
        credit_limit: 20000,
        credit_limit_override: null,
      }
      expect(getEffectiveCreditLimit(card)).toBe(20000)
      expect(isCreditLimitManuallySet(card)).toBe(false)
    })

    it('用户手动输入 credit_limit_override 时，优先级最高且标记已手动设置', () => {
      const card: Pick<CreditCard, 'credit_limit' | 'credit_limit_override'> = {
        credit_limit: 20000,
        credit_limit_override: 60000,
      }
      expect(getEffectiveCreditLimit(card)).toBe(60000)
      expect(isCreditLimitManuallySet(card)).toBe(true)
    })

    it('手动覆盖设为 0 或非法值时，回落至 credit_limit 或 null', () => {
      const cardWithFallback: Pick<CreditCard, 'credit_limit' | 'credit_limit_override'> = {
        credit_limit: 15000,
        credit_limit_override: 0,
      }
      expect(getEffectiveCreditLimit(cardWithFallback)).toBe(15000)
      expect(isCreditLimitManuallySet(cardWithFallback)).toBe(false)

      const cardUnacquired: Pick<CreditCard, 'credit_limit' | 'credit_limit_override'> = {
        credit_limit: 0,
        credit_limit_override: 0,
      }
      expect(getEffectiveCreditLimit(cardUnacquired)).toBeNull()
      expect(isCreditLimitManuallySet(cardUnacquired)).toBe(false)
    })
  })

  describe('syncCreditLimitFromBill (邮件同步信用额度)', () => {
    // 模拟轻量 D1 prepare/bind/first/run 行为
    function createMockDb(initialCard: { credit_limit: number | null; credit_limit_override?: number | null }) {
      const card = { ...initialCard }
      let updatedLimit: number | null = null

      const db = {
        prepare: (sql: string) => ({
          bind: (...args: unknown[]) => ({
            first: async <T>() => {
              if (sql.includes('SELECT credit_limit')) {
                return card as T
              }
              return null as T
            },
            run: async () => {
              if (sql.includes('UPDATE credit_cards SET credit_limit')) {
                updatedLimit = Number(args[0])
                card.credit_limit = updatedLimit
              }
              return { success: true }
            },
          }),
        }),
        getCard: () => card,
        getUpdatedLimit: () => updatedLimit,
      }
      return db
    }

    it('卡片当前为未获取（0 且无 override）时，邮件包含确切额度则更新回填', async () => {
      const mock = createMockDb({ credit_limit: 0, credit_limit_override: null })
      const changed = await syncCreditLimitFromBill(mock as unknown as D1Database, 'c1', {
        is_bill: true,
        credit_limit: 80000,
      })
      expect(changed).toBe(true)
      expect(mock.getUpdatedLimit()).toBe(80000)
    })

    it('卡片已有用户手动设置（credit_limit_override）时，邮件同步绝不覆盖', async () => {
      const mock = createMockDb({ credit_limit: 50000, credit_limit_override: 50000 })
      const changed = await syncCreditLimitFromBill(mock as unknown as D1Database, 'c1', {
        is_bill: true,
        credit_limit: 100000,
      })
      expect(changed).toBe(false)
      expect(mock.getUpdatedLimit()).toBeNull()
      expect(mock.getCard().credit_limit).toBe(50000)
    })

    it('卡片已有已获取额度时，邮件同步不随意覆盖', async () => {
      const mock = createMockDb({ credit_limit: 30000, credit_limit_override: null })
      const changed = await syncCreditLimitFromBill(mock as unknown as D1Database, 'c1', {
        is_bill: true,
        credit_limit: 50000,
      })
      expect(changed).toBe(false)
      expect(mock.getUpdatedLimit()).toBeNull()
    })

    it('邮件中额度为 0、缺失或非正数时，不触碰卡片', async () => {
      const mock = createMockDb({ credit_limit: 0, credit_limit_override: null })
      const changed = await syncCreditLimitFromBill(mock as unknown as D1Database, 'c1', {
        is_bill: true,
        credit_limit: 0,
      })
      expect(changed).toBe(false)
      expect(mock.getUpdatedLimit()).toBeNull()
    })

    it('card 具备 credit_limit_override 时 getEffectiveCreditLimit 正确生效且保存时能保留', () => {
      const cardFromLoader: Pick<CreditCard, 'credit_limit' | 'credit_limit_override'> = {
        credit_limit: 10000,
        credit_limit_override: 30000,
      }
      expect(getEffectiveCreditLimit(cardFromLoader)).toBe(30000)
    })
  })
})
