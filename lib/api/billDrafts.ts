// lib/api/billDrafts.ts
import { db } from '../insforge'
import type { Bill } from '../types'
import { createBill } from './bills'
import type { BillItemInput } from './bills'
import type { BillDraftPayload } from '../billRecognizer'

export interface BillImportDraft {
  id: string
  created_by: string
  card_id: string | null
  source_type: 'text' | 'image' | 'pdf' | 'email' | 'sms'
  raw_text: string | null
  file_ref: string | null
  parsed_payload: BillDraftPayload
  status: 'draft' | 'confirmed' | 'discarded'
  confidence: number | null
  created_at: string
  confirmed_at: string | null
}

export interface CreateDraftInput {
  created_by: string
  card_id?: string
  source_type: BillImportDraft['source_type']
  raw_text?: string
  file_ref?: string
  parsed_payload: BillDraftPayload
  confidence?: number
}

/**
 * Create a new bill import draft.
 */
export async function createBillImportDraft(input: CreateDraftInput): Promise<BillImportDraft> {
  const { data, error } = await db
    .from('bill_import_drafts')
    .insert({
      created_by: input.created_by,
      card_id: input.card_id || null,
      source_type: input.source_type,
      raw_text: input.raw_text || null,
      file_ref: input.file_ref || null,
      parsed_payload: input.parsed_payload as any, // JSONB
      confidence: input.confidence || null,
    })
    .select()
    .single()

  if (error) throw error
  return data
}

/**
 * Get a bill import draft by ID.
 */
export async function getBillImportDraft(id: string): Promise<BillImportDraft> {
  const { data, error } = await db
    .from('bill_import_drafts')
    .select('*')
    .eq('id', id)
    .single()

  if (error) throw error
  return data
}

/**
 * Get all draft bills for a user.
 */
export async function getBillImportDrafts(userId: string): Promise<BillImportDraft[]> {
  const { data, error } = await db
    .from('bill_import_drafts')
    .select('*')
    .eq('created_by', userId)
    .eq('status', 'draft')
    .order('created_at', { ascending: false })

  if (error) throw error
  return data || []
}

/**
 * Update a bill import draft.
 */
export async function updateBillImportDraft(
  id: string,
  updates: Partial<Pick<BillImportDraft, 'card_id' | 'parsed_payload' | 'confidence'>>
): Promise<BillImportDraft> {
  const updateData: any = {}

  if (updates.card_id !== undefined) {
    updateData.card_id = updates.card_id
  }

  if (updates.parsed_payload !== undefined) {
    updateData.parsed_payload = updates.parsed_payload as any // JSONB
  }

  if (updates.confidence !== undefined) {
    updateData.confidence = updates.confidence
  }

  const { data, error } = await db
    .from('bill_import_drafts')
    .update(updateData)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

/**
 * Confirm a bill import draft and create the actual bill.
 */
export async function confirmBillImportDraft(id: string): Promise<Bill> {
  // Get the draft
  const draft = await getBillImportDraft(id)

  if (draft.status !== 'draft') {
    throw new Error('只能确认草稿状态的账单')
  }

  const payload = draft.parsed_payload as any

  // Validate required fields
  if (!payload.bill_amount || !payload.due_date || !payload.bill_month) {
    throw new Error('账单缺少必要字段')
  }

  if (!draft.card_id) {
    throw new Error('请先选择信用卡')
  }

  // Check for duplicates
  const duplicate = await checkDuplicateBill(draft.card_id, payload.bill_month)
  if (duplicate) {
    throw new Error(`该信用卡在 ${payload.bill_month} 已存在账单`)
  }

  // Prepare items with confidence and raw_text
  const items: BillItemInput[] = (payload.items || []).map((item: any) => ({
    transaction_date: item.transaction_date,
    description: item.description,
    amount: item.amount,
    category: item.category,
    item_type: item.item_type || 'purchase',
    source: 'llm' as const,
    confidence: item.confidence,
    raw_text: item.raw_text,
    metadata: {
      draft_id: id,
      import_source: draft.source_type,
    },
  }))

  // Create the bill
  const bill = await createBill({
    card_id: draft.card_id,
    bill_month: payload.bill_month,
    statement_start: payload.statement_start,
    statement_end: payload.statement_end,
    statement_date: payload.statement_date,
    bill_amount: payload.bill_amount,
    min_payment: payload.min_payment || 0,
    due_date: payload.due_date,
    status: 'unpaid',
    items,
  })

  // Update draft status
  await db
    .from('bill_import_drafts')
    .update({
      status: 'confirmed',
      confirmed_at: new Date().toISOString(),
    })
    .eq('id', id)

  return bill
}

/**
 * Discard a bill import draft.
 */
export async function discardBillImportDraft(id: string): Promise<void> {
  const { error } = await db
    .from('bill_import_drafts')
    .update({ status: 'discarded' })
    .eq('id', id)

  if (error) throw error
}

/**
 * Check if a bill already exists for the given card and month.
 */
export async function checkDuplicateBill(
  cardId: string,
  billMonth: string
): Promise<Bill | null> {
  const { data, error } = await db
    .from('bills')
    .select('*')
    .eq('card_id', cardId)
    .eq('bill_month', billMonth)
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return data
}
