import { insforge } from '../insforge'

export async function syncGmailLedgerToCardsAndBills(targetUserId?: string): Promise<{
  syncedCardsCount: number
  syncedBillsCount: number
}> {
  try {
    // 0. 自动将数据库中未绑定 created_by 的持卡人更新绑定给当前用户
    if (targetUserId) {
      await insforge.database
        .from('card_holders')
        .update({ created_by: targetUserId })
        .is('created_by', null)
    }

    // 1. 获取所有有效的 gmail_ledger_entries
    const { data: entries, error: fetchErr } = await insforge.database
      .from('gmail_ledger_entries')
      .select('*')

    if (fetchErr || !entries || entries.length === 0) {
      return { syncedCardsCount: 0, syncedBillsCount: 0 }
    }

    // 2. 获取现有的持卡人与别名
    let { data: holders } = await insforge.database
      .from('card_holders')
      .select('id, name, aliases, created_by')

    let defaultHolderId = holders && holders.length > 0 ? holders[0].id : null
    const holderByNameMap = new Map<string, string>()
    ;(holders || []).forEach((h: any) => {
      if (h.name) holderByNameMap.set(h.name.trim().toLowerCase(), h.id)
      if (Array.isArray(h.aliases)) {
        h.aliases.forEach((alias: string) => {
          if (alias) holderByNameMap.set(alias.trim().toLowerCase(), h.id)
        })
      }
    })

    if (!defaultHolderId) {
      const { data: newHolder } = await insforge.database
        .from('card_holders')
        .insert([{ name: '主持卡人', created_by: targetUserId || null }])
        .select()
        .single()

      if (newHolder) {
        defaultHolderId = newHolder.id
        holderByNameMap.set('主持卡人', newHolder.id)
      }
    }

    // 3. 获取现有的 credit_cards 和 card_products
    const { data: existingCards } = await insforge.database.from('credit_cards').select('*')
    const { data: products } = await insforge.database.from('card_products').select('*')

    const cardByBankAndTail = new Map<string, any>()
    ;(existingCards || []).forEach((card: any) => {
      const tail = card.card_number_last4
      const bankName = card.bank_name || ''
      if (tail) {
        cardByBankAndTail.set(`${bankName}:${tail}`, card)
        cardByBankAndTail.set(`:${tail}`, card)
      }
    })

    function getProductIdForBank(bankName: string): string | null {
      if (!products || products.length === 0) return null
      const match = products.find((p: any) => p.bank_name && bankName.includes(p.bank_name))
      return match ? match.id : products[0].id
    }

    let syncedCardsCount = 0
    let syncedBillsCount = 0

    // 4. 循环同步
    for (const entry of entries as any[]) {
      const tail = entry.account_tail ? String(entry.account_tail).trim() : null
      const rawBank = entry.bank || '通用银行'
      const bankShort = rawBank.split('/')[0].trim()
      const amount = Number(entry.statement_amount || 0)

      if (amount <= 0 && !tail) continue

      // A. 卡片匹配或自动创建
      const cardKey = `${bankShort}:${tail}`
      let card = cardByBankAndTail.get(cardKey) || (tail ? cardByBankAndTail.get(`:${tail}`) : null)

      if (!card && tail) {
        const rawHName = entry.cardholder_name ? entry.cardholder_name.trim() : '主持卡人'
        const cleanHName = rawHName.toLowerCase()
        let holderId = holderByNameMap.get(cleanHName)

        // 智能模糊匹配别名（若名字包含*或先生，匹配已有同姓持卡人）
        if (!holderId && holders && holders.length > 0) {
          const firstChar = rawHName[0]
          const matched = holders.find((h: any) => h.name && h.name[0] === firstChar)
          if (matched) {
            holderId = matched.id
          }
        }

        if (!holderId) {
          if (defaultHolderId) {
            holderId = defaultHolderId
          } else {
            const { data: createdH } = await insforge.database
              .from('card_holders')
              .insert([{ name: rawHName, created_by: targetUserId || null }])
              .select()
              .single()

            if (createdH) {
              const newId: string = createdH.id
              holderId = newId
              holderByNameMap.set(cleanHName, newId)
            }
          }
        }

        const prodId = getProductIdForBank(bankShort)

        const { data: newCard } = await insforge.database
          .from('credit_cards')
          .insert([{
            holder_id: holderId,
            card_product_id: prodId,
            card_number_last4: tail,
            credit_limit: 50000,
            billing_day: entry.statement_date ? new Date(entry.statement_date).getDate() : 10,
            status: 'active',
            bank_name: bankShort,
            card_name: `${bankShort}信用卡 (${tail})`,
            currency: entry.currency || 'CNY',
            payment_due_type: 'after_billing',
            payment_due_value: 20
          }])
          .select()
          .single()

        if (newCard) {
          card = newCard
          cardByBankAndTail.set(cardKey, newCard)
          cardByBankAndTail.set(`:${tail}`, newCard)
          syncedCardsCount++
        }
      }

      // B. 账单匹配或自动创建
      if (card && entry.due_date) {
        const billMonth = entry.statement_date
          ? entry.statement_date.slice(0, 7)
          : entry.due_date.slice(0, 7)

        const { data: existingBill } = await insforge.database
          .from('bills')
          .select('id')
          .eq('card_id', card.id)
          .eq('bill_month', billMonth)
          .maybeSingle()

        if (!existingBill) {
          const statusMap: Record<string, 'paid' | 'partial' | 'unpaid'> = {
            '已还清': 'paid',
            '部分还款': 'partial',
            '未还款': 'unpaid'
          }
          const status = statusMap[entry.payment_status] || (entry.completed ? 'paid' : 'unpaid')

          const { data: newBill } = await insforge.database
            .from('bills')
            .insert([{
              card_id: card.id,
              bill_month: billMonth,
              statement_start: entry.statement_date || entry.due_date,
              statement_end: entry.statement_date || entry.due_date,
              bill_amount: amount,
              min_payment: Number(entry.minimum_payment || 0),
              due_date: entry.due_date,
              status: status
            }])
            .select()
            .single()

          if (newBill) {
            syncedBillsCount++
            await insforge.database
              .from('gmail_ledger_entries')
              .update({ matched_card_id: card.id, matched_bill_id: newBill.id })
              .eq('id', entry.id)
          }
        } else {
          await insforge.database
            .from('gmail_ledger_entries')
            .update({ matched_card_id: card.id, matched_bill_id: existingBill.id })
            .eq('id', entry.id)
        }
      }
    }

    return { syncedCardsCount, syncedBillsCount }
  } catch (err) {
    console.error('syncGmailLedgerToCardsAndBills failed:', err)
    return { syncedCardsCount: 0, syncedBillsCount: 0 }
  }
}
