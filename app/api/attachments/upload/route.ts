// app/api/attachments/upload/route.ts — dedicated upload endpoint for R2
// attachments (replaces browser-side R2 access from the migration bridge).

import { uploadRecordAttachment } from '@/lib/api/attachments.server'

function sessionUserId(request: Request): string | null {
  const cookie = request.headers.get('Cookie') ?? ''
  const match = cookie.match(/wc_user=([^;]+)/)
  if (!match) return null
  try {
    const parsed = JSON.parse(decodeURIComponent(match[1])) as { id?: string }
    return typeof parsed.id === 'string' ? parsed.id : null
  } catch {
    return null
  }
}

export async function POST(request: Request) {
  const userId = sessionUserId(request)
  if (!userId) {
    return Response.json({ error: '未登录' }, { status: 401 })
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return Response.json({ error: '请求必须是 multipart/form-data' }, { status: 400 })
  }
  const recordType = form.get('record_type')
  const recordId = form.get('record_id')
  const file = form.get('file')
  if (typeof recordType !== 'string' || typeof recordId !== 'string' || !(file instanceof File)) {
    return Response.json({ error: '缺少 record_type / record_id / file' }, { status: 400 })
  }
  if (file.size > 20 * 1024 * 1024) {
    return Response.json({ error: '附件不能超过 20MB' }, { status: 413 })
  }

  try {
    const attachment = await uploadRecordAttachment(recordType, recordId, file, userId)
    return Response.json({ data: attachment, error: null })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return Response.json({ error: message }, { status: 500 })
  }
}
