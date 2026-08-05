import { insforge } from '../insforge'
import type { EmailParseLog } from '../types'

export interface ParsedEmailBillData {
  is_bill?: boolean
  bank_name?: string
  card_last4?: string
  bill_amount?: number
  min_payment?: number
  due_date?: string
  bill_month?: string
  statement_date?: string
  currency?: string
  confidence?: number
}

export type EmailParseLogWithParsed = EmailParseLog & {
  parsedData?: ParsedEmailBillData
}

/**
 * 获取所有的邮件解析/账单日志列表
 */
export async function getEmailParseLogs(): Promise<EmailParseLogWithParsed[]> {
  const { data, error } = await insforge.database
    .from('email_parse_logs')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) throw error

  return (data || []).map((log: EmailParseLog) => {
    let parsedData: ParsedEmailBillData | undefined = undefined
    if (log.raw_ai_response) {
      try {
        parsedData = typeof log.raw_ai_response === 'string'
          ? JSON.parse(log.raw_ai_response)
          : log.raw_ai_response
      } catch (e) {
        console.warn('Parse raw_ai_response failed for log:', log.id)
      }
    }
    return {
      ...log,
      parsedData
    }
  })
}

export interface SyncEmailBillParams {
  logId: string
  holderId?: string
  bankName: string
  cardName: string
  cardNumberLast4: string
  billingDay: number
  billAmount: number
  minPayment?: number
  billMonth: string
  dueDate: string
  statementDate?: string
}

/**
 * 将邮件账单同步并建立到用户本账户中（建立持卡对象/银行/卡片及生成对应账单）
 */
export async function syncEmailBillToAccount(params: SyncEmailBillParams): Promise<{ cardId: string; billId: string }> {
  const {
    logId,
    holderId,
    bankName,
    cardName,
    cardNumberLast4,
    billingDay,
    billAmount,
    minPayment = 0,
    billMonth,
    dueDate,
    statementDate
  } = params

  // 1. 获取/保证持卡人 (card_holder)
  let targetHolderId = holderId
  if (!targetHolderId) {
    const { data: existingHolders } = await insforge.database
      .from('card_holders')
      .select('id')
      .order('created_at', { ascending: true })
      .limit(1)

    if (existingHolders && existingHolders.length > 0) {
      targetHolderId = existingHolders[0].id
    } else {
      // 自动新建默认持卡人“本人”
      const { data } = await insforge.auth.getCurrentUser()
      const { data: newHolder, error: createHolderErr } = await insforge.database
        .from('card_holders')
        .insert([{
          name: '本人',
          created_by: data?.user?.id || '00000000-0000-0000-0000-000000000000',
          avatar_color: '#1976d2'
        }])
        .select()
        .single()
      if (createHolderErr) throw createHolderErr
      targetHolderId = newHolder.id
    }
  }

  // 2. 匹配/创建 银行 (banks)
  let bankId: string | undefined = undefined
  const { data: existingBanks } = await insforge.database
    .from('banks')
    .select('id')
    .eq('name', bankName)
    .maybeSingle()

  if (existingBanks) {
    bankId = existingBanks.id
  } else {
    const { data: newBank } = await insforge.database
      .from('banks')
      .insert([{
        name: bankName,
        full_name: bankName,
        country: 'CN'
      }])
      .select()
      .single()
    bankId = newBank?.id
  }

  // 3. 匹配/创建 卡产品 (card_products)
  let cardProductId: string
  const { data: existingProduct } = await insforge.database
    .from('card_products')
    .select('id')
    .eq('bank_name', bankName)
    .eq('card_name', cardName)
    .maybeSingle()

  if (existingProduct) {
    cardProductId = existingProduct.id
  } else {
    const { data: newProduct, error: productErr } = await insforge.database
      .from('card_products')
      .insert([{
        bank_id: bankId,
        bank_name: bankName,
        card_name: cardName,
        country: 'CN',
        currency: 'CNY',
        payment_due_type: 'after_billing',
        payment_due_value: 20
      }])
      .select()
      .single()

    if (productErr) throw productErr
    cardProductId = newProduct.id
  }

  // 4. 匹配/创建 用户的信用卡 (credit_cards)
  let targetCardId: string
  // 按照末尾4位或产品查找现有持卡账户
  let query = insforge.database
    .from('credit_cards')
    .select('id')
    .eq('holder_id', targetHolderId)
    .eq('card_product_id', cardProductId)

  if (cardNumberLast4) {
    query = query.eq('card_number_last4', cardNumberLast4)
  }

  const { data: existingCard } = await query.maybeSingle()

  if (existingCard) {
    targetCardId = existingCard.id
  } else {
    // 建立新卡片账户
    const { data: newCard, error: cardErr } = await insforge.database
      .from('credit_cards')
      .insert([{
        holder_id: targetHolderId,
        card_product_id: cardProductId,
        card_number_last4: cardNumberLast4,
        credit_limit: 0,
        billing_day: billingDay,
        status: 'active',
        card_type: 'credit'
      }])
      .select()
      .single()

    if (cardErr) throw cardErr
    targetCardId = newCard.id
  }

  // 5. 创建/更新 对应的账单 (bills)
  let targetBillId: string
  const { data: existingBill } = await insforge.database
    .from('bills')
    .select('id')
    .eq('card_id', targetCardId)
    .eq('bill_month', billMonth)
    .maybeSingle()

  if (existingBill) {
    targetBillId = existingBill.id
    const { error: billUpdateErr } = await insforge.database
      .from('bills')
      .update({
        bill_amount: billAmount,
        min_payment: minPayment,
        due_date: dueDate,
        statement_date: statementDate || undefined,
        statement_end: statementDate || undefined,
        status: 'unpaid'
      })
      .eq('id', targetBillId)
    if (billUpdateErr) throw billUpdateErr
  } else {
    const { data: newBill, error: billCreateErr } = await insforge.database
      .from('bills')
      .insert([{
        card_id: targetCardId,
        bill_month: billMonth,
        statement_start: statementDate || undefined,
        statement_end: statementDate || undefined,
        statement_date: statementDate || undefined,
        bill_amount: billAmount,
        min_payment: minPayment,
        due_date: dueDate,
        status: 'unpaid'
      }])
      .select()
      .single()

    if (billCreateErr) throw billCreateErr
    targetBillId = newBill.id
  }

  // 6. 更新邮件解析日志记录 (email_parse_logs) 为成功状态
  await insforge.database
    .from('email_parse_logs')
    .update({
      status: 'success',
      bill_id: targetBillId,
      error_msg: null
    })
    .eq('id', logId)

  return {
    cardId: targetCardId,
    billId: targetBillId
  }
}
