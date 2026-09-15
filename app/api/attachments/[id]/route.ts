// app/api/attachments/[id]/route.ts — stream an attachment from R2, or delete it.

import {
  getAttachmentById,
  deleteRecordAttachment,
} from '@/lib/api/attachments.server'
import { getWorkerEnv } from '@/lib/db/client'
import { readSession } from '@/lib/session'

async function sessionFrom(request: Request) {
  return readSession(request)
}

function r2Bucket(): R2Bucket | undefined {
  const env = getWorkerEnv()
  return env.ATTACHMENTS as R2Bucket | undefined
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await sessionFrom(request)
  if (!session) return Response.json({ error: '未登录' }, { status: 401 })
  const { id } = await params
  const record = await getAttachmentById(id)
  if (!record) return Response.json({ error: '附件不存在' }, { status: 404 })

  const bucket = r2Bucket()
  if (!bucket) return Response.json({ error: 'R2 绑定不可用' }, { status: 500 })

  const obj = await bucket.get(record.storage_path)
  if (!obj) return Response.json({ error: '附件文件缺失' }, { status: 404 })

  const headers = new Headers()
  headers.set('Content-Type', record.file_type || obj.httpMetadata?.contentType || 'application/octet-stream')
  headers.set('Content-Disposition', `inline; filename="${encodeURIComponent(record.file_name)}"`)
  headers.set('Cache-Control', 'private, max-age=3600')
  return new Response(obj.body, { headers })
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await sessionFrom(request)
  if (!session) return Response.json({ error: '未登录' }, { status: 401 })
  const { id } = await params
  const record = await getAttachmentById(id)
  if (!record) return Response.json({ error: '附件不存在' }, { status: 404 })
  await deleteRecordAttachment(record)
  return Response.json({ data: null, error: null })
}
