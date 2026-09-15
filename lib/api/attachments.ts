// lib/api/attachments.ts — client-side attachment helpers. Binary upload and
// download go through the dedicated /api/attachments routes (FormData / R2
// streaming); metadata goes through the RPC API.
import type * as Server from './attachments.server'
import { callRpc } from './rpc-client'

export type { RecordAttachment } from './attachments.server'

export function getAttachments(...args: Parameters<typeof Server.getAttachments>) {
  return callRpc<typeof Server.getAttachments>('attachments', 'getAttachments', ...args)
}

export function deleteRecordAttachment(...args: Parameters<typeof Server.deleteRecordAttachment>) {
  return callRpc<typeof Server.deleteRecordAttachment>('attachments', 'deleteRecordAttachment', ...args)
}

export async function uploadRecordAttachment(
  recordType: string,
  recordId: string,
  file: File,
  _uploadedBy?: string
): Promise<Server.RecordAttachment> {
  const form = new FormData()
  form.set('record_type', recordType)
  form.set('record_id', recordId)
  form.set('file', file)
  const res = await fetch('/api/attachments/upload', {
    method: 'POST',
    body: form,
    credentials: 'same-origin',
  })
  const payload = (await res.json().catch(() => null)) as { data?: Server.RecordAttachment; error?: string } | null
  if (!res.ok || !payload || payload.error || !payload.data) {
    throw new Error(payload?.error || `附件上传失败 (${res.status})`)
  }
  return payload.data
}

export function getAttachmentUrl(attachment: Server.RecordAttachment): string {
  return attachment.public_url || `/api/attachments/${attachment.id}`
}
