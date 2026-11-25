// lib/api/sync-gmail.server.ts — 旧「邮箱账本 → 卡包/账单」同步入口的安全桥接。
//
// 方向1（HUB-152 / HUB-154 §3.3(4)）之后，`gmail_ledger_entries` 不再自动建卡、
// 也不再直写 `bills`：历史条目幂等转入 `bill_import_drafts`，由人工确认后入账
// （AC-09）。本模块保留原 RPC 名与返回形状，避免 Web 既有调用方一次性改完。

import { syncUserGmail } from '../gmail/sync.server'
import { migrateLegacyLedgerToDrafts } from './billDrafts.server'

/**
 * 安全桥接：
 *   1) 历史账本 → 草稿箱（幂等，可重复调用）；
 *   2) 再拉一次 Gmail，让草稿箱里出现最新的待确认条目（失败不阻断迁移结果）。
 *
 * 返回形状保持 { syncedCardsCount, syncedBillsCount } 兼容既有调用方
 * （app/(mobile)/bills/page.tsx 只读这两个字段）。单轨之后两者恒为 0：
 * 新增的是草稿，不是卡或账单。
 */
export async function syncGmailLedgerToCardsAndBills(targetUserId?: string): Promise<{
  syncedCardsCount: number
  syncedBillsCount: number
  migratedDrafts: number
  gmailError?: string
}> {
  if (!targetUserId) {
    throw new Error('同步邮件账单需要当前用户 ID，禁止全局同步')
  }

  const { migrated } = await migrateLegacyLedgerToDrafts(targetUserId)

  let gmailError: string | undefined
  try {
    await syncUserGmail(targetUserId)
  } catch (err) {
    gmailError = err instanceof Error ? err.message : String(err)
  }

  return {
    syncedCardsCount: 0,
    syncedBillsCount: 0,
    migratedDrafts: migrated,
    ...(gmailError ? { gmailError } : {}),
  }
}
