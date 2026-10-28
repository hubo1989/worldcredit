// lib/api/billDrafts.ts
import { query, queryOne, execute, uuid, now } from '../db'
import type { Bill } from '../types'
import { createBill } from './bills.server'
import type { BillItemInput } from './bills.server'
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

interface DraftRow {
  id: string
  created_by: string
  card_id: string | null
  source_type: string
  raw_text: string | null
  file_ref: string | null
  parsed_payload: string
  status: string
  confidence: number | null
  created_at: string
  confirmed_at: string | null
}

function rowToDraft(row: DraftRow): BillImportDraft {
  return {
    ...row,
    source_type: row.source_type as BillImportDraft['source_type'],
    status: row.status as BillImportDraft['status'],
    parsed_payload: JSON.parse(row.parsed_payload),
  }
}

export async function createBillImportDraft(input: CreateDraftInput): Promise<BillImportDraft> {
  const id = uuid()
  const { error } = await execute(
    `INSERT INTO bill_import_drafts (id, created_by, card_id, source_type, raw_text, file_ref, parsed_payload, confidence)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.created_by, input.card_id || null, input.source_type, input.raw_text || null,
     input.file_ref || null, JSON.stringify(input.parsed_payload), input.confidence || null]
  )
  if (error) throw new Error(error.message)
  const draft = await getBillImportDraft(id)
  return draft
}

export async function getBillImportDraft(id: string): Promise<BillImportDraft> {
  const { data, error } = await queryOne<DraftRow>(
    'SELECT * FROM bill_import_drafts WHERE id = ?', [id]
  )
  if (error) throw new Error(error.message)
  if (!data) throw new Error('草稿不存在')
  return rowToDraft(data)
}

export async function getBillImportDrafts(userId?: string): Promise<BillImportDraft[]> {
  if (!userId) return []
  const { data, error } = await query<DraftRow>(
    "SELECT * FROM bill_import_drafts WHERE created_by = ? AND status = 'draft' ORDER BY created_at DESC",
    [userId]
  )
  if (error) throw new Error(error.message)
  return (data || []).map(rowToDraft)
}

export async function updateBillImportDraft(
  id: string,
  updates: Partial<Pick<BillImportDraft, 'card_id' | 'parsed_payload' | 'confidence'>>
): Promise<BillImportDraft> {
  const fields: string[] = []
  const params: unknown[] = []
  if (updates.card_id !== undefined) { fields.push('card_id = ?'); params.push(updates.card_id) }
  if (updates.parsed_payload !== undefined) { fields.push('parsed_payload = ?'); params.push(JSON.stringify(updates.parsed_payload)) }
  if (updates.confidence !== undefined) { fields.push('confidence = ?'); params.push(updates.confidence) }
  if (fields.length === 0) throw new Error('没有需要更新的字段')
  params.push(id)
  const { error } = await execute(`UPDATE bill_import_drafts SET ${fields.join(', ')} WHERE id = ?`, params)
  if (error) throw new Error(error.message)
  return getBillImportDraft(id)
}

export async function confirmBillImportDraft(id: string): Promise<Bill> {
  const draft = await getBillImportDraft(id)
  if (draft.status !== 'draft') {
    throw new Error('只能确认草稿状态的账单')
  }
  const payload = draft.parsed_payload as unknown as {
    bill_amount?: number
    due_date?: string
    bill_month?: string
    statement_start?: string
    statement_end?: string
    statement_date?: string
    min_payment?: number
    items?: Record<string, unknown>[]
  }
  if (!payload.bill_amount || !payload.due_date || !payload.bill_month) {
    throw new Error('账单缺少必要字段')
  }
  if (!draft.card_id) {
    throw new Error('请先选择信用卡')
  }

  const duplicate = await checkDuplicateBill(draft.card_id, payload.bill_month)
  if (duplicate) {
    throw new Error(`该信用卡在 ${payload.bill_month} 已存在账单`)
  }

  const items: BillItemInput[] = (payload.items || []).map((item: Record<string, unknown>) => ({
    transaction_date: item.transaction_date as string,
    description: item.description as string,
    amount: item.amount as number,
    category: item.category as string,
    item_type: (item.item_type as 'purchase') || 'purchase',
    source: 'llm' as const,
    confidence: item.confidence as number | undefined,
    raw_text: item.raw_text as string | undefined,
    metadata: {
      draft_id: id,
      import_source: draft.source_type,
    },
  }))

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

  await execute(
    "UPDATE bill_import_drafts SET status = 'confirmed', confirmed_at = ? WHERE id = ?",
    [now(), id]
  )

  return bill
}

export async function discardBillImportDraft(id: string): Promise<void> {
  const { error } = await execute(
    "UPDATE bill_import_drafts SET status = 'discarded' WHERE id = ?", [id]
  )
  if (error) throw new Error(error.message)
}

export async function checkDuplicateBill(cardId: string, billMonth: string): Promise<Bill | null> {
  const { data } = await queryOne<Bill>(
    'SELECT * FROM bills WHERE card_id = ? AND bill_month = ? LIMIT 1', [cardId, billMonth]
  )
  return data
}
