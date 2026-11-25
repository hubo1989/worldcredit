'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  getGmailConnection,
  syncGmailNow,
  disconnectGmail,
} from '@/lib/api/gmail'
import { getHolders } from '@/lib/api/holders'
import { ConfirmDialog, Modal } from '@/components/obsidian/overlays'
import { Button, Toggle } from '@/components/obsidian/controls'
import { SelectField, TextField } from '@/components/obsidian/fields'
import type { CardHolder } from '@/lib/types'
import { RpcError } from '@/lib/api/rpc-client'
import {
  getGmailConnections,
  updateGmailConnection,
  syncGmailConnection,
  disconnectGmailConnection,
  getUserImportPreferences,
  updateUserImportPreferences,
  type GmailConnectionItem,
} from './omnibusApi'

const MAX_GMAIL_CONNECTIONS = 10

const CONNECTION_STATUS_TEXT: Record<GmailConnectionItem['status'], string> = {
  active: '已连接',
  revoked: '授权已过期，请重连',
  error: '异常',
}

function isMissingEndpointError(err: unknown): boolean {
  if (err instanceof RpcError) {
    return /接口不存在|未注册|404|not found/i.test(err.message)
  }
  return err instanceof Error && /接口不存在|未注册|404/.test(err.message)
}

export function GmailConnectPanel() {
  const [connections, setConnections] = useState<GmailConnectionItem[]>([])
  const [holders, setHolders] = useState<CardHolder[]>([])
  const [autoCommitTrustedEmail, setAutoCommitTrustedEmail] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [addOpen, setAddOpen] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [newDefaultHolderId, setNewDefaultHolderId] = useState('')

  const [editingConn, setEditingConn] = useState<GmailConnectionItem | null>(null)
  const [editLabel, setEditLabel] = useState('')
  const [editHolderId, setEditHolderId] = useState('')
  const [editMode, setEditMode] = useState<'auto_then_default' | 'force_default_unless_conflict'>(
    'auto_then_default'
  )
  const [editSyncEnabled, setEditSyncEnabled] = useState(true)

  const [disconnectTarget, setDisconnectTarget] = useState<GmailConnectionItem | null>(null)

  const reload = useCallback(async () => {
    const [holderList, importPrefs] = await Promise.all([
      getHolders().catch(() => [] as CardHolder[]),
      getUserImportPreferences().catch(() => ({ auto_commit_trusted_email: true })),
    ])
    setHolders(holderList)
    setAutoCommitTrustedEmail(importPrefs.auto_commit_trusted_email !== false)

    try {
      const list = await getGmailConnections()
      setConnections(list)
    } catch {
      // 兼容单连接旧端点（HUB-156 合入前兜底）
      try {
        const single = await getGmailConnection()
        if (single.email) {
          setConnections([
            {
              id: 'legacy-single',
              email: single.email,
              display_label: null,
              default_holder_id: null,
              attribution_mode: 'auto_then_default',
              sync_enabled: true,
              status: single.status ?? 'active',
              last_sync_at: single.last_sync_at,
              last_sync_summary: single.last_sync_summary,
              last_error: single.last_error,
              created_at: '',
            },
          ])
        } else {
          setConnections([])
        }
      } catch {
        setConnections([])
      }
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const syncConnection = async (connectionId?: string) => {
    setBusyId(connectionId ?? '__all__')
    setNotice('同步中…')
    try {
      const acc = { written: 0, drafted: 0, skipped: 0, failed: 0 }
      let remaining = 1
      for (let round = 0; remaining > 0 && round < 30; round++) {
        let s: { written: number; drafted: number; skipped: number; failed: number; remaining: number }
        try {
          s = await syncGmailConnection({ connectionId, maxMessages: 6 })
        } catch (err) {
          if (!isMissingEndpointError(err)) throw err
          s = await syncGmailNow(undefined, { maxMessages: 6 })
        }
        acc.written += s.written
        acc.drafted += s.drafted
        acc.skipped += s.skipped
        acc.failed += s.failed
        remaining = s.remaining
        setNotice(`同步中… 落账单 ${acc.written}｜草稿 ${acc.drafted}｜剩余 ${remaining} 封`)
      }
      setNotice(
        `同步完成：落账单 ${acc.written}，草稿 ${acc.drafted}，跳过 ${acc.skipped}，失败 ${acc.failed}`
      )
      await reload()
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyId(null)
    }
  }

  const handleConfirmDisconnect = async () => {
    const target = disconnectTarget
    setDisconnectTarget(null)
    if (!target) return
    setBusyId(target.id)
    try {
      try {
        await disconnectGmailConnection({ connectionId: target.id })
      } catch (err) {
        if (!isMissingEndpointError(err)) throw err
        await disconnectGmail()
      }
      setNotice(`已断开 ${target.email} 授权，其余邮箱与已导入账单不受影响`)
      await reload()
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyId(null)
    }
  }

  const openEditModal = (conn: GmailConnectionItem) => {
    setEditingConn(conn)
    setEditLabel(conn.display_label ?? '')
    setEditHolderId(conn.default_holder_id ?? '')
    setEditMode(conn.attribution_mode ?? 'auto_then_default')
    setEditSyncEnabled(conn.sync_enabled)
  }

  const saveEditConnection = async () => {
    if (!editingConn) return
    setBusyId(editingConn.id)
    try {
      await updateGmailConnection(editingConn.id, {
        display_label: editLabel.trim() || null,
        default_holder_id: editHolderId || null,
        attribution_mode: editMode,
        sync_enabled: editSyncEnabled,
      })
      setEditingConn(null)
      setNotice('邮箱归属设置已更新')
      await reload()
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyId(null)
    }
  }

  const handleToggleAutoCommit = async (parkAllToDrafts: boolean) => {
    const nextAutoCommit = !parkAllToDrafts
    setAutoCommitTrustedEmail(nextAutoCommit)
    try {
      await updateUserImportPreferences({ auto_commit_trusted_email: nextAutoCommit })
      setNotice(
        nextAutoCommit
          ? '已恢复默认：高可信匹配已有卡片的账单邮件自动入账'
          : '已开启安全模式：全部邮箱账单同步先停草稿箱人工复核'
      )
    } catch (err) {
      setAutoCommitTrustedEmail(!nextAutoCommit)
      setNotice(err instanceof Error ? err.message : '保存导入偏好失败')
    }
  }

  const buildOAuthStartUrl = () => {
    const params = new URLSearchParams()
    if (newDefaultHolderId) params.set('defaultHolderId', newDefaultHolderId)
    if (newLabel.trim()) params.set('label', newLabel.trim())
    const qs = params.toString()
    return `/api/auth/gmail/start${qs ? `?${qs}` : ''}`
  }

  const holderName = (holderId: string | null) =>
    holderId ? holders.find(h => h.id === holderId)?.name || '已绑持卡人' : '自动识别'

  return (
    <div className='flex flex-col gap-3 rounded-2xl border border-d-border bg-d-subtle/50 p-4'>
      <div className='flex items-start justify-between gap-2'>
        <div>
          <p className='text-[15px] font-semibold leading-5 text-d-text'>家庭多 Gmail 直连聚合</p>
          <p className='mt-0.5 text-[12px] leading-4 text-d-muted'>
            可同时连接本人及配偶/父母多个只读 Gmail（最多 10 个），按持卡人自动归属账单。
          </p>
        </div>
        <button
          type='button'
          disabled={connections.length >= MAX_GMAIL_CONNECTIONS}
          title={connections.length >= MAX_GMAIL_CONNECTIONS ? `最多绑定 ${MAX_GMAIL_CONNECTIONS} 个 Gmail` : undefined}
          onClick={() => setAddOpen(true)}
          className='min-h-[38px] shrink-0 rounded-xl bg-d-accent px-3 text-[12px] font-semibold text-white disabled:opacity-40'
        >
          {connections.length >= MAX_GMAIL_CONNECTIONS ? `已达上限 (${MAX_GMAIL_CONNECTIONS})` : '+ 添加邮箱'}
        </button>
      </div>

      {connections.length > 1 && (
        <button
          type='button'
          disabled={busyId !== null}
          onClick={() => void syncConnection(undefined)}
          className='flex min-h-[40px] w-full items-center justify-center rounded-xl border border-d-accent/50 bg-d-surface text-[13px] font-semibold text-d-accent-light disabled:opacity-50'
        >
          {busyId === '__all__' ? '⚡ 全部邮箱同步中…' : `⚡ 立即同步全部邮箱 (${connections.length})`}
        </button>
      )}

      {connections.length === 0 ? (
        <div className='rounded-xl border border-dashed border-d-border bg-d-bg/60 p-4'>
          <p className='text-[12px] leading-4 text-d-muted'>
            尚未连接 Gmail。授权只读权限后，系统会自动识别邮件正文及 PDF 月结单附件并生成草稿或入账。
          </p>
          <a
            href='/api/auth/gmail/start'
            className='mt-3 inline-flex min-h-[44px] items-center justify-center rounded-xl bg-d-accent px-5 text-[13px] font-semibold text-white'
          >
            连接 Gmail（只读）
          </a>
        </div>
      ) : (
        <div className='flex flex-col gap-2.5'>
          {connections.map(conn => {
            const isBusy = busyId === conn.id || busyId === '__all__'
            return (
              <div
                key={conn.id}
                className='rounded-xl border border-d-border bg-d-surface p-3.5'
              >
                <div className='flex items-center justify-between gap-2'>
                  <div className='min-w-0 flex-1'>
                    <div className='flex items-center gap-1.5'>
                      <p className='truncate text-[14px] font-bold text-d-text'>{conn.email}</p>
                      {conn.display_label && (
                        <span className='shrink-0 rounded-md bg-d-subtle px-1.5 py-0.5 text-[10px] font-semibold text-d-accent-light'>
                          {conn.display_label}
                        </span>
                      )}
                    </div>
                    <p className='mt-0.5 text-[11px] text-d-muted'>
                      默认持卡人：{holderName(conn.default_holder_id)} ·{' '}
                      {conn.sync_enabled ? '自动同步已开启' : '已暂停同步'}
                    </p>
                  </div>
                  <span
                    className={
                      'shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ' +
                      (conn.status === 'active'
                        ? 'border-d-success-ink/30 bg-d-success-soft text-d-success-ink'
                        : 'border-d-danger/40 bg-d-danger-soft text-d-danger-ink')
                    }
                  >
                    {CONNECTION_STATUS_TEXT[conn.status] ?? '异常'}
                  </span>
                </div>

                <p className='mt-1.5 text-[11px] leading-4 text-d-muted'>
                  {conn.last_sync_at ? `上次同步 ${conn.last_sync_at}` : '尚未同步'}
                  {conn.last_sync_summary ? `｜${conn.last_sync_summary}` : ''}
                </p>
                {conn.last_error && (
                  <p className='mt-1 text-[11px] leading-4 text-d-danger-ink'>
                    错误：{conn.last_error}
                  </p>
                )}

                <div className='mt-2.5 flex flex-wrap gap-2'>
                  <button
                    type='button'
                    onClick={() => void syncConnection(conn.id)}
                    disabled={isBusy}
                    className='min-h-[38px] flex-1 rounded-xl bg-d-accent px-3 text-[12px] font-semibold text-white disabled:opacity-50'
                  >
                    {busyId === conn.id ? '同步中…' : '立即同步'}
                  </button>
                  {conn.id !== 'legacy-single' && (
                    <button
                      type='button'
                      onClick={() => openEditModal(conn)}
                      disabled={isBusy}
                      className='min-h-[38px] rounded-xl border border-d-border bg-d-subtle px-3 text-[12px] font-semibold text-d-text disabled:opacity-50'
                    >
                      归属设置
                    </button>
                  )}
                  {conn.status === 'revoked' && (
                    <a
                      href='/api/auth/gmail/start'
                      className='inline-flex min-h-[38px] items-center rounded-xl border border-d-gold-deep bg-d-gold-soft px-3 text-[12px] font-semibold text-d-gold'
                    >
                      重连
                    </a>
                  )}
                  <button
                    type='button'
                    onClick={() => setDisconnectTarget(conn)}
                    disabled={isBusy}
                    className='min-h-[38px] rounded-xl border border-d-danger/50 bg-d-danger-soft px-3 text-[12px] font-semibold text-d-danger-ink disabled:opacity-50'
                  >
                    断开
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* 全局入账安全开关 */}
      <div className='flex items-center justify-between gap-3 rounded-xl border border-d-border bg-d-surface px-3.5 py-3'>
        <div className='min-w-0 flex-1'>
          <p className='text-[13px] font-semibold text-d-text'>全部邮箱同步先停草稿箱复核</p>
          <p className='mt-0.5 text-[11px] leading-4 text-d-muted'>
            开启后，高可信自动邮件也会先进入待确认草稿箱，由人工核对后再入账。
          </p>
        </div>
        <Toggle
          checked={!autoCommitTrustedEmail}
          onChange={v => void handleToggleAutoCommit(v)}
          ariaLabel='全部邮箱同步先停草稿箱复核'
        />
      </div>

      {notice && <p className='text-[12px] leading-4 text-d-muted'>{notice}</p>}

      {/* 添加新邮箱配置弹窗 */}
      <Modal
        open={addOpen}
        title='添加家庭 Gmail 邮箱'
        onClose={() => setAddOpen(false)}
        footer={
          <>
            <Button variant='ghost' onClick={() => setAddOpen(false)}>
              取消
            </Button>
            <a
              href={buildOAuthStartUrl()}
              className='inline-flex h-11 items-center justify-center rounded-xl bg-d-accent px-5 text-[14px] font-semibold text-white'
            >
              前往 Google 授权（只读）
            </a>
          </>
        }
      >
        <div className='flex flex-col gap-3'>
          <TextField
            label='邮箱备注（选填）'
            placeholder='例如：老婆主邮箱 / 爸爸招行卡'
            value={newLabel}
            onChange={e => setNewLabel(e.target.value)}
          />
          <SelectField
            label='默认归属持卡人（选填）'
            value={newDefaultHolderId}
            onChange={e => setNewDefaultHolderId(e.target.value)}
            options={[
              { value: '', label: '不固定（优先从邮件/PDF自动识别）' },
              ...holders.map(h => ({ value: h.id, label: h.name })),
            ]}
            helperText='若绑定的家庭成员邮箱收到的外文账单缺少中文称呼，将自动归属该持卡人'
          />
        </div>
      </Modal>

      {/* 编辑单个邮箱连接归属 */}
      <Modal
        open={editingConn !== null}
        title='编辑邮箱归属与同步'
        onClose={() => setEditingConn(null)}
        footer={
          <>
            <Button variant='ghost' onClick={() => setEditingConn(null)}>
              取消
            </Button>
            <Button onClick={() => void saveEditConnection()} loading={busyId === editingConn?.id}>
              保存
            </Button>
          </>
        }
      >
        <div className='flex flex-col gap-3'>
          <p className='text-[12px] text-d-muted'>邮箱：{editingConn?.email}</p>
          <TextField
            label='备注名称（选填）'
            placeholder='例如：配偶主邮箱'
            value={editLabel}
            onChange={e => setEditLabel(e.target.value)}
          />
          <SelectField
            label='默认归属持卡人'
            value={editHolderId}
            onChange={e => setEditHolderId(e.target.value)}
            options={[
              { value: '', label: '未指定（仅靠邮件与卡号识别）' },
              ...holders.map(h => ({ value: h.id, label: h.name })),
            ]}
          />
          <SelectField
            label='归属判定策略'
            value={editMode}
            onChange={e =>
              setEditMode(
                e.target.value as 'auto_then_default' | 'force_default_unless_conflict'
              )
            }
            options={[
              { value: 'auto_then_default', label: '优先按邮件/PDF认人，未命中时用默认持卡人' },
              { value: 'force_default_unless_conflict', label: '强绑定默认持卡人（仅显式冲突时停草稿）' },
            ]}
          />
          <div className='flex items-center justify-between rounded-xl border border-d-border bg-d-bg px-3 py-2.5'>
            <span className='text-[13px] font-medium text-d-text'>参与定时与一键同步</span>
            <Toggle checked={editSyncEnabled} onChange={setEditSyncEnabled} ariaLabel='启用同步' />
          </div>
        </div>
      </Modal>

      {/* 断开单个连接确认 */}
      <ConfirmDialog
        open={disconnectTarget !== null}
        title='断开 Gmail 授权'
        onClose={() => setDisconnectTarget(null)}
        actions={
          <>
            <button
              type='button'
              onClick={() => setDisconnectTarget(null)}
              className='min-h-[44px] rounded-xl border border-d-border bg-d-surface px-4 text-sm font-medium text-d-text'
            >
              取消
            </button>
            <button
              type='button'
              onClick={() => void handleConfirmDisconnect()}
              className='min-h-[44px] rounded-xl bg-d-danger px-4 text-sm font-semibold text-white'
            >
              确定断开
            </button>
          </>
        }
      >
        <p className='text-[13px] leading-5 text-d-muted'>
          仅断开「{disconnectTarget?.email}」的 OAuth 授权并清理该邮箱的原始邮件缓存，已导入账单、待确认草稿及其他邮箱连接均不受影响。确认断开？
        </p>
      </ConfirmDialog>
    </div>
  )
}
