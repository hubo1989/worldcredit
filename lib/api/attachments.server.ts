import { query, queryOne, execute, uuid, now } from '../db'
import { getWorkerEnv } from '../db/client'

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

function buildStoragePath(recordType: string, recordId: string, fileName: string): string {
  const safeName = sanitizeFileName(fileName)
  return `${recordType}/${recordId}/${Date.now()}-${randomId()}-${safeName}`
}

export async function getAttachments(recordType: string, recordId: string): Promise<RecordAttachment[]> {
  const { data, error } = await query<RecordAttachment>(
    'SELECT * FROM record_attachments WHERE record_type = ? AND record_id = ? ORDER BY created_at DESC',
    [recordType, recordId]
  )
  if (error) throw new Error(error.message)
  return (data || []).map(a => ({ ...a, public_url: `/api/attachments/${a.id}` }))
}

export async function uploadRecordAttachment(
  recordType: string,
  recordId: string,
  file: File,
  uploadedBy?: string
): Promise<RecordAttachment> {
  const storagePath = buildStoragePath(recordType, recordId, file.name)
  const bucket = getWorkerEnv().ATTACHMENTS as R2Bucket | undefined
  if (!bucket) throw new Error('R2 binding "ATTACHMENTS" not found')

  const buffer = await file.arrayBuffer()
  await bucket.put(storagePath, buffer, {
    httpMetadata: { contentType: file.type || 'application/octet-stream' },
  })

  const id = uuid()
  const { error } = await execute(
    `INSERT INTO record_attachments (id, record_type, record_id, bucket, storage_path, file_name, file_type, file_size, uploaded_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, recordType, recordId, ATTACHMENT_BUCKET, storagePath, file.name,
     file.type || null, file.size, uploadedBy || null, now()]
  )
  if (error) throw new Error(error.message)

  const created = await getAttachmentById(id)
  if (!created) throw new Error('附件记录创建失败')
  return created
}

export async function getAttachmentById(id: string): Promise<RecordAttachment | null> {
  const { data } = await queryOne<RecordAttachment>(
    'SELECT * FROM record_attachments WHERE id = ?', [id]
  )
  return data ? { ...data, public_url: `/api/attachments/${data.id}` } : null
}

export async function deleteRecordAttachment(attachment: RecordAttachment): Promise<void> {
  const bucket = getWorkerEnv().ATTACHMENTS as R2Bucket | undefined
  if (bucket) {
    await bucket.delete(attachment.storage_path)
  }
  await execute('DELETE FROM record_attachments WHERE id = ?', [attachment.id])
}

export function getAttachmentUrl(attachment: RecordAttachment): string {
  return attachment.public_url || `/api/attachments/${attachment.id}`
}
