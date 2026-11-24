// app/api/attachments/[id]/route.ts — stream an attachment from R2, or delete it.
//
// HUB-156 安全修复（HUB-154 §3.2 / AC-12）：此前 GET/DELETE 只校验「已登录」，
// 任何用户都能按 id 枚举读取他人草稿原件。现在：
//   - record_type = 'draft'：仅上传者本人或该草稿的 created_by 可访问，否则 403；
//   - 其余类型：member 角色必须通过 assertRecordAccess。

import {
  getAttachmentById,
  deleteRecordAttachment,
} from '@/lib/api/attachments.server'
import { getWorkerEnv } from '@/lib/db/client'
import { readSession } from '@/lib/session'
import {
  assertDraftAttachmentAccess,
  assertRecordAccess,
  buildMemberContext,
  MemberScopeError,
} from '@/lib/api/member-scope'

async function sessionFrom(request: Request) {
  return readSession(request)
}

function r2Bucket(): R2Bucket | undefined {
  const env = getWorkerEnv()
  return env.ATTACHMENTS as R2Bucket | undefined
}

/** 归属校验：草稿附件对所有角色生效，其余类型只对 member 生效。 */
async function authorizeRecord(
  record: { id: string; record_type: string; record_id: string },
  session: { id: string; role: 'admin' | 'member' },
): Promise<Response | null> {
  try {
    if (record.record_type === 'draft') {
      await assertDraftAttachmentAccess(record.id, session.id)
      return null
    }
    if (session.role === 'member') {
      const ctx = await buildMemberContext(session)
      await assertRecordAccess(record.record_type, record.record_id, ctx)
    }
    return null
  } catch (err) {
    if (err instanceof MemberScopeError) {
      return Response.json({ error: err.message }, { status: 403 })
    }
    throw err
  }
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

  const denied = await authorizeRecord(record, session)
  if (denied) return denied

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

  const denied = await authorizeRecord(record, session)
  if (denied) return denied

  await deleteRecordAttachment(record)
  return Response.json({ data: null, error: null })
}
