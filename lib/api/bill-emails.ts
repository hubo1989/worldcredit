import { insforge } from '../insforge'

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
  const { data, error } = await insforge.database
    .from('bill_email_sources')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data || []
}

export async function addBillEmailSource(
  userId: string,
  email: string,
  label?: string
): Promise<BillEmailSource> {
  const normalized = normalizeEmail(email)
  const { data, error } = await insforge.database
    .from('bill_email_sources')
    .upsert({
      user_id: userId,
      email: normalized,
      label: label?.trim() || null,
      is_active: true,
    }, { onConflict: 'user_id,email' })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function setBillEmailSourceActive(id: string, isActive: boolean): Promise<BillEmailSource> {
  const { data, error } = await insforge.database
    .from('bill_email_sources')
    .update({ is_active: isActive })
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function deleteBillEmailSource(id: string): Promise<void> {
  const { error } = await insforge.database
    .from('bill_email_sources')
    .delete()
    .eq('id', id)

  if (error) throw error
}
