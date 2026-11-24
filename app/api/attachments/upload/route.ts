// app/api/attachments/upload/route.ts — dedicated upload endpoint for R2
// attachments (replaces browser-side R2 access from the migration bridge).
//
// HUB-154 §3.2 两段式契约的第一段：10MB 级 PDF/图片绝不 Base64 塞进 RPC JSON
// （/api/rpc 设有 1MB 上限），先在这里流式直存 R2，再把 attachment_ids 交给
// billDrafts.importAndParseBill。
//
// 同时支持 Cookie `wc_user` 与 `Authorization: Bearer <session>`（iOS / Share
// Extension 走 Bearer）。record_type = 'draft' 时强制 ≤10MB + 魔数 + SHA-256；
// 其余类型在 member 角色下必须通过 assertRecordAccess（AC-12）。

import { uploadRecordAttachment, sha256Hex } from '@/lib/api/attachments.server'
import { readSession } from '@/lib/session'
import {
  buildMemberContext,
  assertRecordAccess,
  MemberScopeError,
} from '@/lib/api/member-scope'

/** 草稿原件硬上限（HUB-154 §1.2 / PRD §4.1.1）。 */
const MAX_DRAFT_ATTACHMENT_BYTES = 10 * 1024 * 1024
/** 非草稿附件沿用历史 20MB 上限。 */
const MAX_OTHER_ATTACHMENT_BYTES = 20 * 1024 * 1024

const ALLOWED_RECORD_TYPES = new Set(['draft', 'bill', 'card', 'holder'])

/** 魔数 → 规范 MIME。以字节为准，MIME 头只作提示（可伪造）。 */
function detectMagicType(bytes: Uint8Array): { mime: string | null; kind: 'pdf' | 'image' | null } {
  if (bytes.length >= 5) {
    const head = String.fromCharCode(...bytes.slice(0, 5))
    if (head === '%PDF-') return { mime: 'application/pdf', kind: 'pdf' }
  }
  if (bytes.length >= 8) {
    const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    if (png.every((byte, index) => bytes[index] === byte)) {
      return { mime: 'image/png', kind: 'image' }
    }
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mime: 'image/jpeg', kind: 'image' }
  }
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF') {
    if (String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') {
      return { mime: 'image/webp', kind: 'image' }
    }
  }
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(4, 8)) === 'ftyp') {
    const brand = String.fromCharCode(...bytes.slice(8, 12))
    if (brand === 'heic' || brand === 'heix' || brand === 'mif1') {
      return { mime: 'image/heic', kind: 'image' }
    }
  }
  return { mime: null, kind: null }
}

async function sessionFrom(request: Request) {
  return readSession(request)
}

function jsonError(error: string, status: number) {
  return Response.json({ error }, { status })
}

export async function POST(request: Request) {
  const session = await sessionFrom(request)
  if (!session) {
    return jsonError('未登录', 401)
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return jsonError('请求必须是 multipart/form-data', 400)
  }
  const recordType = form.get('record_type')
  const recordId = form.get('record_id')
  const file = form.get('file')
  if (typeof recordType !== 'string' || typeof recordId !== 'string' || !(file instanceof File)) {
    return jsonError('缺少 record_type / record_id / file', 400)
  }
  if (!ALLOWED_RECORD_TYPES.has(recordType)) {
    return jsonError('不支持的附件归属类型', 400)
  }
  if (!recordId.trim()) {
    return jsonError('缺少 record_id', 400)
  }

  const limit = recordType === 'draft' ? MAX_DRAFT_ATTACHMENT_BYTES : MAX_OTHER_ATTACHMENT_BYTES
  if (file.size > limit) {
    return jsonError(
      recordType === 'draft' ? '单个账单文件不能超过 10MB' : '附件不能超过 20MB',
      413,
    )
  }

  // 非草稿附件：member 必须证明自己对该记录有权限（fail-closed）。
  if (recordType !== 'draft' && session.role === 'member') {
    const ctx = await buildMemberContext(session)
    try {
      await assertRecordAccess(recordType, recordId, ctx)
    } catch (err) {
      if (err instanceof MemberScopeError) return jsonError(err.message, 403)
      throw err
    }
  }

  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(await file.arrayBuffer())
  } catch {
    return jsonError('读取上传内容失败', 400)
  }
  if (bytes.byteLength === 0) {
    return jsonError('上传内容为空', 400)
  }

  // 草稿原件只接受 PDF / PNG / JPEG / WebP / HEIC，且以魔数为准。
  const detected = detectMagicType(bytes)
  if (recordType === 'draft' && !detected.kind) {
    return jsonError('仅支持 PDF、PNG、JPEG、WebP、HEIC 格式的账单文件', 415)
  }

  try {
    const sha256 = await sha256Hex(bytes)
    const attachment = await uploadRecordAttachment(recordType, recordId, file, session.id, {
      sha256,
    })
    return Response.json({ data: { ...attachment, sha256 }, error: null })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return jsonError(message, 500)
  }
}
