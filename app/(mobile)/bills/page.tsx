'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  Container, Typography, Box, Stack, Tabs, Tab,
  Paper, IconButton, Button, Skeleton,
  Fab, Snackbar, Alert
} from '@mui/material'
import SyncIcon from '@mui/icons-material/Sync'
import AddIcon from '@mui/icons-material/Add'
import ReceiptIcon from '@mui/icons-material/ReceiptLong'
import CheckIcon from '@mui/icons-material/CheckCircleOutline'
import { getBillDashboardItems, createBill, createPayment, updateBillStatus, type BillDashboardItem } from '@/lib/api/bills'
import { insforge } from '@/lib/insforge'
import { BillStatusCard } from '@/components/mobile/BillStatusCard'
import { PaymentForm } from '@/components/mobile/PaymentForm'
import { BillForm } from '@/components/mobile/BillForm'
import { format, addMonths, startOfMonth, setDate, addDays } from 'date-fns'

import { useAuth } from '@/lib/auth'

type BillWithCard = BillDashboardItem

export default function BillsPage() {
  const { user } = useAuth()
  const [bills, setBills] = useState<BillWithCard[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [tabValue, setTabValue] = useState(0) // 0: 全部, 1: 待还, 2: 已还
  
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [selectedBill, setSelectedBill] = useState<BillWithCard | null>(null)
  const [billFormOpen, setBillFormOpen] = useState(false)

  const [celebrationNotice, setCelebrationNotice] = useState<{ open: boolean; message: string }>({
    open: false,
    message: ''
  })

  const loadBills = useCallback(async () => {
    if (!user) return
    try {
      setLoading(true)
      const data = await getBillDashboardItems(100, user.id)
      setBills(data)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => { loadBills() }, [loadBills])

  // 自动同步/生成账单逻辑
  const handleSync = async () => {
    if (!user) return
    setSyncing(true)
    try {
      // 1. 获取当前用户持卡人与信用卡
      const { data: holders } = await insforge.database
        .from('card_holders')
        .select('id')
        .eq('created_by', user.id)

      const holderIds = (holders || []).map(h => h.id)
      if (holderIds.length === 0) {
        setCelebrationNotice({ open: true, message: '👍 当前没有关联的持卡人与信用卡可同步。' })
        return
      }

      const { data: cardsRaw, error: cardsError } = await insforge.database
        .from('credit_cards')
        .select('*')
        .in('holder_id', holderIds)
      
      if (cardsError) throw cardsError
      if (!cardsRaw || cardsRaw.length === 0) {
        setCelebrationNotice({ open: true, message: '👍 当前没有关联的信用卡可同步。' })
        return
      }

      const pIds = Array.from(new Set(cardsRaw.map(c => c.card_product_id).filter(Boolean)))
      let pMap: Record<string, any> = {}
      if (pIds.length > 0) {
        const { data: pData } = await insforge.database
          .from('card_products')
          .select('*')
          .in('id', pIds)
        if (pData) pMap = pData.reduce((acc, p) => ({ ...acc, [p.id]: p }), {})
      }

      const cards = cardsRaw.map(c => ({
        ...c,
        card_product: pMap[c.card_product_id] || { payment_due_value: 20 }
      }))

      const now = new Date()
      const currentMonthStr = format(now, 'yyyy-MM')

      let createdCount = 0
      for (const card of cards) {
        // 检查该卡本月是否已有账单
        const billDate = setDate(startOfMonth(now), card.billing_day)
        const billingEnd = format(billDate, 'yyyy-MM-dd')
        
        const { data: existing } = await insforge.database
          .from('bills')
          .select('id')
          .eq('card_id', card.id)
          .eq('bill_month', currentMonthStr)
          .maybeSingle()

        if (!existing) {
          // 创建一个模拟账单（金额默认为0，待用户手动同步或输入）
          const dueDate = addDays(billDate, card.card_product.payment_due_value)
          
          await createBill({
            card_id: card.id,
            bill_month: currentMonthStr,
            statement_start: format(addMonths(billDate, -1), 'yyyy-MM-dd'),
            statement_end: billingEnd,
            bill_amount: 0, 
            min_payment: 0,
            due_date: format(dueDate, 'yyyy-MM-dd'),
            status: 'unpaid'
          })
          createdCount++
        }
      }
      
      if (createdCount > 0) {
        await loadBills()
        setCelebrationNotice({ open: true, message: `✨ 成功同步！为持卡账户新增了 ${createdCount} 笔待入账单。` })
      } else {
        setCelebrationNotice({ open: true, message: '👍 账单已是最新状态。' })
      }
    } catch (err: any) {
      alert('同步失败: ' + err.message)
    } finally {
      setSyncing(false)
    }
  }

  const handlePayment = async (data: { amount: number; paid_at: string; note?: string }) => {
    if (!selectedBill) return
    try {
      await createPayment({
        bill_id: selectedBill.id,
        amount: data.amount,
        paid_at: data.paid_at,
        channel: '手动还款',
        note: data.note
      })
      
      // 查询该账单的所有还款记录求和，与账单金额比较决定状态
      const { data: allPayments } = await insforge.database
        .from('payments')
        .select('amount')
        .eq('bill_id', selectedBill.id)
      
      const totalPaid = (allPayments || []).reduce(
        (sum: number, p: { amount: number }) => sum + Number(p.amount), 0
      )
      const billAmount = Number(selectedBill.bill_amount)

      let isFullPaid = false
      if (totalPaid >= billAmount) {
        await updateBillStatus(selectedBill.id, 'paid')
        isFullPaid = true
      } else if (totalPaid > 0) {
        await updateBillStatus(selectedBill.id, 'partial')
      }
      
      await loadBills()
      setCelebrationNotice({
        open: true,
        message: isFullPaid ? '🎉 恭喜！本期账单已全额结清！账户资产负债率降低！' : '✅ 登记还款成功！已更新账单结余。'
      })
    } catch (err: any) {
      alert('登记还款失败: ' + err.message)
    }
  }

  const filteredBills = bills.filter(b => {
    if (tabValue === 1) return b.computed_status === 'unpaid' || b.computed_status === 'partial' || b.computed_status === 'overdue'
    if (tabValue === 2) return b.computed_status === 'paid'
    return true
  })

  // 按月份分组
  const groupedBills: Record<string, BillWithCard[]> = {}
  filteredBills.forEach(b => {
    const dateStr = b.statement_end || b.due_date
    const month = format(new Date(dateStr), 'yyyy年MM月')
    if (!groupedBills[month]) groupedBills[month] = []
    groupedBills[month].push(b)
  })

  return (
    <Container sx={{ py: 3, pb: 10 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h5" fontWeight={800}>
          账单管理
        </Typography>
        <IconButton 
          id="sync-bills-btn"
          color="primary" 
          onClick={handleSync} 
          disabled={syncing}
          sx={{ bgcolor: 'primary.light', opacity: 0.9 }}
        >
          <SyncIcon sx={{ animation: syncing ? 'spin 1s linear infinite' : 'none' }} />
          <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
        </IconButton>
      </Box>

      <Tabs 
        value={tabValue} 
        onChange={(_, v) => setTabValue(v)}
        variant="fullWidth"
        sx={{ mb: 3, borderBottom: 1, borderColor: 'divider' }}
      >
        <Tab label="全部" />
        <Tab label="待还款" />
        <Tab label="已结清" />
      </Tabs>

      {loading ? (
        <Stack spacing={2}>
          {[1, 2, 3].map(i => <Skeleton key={i} variant="rounded" height={100} sx={{ borderRadius: 4 }} />)}
        </Stack>
      ) : filteredBills.length === 0 ? (
        <Paper sx={{ p: 8, textAlign: 'center', borderRadius: 4, bgcolor: 'background.paper', border: '1px dashed', borderColor: 'divider' }}>
          <ReceiptIcon sx={{ fontSize: 64, color: 'text.disabled', mb: 2, opacity: 0.3 }} />
          <Typography color="text.secondary">暂无相关账单</Typography>
          <Button sx={{ mt: 2 }} onClick={handleSync}>立即同步</Button>
        </Paper>
      ) : (
        Object.entries(groupedBills).map(([month, monthBills]) => (
          <Box key={month} sx={{ mb: 4 }}>
            <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1.5, px: 1, display: 'flex', alignItems: 'center', gap: 1, fontWeight: 700 }}>
              <Box sx={{ width: 4, height: 16, bgcolor: 'primary.main', borderRadius: 1 }} />
              {month}
            </Typography>
            <Stack spacing={1}>
              {monthBills.map(bill => (
                <BillStatusCard 
                  key={bill.id} 
                  bill={bill} 
                  onClick={() => {
                    setSelectedBill(bill)
                    setPaymentOpen(true)
                  }}
                />
              ))}
            </Stack>
          </Box>
        ))
      )}

      {selectedBill && (
        <PaymentForm
          open={paymentOpen}
          onClose={() => setPaymentOpen(false)}
          onSubmit={handlePayment}
          totalAmount={Number(selectedBill.bill_amount)}
          billMonth={format(new Date(selectedBill.statement_end || selectedBill.due_date), 'MM月')}
          billId={selectedBill.id}
          onAttachmentChanged={loadBills}
        />
      )}

      {/* 录入账单 FAB */}
      <Fab
        color="primary"
        aria-label="录入账单"
        onClick={() => setBillFormOpen(true)}
        sx={{ position: 'fixed', bottom: 80, right: 20, zIndex: 10 }}
      >
        <AddIcon />
      </Fab>

      <BillForm
        open={billFormOpen}
        onClose={() => setBillFormOpen(false)}
        onSuccess={loadBills}
      />

      <Snackbar
        open={celebrationNotice.open}
        autoHideDuration={4000}
        onClose={() => setCelebrationNotice(prev => ({ ...prev, open: false }))}
      >
        <Alert severity="success" icon={<CheckIcon fontSize="small" />} onClose={() => setCelebrationNotice(prev => ({ ...prev, open: false }))}>
          {celebrationNotice.message}
        </Alert>
      </Snackbar>
    </Container>
  )
}
