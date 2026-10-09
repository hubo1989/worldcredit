'use client'

import { useState, useEffect } from 'react'
import { Modal } from '@/components/obsidian/overlays'
import { Button } from '@/components/obsidian/controls'
import { TextField, SelectField } from '@/components/obsidian/fields'
import { Alert } from '@/components/obsidian/feedback'
import type { EmailParseLogWithParsed } from '@/lib/api/emailBills'
import { syncEmailBillToAccount } from '@/lib/api/emailBills'
import { getCardHolders } from '@/lib/api/cards'
import type { CardHolder } from '@/lib/types'

interface Props {
  open: boolean
  onClose: () => void
  onSuccess: () => void
  log: EmailParseLogWithParsed | null
}

export function EmailBillSyncModal({ open, onClose, onSuccess, log }: Props) {
  const [holders, setHolders] = useState<CardHolder[]>([])
  const [selectedHolderId, setSelectedHolderId] = useState('')
  const [bankName, setBankName] = useState('')
  const [cardName, setCardName] = useState('')
  const [last4, setLast4] = useState('')
  const [billingDay, setBillingDay] = useState('10')
  const [dueDate, setDueDate] = useState('')
  const [billMonth, setBillMonth] = useState('')
  const [billAmount, setBillAmount] = useState('')
  const [minPayment, setMinPayment] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    if (open) {
      getCardHolders().then(data => {
        setHolders(data)
        if (data.length > 0) {
          setSelectedHolderId(data[0].id)
        }
      }).catch(err => console.error('Fetch holders error:', err))
    }
  }, [open])

  useEffect(() => {
    if (log?.parsedData) {
      const parsed = log.parsedData
      const bName = parsed.bank_name || '信用卡银行'
      setBankName(bName)
      setCardName(`${bName}信用卡`)
      setLast4(parsed.card_last4 || '')

      // 推算账单日数字
      if (parsed.statement_date) {
        const dayStr = parsed.statement_date.split('-')[2]
        if (dayStr) setBillingDay(parseInt(dayStr, 10).toString())
      } else {
        setBillingDay('10')
      }

      setDueDate(parsed.due_date || '')
      setBillMonth(parsed.bill_month || new Date().toISOString().slice(0, 7))
      setBillAmount(parsed.bill_amount != null ? parsed.bill_amount.toString() : '0')
      setMinPayment(parsed.min_payment != null ? parsed.min_payment.toString() : '0')
      setErrorMsg('')
    }
  }, [log])

  const handleSubmit = async () => {
    if (!log) return
    if (!bankName.trim()) {
      setErrorMsg('请填写银行名称')
      return
    }
    if (!cardName.trim()) {
      setErrorMsg('请填写卡片名称')
      return
    }
    if (!dueDate) {
      setErrorMsg('请填写还款截止日')
      return
    }

    setSubmitting(true)
    setErrorMsg('')

    try {
      await syncEmailBillToAccount({
        logId: log.id,
        holderId: selectedHolderId || undefined,
        bankName: bankName.trim(),
        cardName: cardName.trim(),
        cardNumberLast4: last4.trim(),
        billingDay: parseInt(billingDay, 10) || 1,
        billAmount: parseFloat(billAmount) || 0,
        minPayment: parseFloat(minPayment) || 0,
        billMonth: billMonth || new Date().toISOString().slice(0, 7),
        dueDate: dueDate,
        statementDate: log.parsedData?.statement_date || undefined
      })

      onSuccess()
      onClose()
    } catch (err) {
      console.error(err)
      setErrorMsg(err instanceof Error ? err.message : '同步失败，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title='同步账单到本账户'
      footer={
        <>
          <Button variant='ghost' onClick={onClose} disabled={submitting}>取消</Button>
          <Button onClick={handleSubmit} loading={submitting}>
            {submitting ? '建立中...' : '建立账户并同步账单'}
          </Button>
        </>
      }
    >
      <p className='mb-4 text-[14px] leading-5 text-d-muted'>
        根据邮件解析结果，自动建立对应的持卡账户（发卡行、卡片尾号、账单日、还款日），并将此笔账单导入您的账户中。
      </p>

      {errorMsg && (
        <div className='mb-4'>
          <Alert severity='error'>{errorMsg}</Alert>
        </div>
      )}

      <div className='flex flex-col gap-4'>
        {/* 持卡人选择 */}
        <SelectField
          label='持卡对象'
          value={selectedHolderId}
          onChange={e => setSelectedHolderId(e.target.value)}
          options={holders.map(h => ({ value: h.id, label: h.name }))}
          helperText={holders.length === 0 ? '若无持卡人，系统将自动创建“本人”' : undefined}
        />

        {/* 银行名称 */}
        <TextField
          label='发卡银行' required
          value={bankName}
          onChange={e => setBankName(e.target.value)}
        />

        {/* 卡片名称 */}
        <TextField
          label='卡片名称' required
          value={cardName}
          onChange={e => setCardName(e.target.value)}
        />

        {/* 卡尾号 */}
        <TextField
          label='卡号末4位'
          value={last4}
          onChange={e => setLast4(e.target.value)}
          maxLength={4}
          placeholder='如 8888'
        />

        {/* 账单日与还款日 */}
        <div className='flex gap-3'>
          <div className='min-w-0 flex-1'>
            <TextField
              label='账单日'
              type='number'
              value={billingDay}
              onChange={e => setBillingDay(e.target.value)}
              endAdornment={<span className='text-[13px]'>日</span>}
              helperText='每月生成账单的日期(1-31)'
            />
          </div>
          <div className='min-w-0 flex-[1.5]'>
            <TextField
              label='还款截止日' required
              type='date'
              value={dueDate}
              onChange={e => setDueDate(e.target.value)}
            />
          </div>
        </div>

        {/* 金额相关 */}
        <div className='flex gap-3'>
          <div className='min-w-0 flex-1'>
            <TextField
              label='本期账单金额'
              type='number'
              value={billAmount}
              onChange={e => setBillAmount(e.target.value)}
              startAdornment={<span className='text-[14px]'>¥</span>}
            />
          </div>
          <div className='min-w-0 flex-1'>
            <TextField
              label='最低还款额'
              type='number'
              value={minPayment}
              onChange={e => setMinPayment(e.target.value)}
              startAdornment={<span className='text-[14px]'>¥</span>}
            />
          </div>
        </div>
      </div>
    </Modal>
  )
}
