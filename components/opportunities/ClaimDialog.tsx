'use client'

// components/opportunities/ClaimDialog.tsx — 普通领取（激活现有批次，不加额）
// 与实际奖励到账（quota 建有界配额 / non_quota 只记结果）分开设卡。

import { useRef, useState } from 'react'
import { ConfirmDialog } from '@/components/obsidian/overlays'
import { recordOpportunityClaim, recordTaskRewardReceived } from '@/lib/api/opportunities'

export function ClaimDialog({
  account,
  cycle,
  cardIds,
  onClose,
  onDone,
}: {
  account: { id: string; title: string }
  cycle: { id: string; activation_state: string }
  cardIds: string[]
  onClose: () => void
  onDone: () => void
}) {
  const [cardId, setCardId] = useState(cardIds[0] ?? '')
  const [claimedOn, setClaimedOn] = useState(new Date().toISOString().slice(0, 10))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const keyRef = useRef<string | null>(null)

  if (cycle.activation_state !== 'pending_claim') {
    return (
      <ConfirmDialog
        open
        title={`领取 · ${account.title}`}
        onClose={onClose}
        actions={
          <button type='button' onClick={onClose} className='h-10 rounded-xl px-5 text-sm font-semibold text-d-muted'>
            关闭
          </button>
        }
      >
        <p className='text-[12px] text-d-muted'>该批次不在待领取状态（{cycle.activation_state}）。</p>
      </ConfirmDialog>
    )
  }

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      if (!keyRef.current) {
        keyRef.current =
          typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? `claim-${crypto.randomUUID()}`
            : `claim-${Date.now()}`
      }
      await recordOpportunityClaim({
        account_id: account.id,
        cycle_id: cycle.id,
        card_id: cardId,
        claimed_on: claimedOn,
        request_key: keyRef.current,
      })
      keyRef.current = null
      onDone()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <ConfirmDialog
      open
      title={`记录领取 · ${account.title}`}
      onClose={busy ? () => {} : onClose}
      actions={
        <>
          <button
            type='button'
            disabled={busy}
            onClick={onClose}
            className='h-10 rounded-xl px-5 text-sm font-semibold text-d-muted disabled:opacity-50'
          >
            取消
          </button>
          <button
            type='button'
            disabled={busy || !cardId || !claimedOn}
            onClick={() => void submit()}
            className='h-10 rounded-xl bg-d-accent px-5 text-sm font-semibold text-white disabled:opacity-50'
          >
            {busy ? '提交中…' : '确认已领取'}
          </button>
        </>
      }
    >
      <p className='text-[12px] leading-4 text-d-muted'>
        记录“已在银行侧领取”；不新增额度，只激活本期配额。
      </p>
      <label className='mt-3 block'>
        <span className='mb-1 block text-[12px] font-semibold text-d-muted'>领取日期</span>
        <input
          type='date'
          value={claimedOn}
          onChange={(e) => setClaimedOn(e.target.value)}
          className='w-full rounded-xl border border-d-border bg-d-bg px-3 py-2 text-[16px] text-d-text outline-none focus:border-d-accent'
        />
      </label>
      {cardIds.length > 1 && (
        <label className='mt-3 block'>
          <span className='mb-1 block text-[12px] font-semibold text-d-muted'>使用的卡</span>
          <select
            value={cardId}
            onChange={(e) => setCardId(e.target.value)}
            className='w-full rounded-xl border border-d-border bg-d-bg px-3 py-2 text-[16px] text-d-text outline-none focus:border-d-accent'
          >
            {cardIds.map((id) => (
              <option key={id} value={id}>{id}</option>
            ))}
          </select>
        </label>
      )}
      {error && (
        <p className='mt-2 rounded-lg bg-d-danger-soft px-3 py-2 text-[12px] text-d-danger-ink'>{error}</p>
      )}
    </ConfirmDialog>
  )
}

/** 实际奖励到账：quota 建有界配额；non_quota 只记结果。 */
export function RewardReceivedDialog({
  taskCycle,
  rewardKey,
  rewardKind,
  accountId,
  onClose,
  onDone,
}: {
  taskCycle: { id: string; title: string }
  rewardKey: string
  rewardKind: 'quota' | 'non_quota'
  accountId: string | null
  onClose: () => void
  onDone: () => void
}) {
  const [receivedOn, setReceivedOn] = useState(new Date().toISOString().slice(0, 10))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const keyRef = useRef<string | null>(null)

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      if (!keyRef.current) {
        keyRef.current =
          typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? `reward-${crypto.randomUUID()}`
            : `reward-${Date.now()}`
      }
      await recordTaskRewardReceived({
        task_cycle_id: taskCycle.id,
        reward_key: rewardKey,
        received_on: receivedOn,
        account_id: rewardKind === 'quota' ? accountId : null,
        request_key: keyRef.current,
      })
      keyRef.current = null
      onDone()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <ConfirmDialog
      open
      title={`记录到账 · ${taskCycle.title}`}
      onClose={busy ? () => {} : onClose}
      actions={
        <>
          <button
            type='button'
            disabled={busy}
            onClick={onClose}
            className='h-10 rounded-xl px-5 text-sm font-semibold text-d-muted disabled:opacity-50'
          >
            取消
          </button>
          <button
            type='button'
            disabled={busy || !receivedOn || (rewardKind === 'quota' && !accountId)}
            onClick={() => void submit()}
            className='h-10 rounded-xl bg-d-accent px-5 text-sm font-semibold text-white disabled:opacity-50'
          >
            {busy ? '提交中…' : '确认到账'}
          </button>
        </>
      }
    >
      <p className='text-[12px] leading-4 text-d-muted'>
        {rewardKind === 'quota'
          ? '记录奖励配额实际到账：系统按计划发放窗口建立有界配额（起点不早于到账日）。'
          : '记录非配额奖励结果（如年费减免/礼品）；不产生可用额度。'}
        到预计日期不会自动发放。
      </p>
      <label className='mt-3 block'>
        <span className='mb-1 block text-[12px] font-semibold text-d-muted'>到账日期</span>
        <input
          type='date'
          value={receivedOn}
          onChange={(e) => setReceivedOn(e.target.value)}
          className='w-full rounded-xl border border-d-border bg-d-bg px-3 py-2 text-[16px] text-d-text outline-none focus:border-d-accent'
        />
      </label>
      {error && (
        <p className='mt-2 rounded-lg bg-d-danger-soft px-3 py-2 text-[12px] text-d-danger-ink'>{error}</p>
      )}
    </ConfirmDialog>
  )
}
