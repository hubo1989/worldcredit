import { insforge } from '../insforge'
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

  // 1. 只同步明确归属当前用户的 Gmail ledger 记录，禁止全局扫描/认领历史未归属数据。
  const { data: rawEntries, error: fetchErr } = await insforge.database
    .from('gmail_ledger_entries')
    .select('*')
    .eq('created_by', targetUserId)

  if (fetchErr) throw fetchErr
  const entries = (rawEntries || []) as GmailLedgerSyncEntry[]
  if (entries.length === 0) {
    return { syncedCardsCount: 0, syncedBillsCount: 0 }
  }

  // 2. 仅使用当前用户的持卡人，禁止把其它用户的 holder 当默认归属。
  const { data: rawHolders, error: holderErr } = await insforge.database
    .from('card_holders')
    .select('id, name, aliases, created_by')
    .eq('created_by', targetUserId)
    .order('created_at', { ascending: true })

  if (holderErr) throw holderErr

  let holders = (rawHolders || []) as CardHolder[]
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
    const { data: newHolder, error: createDefaultErr } = await insforge.database
      .from('card_holders')
      .insert([{ name: '主持卡人', created_by: targetUserId }])
      .select()
      .single()

    if (createDefaultErr) throw createDefaultErr
    if (!newHolder?.id) throw new Error('创建默认持卡人失败')

    const createdHolder = newHolder as CardHolder
    holders = [createdHolder]
    defaultHolderId = createdHolder.id
    rebuildHolderMap()
  }

  // 3. 获取当前用户信用卡与产品。银行名来自 card_product，不写入 credit_cards 非法字段。
  const { data: existingCards, error: cardsErr } = await insforge.database
    .from('credit_cards')
    .select('*, card_product:card_products(bank_name, card_name)')
    .in('holder_id', holders.map(h => h.id))

  if (cardsErr) throw cardsErr

  const { data: products, error: productsErr } = await insforge.database
    .from('card_products')
    .select('*')
    .eq('is_active', true)

  if (productsErr) throw productsErr

  const activeProducts = (products || []) as CardProduct[]
  if (activeProducts.length === 0) {
    throw new Error('缺少可用卡产品，无法从邮件账单自动创建信用卡')
  }

  const cardByBankAndTail = new Map<string, ExistingCard>()
  ;((existingCards || []) as ExistingCard[]).forEach(card => {
    const tail = card.card_number_last4
    if (!tail) return
    const bankName = normalizeBank(card.card_product?.bank_name)
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

  // 4. 循环同步
  for (const entry of entries) {
    const tail = entry.account_tail ? String(entry.account_tail).trim() : null
    const bankShort = normalizeBank(entry.bank)
    const amount = Number(entry.statement_amount || 0)
    const billMonth = getEntryMonth(entry)

    if (!tail || !entry.due_date || !billMonth || amount <= 0) continue

    // A. 卡片匹配或自动创建
    const cardKey = `${bankShort}:${tail}`
    let card = cardByBankAndTail.get(cardKey) || cardByBankAndTail.get(`:${tail}`) || null

    if (!card) {
      const rawHolderName = entry.cardholder_name?.trim() || '主持卡人'
      const normalizedHolderName = normalizeName(rawHolderName)
      let holderId = holderByNameMap.get(normalizedHolderName)

      // 保守匹配：只在同姓且带脱敏符号/称谓时归并，避免同姓真实用户误合并。
      if (!holderId && rawHolderName && /[*＊]|先生|女士/.test(rawHolderName)) {
        const firstChar = rawHolderName[0]
        const matched = holders.find(holder => holder.name?.[0] === firstChar)
        holderId = matched?.id
      }

      if (!holderId) holderId = defaultHolderId
      if (!holderId) throw new Error('缺少当前用户持卡人，无法同步账单')

      const product = getProductForBank(bankShort)
      const { data: newCard, error: createCardErr } = await insforge.database
        .from('credit_cards')
        .insert([{
          holder_id: holderId,
          card_product_id: product.id,
          card_number_last4: tail,
          credit_limit: 50000,
          billing_day: pickStatementDay(entry.statement_date),
          status: 'active',
          card_type: entry.kind?.includes('贷款') ? 'loan' : 'credit',
        }])
        .select('*, card_product:card_products(bank_name, card_name)')
        .single()

      if (createCardErr) throw createCardErr
      if (!newCard) throw new Error('自动创建信用卡失败')

      card = newCard as ExistingCard
      cardByBankAndTail.set(cardKey, card)
      cardByBankAndTail.set(`:${tail}`, card)
      syncedCardsCount++
    }

    // B. 账单匹配或自动创建
    const { data: existingBill, error: findBillErr } = await insforge.database
      .from('bills')
      .select('id')
      .eq('card_id', card.id)
      .eq('bill_month', billMonth)
      .maybeSingle()

    if (findBillErr) throw findBillErr

    if (!existingBill) {
      const { data: newBill, error: createBillErr } = await insforge.database
        .from('bills')
        .insert([{
          card_id: card.id,
          bill_month: billMonth,
          statement_start: entry.statement_date || entry.due_date,
          statement_end: entry.statement_date || entry.due_date,
          bill_amount: amount,
          min_payment: Number(entry.minimum_payment || 0),
          due_date: entry.due_date,
          status: mapPaymentStatus(entry),
        }])
        .select()
        .single()

      if (createBillErr) throw createBillErr
      if (!newBill) throw new Error('自动创建账单失败')

      const { error: linkErr } = await insforge.database
        .from('gmail_ledger_entries')
        .update({ matched_card_id: card.id, matched_bill_id: newBill.id })
        .eq('id', entry.id)

      if (linkErr) throw linkErr
      syncedBillsCount++
    } else {
      const { error: linkErr } = await insforge.database
        .from('gmail_ledger_entries')
        .update({ matched_card_id: card.id, matched_bill_id: existingBill.id })
        .eq('id', entry.id)

      if (linkErr) throw linkErr
    }
  }

  return { syncedCardsCount, syncedBillsCount }
}
