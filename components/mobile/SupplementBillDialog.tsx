'use client'

import { useEffect, useMemo, useState } from 'react'
import { Modal } from '@/components/obsidian/overlays'
import { Button, CheckRow } from '@/components/obsidian/controls'
import { SelectField, TextField } from '@/components/obsidian/fields'
import { Alert } from '@/components/obsidian/feedback'
import { getBillByCardMonth } from '@/lib/api/bills'
import { currencySymbol } from '@/lib/fx'
import {
  formatCardTail,
  getEffectiveCardName,
  getLocalTodayString,
  isValidCalendarDate,
} from '@/lib/utils'
import {
  actualStatementDateInMonth,
  clampBillingDay,
  computeSuggestedDueDate,
  extractExistingBillIdFromConflict,
  normalizeYearMonth,
  supplementMissingBill,
  type CardWithMissingStatement,
  type MissingStatementSummary,
  type SupplementMissingBillResult,
} from './supplementBillApi'

export interface SupplementBillDialogProps {
  open: boolean
  onClose: () => void
  onSuccess: (
    result: SupplementMissingBillResult,
    context: { cardId: string; billMonth: string }
  ) => void
  cardsSummary: CardWithMissingStatement[]
  holderMap?: Record<string, string>
  initialCardId?: string | null
  initialBillMonth?: string | null
  initialMissingSummary?: MissingStatementSummary | null
  onSwitchToImport?: (cardId: string) => void
  onOpenDraft?: (draftId: string) => void
  onOpenExistingBill?: (billId: string) => void
}

function createUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, ch => {
    const r = (Math.random() * 16) | 0
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

export function SupplementBillDialog({
  open,
  onClose,
  onSuccess,
  cardsSummary,
  holderMap = {},
  initialCardId = null,
  initialBillMonth = null,
  initialMissingSummary = null,
  onSwitchToImport,
  onOpenDraft,
  onOpenExistingBill,
}: SupplementBillDialogProps) {
  const selectableCards = useMemo(() => {
    return cardsSummary.filter(item => {
      const status = item.card.status ?? 'active'
      const cardType = item.card.card_type ?? 'credit'
      if (status !== 'active' || cardType !== 'credit') return false
      if (item.account?.status === 'archived') return false
      if (item.account?.statement_mode === 'merged' && item.isAnchorCard === false) return false
      return true
    })
  }, [cardsSummary])

  const [selectedCardId, setSelectedCardId] = useState('')
  const [billMonth, setBillMonth] = useState('')
  const [billAmount, setBillAmount] = useState('')
  const [minPayment, setMinPayment] = useState('')
  const [statementDate, setStatementDate] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [statementDateDirty, setStatementDateDirty] = useState(false)
  const [dueDateDirty, setDueDateDirty] = useState(false)
  const [minPaymentDirty, setMinPaymentDirty] = useState(false)
  const [markAsPaid, setMarkAsPaid] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [statementStart, setStatementStart] = useState('')
  const [statementEnd, setStatementEnd] = useState('')
  const [subtotalDrafts, setSubtotalDrafts] = useState<Record<string, string>>({})

  const [remoteExistingBillId, setRemoteExistingBillId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflictBillId, setConflictBillId] = useState<string | null>(null)
  const [clientRequestId, setClientRequestId] = useState<string>(() => createUuid())

  const selectedItem = useMemo(() => {
    const byDirect = cardsSummary.find(c => c.card.id === selectedCardId)
    if (byDirect) return byDirect
    return selectableCards[0] ?? null
  }, [cardsSummary, selectableCards, selectedCardId])

  const activeMergedMembers = useMemo(() => {
    if (!selectedItem || selectedItem.account?.statement_mode !== 'merged') return []
    const members = selectedItem.memberCards ?? [selectedItem.card]
    return members.filter(
      m => (m.status ?? 'active') === 'active' && (m.card_type ?? 'credit') === 'credit'
    )
  }, [selectedItem])

  const isMergedAccount =
    selectedItem?.account?.statement_mode === 'merged' && activeMergedMembers.length >= 2

  const effectiveBillingDay = useMemo(() => {
    if (!selectedItem) return 1
    return clampBillingDay(
      selectedItem.card.override_billing_day ??
        selectedItem.card.billing_day ??
        selectedItem.account?.billing_day ??
        1
    )
  }, [selectedItem])

  // 初始化打开态
  useEffect(() => {
    if (!open) return
    const todayStr = getLocalTodayString('Asia/Shanghai')
    const defaultCard =
      cardsSummary.find(c => c.card.id === initialCardId) ??
      cardsSummary.find(c => c.memberCards?.some(m => m.id === initialCardId)) ??
      selectableCards[0] ??
      null
    const resolvedCardId = defaultCard?.card.id ?? initialCardId ?? ''
    const resolvedMonth =
      normalizeYearMonth(initialBillMonth) ??
      initialMissingSummary?.missingBillMonth ??
      defaultCard?.missingStatement?.missingBillMonth ??
      todayStr.slice(0, 7)

    setSelectedCardId(resolvedCardId)
    setBillMonth(resolvedMonth)
    setBillAmount('')
    setMinPayment('')
    setStatementDateDirty(false)
    setDueDateDirty(false)
    setMinPaymentDirty(false)
    setMarkAsPaid(false)
    setAdvancedOpen(false)
    setStatementStart('')
    setStatementEnd('')
    setSubtotalDrafts({})
    setRemoteExistingBillId(null)
    setError(null)
    setConflictBillId(null)
    setClientRequestId(createUuid())

    if (defaultCard) {
      const bDay = clampBillingDay(
        defaultCard.card.override_billing_day ??
          defaultCard.card.billing_day ??
          defaultCard.account?.billing_day ??
          1
      )
      setStatementDate(actualStatementDateInMonth(bDay, resolvedMonth))
      setDueDate(
        computeSuggestedDueDate(
          defaultCard.card,
          defaultCard.card.card_product,
          resolvedMonth,
          defaultCard.account
        )
      )
    } else {
      setStatementDate('')
      setDueDate('')
    }
  }, [open, initialCardId, initialBillMonth, initialMissingSummary, cardsSummary, selectableCards])

  // 当卡或缺失账期变化时，对未手改过的日期自动重新推算
  useEffect(() => {
    if (!open || !selectedItem) return
    const normalized = normalizeYearMonth(billMonth)
    if (!normalized) return
    if (!statementDateDirty) {
      setStatementDate(actualStatementDateInMonth(effectiveBillingDay, normalized))
    }
    if (!dueDateDirty) {
      setDueDate(
        computeSuggestedDueDate(
          selectedItem.card,
          selectedItem.card.card_product,
          normalized,
          selectedItem.account
        )
      )
    }
  }, [open, selectedItem, billMonth, effectiveBillingDay, statementDateDirty, dueDateDirty])

  const localExistingBill = useMemo(() => {
    const normalized = normalizeYearMonth(billMonth)
    if (!selectedItem || !normalized) return null
    return (
      selectedItem.historyBills.find(
        b => normalizeYearMonth(b.bill_month) === normalized
      ) ?? null
    )
  }, [selectedItem, billMonth])

  // 远端兜底查重：防止 historyBills 仅载入近 500 条时漏判更早期账单
  useEffect(() => {
    if (!open || !selectedCardId) return
    const normalized = normalizeYearMonth(billMonth)
    if (!normalized || localExistingBill) {
      setRemoteExistingBillId(null)
      return
    }
    let cancelled = false
    void getBillByCardMonth(selectedCardId, normalized)
      .then(bill => {
        if (!cancelled) setRemoteExistingBillId(bill?.id ?? null)
      })
      .catch(() => {
        if (!cancelled) setRemoteExistingBillId(null)
      })
    return () => {
      cancelled = true
    }
  }, [open, selectedCardId, billMonth, localExistingBill])

  const existingBillId = localExistingBill?.id ?? remoteExistingBillId

  const pendingDraftInfo = useMemo(() => {
    const normalized = normalizeYearMonth(billMonth)
    const missing = initialMissingSummary ?? selectedItem?.missingStatement ?? null
    if (!missing || !missing.pendingDraftId) return null
    if (normalized && missing.missingBillMonth !== normalized) return null
    return {
      id: missing.pendingDraftId,
      status: missing.pendingDraftStatus,
      month: missing.missingBillMonth,
    }
  }, [billMonth, initialMissingSummary, selectedItem])

  const todayStr = getLocalTodayString('Asia/Shanghai')
  const parsedAmountNum = Number(billAmount.trim())
  const showMarkAsPaidOption =
    billAmount.trim() !== '' &&
    Number.isFinite(parsedAmountNum) &&
    parsedAmountNum > 0 &&
    isValidCalendarDate(dueDate.trim()) &&
    dueDate.trim() < todayStr

  useEffect(() => {
    if (!showMarkAsPaidOption && markAsPaid) {
      setMarkAsPaid(false)
    }
  }, [showMarkAsPaidOption, markAsPaid])

  const cardContextHeader = useMemo(() => {
    if (!selectedItem) return ''
    const bankName =
      selectedItem.card.card_product?.bank_name || selectedItem.account?.bank_name || '银行卡'
    const holderName = holderMap[selectedItem.holder_id]
    if (isMergedAccount) {
      const tails = activeMergedMembers
        .map(m => formatCardTail(m.card_number_last4))
        .filter(Boolean)
      const tailText =
        tails.length > 0 ? `含尾号 ${tails.join(' · ')}` : `${activeMergedMembers.length} 张卡`
      return `${bankName} 合并账单（${tailText}）${holderName ? ` · ${holderName}` : ''}`
    }
    const cardName = getEffectiveCardName(selectedItem.card, selectedItem.card.card_product)
    const tail = formatCardTail(selectedItem.card.card_number_last4)
    return `${bankName} · ${cardName}${tail ? `（尾号 ${tail}）` : ''}${holderName ? ` · ${holderName}` : ''}`
  }, [selectedItem, holderMap, isMergedAccount, activeMergedMembers])

  const currency =
    selectedItem?.card.card_product?.currency || selectedItem?.account?.currency || 'CNY'
  const currencySym = currencySymbol(currency)

  const handleResetDates = () => {
    if (!selectedItem) return
    const normalized = normalizeYearMonth(billMonth)
    if (!normalized) return
    setStatementDateDirty(false)
    setDueDateDirty(false)
    setStatementDate(actualStatementDateInMonth(effectiveBillingDay, normalized))
    setDueDate(
      computeSuggestedDueDate(
        selectedItem.card,
        selectedItem.card.card_product,
        normalized,
        selectedItem.account
      )
    )
  }

  const submitPayload = async (isZeroQuickConfirm: boolean) => {
    setError(null)
    setConflictBillId(null)

    const targetCardId = selectedItem?.card.id || selectedCardId
    if (!targetCardId) {
      setError('请选择需要补录的信用卡')
      return
    }
    const normalizedMonth = normalizeYearMonth(billMonth)
    if (!normalizedMonth) {
      setError('请选择有效的账单月份（YYYY-MM）')
      return
    }

    const trimmedDue = dueDate.trim()
    if (!isValidCalendarDate(trimmedDue)) {
      setError('最后还款日应为 YYYY-MM-DD 格式的真实日历日')
      return
    }
    const trimmedStmt = statementDate.trim()
    if (trimmedStmt && !isValidCalendarDate(trimmedStmt)) {
      setError('账单日应为 YYYY-MM-DD 格式的真实日历日')
      return
    }
    const trimmedStart = statementStart.trim()
    const trimmedEnd = statementEnd.trim()
    if (trimmedStart && !isValidCalendarDate(trimmedStart)) {
      setError('账期开始日应为 YYYY-MM-DD 格式的真实日历日')
      return
    }
    if (trimmedEnd && !isValidCalendarDate(trimmedEnd)) {
      setError('账期结束日应为 YYYY-MM-DD 格式的真实日历日')
      return
    }
    if (trimmedStart && trimmedEnd && trimmedStart > trimmedEnd) {
      setError('账期开始日不能晚于账期结束日')
      return
    }

    let finalAmount = 0
    let finalMinPayment: number | null = 0
    let finalPinMinPayment = false

    if (!isZeroQuickConfirm) {
      const trimmedAmt = billAmount.trim()
      if (!trimmedAmt) {
        setError('请输入本期应还金额（无消费可点击上方「确认 0 元零账单」）')
        return
      }
      const amtNum = Number(trimmedAmt)
      if (!Number.isFinite(amtNum) || amtNum < 0) {
        setError('应还金额必须是大于等于 0 的有效数字')
        return
      }
      finalAmount = amtNum

      const trimmedMin = minPayment.trim()
      if (trimmedMin !== '') {
        const minNum = Number(trimmedMin)
        if (!Number.isFinite(minNum) || minNum < 0) {
          setError('最低还款额必须是不小于 0 的数字')
          return
        }
        finalMinPayment = minNum
        finalPinMinPayment = minPaymentDirty || true
      } else {
        finalMinPayment = amtNum === 0 ? 0 : null
        finalPinMinPayment = false
      }
    }

    const subtotals = isMergedAccount
      ? activeMergedMembers
          .map(member => {
            const raw = (subtotalDrafts[member.id] ?? '').trim()
            if (!raw) return null
            const val = Number(raw)
            if (!Number.isFinite(val)) return null
            return {
              card_id: member.id,
              card_tail: formatCardTail(member.card_number_last4) || '----',
              subtotal_amount: val,
              currency,
            }
          })
          .filter((s): s is NonNullable<typeof s> => s !== null)
      : undefined

    setSubmitting(true)
    try {
      const result = await supplementMissingBill({
        id: clientRequestId,
        card_id: targetCardId,
        bill_month: normalizedMonth,
        bill_amount: finalAmount,
        min_payment: finalMinPayment,
        due_date: trimmedDue,
        statement_date: trimmedStmt || null,
        statement_start: trimmedStart || null,
        statement_end: trimmedEnd || null,
        pin_due_date: dueDateDirty,
        pin_statement_date: statementDateDirty,
        pin_min_payment: finalPinMinPayment,
        mark_as_paid: finalAmount > 0 && showMarkAsPaidOption ? markAsPaid : false,
        subtotals: subtotals && subtotals.length > 0 ? subtotals : undefined,
      })
      onSuccess(result, { cardId: targetCardId, billMonth: normalizedMonth })
      onClose()
    } catch (err) {
      const existingId = extractExistingBillIdFromConflict(err)
      if (existingId) {
        setConflictBillId(existingId)
      }
      setError(err instanceof Error ? err.message : '保存补录失败，请重试')
    } finally {
      setSubmitting(false)
    }
  }

  const cardLocked = Boolean(initialCardId)

  return (
    <Modal
      open={open}
      title='手动补充账单'
      maxWidth='md'
      onClose={() => !submitting && onClose()}
      dismissible={!submitting}
      footer={
        <>
          <Button variant='ghost' onClick={onClose} disabled={submitting}>
            取消
          </Button>
          <Button
            onClick={() => void submitPayload(false)}
            loading={submitting}
            disabled={Boolean(existingBillId)}
          >
            {submitting ? '保存中...' : '保存补录'}
          </Button>
        </>
      }
    >
      <div className='flex flex-col gap-3.5'>
        {/* 卡片 / 合并账户上下文 */}
        {cardLocked ? (
          <div className='rounded-xl border border-d-border bg-d-subtle/70 px-3.5 py-2.5'>
            <p className='text-[13px] font-semibold leading-5 text-d-text'>
              {cardContextHeader || '已选信用卡'}
            </p>
            {isMergedAccount ? (
              <p className='mt-0.5 text-[11px] leading-4 text-d-muted'>
                补充后归入该合并账单账户，解除整组缺账提醒
              </p>
            ) : null}
          </div>
        ) : (
          <SelectField
            label='归属信用卡 / 账户'
            required
            value={selectedCardId}
            onChange={e => {
              setSelectedCardId(e.target.value)
              setStatementDateDirty(false)
              setDueDateDirty(false)
            }}
            placeholder='暂无可用信用卡'
            options={selectableCards.map(c => {
              const bank = c.card.card_product?.bank_name || ''
              const name = getEffectiveCardName(c.card, c.card.card_product)
              const tail = formatCardTail(c.card.card_number_last4)
              return {
                value: c.card.id,
                label: `${bank} ${name}${tail ? ` (${tail})` : ''}`.trim(),
              }
            })}
          />
        )}

        {/* 已有账单冲突提示 */}
        {existingBillId ? (
          <Alert
            severity='warning'
            action={
              onOpenExistingBill ? (
                <button
                  type='button'
                  onClick={() => {
                    onClose()
                    onOpenExistingBill(existingBillId)
                  }}
                  className='min-h-[36px] rounded-lg border border-d-gold-deep/50 bg-d-surface px-2.5 text-[12px] font-semibold text-d-warn-ink'
                >
                  打开详情
                </button>
              ) : undefined
            }
          >
            该卡/账户 {billMonth} 期已存在账单记录，无需重复补录。
          </Alert>
        ) : null}

        {/* 待核对草稿提示条 */}
        {pendingDraftInfo ? (
          <Alert
            severity='info'
            action={
              onOpenDraft ? (
                <button
                  type='button'
                  onClick={() => {
                    onClose()
                    onOpenDraft(pendingDraftInfo.id)
                  }}
                  className='min-h-[36px] rounded-lg border border-d-accent/40 bg-d-surface px-2.5 text-[12px] font-semibold text-d-accent-light'
                >
                  去草稿箱核对
                </button>
              ) : undefined
            }
          >
            草稿箱已有 {pendingDraftInfo.month} 期解析草稿，可直接确认或在此手动补录。
          </Alert>
        ) : null}

        {/* 顶部快捷操作区：0 元零账单一键确认 + 切换智能导入 */}
        <div className='flex flex-col gap-2 rounded-xl border border-d-gold-deep/40 bg-d-gold-soft p-3'>
          <button
            type='button'
            disabled={submitting || Boolean(existingBillId)}
            onClick={() => void submitPayload(true)}
            className='flex min-h-[44px] w-full items-center justify-between gap-2 rounded-xl border border-d-gold-deep/40 bg-d-surface px-3.5 py-2 text-left transition-colors active:bg-d-subtle disabled:opacity-50'
          >
            <span className='min-w-0 flex-1'>
              <span className='block text-[13px] font-bold text-d-warn-ink'>
                本期无消费，确认 0 元零账单
              </span>
              <span className='block text-[11px] leading-4 text-d-muted'>
                直接按推算日期记为 {currencySym}0.00 已结清，立即消除缺账提醒
              </span>
            </span>
            <span className='shrink-0 rounded-lg bg-d-gold px-2.5 py-1 text-[11px] font-bold text-d-bg'>
              一键确认
            </span>
          </button>

          {onSwitchToImport ? (
            <button
              type='button'
              disabled={submitting}
              onClick={() => {
                const targetId = selectedItem?.card.id || selectedCardId
                onClose()
                onSwitchToImport(targetId)
              }}
              className='flex min-h-[40px] w-full items-center justify-between rounded-lg px-2 text-[12px] font-semibold text-d-accent-light transition-colors hover:bg-d-surface/50'
            >
              <span>我有文本 / 截图 / PDF → 智能导入</span>
              <span>去导入 ›</span>
            </button>
          ) : null}
        </div>

        {/* 核心录入表单区 */}
        <TextField
          label='缺失账期'
          required
          type='month'
          value={billMonth}
          onChange={e => {
            setBillMonth(e.target.value)
            setError(null)
            setConflictBillId(null)
          }}
        />

        <TextField
          autoFocus
          label='本期应还金额'
          required
          type='number'
          inputMode='decimal'
          min={0}
          step='0.01'
          placeholder='0.00'
          value={billAmount}
          onChange={e => setBillAmount(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !existingBillId) {
              void submitPayload(false)
            }
          }}
          startAdornment={<span className='text-[14px] font-semibold'>{currencySym}</span>}
        />

        <TextField
          label='最低还款额（选填）'
          type='number'
          inputMode='decimal'
          min={0}
          step='0.01'
          placeholder='可留空'
          value={minPayment}
          onChange={e => {
            setMinPayment(e.target.value)
            setMinPaymentDirty(true)
          }}
          startAdornment={<span className='text-[14px] font-semibold'>{currencySym}</span>}
        />

        <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
          <TextField
            label='出账日 / 账单日（选填）'
            type='date'
            value={statementDate}
            onChange={e => {
              setStatementDate(e.target.value)
              setStatementDateDirty(true)
            }}
          />
          <TextField
            label='最后还款日'
            required
            type='date'
            value={dueDate}
            onChange={e => {
              setDueDate(e.target.value)
              setDueDateDirty(true)
            }}
          />
        </div>

        {(statementDateDirty || dueDateDirty) && (
          <div className='flex justify-end'>
            <button
              type='button'
              onClick={handleResetDates}
              className='text-[12px] font-semibold text-d-accent-light underline underline-offset-2'
            >
              恢复按卡片规则推算的日期
            </button>
          </div>
        )}

        {showMarkAsPaidOption ? (
          <CheckRow checked={markAsPaid} onChange={setMarkAsPaid} disabled={submitting}>
            我已在银行还清本期（入账后同步标记已还清）
          </CheckRow>
        ) : null}

        {/* 高级折叠区（默认收起） */}
        <div className='rounded-xl border border-d-border bg-d-subtle/40'>
          <button
            type='button'
            aria-expanded={advancedOpen}
            onClick={() => setAdvancedOpen(v => !v)}
            className='flex min-h-[44px] w-full items-center justify-between px-3.5 text-[12px] font-semibold text-d-muted'
          >
            <span>高级选项（账期起止{isMergedAccount ? ' / 分卡小计' : ''}）</span>
            <span>{advancedOpen ? '收起' : '展开'}</span>
          </button>

          {advancedOpen ? (
            <div className='flex flex-col gap-3 border-t border-d-border px-3.5 py-3'>
              <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
                <TextField
                  label='账期开始日（选填）'
                  type='date'
                  value={statementStart}
                  onChange={e => setStatementStart(e.target.value)}
                />
                <TextField
                  label='账期结束日（选填）'
                  type='date'
                  value={statementEnd}
                  onChange={e => setStatementEnd(e.target.value)}
                />
              </div>

              {isMergedAccount ? (
                <div className='flex flex-col gap-2'>
                  <p className='text-[12px] font-semibold text-d-muted'>分卡小计（选填）</p>
                  {activeMergedMembers.map(member => {
                    const tail = formatCardTail(member.card_number_last4) || '----'
                    return (
                      <TextField
                        key={member.id}
                        label={`尾号 ${tail} 小计`}
                        type='number'
                        inputMode='decimal'
                        step='0.01'
                        placeholder='可留空'
                        value={subtotalDrafts[member.id] ?? ''}
                        onChange={e =>
                          setSubtotalDrafts(prev => ({
                            ...prev,
                            [member.id]: e.target.value,
                          }))
                        }
                        startAdornment={<span className='text-[14px]'>{currencySym}</span>}
                      />
                    )
                  })}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <Alert severity='info'>
          手动补充的金额优先级最高，后续邮件或 Gmail 同步到达同账期账单时不会覆盖您手填的值。
        </Alert>

        {error ? (
          <Alert
            severity='error'
            action={
              conflictBillId && onOpenExistingBill ? (
                <button
                  type='button'
                  onClick={() => {
                    onClose()
                    onOpenExistingBill(conflictBillId)
                  }}
                  className='min-h-[36px] rounded-lg border border-d-danger/40 bg-d-surface px-2.5 text-[12px] font-semibold text-d-danger-ink'
                >
                  查看已有账单
                </button>
              ) : undefined
            }
          >
            {error}
          </Alert>
        ) : null}
      </div>
    </Modal>
  )
}
