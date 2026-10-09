'use client'

import { useEffect, useState } from 'react'
import { Modal } from '@/components/obsidian/overlays'
import { Button } from '@/components/obsidian/controls'
import { TextField } from '@/components/obsidian/fields'
import { Alert } from '@/components/obsidian/feedback'
import { setCardManualBillAmount } from '@/lib/api/bills'
import { currencySymbol } from '@/lib/fx'
import { format } from 'date-fns'

interface Props {
  open: boolean
  onClose: () => void
  onSuccess: () => void
  cardId: string | null
  /** 卡名 + 尾号，用于确认改的是哪张卡 */
  cardLabel: string
  currency: string
  /** 当前生效金额（手填值优先）；用于预填输入框 */
  currentAmount: number
  /** 是否已经手填过（决定按钮文案与文案提示） */
  isPinned: boolean
}

/**
 * 手动填写账单金额。
 *
 * 手填值优先于一切导入来源（邮件解析 / Gmail 同步 / LLM 抽取）——导入方只写
 * bills.bill_amount，手填写的是 bills.bill_amount_override，两者都保留，
 * 因此这里填完之后，下一封账单邮件不会把用户的数字改掉。
 */
export function ManualBillAmountDialog({
  open, onClose, onSuccess, cardId, cardLabel, currency, currentAmount, isPinned,
}: Props) {
  const [value, setValue] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setValue(currentAmount > 0 ? String(currentAmount) : '')
    setError(null)
  }, [open, currentAmount])

  const handleSubmit = async () => {
    if (!cardId) return
    setError(null)
    const amount = parseFloat(value)
    if (!Number.isFinite(amount) || amount < 0) {
      setError('请输入不小于 0 的金额')
      return
    }
    setSubmitting(true)
    try {
      await setCardManualBillAmount(cardId, amount)
      onSuccess()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败，请重试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      title={isPinned ? '修改账单金额' : '填写账单金额'}
      onClose={() => !submitting && onClose()}
      dismissible={!submitting}
      footer={
        <>
          <Button variant='ghost' onClick={onClose} disabled={submitting}>取消</Button>
          <Button onClick={handleSubmit} loading={submitting}>
            {submitting ? '保存中...' : '保存'}
          </Button>
        </>
      }
    >
      <div className='flex flex-col gap-3'>
        <p className='text-[13px] leading-5 text-d-muted'>
          {cardLabel} · {format(new Date(), 'yyyy-MM')} 账期
        </p>
        <TextField
          autoFocus
          type='number'
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSubmit() }}
          placeholder='0.00'
          inputMode='decimal'
          min={0}
          step='0.01'
          startAdornment={<span className='text-[14px]'>{currencySymbol(currency)}</span>}
        />
        {/* 说清优先级，避免用户以为下次导入会覆盖它（或反过来以为它不会生效） */}
        <Alert severity='info'>
          手动填写的金额优先级最高；邮件导入、Gmail 同步得到的金额不会覆盖它。
        </Alert>
        {error && <Alert severity='error'>{error}</Alert>}
      </div>
    </Modal>
  )
}
