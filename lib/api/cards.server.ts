import { query, queryOne, execute, batch, uuid, now } from '../db'
import type { CardProduct, CreditCard, CardHolder, Bill, Benefit, BenefitUsage, CardDueDateResolution } from '@/lib/types'
import { normalizeAliases } from '../utils'
import { legacyBenefitPeriodStart } from './benefits.server'
import { localDateInZone } from '../opportunities/dates'
import type { OpportunityActor } from '../opportunities/types'
import type { OpportunityDto } from '../opportunities/queries.server'
import { getCardOpportunities } from '../opportunities/queries.server'
import {
  loadCardDueDateResolution,
  buildDueDateReasonReport,
  type DueDateReasonReport,
  type CardForDueDateSummary,
  type BillForDueDateSummary,
  type GmailSyncMessageLite,
  type BillImportDraftLite,
} from '../due-date-summary'
import type { EmailParseLog } from '../types'

export type CreditCardWithProduct = CreditCard & {
  card_product?: CardProduct
  bank_name?: string
  card_name?: string
}

interface CardJoinRow {
  id: string
  holder_id: string
  account_id: string | null
  card_product_id: string
  card_number_last4: string | null
  credit_limit: number
  credit_limit_override: number | null
  billing_day: number
  status: string
  card_type: string
  loan_due_day: number | null
  override_billing_day: number | null
  override_due_type: string | null
  override_due_value: number | null
  issued_on: string | null
  activated_on: string | null
  name_override: string | null
  annual_fee_override: number | null
  created_at: string
  // product fields
  p_id: string | null
  p_country: string | null
  p_bank_id: string | null
  p_bank_name: string | null
  p_card_name: string | null
  p_currency: string | null
  p_payment_due_type: string | null
  p_payment_due_value: number | null
  p_annual_fee: number | null
  p_annual_fee_waiver: string | null
  p_is_active: number | null
  p_created_at: string | null
}

function joinRowToCard(row: CardJoinRow): CreditCardWithProduct {
  const card: CreditCardWithProduct = {
    id: row.id,
    holder_id: row.holder_id,
    account_id: row.account_id || undefined,
    card_product_id: row.card_product_id,
    card_number_last4: row.card_number_last4 || undefined,
    credit_limit: row.credit_limit,
    credit_limit_override: row.credit_limit_override != null ? Number(row.credit_limit_override) : undefined,
    billing_day: row.billing_day,
    status: row.status as CreditCard['status'],
    card_type: row.card_type as CreditCard['card_type'],
    loan_due_day: row.loan_due_day || undefined,
    override_billing_day: row.override_billing_day || undefined,
    override_due_type: row.override_due_type as CreditCard['override_due_type'],
    override_due_value: row.override_due_value || undefined,
    name_override: row.name_override || undefined,
    annual_fee_override: row.annual_fee_override != null ? row.annual_fee_override : undefined,
    issued_on: row.issued_on ?? null,
    activated_on: row.activated_on ?? null,
    created_at: row.created_at,
  }
  if (row.p_id) {
    card.card_product = {
      id: row.p_id,
      country: row.p_country || 'CN',
      bank_id: row.p_bank_id || undefined,
      bank_name: row.p_bank_name || '',
      card_name: row.p_card_name || '',
      currency: row.p_currency || 'CNY',
      payment_due_type: (row.p_payment_due_type || 'after_billing') as CardProduct['payment_due_type'],
      payment_due_value: row.p_payment_due_value || 20,
      annual_fee: row.p_annual_fee || 0,
      annual_fee_waiver: row.p_annual_fee_waiver || undefined,
      is_active: row.p_is_active === 1,
      created_at: row.p_created_at || row.created_at,
    }
    card.bank_name = card.card_product.bank_name
    card.card_name = card.name_override || card.card_product.card_name
  }
  return card
}

const CARD_SELECT = `cc.id, cc.holder_id, cc.account_id, cc.card_product_id, cc.card_number_last4, cc.credit_limit, cc.credit_limit_override,
  cc.billing_day, cc.status, cc.card_type, cc.loan_due_day, cc.override_billing_day,
  cc.override_due_type, cc.override_due_value, cc.name_override, cc.annual_fee_override, cc.created_at,
  cc.issued_on, cc.activated_on,
  cp.id AS p_id, cp.country AS p_country, cp.bank_id AS p_bank_id, cp.bank_name AS p_bank_name,
  cp.card_name AS p_card_name, cp.currency AS p_currency, cp.payment_due_type AS p_payment_due_type,
  cp.payment_due_value AS p_payment_due_value, cp.annual_fee AS p_annual_fee,
  cp.annual_fee_waiver AS p_annual_fee_waiver, cp.is_active AS p_is_active, cp.created_at AS p_created_at
FROM credit_cards cc LEFT JOIN card_products cp ON cc.card_product_id = cp.id`

export async function getCardProducts(): Promise<CardProduct[]> {
  const { data, error } = await query<Record<string, unknown>>(
    'SELECT * FROM card_products WHERE is_active = 1 ORDER BY bank_name ASC'
  )
  if (error) throw new Error(error.message)
  return (data || []).map(p => ({ ...(p as unknown as CardProduct), is_active: p.is_active === 1 }))
}

export async function getCardHolders(): Promise<CardHolder[]> {
  const { data, error } = await query<CardHolder>(
    'SELECT * FROM card_holders ORDER BY created_at ASC'
  )
  if (error) throw new Error(error.message)
  // D1 把 aliases 存成 TEXT，读回来是 JSON 字符串；与 holders.server.ts 同样在读取边界归一化
  return (data || []).map(row => ({ ...row, aliases: normalizeAliases(row.aliases) }))
}

/** Light-weight card list (id + holder) used by the dashboard filter chips. */
export async function getCardsBasicByHolders(
  holderIds: string[]
): Promise<Array<{ id: string; holder_id: string }>> {
  if (!holderIds || holderIds.length === 0) return []
  const placeholders = holderIds.map(() => '?').join(',')
  const { data, error } = await query<{ id: string; holder_id: string }>(
    `SELECT id, holder_id FROM credit_cards WHERE holder_id IN (${placeholders})`,
    holderIds
  )
  if (error) throw new Error(error.message)
  return data || []
}

/** All cards joined with their product, for bill entry forms. */
export async function getAllCardsWithProduct(): Promise<CreditCardWithProduct[]> {
  const { data, error } = await query<CardJoinRow>(
    `SELECT ${CARD_SELECT} ORDER BY cc.created_at DESC`
  )
  if (error) throw new Error(error.message)
  return (data || []).map(joinRowToCard)
}

export interface CardDetailBill extends Bill {
  paid_amount: number
  computed_status: Bill['status']
}

export interface CardDetailBenefit extends Benefit {
  used: number
}

export interface CardDetail {
  card: CreditCardWithProduct & {
    card_holder?: CardHolder
  }
  bills: CardDetailBill[]
  benefits: CardDetailBenefit[]
  /** 统一机会 DTO（Task 11）：默认最多 3 条，完整列表走机会页。 */
  opportunities: OpportunityDto[]
  /** 还款日确切性与四类缺失原因解析（严格区分，绝不编造日期） */
  dueDateResolution?: CardDueDateResolution
}

function computeBillStatus(billAmount: number, paid: number, dueDate: string): Bill['status'] {
  const amount = Number(billAmount) || 0
  if (amount <= 0 || paid >= amount) return 'paid'
  if (paid > 0) return 'partial'
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const due = new Date(dueDate)
  due.setHours(0, 0, 0, 0)
  return due.getTime() < today.getTime() ? 'overdue' : 'unpaid'
}

/** Card detail page aggregate: card + product + holder, recent bills with
 *  payment totals, and per-period benefit usage counts. */
export async function getCardDetail(
  actor: OpportunityActor,
  cardId: string,
  nowOnParam?: string,
): Promise<CardDetail> {
  const base = await getCardById(cardId)
  if (!base) throw new Error('卡片不存在')

  const card: CardDetail['card'] = { ...base }
  if (base.holder_id) {
    const { data: holderRow, error } = await queryOne<CardHolder>(
      'SELECT * FROM card_holders WHERE id = ?',
      [base.holder_id]
    )
    if (!error && holderRow) card.card_holder = holderRow
  }

  const { data: billRows, error: billsError } = await query<Bill>(
    // 手填金额优先：SQL 层直接归一化，避免下游各自合成时漏掉一处
    `SELECT id, card_id, bill_month, statement_start, statement_end, statement_date,
            COALESCE(bill_amount_override, bill_amount) AS bill_amount,
            bill_amount_override, min_payment, due_date, status, created_at
     FROM bills WHERE card_id = ? ORDER BY due_date DESC LIMIT 3`,
    [cardId]
  )
  if (billsError) throw new Error(billsError.message)
  const bills = billRows || []
  const billIds = bills.map(b => b.id)
  let paidByBill = new Map<string, number>()
  if (billIds.length > 0) {
    const placeholders = billIds.map(() => '?').join(',')
    const { data: payRows, error: payError } = await query<{ bill_id: string; amount: number }>(
      `SELECT bill_id, amount FROM payments WHERE bill_id IN (${placeholders})`,
      billIds
    )
    if (payError) throw new Error(payError.message)
    paidByBill = new Map<string, number>()
    for (const p of payRows || []) {
      paidByBill.set(p.bill_id, (paidByBill.get(p.bill_id) || 0) + Number(p.amount || 0))
    }
  }
  const billList: CardDetailBill[] = bills.map(b => {
    const paid = paidByBill.get(b.id) || 0
    return {
      ...b,
      paid_amount: paid,
      computed_status: computeBillStatus(Number(b.bill_amount) || 0, paid, b.due_date),
    }
  })

  const benefits: CardDetailBenefit[] = []
  if (base.card_product_id) {
    const { data: benefitRows, error: benError } = await query<Benefit>(
      'SELECT * FROM benefits WHERE card_product_id = ?',
      [base.card_product_id]
    )
    if (benError) throw new Error(benError.message)
    const bs = benefitRows || []
    if (bs.length > 0) {
      const ids = bs.map(b => b.id)
      const placeholders = ids.map(() => '?').join(',')
      const { data: usageRows, error: usageError } = await query<Pick<BenefitUsage, 'benefit_id' | 'used_at'>>(
        `SELECT benefit_id, used_at FROM benefit_usages WHERE benefit_id IN (${placeholders})`,
        ids
      )
      if (usageError) throw new Error(usageError.message)
      const allUsages = usageRows || []
      // 统一周期口径：与权益列表相同的 [period_start_on, today] 区间。
      // 原实现用主机本地时区的 getMonth() 比较（Workers 上是 UTC，月初会
      // 误算上月），现在用规则时区的 civil date。nowOn 可注入供测试。
      const nowOn = nowOnParam ?? localDateInZone(new Date(), 'Asia/Shanghai')
      for (const b of bs) {
        const periodStart = legacyBenefitPeriodStart(b, nowOn)
        const periodUsages = allUsages.filter(u => {
          if (u.benefit_id !== b.id) return false
          if (!u.used_at) return false
          if (periodStart === null) return true // one_time: all usages count
          return u.used_at >= periodStart && u.used_at <= nowOn
        })
        benefits.push({ ...b, used: periodUsages.length })
      }
    }
  }

  // 可用机会（Task 11）：同一 DTO/可用性服务，最多 3 条；失败不阻塞卡详情
  let opportunities: OpportunityDto[]
  try {
    opportunities = await getCardOpportunities(
      actor,
      cardId,
      3,
      nowOnParam ? { now: `${nowOnParam}T12:00:00Z` } : {},
    )
  } catch {
    opportunities = []
  }

  let dueDateResolution: CardDueDateResolution | undefined
  try {
    dueDateResolution = await loadCardDueDateResolution(card)
  } catch (err) {
    console.error('加载卡片还款日解析失败:', err)
  }

  return { card, bills: billList, benefits, opportunities, dueDateResolution }
}

export async function getCardsByHolder(holderId: string): Promise<CreditCardWithProduct[]> {
  const { data, error } = await query<CardJoinRow>(
    `SELECT ${CARD_SELECT} WHERE cc.holder_id = ? ORDER BY cc.created_at DESC`,
    [holderId]
  )
  if (error) throw new Error(error.message)
  return (data || []).map(joinRowToCard)
}

export type CreateCardInput = {
  holder_id: string
  billing_day: number
  account_id?: string | null
  card_product_id?: string
  bank_id?: string
  card_number_last4?: string | null
  credit_limit?: number
  credit_limit_override?: number | null
  status?: CreditCard['status']
  card_type?: CreditCard['card_type']
  loan_due_day?: number | null
  override_billing_day?: number | null
  override_due_type?: CreditCard['override_due_type']
  override_due_value?: number | null
  name_override?: string | null
  annual_fee_override?: number | null
  account_mode_override?: CreditCard['account_mode_override']
  issued_on?: string | null
  activated_on?: string | null
}

export async function createCard(card: CreateCardInput): Promise<CreditCardWithProduct> {
  const id = uuid()
  let productId = card.card_product_id
  let product: CardProduct | null = null

  if (productId) {
    const { data } = await queryOne<CardProduct>('SELECT * FROM card_products WHERE id = ?', [productId])
    product = data
  }

  if (!product && card.bank_id) {
    // 优先匹配默认卡产品，其次匹配该银行首个活跃卡产品
    const { data: defaultProduct } = await queryOne<CardProduct>(
      'SELECT * FROM card_products WHERE bank_id = ? AND is_active = 1 ORDER BY (CASE WHEN id = ? THEN 0 ELSE 1 END), created_at ASC LIMIT 1',
      [card.bank_id, `cp_default_${card.bank_id}`]
    )
    product = defaultProduct
    if (!product) {
      // 银行存在但尚无卡产品（如测试新灌数据或新银行），动态兜底创建一条基础卡产品
      const { data: bank } = await queryOne<{ id: string; name: string; country?: string }>(
        'SELECT id, name, country FROM banks WHERE id = ?',
        [card.bank_id]
      )
      if (bank) {
        const defId = `cp_default_${bank.id}`
        await execute(
          `INSERT OR IGNORE INTO card_products (id, country, bank_id, bank_name, card_name, currency, payment_due_type, payment_due_value, annual_fee, is_active)
           VALUES (?, ?, ?, ?, ?, 'CNY', 'after_billing', 20, 0, 1)`,
          [defId, bank.country || 'CN', bank.id, bank.name, '标准信用卡']
        )
        const { data: createdProd } = await queryOne<CardProduct>('SELECT * FROM card_products WHERE id = ?', [defId])
        product = createdProd
      }
    }
    if (product) {
      productId = product.id
    }
  }

  if (!productId) {
    throw new Error('缺少卡产品或所属银行')
  }

  // 名称覆盖清洗：若与产品名称相同则置空，否则去除首尾空格
  let nameOverride: string | null = null
  if (card.name_override && card.name_override.trim()) {
    const trimmed = card.name_override.trim()
    if (!product || trimmed !== product.card_name) {
      nameOverride = trimmed
    }
  }

  const limitOverride = card.credit_limit_override != null
    ? (Number(card.credit_limit_override) > 0 ? Number(card.credit_limit_override) : null)
    : (card.credit_limit && Number(card.credit_limit) > 0 ? Number(card.credit_limit) : null)
  const limitValue = limitOverride ?? (Number(card.credit_limit) || 0)

  // 关联或创建 credit_account
  let accountId = card.account_id || null
  if (!accountId) {
    const currency = product?.currency || 'CNY'
    const bankKey = product?.bank_id || product?.bank_name || 'UNKNOWN'
    // 若不是贷款卡，检查是否已有同持卡人同银行同币种的 active merged 账户
    if ((card.card_type || 'credit') !== 'loan') {
      const { data: existingAccount } = await queryOne<{ id: string }>(
        `SELECT id FROM credit_accounts
         WHERE holder_id = ?
           AND COALESCE(bank_id, bank_name) = ?
           AND currency = ?
           AND statement_mode = 'merged'
           AND status = 'active'
         ORDER BY created_at ASC LIMIT 1`,
        [card.holder_id, bankKey, currency]
      )
      if (existingAccount) {
        accountId = existingAccount.id
      }
    }

    if (!accountId) {
      // 检查发卡行模式
      let defaultStatementMode: 'merged' | 'independent' = 'independent'
      let defaultQuotaMode: 'shared' | 'independent' = 'independent'
      if (product?.bank_id) {
        const { data: bankRow } = await queryOne<{ statement_mode: string; quota_mode: string }>(
          'SELECT statement_mode, quota_mode FROM banks WHERE id = ?',
          [product.bank_id]
        )
        if (bankRow?.statement_mode === 'merged') defaultStatementMode = 'merged'
        if (bankRow?.quota_mode === 'shared') defaultQuotaMode = 'shared'
      } else if (product?.bank_name) {
        if (/招商|民生|上海银行|北京银行/.test(product.bank_name)) {
          defaultStatementMode = 'merged'
          defaultQuotaMode = 'shared'
        }
      }

      if (card.card_type === 'loan') {
        defaultStatementMode = 'independent'
        defaultQuotaMode = 'independent'
      }

      accountId = uuid()
      await execute(
        `INSERT INTO credit_accounts (
          id, holder_id, bank_id, bank_name, currency, statement_mode, quota_mode,
          shared_credit_limit, billing_day, due_type, due_value, primary_card_id, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'active', ?, ?)`,
        [
          accountId,
          card.holder_id,
          product?.bank_id || null,
          product?.bank_name || '未知银行',
          currency,
          defaultStatementMode,
          defaultQuotaMode,
          limitValue > 0 ? limitValue : null,
          card.billing_day,
          card.override_due_type || product?.payment_due_type || 'after_billing',
          card.override_due_value || product?.payment_due_value || 20,
          now(),
          now()
        ]
      )
    }
  }

  const { error } = await execute(
    `INSERT INTO credit_cards (
      id, holder_id, account_id, card_product_id, card_number_last4, credit_limit, credit_limit_override,
      billing_day, status, card_type, loan_due_day, override_billing_day,
      override_due_type, override_due_value, name_override, annual_fee_override,
      account_mode_override, issued_on, activated_on
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, card.holder_id, accountId, productId, card.card_number_last4 || null, limitValue, limitOverride,
      card.billing_day, card.status || 'active', card.card_type || 'credit', card.loan_due_day || null,
      null, // override_billing_day 归一合并后新建卡统一为 null
      card.override_due_type || null, card.override_due_value || null, nameOverride,
      card.annual_fee_override ?? null, card.account_mode_override ?? null,
      card.issued_on ?? null, card.activated_on ?? null
    ]
  )
  if (error) throw new Error(error.message)

  // 确保账户有 primary_card_id 锚点卡
  if (accountId) {
    await execute(
      'UPDATE credit_accounts SET primary_card_id = ? WHERE id = ? AND primary_card_id IS NULL',
      [id, accountId]
    )
  }

  const created = await getCardById(id)
  if (!created) throw new Error('卡片创建失败')
  return created
}

async function getCardById(id: string): Promise<CreditCardWithProduct | null> {
  const { data, error } = await queryOne<CardJoinRow>(
    `SELECT ${CARD_SELECT} WHERE cc.id = ?`, [id]
  )
  if (error || !data) return null
  return joinRowToCard(data)
}

export type UpdateCardPatch = Partial<Omit<CreditCard, 'id' | 'created_at'>> & {
  bank_id?: string
  card_product_id?: string
}

export async function updateCard(
  id: string,
  patch: UpdateCardPatch
): Promise<CreditCardWithProduct> {
  const currentCard = await getCardById(id)
  if (!currentCard) throw new Error('卡片不存在')

  let targetProductId = patch.card_product_id

  // 1. 若传了 card_product_id 且试图换绑产品/银行
  if (targetProductId && targetProductId !== currentCard.card_product_id) {
    const { data: targetProduct, error: pError } = await queryOne<CardProduct>(
      'SELECT * FROM card_products WHERE id = ?',
      [targetProductId]
    )
    if (pError || !targetProduct) {
      throw new Error('目标卡产品不存在')
    }

    // Q3 同币种限制：若已有历史账单，只允许同币种切换
    const { data: billRows } = await queryOne<{ cnt: number }>(
      'SELECT COUNT(*) as cnt FROM bills WHERE card_id = ?',
      [id]
    )
    const hasBills = (billRows?.cnt ?? 0) > 0
    const curCurrency = currentCard.card_product?.currency || 'CNY'
    const targetCurrency = targetProduct.currency || 'CNY'
    if (hasBills && curCurrency !== targetCurrency) {
      throw new Error('该卡已有历史账单，仅允许切换到同币种卡产品；如需更换币种，请新建卡片')
    }

    // 机会台账冲突检查
    const { data: oppAccounts } = await query<{ account_id: string }>(
      'SELECT account_id FROM opportunity_account_cards WHERE card_id = ? AND retired_at IS NULL',
      [id]
    )
    if (oppAccounts && oppAccounts.length > 0) {
      if (currentCard.card_product?.bank_id && targetProduct.bank_id && currentCard.card_product.bank_id !== targetProduct.bank_id) {
        throw new Error('这张卡关联了原银行的权益台账，请先去「我的权益」解绑后再换银行')
      }
    }
  } else if (!targetProductId && patch.bank_id && currentCard.card_product?.bank_id !== patch.bank_id) {
    // 仅传 bank_id 且试图更换所属银行
    let defaultProduct = (await queryOne<CardProduct>(
      'SELECT * FROM card_products WHERE bank_id = ? AND is_active = 1 ORDER BY (CASE WHEN id = ? THEN 0 ELSE 1 END), created_at ASC LIMIT 1',
      [patch.bank_id, `cp_default_${patch.bank_id}`]
    )).data
    if (!defaultProduct) {
      const { data: bank } = await queryOne<{ id: string; name: string; country?: string }>(
        'SELECT id, name, country FROM banks WHERE id = ?',
        [patch.bank_id]
      )
      if (bank) {
        const defId = `cp_default_${bank.id}`
        await execute(
          `INSERT OR IGNORE INTO card_products (id, country, bank_id, bank_name, card_name, currency, payment_due_type, payment_due_value, annual_fee, is_active)
           VALUES (?, ?, ?, ?, ?, 'CNY', 'after_billing', 20, 0, 1)`,
          [defId, bank.country || 'CN', bank.id, bank.name, '标准信用卡']
        )
        defaultProduct = (await queryOne<CardProduct>('SELECT * FROM card_products WHERE id = ?', [defId])).data
      }
    }
    if (!defaultProduct) {
      throw new Error('所选银行暂无可用卡产品')
    }
    targetProductId = defaultProduct.id

    const { data: billRows } = await queryOne<{ cnt: number }>(
      'SELECT COUNT(*) as cnt FROM bills WHERE card_id = ?',
      [id]
    )
    const hasBills = (billRows?.cnt ?? 0) > 0
    const curCurrency = currentCard.card_product?.currency || 'CNY'
    const targetCurrency = defaultProduct.currency || 'CNY'
    if (hasBills && curCurrency !== targetCurrency) {
      throw new Error('该卡已有历史账单，仅允许切换到同币种卡产品；如需更换币种，请新建卡片')
    }
  }

  // 2. 持卡人变更校验（防止越权）
  if (patch.holder_id && patch.holder_id !== currentCard.holder_id) {
    const { data: holders } = await query<{ id: string; created_by: string; auth_user_id: string }>(
      'SELECT id, created_by, auth_user_id FROM card_holders WHERE id IN (?, ?)',
      [currentCard.holder_id, patch.holder_id]
    )
    const curH = holders?.find(h => h.id === currentCard.holder_id)
    const newH = holders?.find(h => h.id === patch.holder_id)
    if (!curH || !newH || (curH.created_by && newH.created_by && curH.created_by !== newH.created_by)) {
      throw new Error('卡片或目标持卡人不存在，或不属于同一账户')
    }
  }

  // 3. 额度计算（复用 Task B 逻辑）
  let limitOverrideVal = patch.credit_limit_override
  let limitVal = patch.credit_limit

  if (patch.credit_limit !== undefined && patch.credit_limit_override === undefined) {
    const num = Number(patch.credit_limit)
    if (Number.isFinite(num) && num > 0) {
      limitOverrideVal = num
      limitVal = num
    } else {
      limitOverrideVal = null
      limitVal = 0
    }
  } else if (patch.credit_limit_override !== undefined && patch.credit_limit === undefined) {
    const num = Number(patch.credit_limit_override)
    if (Number.isFinite(num) && num > 0) {
      limitVal = num
      limitOverrideVal = num
    } else {
      limitVal = 0
      limitOverrideVal = null
    }
  }

  // 4. Q2 账单日合并收口：若更新 billing_day，强制清空 override_billing_day
  let effectiveOverrideBillingDay = patch.override_billing_day
  if (patch.billing_day !== undefined) {
    effectiveOverrideBillingDay = null
  }

  // 5. 卡片名称覆盖更新处理
  let finalNameOverride = patch.name_override
  if (finalNameOverride !== undefined) {
    if (finalNameOverride && finalNameOverride.trim()) {
      const trimmed = finalNameOverride.trim()
      const effectiveProduct = targetProductId
        ? (await queryOne<CardProduct>('SELECT * FROM card_products WHERE id = ?', [targetProductId]))?.data
        : currentCard.card_product
      if (effectiveProduct && trimmed === effectiveProduct.card_name) {
        finalNameOverride = null
      } else {
        finalNameOverride = trimmed
      }
    } else {
      finalNameOverride = null
    }
  }

  const fields: string[] = []
  const params: unknown[] = []
  const fieldMap: Record<string, unknown> = {
    card_product_id: targetProductId,
    holder_id: patch.holder_id,
    card_number_last4: patch.card_number_last4,
    credit_limit: limitVal,
    credit_limit_override: limitOverrideVal,
    billing_day: patch.billing_day,
    status: patch.status,
    card_type: patch.card_type,
    loan_due_day: patch.loan_due_day,
    override_billing_day: effectiveOverrideBillingDay,
    override_due_type: patch.override_due_type,
    override_due_value: patch.override_due_value,
    name_override: finalNameOverride,
    annual_fee_override: patch.annual_fee_override,
    account_mode_override: patch.account_mode_override,
    issued_on: patch.issued_on,
    activated_on: patch.activated_on,
  }
  for (const [key, value] of Object.entries(fieldMap)) {
    if (value !== undefined) {
      fields.push(`${key} = ?`)
      params.push(value)
    }
  }
  if (fields.length === 0) throw new Error('没有需要更新的字段')
  params.push(id)
  const { error } = await execute(`UPDATE credit_cards SET ${fields.join(', ')} WHERE id = ?`, params)
  if (error) {
    if (/OPPORTUNITY_CARD_OWNERSHIP_CONFLICT/.test(error.message)) {
      throw new Error('该卡已关联权益台账账户，请先在「我的权益」解绑后再更换持卡人')
    }
    throw new Error(error.message)
  }
  const updated = await getCardById(id)
  if (!updated) throw new Error('卡片更新失败')
  return updated
}

export async function deleteCard(id: string): Promise<void> {
  const card = await getCardById(id)
  if (!card) return

  const accountId = card.account_id
  if (accountId) {
    // 检查同账户内是否有其他卡片
    const { data: siblings } = await query<{ id: string }>(
      `SELECT id FROM credit_cards
       WHERE account_id = ? AND id != ?
       ORDER BY (CASE WHEN status = 'active' THEN 0 ELSE 1 END), created_at ASC`,
      [accountId, id]
    )

    if (siblings && siblings.length > 0) {
      // 仍有其他卡片！检查当前被删卡片是否为 primary_card_id 锚点卡
      const { data: accountRow } = await queryOne<{ primary_card_id: string }>(
        'SELECT primary_card_id FROM credit_accounts WHERE id = ?',
        [accountId]
      )

      if (accountRow?.primary_card_id === id) {
        const nextPrimaryCardId = siblings[0].id
        // 在单一 batch 事务中：将账户锚点及所有 bills.card_id 平滑平移至剩余卡片，再删除目标卡，防止账单误灭失！
        await batch([
          {
            sql: 'UPDATE credit_accounts SET primary_card_id = ?, updated_at = ? WHERE id = ?',
            params: [nextPrimaryCardId, now(), accountId],
          },
          {
            sql: 'UPDATE bills SET card_id = ? WHERE account_id = ?',
            params: [nextPrimaryCardId, accountId],
          },
          {
            sql: 'DELETE FROM credit_cards WHERE id = ?',
            params: [id],
          },
        ])
        return
      }
    } else {
      // 账户内最后一张卡片：删除卡片前，先清理关联账户及账单
      await batch([
        {
          sql: 'DELETE FROM credit_accounts WHERE id = ?',
          params: [accountId],
        },
        {
          sql: 'DELETE FROM credit_cards WHERE id = ?',
          params: [id],
        },
      ])
      return
    }
  }

  const { error } = await execute('DELETE FROM credit_cards WHERE id = ?', [id])
  if (error) throw new Error(error.message)
}

/**
 * 修改卡片归属持卡人（Task：UI 内调整归属）。
 * 双端 scope 校验：当前持卡人与目标持卡人都必须在调用者名下
 * （与 getCardsWithBillsSummary 同谓词），防止把卡移给别人家或从别人家移入。
 * 卡上挂着权益台账关联时数据库触发器会拒绝（OPPORTUNITY_CARD_OWNERSHIP_CONFLICT），
 * 这里转成可读提示，让用户先去权益页解绑。
 *
 * 锚点卡守卫：若卡片在原持卡人的多卡合并账户中，先将其平滑拆出，原账户锚点平移给剩余卡。
 */
export async function updateCardHolder(
  userId: string,
  cardId: string,
  newHolderId: string
): Promise<CreditCardWithProduct> {
  if (!cardId || !newHolderId) throw new Error('缺少卡片或目标持卡人')
  const card = await getCardById(cardId)
  if (!card) throw new Error('卡片不存在')

  if (card.holder_id === newHolderId) return card // 幂等：同持卡人直接返回

  const { data: holders } = await query<{ id: string }>(
    `SELECT id FROM card_holders WHERE (created_by = ? OR auth_user_id = ?) AND id IN (?, ?)`,
    [userId, userId, card.holder_id, newHolderId]
  )
  const visible = new Set((holders || []).map((h) => h.id))
  // “不存在”与“无权”同口径，避免探测他人持卡人
  if (!visible.has(card.holder_id) || !visible.has(newHolderId)) {
    throw new Error('卡片或目标持卡人不存在，或不属于当前账户')
  }

  // 账户移交守卫：若卡片在原持卡人的多卡合并账户中，先将其从原账户拆出
  let newAccountId = card.account_id || null
  if (card.account_id) {
    const { data: oldAccount } = await queryOne<{ statement_mode: string; primary_card_id: string }>(
      'SELECT statement_mode, primary_card_id FROM credit_accounts WHERE id = ?',
      [card.account_id]
    )
    const { data: remainingCards } = await query<{ id: string }>(
      'SELECT id FROM credit_cards WHERE account_id = ? AND id != ? ORDER BY (CASE WHEN status = "active" THEN 0 ELSE 1 END), created_at ASC',
      [card.account_id, cardId]
    )

    if (remainingCards && remainingCards.length > 0) {
      // 原账户还有其他卡，原账户平滑切换锚点
      if (oldAccount?.primary_card_id === cardId) {
        const nextAnchorId = remainingCards[0].id
        await batch([
          {
            sql: 'UPDATE credit_accounts SET primary_card_id = ?, updated_at = ? WHERE id = ?',
            params: [nextAnchorId, now(), card.account_id],
          },
          {
            sql: 'UPDATE bills SET card_id = ? WHERE account_id = ?',
            params: [nextAnchorId, card.account_id],
          },
        ])
      }
      // 在新持卡人名下新建独立账户
      newAccountId = uuid()
      await execute(
        `INSERT INTO credit_accounts (
          id, holder_id, bank_id, bank_name, currency, statement_mode, quota_mode,
          shared_credit_limit, billing_day, due_type, due_value, primary_card_id, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'independent', 'independent', NULL, ?, ?, ?, ?, 'active', ?, ?)`,
        [
          newAccountId,
          newHolderId,
          card.card_product?.bank_id || null,
          card.card_product?.bank_name || '未知银行',
          card.card_product?.currency || 'CNY',
          card.billing_day,
          card.override_due_type || card.card_product?.payment_due_type || 'after_billing',
          card.override_due_value || card.card_product?.payment_due_value || 20,
          cardId,
          now(),
          now(),
        ]
      )
    } else {
      // 只有这一张卡，直接把该 credit_account 的 holder_id 改为 newHolderId
      await execute('UPDATE credit_accounts SET holder_id = ?, updated_at = ? WHERE id = ?', [
        newHolderId,
        now(),
        card.account_id,
      ])
    }
  }

  const { error } = await execute(
    'UPDATE credit_cards SET holder_id = ?, account_id = ? WHERE id = ? AND holder_id = ?',
    [newHolderId, newAccountId ?? null, cardId, card.holder_id]
  )
  if (error) {
    if (/OPPORTUNITY_CARD_OWNERSHIP_CONFLICT/.test(error.message)) {
      throw new Error('该卡已关联权益台账账户，请先在「我的权益」解绑后再转移归属')
    }
    throw new Error(error.message)
  }
  const moved = await getCardById(cardId)
  if (!moved || moved.holder_id !== newHolderId) {
    throw new Error('归属转移未生效（并发修改），请刷新后重试')
  }
  return moved
}

/**
 * 汇总当前用户全部卡片及邮件日志/Gmail同步记录的还款日状态与四类缺失原因。
 * 绝不编造日期，按卡/邮件分类汇总给前端与审计入口。
 */
export async function getDueDateReasonReport(userId?: string): Promise<DueDateReasonReport> {
  let cardCondition = ''
  const cardParams: unknown[] = []
  if (userId) {
    cardCondition = 'WHERE (ch.created_by = ? OR ch.auth_user_id = ?)'
    cardParams.push(userId, userId)
  }
  const { data: rawCards } = await query<Record<string, unknown>>(
    `SELECT cc.*, cp.bank_name, cp.card_name, cp.payment_due_type, cp.payment_due_value
     FROM credit_cards cc
     JOIN card_holders ch ON cc.holder_id = ch.id
     LEFT JOIN card_products cp ON cc.card_product_id = cp.id
     ${cardCondition}
     ORDER BY cc.created_at DESC`,
    cardParams
  )
  const cards: CardForDueDateSummary[] = (rawCards ?? []).map((row) => ({
    id: String(row.id),
    holder_id: String(row.holder_id),
    card_number_last4: row.card_number_last4 ? String(row.card_number_last4) : null,
    billing_day: Number(row.billing_day) || 1,
    card_type: (row.card_type === 'loan' ? 'loan' : 'credit') as 'credit' | 'loan',
    loan_due_day: row.loan_due_day ? Number(row.loan_due_day) : null,
    override_due_type: row.override_due_type as CardForDueDateSummary['override_due_type'],
    override_due_value: row.override_due_value ? Number(row.override_due_value) : null,
    bank_name: row.bank_name ? String(row.bank_name) : null,
    card_name: row.name_override ? String(row.name_override) : (row.card_name ? String(row.card_name) : null),
    card_product: row.bank_name ? {
      bank_name: String(row.bank_name),
      card_name: String(row.card_name ?? ''),
      payment_due_type: (row.payment_due_type ?? 'after_billing') as CardProduct['payment_due_type'],
      payment_due_value: Number(row.payment_due_value) || 20,
    } : null,
  }))

  const cardIds = cards.map((c) => c.id)
  let bills: BillForDueDateSummary[] = []
  if (cardIds.length > 0) {
    const placeholders = cardIds.map(() => '?').join(',')
    const { data: billRows } = await query<BillForDueDateSummary>(
      `SELECT id, card_id, bill_month, COALESCE(bill_amount_override, bill_amount) AS bill_amount,
              statement_date, due_date, due_date_override, created_at
       FROM bills WHERE card_id IN (${placeholders}) ORDER BY bill_month DESC LIMIT 500`,
      cardIds
    )
    bills = billRows ?? []
  }

  let emailLogs: EmailParseLog[]
  let gmailMessages: GmailSyncMessageLite[]
  let billDrafts: BillImportDraftLite[]

  const ownerIds = userId ? [userId] : []
  if (ownerIds.length > 0) {
    const placeholders = ownerIds.map(() => '?').join(',')
    const [logsRes, gmailRes, draftsRes] = await Promise.all([
      query<EmailParseLog>(
        `SELECT * FROM email_parse_logs WHERE user_id IN (${placeholders}) ORDER BY created_at DESC LIMIT 300`,
        ownerIds,
      ),
      query<GmailSyncMessageLite>(
        `SELECT gmail_message_id, user_id, from_email, subject, status, bill_id, draft_id, error_msg, created_at
         FROM gmail_sync_messages WHERE user_id IN (${placeholders}) ORDER BY created_at DESC LIMIT 300`,
        ownerIds,
      ),
      query<BillImportDraftLite>(
        `SELECT id, created_by, card_id, source_type, parsed_payload, status, created_at
         FROM bill_import_drafts WHERE created_by IN (${placeholders}) ORDER BY created_at DESC LIMIT 300`,
        ownerIds,
      ),
    ])
    emailLogs = logsRes.data ?? []
    gmailMessages = gmailRes.data ?? []
    billDrafts = draftsRes.data ?? []
  } else {
    const [logsRes, gmailRes, draftsRes] = await Promise.all([
      query<EmailParseLog>(`SELECT * FROM email_parse_logs ORDER BY created_at DESC LIMIT 300`),
      query<GmailSyncMessageLite>(
        `SELECT gmail_message_id, user_id, from_email, subject, status, bill_id, draft_id, error_msg, created_at
         FROM gmail_sync_messages ORDER BY created_at DESC LIMIT 300`
      ),
      query<BillImportDraftLite>(
        `SELECT id, created_by, card_id, source_type, parsed_payload, status, created_at
         FROM bill_import_drafts ORDER BY created_at DESC LIMIT 300`
      ),
    ])
    emailLogs = logsRes.data ?? []
    gmailMessages = gmailRes.data ?? []
    billDrafts = draftsRes.data ?? []
  }

  return buildDueDateReasonReport({
    cards,
    bills,
    emailLogs,
    gmailMessages,
    billDrafts,
  })
}
