// lib/api/attachments.server.ts — record_attachments + R2 的服务端存取（server only）。
//
// HUB-156 变更（HUB-154 §3.2）：
//   1. 上传时计算 SHA-256 并落 record_attachments.sha256（0035 新增列，缺失时自动跳过）；
//   2. uploadRecordAttachment 接受 caller 传入的预计算 sha256，避免二次哈希；
//   3. 魔数校验留在 HTTP 路由层（那里有 MIME 语义），本模块只负责落库与 R2。

import { query, queryOne, execute, uuid, now } from '../db'
import { getWorkerEnv } from '../db/client'
import { tableColumns } from './schema-columns.server'

export const ATTACHMENT_BUCKET = 'record-attachments'

export interface RecordAttachment {
  id: string
  record_type: 'bill' | 'draft' | string
  record_id: string
  bucket: string
  storage_path: string
  file_name: string
  file_type?: string
  file_size?: number
  public_url?: string
  uploaded_by?: string
  sha256?: string | null
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

function buildStoragePath(
  recordType: string,
  recordId: string,
  fileName: string,
  uploadedBy?: string,
): string {
  const safeName = sanitizeFileName(fileName)
  // draft 原件按 HUB-154 §1.4 的约定放 draft-files/{userId}/{draftId}/…；
  // 非草稿类型沿用 {recordType}/{recordId}/… 以保持历史路径可读。
  if (recordType === 'draft') {
    return `draft-files/${uploadedBy || 'unknown'}/${recordId}/${Date.now()}-${randomId()}-${safeName}`
  }
  return `${recordType}/${recordId}/${Date.now()}-${randomId()}-${safeName}`
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer)
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
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
  uploadedBy?: string,
  opts?: { sha256?: string },
): Promise<RecordAttachment> {
  const storagePath = buildStoragePath(recordType, recordId, file.name, uploadedBy)
  const bucket = getWorkerEnv().ATTACHMENTS as R2Bucket | undefined
  if (!bucket) throw new Error('R2 binding "ATTACHMENTS" not found')

  const bytes = new Uint8Array(await file.arrayBuffer())
  const sha256 = opts?.sha256 || (await sha256Hex(bytes))
  await bucket.put(storagePath, bytes, {
    httpMetadata: { contentType: file.type || 'application/octet-stream' },
  })

  const id = uuid()
  const row: Record<string, unknown> = {
    id,
    record_type: recordType,
    record_id: recordId,
    bucket: ATTACHMENT_BUCKET,
    storage_path: storagePath,
    file_name: file.name,
    file_type: file.type || null,
    file_size: file.size,
    uploaded_by: uploadedBy || null,
    created_at: now(),
    sha256,
  }
  const columns = await tableColumns('record_attachments')
  const keys = Object.keys(row).filter(key => columns.has(key))
  const { error } = await execute(
    `INSERT INTO record_attachments (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
    keys.map(key => row[key]),
  )
  if (error) throw new Error(error.message)

  const created = await getAttachmentById(id)
  if (!created) throw new Error('附件记录创建失败')
  return { ...created, sha256 }
}

export async function getAttachmentById(id: string): Promise<RecordAttachment | null> {
  const { data } = await queryOne<RecordAttachment>(
    'SELECT * FROM record_attachments WHERE id = ?',
    [id]
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
