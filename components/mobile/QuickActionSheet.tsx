'use client'

import { useEffect, useState } from 'react'
import { Drawer, Box, Typography, Stack, Snackbar, Alert } from '@mui/material'
import { NoteIcon, CheckIcon, CardIcon, ChevronRightIcon, UserIcon } from '@/components/icons/WcIcon'
import { BillForm } from './BillForm'
import { PaymentForm } from './PaymentForm'
import { CardForm } from './CardForm'
import { getHolders } from '@/lib/api/holders'
import { createPayment, updateBillStatus, getUnpaidBills, getPaymentTotal } from '@/lib/api/bills'
import { createCard } from '@/lib/api/cards'
import type { CardHolder, CreditCard } from '@/lib/types'

/**
 * 记一笔 ActionSheet（§5.2）。
 * 首页金刚区「记一笔」触发，三个选项：录入账单 / 记还款 / 添加卡片。
 * 添加卡片需要持卡人，故内置一个持卡人选择子步。
 */
interface Props {
  open: boolean
  onClose: () => void
  /** 录入/还款/加卡成功后的回调（通常刷新列表） */
  onChanged?: () => void
}

/** Drawer 遮罩：由强调色令牌派生的半透明中性遮罩，不引入新的字面色值。 */
const SCRIM = 'color-mix(in srgb, var(--strong) 34%, transparent)'

export function QuickActionSheet({ open, onClose, onChanged }: Props) {
  const [billFormOpen, setBillFormOpen] = useState(false)
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [cardFormOpen, setCardFormOpen] = useState(false)

  // 还款需要先选账单：这里做一个简易选择，从所有未还账单中挑
  const [holders, setHolders] = useState<CardHolder[]>([])
  const [holderPickerOpen, setHolderPickerOpen] = useState(false)
  const [pickedHolder, setPickedHolder] = useState<CardHolder | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // 还款选择账单相关
  const [unpaidBills, setUnpaidBills] = useState<Array<{ id: string; bill_month: string; bill_amount: number }>>([])
  const [billPickerOpen, setBillPickerOpen] = useState(false)
  const [pickedBill, setPickedBill] = useState<{ id: string; bill_month: string; bill_amount: number } | null>(null)

  useEffect(() => {
    if (!open) return
    getHolders()
      .then(setHolders)
      .catch(() => setHolders([]))
  }, [open])

  const closeAll = () => {
    setBillFormOpen(false)
    setPaymentOpen(false)
    setCardFormOpen(false)
    setHolderPickerOpen(false)
    setBillPickerOpen(false)
    setPickedHolder(null)
    setPickedBill(null)
    onClose()
  }

  const handlePickBill = async () => {
    // 拉取未还账单供选择
    try {
      setUnpaidBills(await getUnpaidBills())
      setBillPickerOpen(true)
    } catch (err) {
      setNotice('加载账单失败：' + (err instanceof Error ? err.message : '未知错误'))
    }
  }

  const handlePaymentSubmit = async (data: { amount: number; paid_at: string; note?: string }) => {
    if (!pickedBill) return
    await createPayment({
      bill_id: pickedBill.id,
      amount: data.amount,
      paid_at: data.paid_at,
      channel: '手动还款',
      note: data.note,
    })
    // 重算状态
    const totalPaid = await getPaymentTotal(pickedBill.id)
    const billAmount = Number(pickedBill.bill_amount)
    let status: 'unpaid' | 'partial' | 'paid' | 'overdue' = 'unpaid'
    if (totalPaid >= billAmount && billAmount > 0) status = 'paid'
    else if (totalPaid > 0) status = 'partial'
    await updateBillStatus(pickedBill.id, status)
    onChanged?.()
  }

  const handleCardSubmit = async (data: Omit<CreditCard, 'id' | 'created_at'>) => {
    if (!pickedHolder) return
    const created = await createCard({
      holder_id: pickedHolder.id,
      card_product_id: data.card_product_id,
      card_number_last4: data.card_number_last4 || undefined,
      credit_limit: Number(data.credit_limit) || 0,
      billing_day: Number(data.billing_day) || 1,
      card_type: 'credit',
      status: 'active',
    })
    onChanged?.()
    void created
  }

  const options = [
    {
      key: 'bill',
      title: '录入账单',
      desc: '手动录入一张账单，支持粘贴邮件 / 短信智能填充',
      icon: <NoteIcon size={20} />,
      onClick: () => {
        setBillFormOpen(true)
      },
    },
    {
      key: 'payment',
      title: '记还款',
      desc: '选择未还账单登记一笔还款',
      icon: <CheckIcon size={20} />,
      onClick: () => handlePickBill(),
    },
    {
      key: 'card',
      title: '添加卡片',
      desc: '为持卡人新增一张信用卡',
      icon: <CardIcon size={20} />,
      onClick: () => {
        if (holders.length === 0) {
          setNotice('还没有持卡人，请先到「我的 → 家庭管理」添加')
          return
        }
        if (holders.length === 1) {
          setPickedHolder(holders[0])
          setCardFormOpen(true)
        } else {
          setHolderPickerOpen(true)
        }
      },
    },
  ]

  return (
    <>
      <Drawer
        anchor="bottom"
        open={open && !billFormOpen && !paymentOpen && !cardFormOpen && !holderPickerOpen && !billPickerOpen}
        onClose={closeAll}
        PaperProps={{
          sx: {
            borderTopLeftRadius: 'var(--radius-depth-3)',
            borderTopRightRadius: 'var(--radius-depth-3)',
            maxWidth: 480,
            mx: 'auto',
            boxShadow: 'var(--shadow-float)',
            backgroundColor: 'var(--paper)',
          },
        }}
        slotProps={{ backdrop: { sx: { background: SCRIM } } }}
      >
        {/* 顶部拉动条 */}
        <Box sx={{ display: 'flex', justifyContent: 'center', pt: 1.25, pb: 0.5 }}>
          <Box sx={{ width: 40, height: 4, borderRadius: 2, bgcolor: 'var(--border-strong)' }} />
        </Box>

        <Typography className="type-section" sx={{ textAlign: 'center', mb: 1 }}>
          记一笔
        </Typography>

        <Stack sx={{ p: 1.5, pt: 0.5, gap: 0.5 }} onMouseDown={e => e.stopPropagation()}>
          {options.map(opt => (
            <Box
              key={opt.key}
              component="button"
              onClick={opt.onClick}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                width: '100%',
                border: 'none',
                bgcolor: 'transparent',
                cursor: 'pointer',
                p: 1.25,
                borderRadius: 'var(--radius-depth-1)',
                textAlign: 'left',
                transition: 'background-color var(--dur-fast) ease',
                '&:hover': { bgcolor: 'rgba(10,31,68,0.04)' },
                '&:focus-visible': { outline: '2px solid var(--navy-600)', outlineOffset: -2 },
              }}
            >
              <Box
                sx={{
                  width: 36,
                  height: 36,
                  borderRadius: '50%',
                  bgcolor: 'rgba(30,58,138,0.10)',
                  color: 'var(--navy-600)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                {opt.icon}
              </Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography className="type-body" sx={{ fontWeight: 600, color: 'var(--text)' }}>
                  {opt.title}
                </Typography>
                <Typography className="type-label">
                  {opt.desc}
                </Typography>
              </Box>
              <ChevronRightIcon size={18} />
            </Box>
          ))}
          <Box sx={{ height: 8 }} />
        </Stack>
      </Drawer>

      {/* 持卡人选择子步 */}
      <Drawer
        anchor="bottom"
        open={holderPickerOpen}
        onClose={() => setHolderPickerOpen(false)}
        PaperProps={{
          sx: {
            borderTopLeftRadius: 'var(--radius-depth-3)',
            borderTopRightRadius: 'var(--radius-depth-3)',
            maxWidth: 480,
            mx: 'auto',
            boxShadow: 'var(--shadow-float)',
            backgroundColor: 'var(--paper)',
          },
        }}
        slotProps={{ backdrop: { sx: { background: SCRIM } } }}
      >
        <Box sx={{ display: 'flex', justifyContent: 'center', pt: 1.25, pb: 0.5 }}>
          <Box sx={{ width: 40, height: 4, borderRadius: 2, bgcolor: 'var(--border-strong)' }} />
        </Box>
        <Typography className="type-section" sx={{ textAlign: 'center', mb: 1 }}>
          选择持卡人
        </Typography>
        <Stack sx={{ p: 1.5, pt: 0.5, gap: 0.5 }}>
          {holders.map(h => (
            <Box
              key={h.id}
              component="button"
              onClick={() => {
                setPickedHolder(h)
                setHolderPickerOpen(false)
                setCardFormOpen(true)
              }}
              sx={{
                display: 'flex', alignItems: 'center', gap: 1.5, width: '100%',
                border: 'none', bgcolor: 'transparent', cursor: 'pointer',
                p: 1.25, borderRadius: 'var(--radius-depth-1)', textAlign: 'left',
                '&:hover': { bgcolor: 'rgba(10,31,68,0.04)' },
              }}
            >
              <Box sx={{ width: 36, height: 36, borderRadius: '50%', bgcolor: 'rgba(30,58,138,0.10)', color: 'var(--navy-600)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <UserIcon size={20} />
              </Box>
              <Typography className="type-body" sx={{ flex: 1, fontWeight: 600, color: 'var(--text)' }}>{h.name}</Typography>
              <ChevronRightIcon size={18} />
            </Box>
          ))}
          <Box sx={{ height: 8 }} />
        </Stack>
      </Drawer>

      {/* 账单选择子步 */}
      <Drawer
        anchor="bottom"
        open={billPickerOpen}
        onClose={() => setBillPickerOpen(false)}
        PaperProps={{
          sx: {
            borderTopLeftRadius: 'var(--radius-depth-3)',
            borderTopRightRadius: 'var(--radius-depth-3)',
            maxHeight: '70vh',
            maxWidth: 480,
            mx: 'auto',
            boxShadow: 'var(--shadow-float)',
            backgroundColor: 'var(--paper)',
          },
        }}
        slotProps={{ backdrop: { sx: { background: SCRIM } } }}
      >
        <Box sx={{ display: 'flex', justifyContent: 'center', pt: 1.25, pb: 0.5 }}>
          <Box sx={{ width: 40, height: 4, borderRadius: 2, bgcolor: 'var(--border-strong)' }} />
        </Box>
        <Typography className="type-section" sx={{ textAlign: 'center', mb: 1 }}>
          选择要还款的账单
        </Typography>
        <Stack sx={{ p: 1.5, pt: 0.5, gap: 0.5, overflowY: 'auto' }}>
          {unpaidBills.length === 0 && (
            <Typography className="type-label" sx={{ textAlign: 'center', py: 2 }}>
              暂无未还账单
            </Typography>
          )}
          {unpaidBills.map(b => (
            <Box
              key={b.id}
              component="button"
              onClick={() => {
                setPickedBill(b)
                setBillPickerOpen(false)
                setPaymentOpen(true)
              }}
              sx={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                width: '100%', border: 0, bgcolor: 'var(--paper)',
                boxShadow: 'var(--shadow-e1)',
                cursor: 'pointer', p: 1.25, borderRadius: 'var(--radius-depth-1)', textAlign: 'left',
                '&:hover': { boxShadow: 'var(--shadow-e2)' },
              }}
            >
              <Box>
                <Typography className="type-label">{b.bill_month} 账单</Typography>
                <Typography className="num-tabular type-body" sx={{ fontWeight: 700, color: 'var(--strong)', mt: 0.25, display: 'block' }}>
                  ¥{Number(b.bill_amount).toLocaleString()}
                </Typography>
              </Box>
              <ChevronRightIcon size={18} />
            </Box>
          ))}
          <Box sx={{ height: 8 }} />
        </Stack>
      </Drawer>

      {/* 三个表单 */}
      <BillForm
        open={billFormOpen}
        onClose={() => { setBillFormOpen(false); closeAll() }}
        onSuccess={() => { onChanged?.(); closeAll() }}
      />

      <PaymentForm
        open={paymentOpen}
        onClose={() => { setPaymentOpen(false); closeAll() }}
        onSubmit={handlePaymentSubmit}
        totalAmount={pickedBill?.bill_amount ?? 0}
        billMonth={pickedBill?.bill_month ?? ''}
        billId={pickedBill?.id}
      />

      <CardForm
        open={cardFormOpen}
        onClose={() => { setCardFormOpen(false); closeAll() }}
        onSubmit={handleCardSubmit}
        holderId={pickedHolder?.id ?? ''}
      />

      <Snackbar
        open={!!notice}
        autoHideDuration={3000}
        onClose={() => setNotice(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={() => setNotice(null)} severity="info" variant="filled">
          {notice}
        </Alert>
      </Snackbar>
    </>
  )
}
