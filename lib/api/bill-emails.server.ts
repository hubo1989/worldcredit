import { query, queryOne, execute, uuid, now } from '../db'

export interface BillEmailSource {
  id: string
  user_id: string
  email: string
  label?: string
  is_active: boolean
  created_at: string
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export async function getBillEmailSources(userId: string): Promise<BillEmailSource[]> {
  const { data, error } = await query<BillEmailSource>(
    'SELECT * FROM bill_email_sources WHERE user_id = ? ORDER BY created_at DESC', [userId]
  )
  if (error) throw new Error(error.message)
  return (data || []).map(s => ({ ...(s as unknown as BillEmailSource), is_active: (s as unknown as Record<string, unknown>).is_active === 1 }))
}

export async function addBillEmailSource(userId: string, email: string, label?: string): Promise<BillEmailSource> {
  const normalized = normalizeEmail(email)
  const existing = await queryOne<BillEmailSource>(
    'SELECT * FROM bill_email_sources WHERE user_id = ? AND email = ?', [userId, normalized]
  )
  if (existing.data) {
    await execute(
      'UPDATE bill_email_sources SET label = ?, is_active = 1 WHERE id = ?',
      [label?.trim() || null, existing.data.id]
    )
    const updated = await queryOne<BillEmailSource>('SELECT * FROM bill_email_sources WHERE id = ?', [existing.data.id])
    return updated.data as unknown as BillEmailSource
  }
  const id = uuid()
  await execute(
    'INSERT INTO bill_email_sources (id, user_id, email, label, is_active, created_at) VALUES (?, ?, ?, ?, 1, ?)',
    [id, userId, normalized, label?.trim() || null, now()]
  )
  const created = await queryOne<BillEmailSource>('SELECT * FROM bill_email_sources WHERE id = ?', [id])
  return created.data as unknown as BillEmailSource
}

export async function setBillEmailSourceActive(id: string, isActive: boolean): Promise<BillEmailSource> {
  await execute('UPDATE bill_email_sources SET is_active = ? WHERE id = ?', [isActive ? 1 : 0, id])
  const updated = await queryOne<BillEmailSource>('SELECT * FROM bill_email_sources WHERE id = ?', [id])
  return updated.data as unknown as BillEmailSource
}

export async function deleteBillEmailSource(id: string): Promise<void> {
  const { error } = await execute('DELETE FROM bill_email_sources WHERE id = ?', [id])
  if (error) throw new Error(error.message)
}
