import { query, queryOne, execute, uuid, now } from '../db'
import type { Bill, CardHolder, CardProduct, CreditCard } from '../types'

type GmailLedgerSyncEntry = {
  id: string
  bank?: string | null
  account_tail?: string | null
  kind?: string | null
  currency?: string | null
  statement_amount?: number | string | null
  minimum_payment?: number | string | null
  due_date?: string | null
  statement_date?: string | null
  cardholder_name?: string | null
  payment_status?: string | null
  completed?: boolean | null
  created_by?: string | null
}

type ExistingCard = CreditCard & { card_product?: Pick<CardProduct, 'bank_name' | 'card_name'> }

function normalizeName(value?: string | null): string {
  return (value || '').trim().toLowerCase()
}

function normalizeBank(value?: string | null): string {
  return (value || '通用银行').split('/')[0].trim()
}

function pickStatementDay(statementDate?: string | null): number {
  if (!statementDate) return 10
  const day = new Date(statementDate).getDate()
  return Number.isFinite(day) && day >= 1 && day <= 31 ? day : 10
}

function getEntryMonth(entry: GmailLedgerSyncEntry): string | null {
  const raw = entry.statement_date || entry.due_date
  return raw ? raw.slice(0, 7) : null
}

function mapPaymentStatus(entry: GmailLedgerSyncEntry): Bill['status'] {
  const statusMap: Record<string, Bill['status']> = {
    已还清: 'paid',
    部分还款: 'partial',
    未还款: 'unpaid',
  }
  return statusMap[entry.payment_status || ''] || (entry.completed ? 'paid' : 'unpaid')
}

export async function syncGmailLedgerToCardsAndBills(targetUserId?: string): Promise<{
  syncedCardsCount: number
  syncedBillsCount: number
}> {
  if (!targetUserId) {
    throw new Error('同步邮件账单需要当前用户 ID，禁止全局同步')
  }

  const { data: rawEntries, error: fetchErr } = await query<GmailLedgerSyncEntry>(
    'SELECT * FROM gmail_ledger_entries WHERE created_by = ?', [targetUserId]
  )
  if (fetchErr) throw new Error(fetchErr.message)
  const entries = rawEntries || []
  if (entries.length === 0) {
    return { syncedCardsCount: 0, syncedBillsCount: 0 }
  }

  const { data: rawHolders, error: holderErr } = await query<CardHolder>(
    'SELECT * FROM card_holders WHERE created_by = ? ORDER BY created_at ASC', [targetUserId]
  )
  if (holderErr) throw new Error(holderErr.message)

  let holders = rawHolders || []
  let defaultHolderId = holders[0]?.id || null
  const holderByNameMap = new Map<string, string>()

  const rebuildHolderMap = () => {
    holderByNameMap.clear()
    holders.forEach(holder => {
      const holderName = normalizeName(holder.name)
      if (holderName) holderByNameMap.set(holderName, holder.id)
      if (Array.isArray(holder.aliases)) {
        holder.aliases.forEach(alias => {
          const normalizedAlias = normalizeName(alias)
          if (normalizedAlias) holderByNameMap.set(normalizedAlias, holder.id)
        })
      }
    })
  }
  rebuildHolderMap()

  if (!defaultHolderId) {
    const newHolderId = uuid()
    const { error: createDefaultErr } = await execute(
      'INSERT INTO card_holders (id, created_by, managed_by, name) VALUES (?, ?, ?, ?)',
      [newHolderId, targetUserId, targetUserId, '主持卡人']
    )
    if (createDefaultErr) throw new Error(createDefaultErr.message)
    holders = [{ id: newHolderId, created_by: targetUserId, name: '主持卡人', avatar_color: '#1976d2', created_at: now() }]
    defaultHolderId = newHolderId
    rebuildHolderMap()
  }

  const holderIds = holders.map(h => h.id)
  const hPlaceholders = holderIds.map(() => '?').join(',')
  const { data: rawCards, error: cardsErr } = await query<Record<string, unknown>>(
    `SELECT cc.id, cc.holder_id, cc.card_product_id, cc.card_number_last4, cc.credit_limit,
            cc.billing_day, cc.status, cc.card_type, cc.created_at,
            cp.bank_name, cp.card_name
     FROM credit_cards cc
     LEFT JOIN card_products cp ON cc.card_product_id = cp.id
     WHERE cc.holder_id IN (${hPlaceholders})`, holderIds
  )
  if (cardsErr) throw new Error(cardsErr.message)

  const { data: products, error: productsErr } = await query<CardProduct>(
    'SELECT * FROM card_products WHERE is_active = 1'
  )
  if (productsErr) throw new Error(productsErr.message)

  const activeProducts = products || []
  if (activeProducts.length === 0) {
    throw new Error('缺少可用卡产品，无法从邮件账单自动创建信用卡')
  }

  const cardByBankAndTail = new Map<string, ExistingCard>()
  ;(rawCards || []).forEach(row => {
    const tail = row.card_number_last4 as string | null
    if (!tail) return
    const bankName = normalizeBank(row.bank_name as string)
    const card: ExistingCard = {
      id: row.id as string,
      holder_id: row.holder_id as string,
      card_product_id: row.card_product_id as string,
      card_number_last4: tail,
      credit_limit: (row.credit_limit as number) || 0,
      billing_day: (row.billing_day as number) || 10,
      status: 'active',
      card_type: 'credit',
      created_at: (row.created_at as string) || '',
      card_product: row.bank_name ? { bank_name: row.bank_name as string, card_name: row.card_name as string } : undefined,
    }
    cardByBankAndTail.set(`${bankName}:${tail}`, card)
    cardByBankAndTail.set(`:${tail}`, card)
  })

  function getProductForBank(bankName: string): CardProduct {
    const normalizedBank = normalizeBank(bankName)
    const exact = activeProducts.find(product => normalizeBank(product.bank_name) === normalizedBank)
    if (exact) return exact
    const fuzzy = activeProducts.find(product => {
      const productBank = normalizeBank(product.bank_name)
      return normalizedBank.includes(productBank) || productBank.includes(normalizedBank)
    })
    return fuzzy || activeProducts[0]
  }

  let syncedCardsCount = 0
  let syncedBillsCount = 0

  for (const entry of entries) {
    const tail = entry.account_tail ? String(entry.account_tail).trim() : null
    const bankShort = normalizeBank(entry.bank)
    const amount = Number(entry.statement_amount || 0)
    const billMonth = getEntryMonth(entry)
    if (!tail || !entry.due_date || !billMonth || amount <= 0) continue

    const cardKey = `${bankShort}:${tail}`
    let card = cardByBankAndTail.get(cardKey) || cardByBankAndTail.get(`:${tail}`) || null

    if (!card) {
      const rawHolderName = entry.cardholder_name?.trim() || '主持卡人'
      const normalizedHolderName = normalizeName(rawHolderName)
      let holderId = holderByNameMap.get(normalizedHolderName)
      if (!holderId && rawHolderName && /[*＊]|先生|女士/.test(rawHolderName)) {
        const firstChar = rawHolderName[0]
        const matched = holders.find(holder => holder.name?.[0] === firstChar)
        holderId = matched?.id
      }
      if (!holderId) holderId = defaultHolderId
      if (!holderId) throw new Error('缺少当前用户持卡人，无法同步账单')

      const product = getProductForBank(bankShort)
      const newCardId = uuid()
      const { error: createCardErr } = await execute(
        `INSERT INTO credit_cards (id, holder_id, card_product_id, card_number_last4, credit_limit, billing_day, status, card_type)
         VALUES (?, ?, ?, ?, 50000, ?, ?, ?)`,
        [newCardId, holderId, product.id, tail, pickStatementDay(entry.statement_date), 'active',
         entry.kind?.includes('贷款') ? 'loan' : 'credit']
      )
      if (createCardErr) throw new Error(createCardErr.message)

      card = {
        id: newCardId, holder_id: holderId, card_product_id: product.id,
        card_number_last4: tail, credit_limit: 50000, billing_day: pickStatementDay(entry.statement_date),
        status: 'active', card_type: entry.kind?.includes('贷款') ? 'loan' : 'credit',
        created_at: now(),
        card_product: { bank_name: product.bank_name, card_name: product.card_name },
      }
      cardByBankAndTail.set(cardKey, card)
      cardByBankAndTail.set(`:${tail}`, card)
      syncedCardsCount++
    }

    const { data: existingBill } = await queryOne<{ id: string }>(
      'SELECT id FROM bills WHERE card_id = ? AND bill_month = ?', [card.id, billMonth]
    )

    if (!existingBill) {
      const newBillId = uuid()
      const { error: createBillErr } = await execute(
        `INSERT INTO bills (id, card_id, bill_month, statement_start, statement_end, bill_amount, min_payment, due_date, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [newBillId, card.id, billMonth, entry.statement_date || entry.due_date, entry.statement_date || entry.due_date,
         amount, Number(entry.minimum_payment || 0), entry.due_date, mapPaymentStatus(entry)]
      )
      if (createBillErr) throw new Error(createBillErr.message)
      await execute(
        'UPDATE gmail_ledger_entries SET matched_card_id = ?, matched_bill_id = ? WHERE id = ?',
        [card.id, newBillId, entry.id]
      )
      syncedBillsCount++
    } else {
      await execute(
        'UPDATE gmail_ledger_entries SET matched_card_id = ?, matched_bill_id = ? WHERE id = ?',
        [card.id, existingBill.id, entry.id]
      )
    }
  }

  return { syncedCardsCount, syncedBillsCount }
}
