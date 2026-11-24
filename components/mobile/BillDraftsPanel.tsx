'use client'
// components/mobile/BillDraftsPanel.tsx — 统一账单草稿箱。
// 覆盖：待解锁加密 PDF、解析失败重试、缺字段/冲突核对、快捷建卡与重复账单对比确认。
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  getBillImportDrafts,
  confirmBillImportDraft,
  discardBillImportDraft,
  updateBillImportDraft,
  type BillImportDraft,
} from '@/lib/api/billDrafts'
import { isPresent } from './bill-editing-shared'
import { getCardsWithBillsSummary } from '@/lib/api/bills'
import { formatCardTail } from '@/lib/utils'
import { ConfirmDialog, Modal } from '@/components/obsidian/overlays'
import { Button, CheckRow } from '@/components/obsidian/controls'
import { TextField } from '@/components/obsidian/fields'
import { BillDraftEditForm, mergeDraftPayload, type BillDraftFieldValues } from './BillDraftEditForm'
import {
  batchDiscardBillDrafts,
  confirmBillImportDraftWithOptions,
  extractDuplicateBillDetails,
  formatAttributionLabel,
  formatDraftAmount,
  getDraftAttachmentPreviewUrl,
  retryParseDraft,
  suggestBankPasswordHint,
  unlockEncryptedDraft,
  type BillDraftPayload,
  type BillImportDraftOmnibus,
  type DuplicateBillDetails,
} from './omnibusApi'

type DraftItem = BillImportDraftOmnibus

interface CardSelectOption {
  id: string
  label: string
  currency?: string
}

function isCompleteDraft(p: BillDraftPayload, parseStatus?: string) {
  if (parseStatus && parseStatus !== 'ready') return false
  if (!isPresent(p.bill_amount) || !p.bill_month) return false
  if (Number(p.bill_amount) > 0 && !p.due_date) return false
  return true
}

function sourceLabelOf(draft: DraftItem): string {
  if (draft.source_label) return draft.source_label
  switch (draft.source_type) {
    case 'pdf':
      return 'PDF 上传'
    case 'image':
      return '截图识别'
    case 'text':
      return '文本导入'
    case 'share_ios':
      return 'iOS 分享'
    case 'legacy_ledger':
      return '历史账本迁入'
    case 'email':
    default:
      return '邮件同步'
  }
}

function parseUrgencyWeight(draft: DraftItem): number {
  const st = draft.parse_status ?? 'ready'
  if (st === 'needs_password') return 0
  if (st === 'parse_failed') return 1
  if (!isCompleteDraft(draft.parsed_payload, st) || !draft.card_id) return 2
  return 3
}

export function BillDraftsPanel({
  onChanged,
  onQuickCreateCard,
  focusDraftId,
  refreshToken = 0,
}: {
  onChanged?: () => void
  onQuickCreateCard?: (prefill: {
    draftId: string
    bankName?: string | null
    last4?: string | null
  }) => void
  focusDraftId?: string | null
  refreshToken?: number
}) {
  const [drafts, setDrafts] = useState<DraftItem[]>([])
  const [cards, setCards] = useState<CardSelectOption[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [unlockTarget, setUnlockTarget] = useState<DraftItem | null>(null)
  const [unlockPw, setUnlockPw] = useState('')
  const [unlockSaveVault, setUnlockSaveVault] = useState(true)
  const [unlockHint, setUnlockHint] = useState('')
  const [previewDraft, setPreviewDraft] = useState<DraftItem | null>(null)
  const [duplicateState, setDuplicateState] = useState<{
    draft: DraftItem
    details: DuplicateBillDetails
  } | null>(null)
  const [confirmBatchDiscardOpen, setConfirmBatchDiscardOpen] = useState(false)

  const reload = useCallback(async () => {
    try {
      const nextDrafts = (await getBillImportDrafts()) as unknown as DraftItem[]
      setDrafts(nextDrafts)
      setEditingId(id => (id !== null && !nextDrafts.some(draft => draft.id === id) ? null : id))
    } catch {
      // 取不到草稿不阻塞账单页
      setDrafts([])
    }
  }, [])

  useEffect(() => {
    void reload()
    void getCardsWithBillsSummary()
      .then(list =>
        setCards(
          list.map(c => ({
            id: c.card.id,
            currency: c.card.card_product?.currency,
            label: `${c.card.card_product?.bank_name ?? ''} ${formatCardTail(c.card.card_number_last4)}`.trim(),
          }))
        )
      )
      .catch(() => {})
  }, [reload, refreshToken])

  const sortedDrafts = useMemo(() => {
    return [...drafts].sort((a, b) => {
      if (focusDraftId) {
        if (a.id === focusDraftId && b.id !== focusDraftId) return -1
        if (b.id === focusDraftId && a.id !== focusDraftId) return 1
      }
      const wa = parseUrgencyWeight(a)
      const wb = parseUrgencyWeight(b)
      if (wa !== wb) return wa - wb
      return b.created_at.localeCompare(a.created_at)
    })
  }, [drafts, focusDraftId])

  if (!sortedDrafts.length) return null

  const patchCard = async (draft: DraftItem, cardId: string) => {
    setBusy(true)
    setError(null)
    try {
      await updateBillImportDraft(draft.id, { card_id: cardId || undefined })
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const saveDraftFields = async (draftId: string, values: BillDraftFieldValues) => {
    const draft = drafts.find(d => d.id === draftId)
    if (!draft) throw new Error('草稿不存在或已被处理')
    await updateBillImportDraft(draft.id, {
      parsed_payload: mergeDraftPayload(
        draft as unknown as BillImportDraft,
        values
      ) as BillImportDraft['parsed_payload'],
    })
  }

  const confirm = async (draft: DraftItem, forceMerge = false) => {
    setBusy(true)
    setError(null)
    try {
      if (forceMerge) {
        await confirmBillImportDraftWithOptions(draft.id, {
          conflict_resolution: 'merge_update',
        })
      } else {
        await confirmBillImportDraft(draft.id)
      }
      setDuplicateState(null)
      await reload()
      onChanged?.()
    } catch (err) {
      const dup = extractDuplicateBillDetails(err)
      if (dup) {
        setDuplicateState({ draft, details: dup })
      } else {
        setError(err instanceof Error ? err.message : String(err))
      }
    } finally {
      setBusy(false)
    }
  }

  const discard = async (draft: DraftItem) => {
    setBusy(true)
    setError(null)
    try {
      await discardBillImportDraft(draft.id)
      setDuplicateState(null)
      await reload()
      onChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const handleBatchDiscard = async () => {
    const targetIds = drafts
      .filter(d => d.parse_status === 'parse_failed' || d.parsed_payload.is_bill === false)
      .map(d => d.id)
    const idsToDiscard = targetIds.length > 0 ? targetIds : drafts.map(d => d.id)
    setConfirmBatchDiscardOpen(false)
    setBusy(true)
    setError(null)
    try {
      await batchDiscardBillDrafts(idsToDiscard)
      await reload()
      onChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const handleUnlockSubmit = async () => {
    if (!unlockTarget || !unlockPw) return
    setBusy(true)
    setError(null)
    try {
      await unlockEncryptedDraft(unlockTarget.id, {
        password: unlockPw,
        save_to_vault: unlockSaveVault,
        vault_label: `${unlockTarget.parsed_payload.bank_name || '月结单'}密码`,
        vault_holder_id: unlockTarget.holder_id ?? null,
        vault_bank_keyword: unlockTarget.parsed_payload.bank_name ?? null,
        vault_hint: unlockHint.trim() || null,
      })
      setUnlockTarget(null)
      setUnlockPw('')
      setUnlockHint('')
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const handleRetry = async (draft: DraftItem, manualMode = false) => {
    setBusy(true)
    setError(null)
    try {
      await retryParseDraft(draft.id, manualMode ? { manual_mode: true } : undefined)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const needsPasswordCount = drafts.filter(d => d.parse_status === 'needs_password').length

  return (
    <div className='px-4 pt-4'>
      <div className='rounded-2xl border border-d-border bg-d-surface p-4'>
        <div className='flex items-start justify-between gap-2'>
          <div>
            <p className='text-[15px] font-semibold leading-5 text-d-text'>
              待确认导入草稿 {drafts.length}
            </p>
            <p className='mt-0.5 text-[12px] leading-4 text-d-muted'>
              {needsPasswordCount > 0
                ? `含 ${needsPasswordCount} 份待解锁加密 PDF，核对无误后确认入库`
                : '全渠道识别结果统一停泊草稿箱，确认后写入主账单'}
            </p>
          </div>
          {drafts.length > 1 && (
            <button
              type='button'
              disabled={busy}
              onClick={() => setConfirmBatchDiscardOpen(true)}
              className='shrink-0 rounded-lg border border-d-border bg-d-subtle px-2.5 py-1 text-[11px] font-semibold text-d-muted hover:text-d-text disabled:opacity-40'
            >
              批量清理
            </button>
          )}
        </div>

        {error && <p className='mt-2 text-[12px] leading-4 text-d-danger-ink'>{error}</p>}

        {sortedDrafts.map(draft => {
          const p = draft.parsed_payload
          const parseStatus = draft.parse_status ?? 'ready'
          const matchedCard = cards.find(c => c.id === draft.card_id)
          const currency = p.currency || matchedCard?.currency || 'CNY'
          const completable = Boolean(isCompleteDraft(p, parseStatus) && draft.card_id)
          const attributionLabel = formatAttributionLabel(draft.attribution_source)
          const candidateIds = new Set(p.candidate_card_ids || [])
          const orderedCards =
            candidateIds.size > 0
              ? [
                  ...cards.filter(c => candidateIds.has(c.id)),
                  ...cards.filter(c => !candidateIds.has(c.id)),
                ]
              : cards

          return (
            <div
              key={draft.id}
              className={
                'mt-3 border-t border-d-border pt-3 text-[12px] text-d-muted ' +
                (focusDraftId === draft.id ? 'rounded-xl bg-d-subtle/40 px-2.5 pb-2.5' : '')
              }
            >
              {/* 标签行：来源 / 状态 / 置信度 / 归属依据 */}
              <div className='mb-1.5 flex flex-wrap items-center gap-1.5'>
                <span className='rounded-md border border-d-border bg-d-subtle px-1.5 py-0.5 text-[10px] font-semibold text-d-text'>
                  {sourceLabelOf(draft)}
                </span>
                {parseStatus === 'needs_password' && (
                  <span className='rounded-md border border-d-gold-deep/50 bg-d-gold-soft px-1.5 py-0.5 text-[10px] font-semibold text-d-gold'>
                    待输入 PDF 密码
                  </span>
                )}
                {parseStatus === 'parse_failed' && (
                  <span className='rounded-md border border-d-danger/40 bg-d-danger-soft px-1.5 py-0.5 text-[10px] font-semibold text-d-danger-ink'>
                    解析失败
                  </span>
                )}
                {draft.confidence != null && (
                  <span className='text-[11px] text-d-muted'>
                    置信度 {(draft.confidence * 100).toFixed(0)}%
                  </span>
                )}
                {attributionLabel && (
                  <span className='text-[11px] text-d-accent-light'>{attributionLabel}</span>
                )}
              </div>

              {/* 摘要行：动态币种符号，严禁硬编码 ¥ */}
              <p className='text-[13px] font-medium text-d-text'>
                {p.bank_name ? `${p.bank_name}${p.card_last4 ? ` (${p.card_last4})` : ''} · ` : ''}
                {p.bill_month ?? '未识别月份'}｜{formatDraftAmount(p.bill_amount, currency)}｜到期{' '}
                {p.due_date ?? '—'}
              </p>

              {/* 告警提示 */}
              {(p.warnings?.length ?? 0) > 0 && (
                <p className='mt-1 text-[11px] leading-4 text-d-warn-ink'>
                  提示：{p.warnings?.join('；')}
                </p>
              )}

              {draft.duplicate_bill_preview && (
                <p className='mt-1 text-[11px] leading-4 text-d-warn-ink'>
                  疑似重复账单：{draft.duplicate_bill_preview.bill_month} 已有{' '}
                  {formatDraftAmount(draft.duplicate_bill_preview.bill_amount, currency)}（
                  {draft.duplicate_bill_preview.status}）
                </p>
              )}

              {p.legacy_ledger && p.legacy_ledger.paid_amount > 0 && (
                <p className='mt-1 text-[11px] leading-4 text-d-success-ink'>
                  历史已还 {formatDraftAmount(p.legacy_ledger.paid_amount, currency)}，确认后自动继承还款记录
                </p>
              )}

              {parseStatus === 'ready' && (
                <div className='mt-2 flex items-center gap-2'>
                  <select
                    className='h-9 min-w-0 flex-1 rounded-lg border border-d-border bg-transparent px-2 text-d-text'
                    value={draft.card_id ?? ''}
                    disabled={busy}
                    onChange={e => void patchCard(draft, e.target.value)}
                  >
                    <option value=''>选择卡片（必选）</option>
                    {orderedCards.map(c => (
                      <option key={c.id} value={c.id}>
                        {candidateIds.has(c.id) ? `★ ${c.label}` : c.label}
                      </option>
                    ))}
                  </select>
                  {!draft.card_id && onQuickCreateCard && (p.bank_name || p.card_last4) && (
                    <button
                      type='button'
                      disabled={busy}
                      onClick={() =>
                        onQuickCreateCard({
                          draftId: draft.id,
                          bankName: p.bank_name,
                          last4: p.card_last4,
                        })
                      }
                      className='h-9 shrink-0 rounded-lg border border-d-accent/50 bg-d-subtle px-2.5 text-[11px] font-semibold text-d-accent-light'
                    >
                      + 新建卡片
                    </button>
                  )}
                </div>
              )}

              {!completable && parseStatus === 'ready' && (
                <p className='mt-1 text-[11px] leading-4 text-d-muted'>
                  {!draft.card_id
                    ? '选择卡片后可确认入库'
                    : '账单字段不全，确认前请补齐金额/月份/到期日'}
                </p>
              )}

              <div className='mt-2 flex flex-wrap gap-2'>
                {parseStatus === 'needs_password' && (
                  <button
                    type='button'
                    disabled={busy}
                    onClick={() => {
                      setUnlockTarget(draft)
                      setUnlockPw('')
                      setUnlockHint(
                        draft.password_hint ||
                          suggestBankPasswordHint(p.bank_name) ||
                          ''
                      )
                    }}
                    className='h-9 rounded-full bg-d-accent px-3.5 text-[12px] font-semibold text-white disabled:opacity-40'
                  >
                    输入密码解锁
                  </button>
                )}

                {parseStatus === 'parse_failed' && (
                  <>
                    <button
                      type='button'
                      disabled={busy}
                      onClick={() => void handleRetry(draft, false)}
                      className='h-9 rounded-full border border-d-accent px-3 text-[12px] font-semibold text-d-accent-light disabled:opacity-40'
                    >
                      重试解析
                    </button>
                    <button
                      type='button'
                      disabled={busy}
                      onClick={() => void handleRetry(draft, true)}
                      className='h-9 rounded-full border border-d-border px-3 text-[12px] font-semibold text-d-muted disabled:opacity-40'
                    >
                      转为手动填写
                    </button>
                  </>
                )}

                {parseStatus === 'ready' && (
                  <>
                    <button
                      type='button'
                      disabled={busy}
                      onClick={() => setEditingId(draft.id)}
                      className='h-9 rounded-full border border-d-border px-3 text-[12px] font-semibold text-d-muted disabled:opacity-40'
                    >
                      编辑字段
                    </button>
                    <button
                      type='button'
                      disabled={!completable || busy}
                      onClick={() => void confirm(draft, false)}
                      className='h-9 rounded-full border border-d-accent px-3 text-[12px] font-semibold text-d-accent-light disabled:opacity-40'
                    >
                      确认入库
                    </button>
                  </>
                )}

                {(draft.file_ref || draft.raw_text) && (
                  <button
                    type='button'
                    disabled={busy}
                    onClick={() => setPreviewDraft(draft)}
                    className='h-9 rounded-full border border-d-border px-3 text-[12px] font-semibold text-d-muted disabled:opacity-40'
                  >
                    查看原件
                  </button>
                )}

                <button
                  type='button'
                  disabled={busy}
                  onClick={() => void discard(draft)}
                  className='h-9 rounded-full border border-d-border px-3 text-[12px] font-semibold text-d-muted disabled:opacity-40'
                >
                  丢弃
                </button>
              </div>
            </div>
          )
        })}
      </div>

      <BillDraftEditForm
        open={editingId != null}
        draft={(drafts.find(d => d.id === editingId) as unknown as BillImportDraft) ?? null}
        cards={cards}
        onClose={() => setEditingId(null)}
        onSaved={() => void reload()}
        onSubmit={saveDraftFields}
      />

      {/* 原位解锁加密 PDF 弹窗 */}
      <Modal
        open={unlockTarget !== null}
        title='输入 PDF 密码解锁'
        onClose={() => !busy && setUnlockTarget(null)}
        dismissible={!busy}
        footer={
          <>
            <Button variant='ghost' onClick={() => setUnlockTarget(null)} disabled={busy}>
              取消
            </Button>
            <Button onClick={() => void handleUnlockSubmit()} loading={busy} disabled={!unlockPw}>
              解锁并解析
            </Button>
          </>
        }
      >
        {unlockTarget && (
          <div className='flex flex-col gap-3'>
            {(unlockTarget.password_hint ||
              suggestBankPasswordHint(unlockTarget.parsed_payload.bank_name)) && (
              <p className='rounded-xl border border-d-border bg-d-subtle px-3 py-2 text-[12px] text-d-muted'>
                密码提示：
                {unlockTarget.password_hint ||
                  suggestBankPasswordHint(unlockTarget.parsed_payload.bank_name)}
              </p>
            )}
            <TextField
              label='PDF 密码'
              type='password'
              value={unlockPw}
              onChange={e => setUnlockPw(e.target.value)}
              placeholder='请输入 PDF 打开密码'
            />
            <CheckRow checked={unlockSaveVault} onChange={setUnlockSaveVault}>
              保存到月结单密码本（下次自动解密）
            </CheckRow>
            {unlockSaveVault && (
              <TextField
                label='备注提示词（选填）'
                value={unlockHint}
                onChange={e => setUnlockHint(e.target.value)}
                placeholder='例如：身份证后6位'
              />
            )}
          </div>
        )}
      </Modal>

      {/* 原件预览弹窗 */}
      <Modal
        open={previewDraft !== null}
        title='账单原件溯源'
        maxWidth='md'
        onClose={() => setPreviewDraft(null)}
        footer={<Button onClick={() => setPreviewDraft(null)}>关闭</Button>}
      >
        {previewDraft && (
          <div className='flex flex-col gap-3'>
            {previewDraft.file_ref && (
              <div className='flex items-center justify-between rounded-xl border border-d-border bg-d-bg p-3'>
                <span className='text-[13px] text-d-text'>
                  附件原件（{previewDraft.source_type === 'pdf' ? 'PDF' : '文件'}）
                </span>
                <a
                  href={getDraftAttachmentPreviewUrl(previewDraft.file_ref)}
                  target='_blank'
                  rel='noreferrer'
                  className='rounded-lg bg-d-accent px-3 py-1.5 text-[12px] font-semibold text-white'
                >
                  新窗口打开原件
                </a>
              </div>
            )}
            {previewDraft.raw_text && (
              <pre className='max-h-72 overflow-auto whitespace-pre-wrap rounded-xl border border-d-border bg-d-bg p-3 text-[12px] leading-5 text-d-muted'>
                {previewDraft.raw_text}
              </pre>
            )}
          </div>
        )}
      </Modal>

      {/* 409 同卡同月重复账单对比确认 */}
      <ConfirmDialog
        open={duplicateState !== null}
        title='检测到同卡同月重复账单'
        onClose={() => !busy && setDuplicateState(null)}
        actions={
          <>
            <Button
              variant='ghost'
              size='sm'
              disabled={busy}
              onClick={() => duplicateState && void discard(duplicateState.draft)}
            >
              丢弃草稿
            </Button>
            <Button
              size='sm'
              loading={busy}
              onClick={() => duplicateState && void confirm(duplicateState.draft, true)}
            >
              合并更新原账单
            </Button>
          </>
        }
      >
        {duplicateState && (
          <div className='flex flex-col gap-2 text-[13px]'>
            <p className='text-d-muted'>
              目标月份 {duplicateState.details.existing_bill.bill_month} 已存在正式账单：
            </p>
            <div className='grid grid-cols-2 gap-2 rounded-xl border border-d-border bg-d-bg p-3'>
              <div>
                <p className='text-[11px] text-d-muted'>现有账单</p>
                <p className='mt-0.5 font-bold text-d-text'>
                  {formatDraftAmount(
                    duplicateState.details.existing_bill.bill_amount,
                    duplicateState.details.draft_bill.currency
                  )}
                </p>
                <p className='text-[11px] text-d-muted'>
                  状态：{duplicateState.details.existing_bill.status}
                </p>
              </div>
              <div>
                <p className='text-[11px] text-d-muted'>草稿金额</p>
                <p className='mt-0.5 font-bold text-d-accent-light'>
                  {formatDraftAmount(
                    duplicateState.details.draft_bill.bill_amount,
                    duplicateState.details.draft_bill.currency
                  )}
                </p>
                <p className='text-[11px] text-d-muted'>
                  到期：{duplicateState.details.draft_bill.due_date || '—'}
                </p>
              </div>
            </div>
          </div>
        )}
      </ConfirmDialog>

      {/* 批量清理确认 */}
      <ConfirmDialog
        open={confirmBatchDiscardOpen}
        title='批量清理草稿'
        onClose={() => setConfirmBatchDiscardOpen(false)}
        actions={
          <>
            <Button variant='ghost' size='sm' onClick={() => setConfirmBatchDiscardOpen(false)}>
              取消
            </Button>
            <Button variant='danger' size='sm' onClick={() => void handleBatchDiscard()}>
              确定清理
            </Button>
          </>
        }
      >
        <p className='text-[13px] leading-5 text-d-muted'>
          优先清理「解析失败 / 非账单」草稿；若无此类草稿，将清空当前全部待确认草稿。确定继续？
        </p>
      </ConfirmDialog>
    </div>
  )
}
