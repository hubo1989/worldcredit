'use client'

import { useEffect, useState } from 'react'
import { Drawer, Box, Typography, Stack, Snackbar, Alert } from '@mui/material'
import { NoteIcon, CheckIcon, CardIcon, ChevronRightIcon, UserIcon } from '@/components/icons/WcIcon'
import { BillForm } from './BillForm'
import { PaymentForm } from './PaymentForm'
import { CardForm } from './CardForm'
import { getHolders } from '@/lib/api/holders'
import { createPayment, updateBillStatus } from '@/lib/api/bills'
import { insforge } from '@/lib/insforge'
import type { CardHolder } from '@/lib/types'

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
      const { data, error } = await insforge.database
        .from('bills')
        .select('id, bill_month, bill_amount, status')
        .neq('status', 'paid')
        .order('due_date', { ascending: true })
        .limit(50)
      if (error) throw error
      setUnpaidBills((data || []) as any)
      setBillPickerOpen(true)
    } catch (err: any) {
      setNotice('加载账单失败：' + (err?.message || '未知错误'))
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
    const { data: allPayments } = await insforge.database
      .from('payments')
      .select('amount')
      .eq('bill_id', pickedBill.id)
    const totalPaid = (allPayments || []).reduce((s: number, p: any) => s + Number(p.amount), 0)
    const billAmount = Number(pickedBill.bill_amount)
    let status: 'unpaid' | 'partial' | 'paid' | 'overdue' = 'unpaid'
    if (totalPaid >= billAmount && billAmount > 0) status = 'paid'
    else if (totalPaid > 0) status = 'partial'
    await updateBillStatus(pickedBill.id, status)
    onChanged?.()
  }

  const handleCardSubmit = async (data: any) => {
    if (!pickedHolder) return
    const { data: created, error } = await insforge.database
      .from('credit_cards')
      .insert([{
        holder_id: pickedHolder.id,
        card_product_id: data.card_product_id,
        card_number_last4: data.card_number_last4 || null,
        credit_limit: Number(data.credit_limit) || 0,
        billing_day: Number(data.billing_day) || 1,
        status: 'active',
      }])
      .select()
      .single()
    if (error) throw error
    onChanged?.()
    return created
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
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
            maxWidth: 480,
            mx: 'auto',
          },
        }}
        slotProps={{ backdrop: { sx: { background: 'rgba(0,0,0,0.4)' } } }}
      >
        {/* 顶部拉动条 */}
        <Box sx={{ display: 'flex', justifyContent: 'center', pt: 1.25, pb: 0.5 }}>
          <Box sx={{ width: 40, height: 4, borderRadius: 2, bgcolor: 'rgba(10,31,68,0.18)' }} />
        </Box>

        <Typography sx={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', textAlign: 'center', mb: 1 }}>
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
                borderRadius: 'var(--radius-card)',
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
                <Typography sx={{ fontSize: 15, fontWeight: 600, color: 'var(--navy-800)', lineHeight: 1.3 }}>
                  {opt.title}
                </Typography>
                <Typography sx={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
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
        PaperProps={{ sx: { borderTopLeftRadius: 16, borderTopRightRadius: 16, maxWidth: 480, mx: 'auto' } }}
        slotProps={{ backdrop: { sx: { background: 'rgba(0,0,0,0.4)' } } }}
      >
        <Box sx={{ display: 'flex', justifyContent: 'center', pt: 1.25, pb: 0.5 }}>
          <Box sx={{ width: 40, height: 4, borderRadius: 2, bgcolor: 'rgba(10,31,68,0.18)' }} />
        </Box>
        <Typography sx={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', textAlign: 'center', mb: 1 }}>
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
                p: 1.25, borderRadius: 'var(--radius-card)', textAlign: 'left',
                '&:hover': { bgcolor: 'rgba(10,31,68,0.04)' },
              }}
            >
              <Box sx={{ width: 36, height: 36, borderRadius: '50%', bgcolor: 'rgba(30,58,138,0.10)', color: 'var(--navy-600)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <UserIcon size={20} />
              </Box>
              <Typography sx={{ flex: 1, fontSize: 15, fontWeight: 600, color: 'var(--navy-800)' }}>{h.name}</Typography>
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
        PaperProps={{ sx: { borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '70vh', maxWidth: 480, mx: 'auto' } }}
        slotProps={{ backdrop: { sx: { background: 'rgba(0,0,0,0.4)' } } }}
      >
        <Box sx={{ display: 'flex', justifyContent: 'center', pt: 1.25, pb: 0.5 }}>
          <Box sx={{ width: 40, height: 4, borderRadius: 2, bgcolor: 'rgba(10,31,68,0.18)' }} />
        </Box>
        <Typography sx={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', textAlign: 'center', mb: 1 }}>
          选择要还款的账单
        </Typography>
        <Stack sx={{ p: 1.5, pt: 0.5, gap: 0.5, overflowY: 'auto' }}>
          {unpaidBills.length === 0 && (
            <Typography sx={{ fontSize: 13, color: 'var(--text-secondary)', textAlign: 'center', py: 2 }}>
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
                width: '100%', border: '1px solid var(--border)', bgcolor: 'var(--paper)',
                cursor: 'pointer', p: 1.25, borderRadius: 'var(--radius-card)', textAlign: 'left',
                '&:hover': { boxShadow: 'var(--shadow-card)' },
              }}
            >
              <Box>
                <Typography sx={{ fontSize: 13, color: 'var(--text-secondary)' }}>{b.bill_month} 账单</Typography>
                <Typography className="num-tabular" sx={{ fontSize: 16, fontWeight: 700, color: 'var(--navy-800)', mt: 0.25 }}>
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
