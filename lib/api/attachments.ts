import { insforge } from '../insforge'

export const ATTACHMENT_BUCKET = 'record-attachments'

export interface RecordAttachment {
  id: string
  record_type: 'bill' | string
  record_id: string
  bucket: string
  storage_path: string
  file_name: string
  file_type?: string
  file_size?: number
  public_url?: string
  uploaded_by?: string
  created_at: string
}

function sanitizeFileName(name: string): string {
  const fallback = 'upload'
  const cleaned = name
    .trim()
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, '-')
    .slice(0, 160)
  return cleaned || fallback
}

function randomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function buildStoragePath(recordType: string, recordId: string, file: File): string {
  const safeName = sanitizeFileName(file.name)
  return `${recordType}/${recordId}/${Date.now()}-${randomId()}-${safeName}`
}

export async function getAttachments(recordType: string, recordId: string): Promise<RecordAttachment[]> {
  const { data, error } = await insforge.database
    .from('record_attachments')
    .select('*')
    .eq('record_type', recordType)
    .eq('record_id', recordId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data || []
}

export async function uploadRecordAttachment(
  recordType: string,
  recordId: string,
  file: File,
  uploadedBy?: string
): Promise<RecordAttachment> {
  const storagePath = buildStoragePath(recordType, recordId, file)
  const bucket = insforge.storage.from(ATTACHMENT_BUCKET)

  const { error: uploadError } = await bucket.upload(storagePath, file)
  if (uploadError) throw uploadError

  const publicUrl = bucket.getPublicUrl(storagePath)
  const { data, error } = await insforge.database
    .from('record_attachments')
    .insert([{
      record_type: recordType,
      record_id: recordId,
      bucket: ATTACHMENT_BUCKET,
      storage_path: storagePath,
      file_name: file.name,
      file_type: file.type || null,
      file_size: file.size,
      public_url: publicUrl,
      uploaded_by: uploadedBy || null,
    }])
    .select()
    .single()

  if (error) throw error
  return data
}

export async function deleteRecordAttachment(attachment: RecordAttachment): Promise<void> {
  const bucket = insforge.storage.from(attachment.bucket || ATTACHMENT_BUCKET)
  const { error: removeError } = await bucket.remove(attachment.storage_path)
  if (removeError) throw removeError

  const { error } = await insforge.database
    .from('record_attachments')
    .delete()
    .eq('id', attachment.id)

  if (error) throw error
}

export function getAttachmentUrl(attachment: RecordAttachment): string {
  return attachment.public_url || insforge.storage.from(attachment.bucket || ATTACHMENT_BUCKET).getPublicUrl(attachment.storage_path)
}
