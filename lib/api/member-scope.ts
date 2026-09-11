// lib/api/member-scope.ts — family-member data isolation (server only).
//
// Members are bound to card_holders rows via card_holders.auth_user_id.
// Every member RPC goes through a guard here before the server function
// runs; guards fail closed with MemberScopeError (mapped to HTTP 403).
// Admins skip all guards.

import { query, queryOne } from '../db'

export class MemberScopeError extends Error {}

export interface MemberContext {
  userId: string
  role: 'admin' | 'member'
  holderIds: string[]
}

export async function buildMemberContext(user: {
  id: string
  role: 'admin' | 'member'
}): Promise<MemberContext> {
  if (user.role === 'admin') {
    return { userId: user.id, role: 'admin', holderIds: [] }
  }
  const { data } = await query<{ id: string }>('SELECT id FROM card_holders WHERE auth_user_id = ?', [
    user.id,
  ])
  return { userId: user.id, role: 'member', holderIds: (data || []).map(h => h.id) }
}

function memberAssert(condition: boolean, message: string): void {
  if (!condition) throw new MemberScopeError(message)
}

export function assertHolderAccess(holderId: unknown, ctx: MemberContext): void {
  memberAssert(typeof holderId === 'string' && ctx.holderIds.includes(holderId), '无权访问其他成员的数据')
}

export function assertHolderIdsAccess(holderIds: unknown, ctx: MemberContext): void {
  memberAssert(Array.isArray(holderIds), '参数必须是持卡人 ID 数组')
  const ids = holderIds as unknown[]
  memberAssert(ids.every(id => typeof id === 'string' && ctx.holderIds.includes(id)), '无权访问其他成员的数据')
}

export async function assertCardAccess(cardId: unknown, ctx: MemberContext): Promise<void> {
  memberAssert(typeof cardId === 'string', '参数必须是卡片 ID')
  const { data } = await queryOne<{ holder_id: string }>('SELECT holder_id FROM credit_cards WHERE id = ?', [cardId])
  memberAssert(!!data && ctx.holderIds.includes(data.holder_id), '无权访问其他成员的卡片')
}

export async function assertBillAccess(billId: unknown, ctx: MemberContext): Promise<void> {
  memberAssert(typeof billId === 'string', '参数必须是账单 ID')
  const { data } = await queryOne<{ holder_id: string }>(
    'SELECT cc.holder_id FROM bills b JOIN credit_cards cc ON b.card_id = cc.id WHERE b.id = ?',
    [billId]
  )
  memberAssert(!!data && ctx.holderIds.includes(data.holder_id), '无权访问其他成员的账单')
}

export async function assertBenefitAccess(benefitId: unknown, ctx: MemberContext): Promise<void> {
  memberAssert(typeof benefitId === 'string', '参数必须是权益 ID')
  const { data } = await queryOne<{ holder_id: string }>(
    "SELECT cc.holder_id FROM benefits bn JOIN credit_cards cc ON bn.card_product_id = cc.card_product_id WHERE bn.id = ? LIMIT 1",
    [benefitId]
  )
  memberAssert(!!data && ctx.holderIds.includes(data.holder_id), '无权使用其他成员卡片的权益')
}

export async function assertDraftAccess(draftId: unknown, ctx: MemberContext): Promise<void> {
  memberAssert(typeof draftId === 'string', '参数必须是草稿 ID')
  const { data } = await queryOne<{ created_by: string }>('SELECT created_by FROM bill_import_drafts WHERE id = ?', [draftId])
  memberAssert(!!data && data.created_by === ctx.userId, '无权操作其他用户的导入草稿')
}

const RECORD_TYPE_GUARDS: Record<string, (id: unknown, ctx: MemberContext) => Promise<void>> = {
  bill: assertBillAccess,
  card: assertCardAccess,
  holder: async (id, ctx) => assertHolderAccess(id, ctx),
}

export async function assertRecordAccess(recordType: unknown, recordId: unknown, ctx: MemberContext): Promise<void> {
  memberAssert(typeof recordType === 'string', '参数缺少记录类型')
  const guard = RECORD_TYPE_GUARDS[recordType as string]
  memberAssert(!!guard, '无权访问该类型记录的附件')
  await guard(recordId, ctx)
}

export async function assertEmailSourceAccess(sourceId: unknown, userId: string): Promise<void> {
  memberAssert(typeof sourceId === 'string', '参数必须是邮箱来源 ID')
  const { data } = await queryOne<{ user_id: string }>('SELECT user_id FROM bill_email_sources WHERE id = ?', [sourceId])
  memberAssert(!!data && data.user_id === userId, '无权操作其他用户的邮箱来源')
}

export async function assertBillListAccess(targetBills: unknown, ctx: MemberContext): Promise<void> {
  if (!Array.isArray(targetBills)) return
  for (const bill of targetBills) {
    const id = bill && typeof bill === 'object' ? (bill as { id?: unknown }).id : bill
    await assertBillAccess(id, ctx)
  }
}

/** Rewrite analytics filters so a member can only ever aggregate their own holder. */
export async function applyAnalyticsScope(filters: unknown, ctx: MemberContext): Promise<void> {
  memberAssert(!!filters && typeof filters === 'object' && !Array.isArray(filters), '参数必须是筛选对象')
  const f = filters as { holder_id?: unknown; card_id?: unknown }
  if (typeof f.card_id === 'string' && f.card_id) {
    await assertCardAccess(f.card_id, ctx)
    return
  }
  memberAssert(ctx.holderIds.length > 0, '当前账号未绑定持卡人档案')
  if (typeof f.holder_id === 'string' && f.holder_id) {
    assertHolderAccess(f.holder_id, ctx)
  } else {
    memberAssert(ctx.holderIds.length === 1, '请选择你自己的持卡人档案后重试')
    f.holder_id = ctx.holderIds[0]
  }
}

/** Response filter for card rows keyed by holder_id. */
export function filterCardsByHolder<T extends { holder_id?: string }>(rows: T[], ctx: MemberContext): T[] {
  return rows.filter(row => (row.holder_id ? ctx.holderIds.includes(row.holder_id) : false))
}

/** Response filter for holder rows. */
export function filterHolders<T extends { id: string }>(rows: T[], ctx: MemberContext): T[] {
  return rows.filter(row => ctx.holderIds.includes(row.id))
}
