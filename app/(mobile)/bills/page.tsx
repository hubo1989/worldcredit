// app/(mobile)/bills/page.tsx
'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Box, Typography, Fab, Skeleton, Alert, Button, SpeedDial, SpeedDialAction, SpeedDialIcon } from '@mui/material'
import { Add as AddIcon, Refresh as RefreshIcon, AutoAwesome, FileDownload } from '@mui/icons-material'
import { getUnpaidBills, getBills, createBill } from '@/lib/api/bills'
import { getHolders } from '@/lib/api/holders'
import { getCardsByHolder } from '@/lib/api/cards'
import { BillCard } from '@/components/mobile/BillCard'
import { BillForm } from '@/components/mobile/BillForm'
import { BillImportDialog } from '@/components/mobile/BillImportDialog'
import { ExportDialog } from '@/components/mobile/ExportDialog'
import { useAuth } from '@/lib/auth'
import { asRole, getErrorMessage } from '@/lib/permissions'
import { usePermission } from '@/lib/hooks/usePermission'
import type { Bill, CreditCard } from '@/lib/types'
import type { BillItemInput } from '@/lib/api/bills'

type BillWithCard = Bill & { credit_cards: Pick<CreditCard, 'bank_name' | 'card_name' | 'card_number_last4' | 'currency'> }

export default function BillsPage() {
  const [tab, setTab] = useState(0)
  const [bills, setBills] = useState<BillWithCard[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [holders, setHolders] = useState<Awaited<ReturnType<typeof getHolders>>>([])
  const [cardOptions, setCardOptions] = useState<{ id: string; label: string; card: CreditCard }[]>([])
  const [exportOpen, setExportOpen] = useState(false)
  const { user, profile } = useAuth()
  const router = useRouter()
  const { canManage } = usePermission()

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = tab === 0 ? await getUnpaidBills() : await getBills()
      setBills(data as BillWithCard[])
    } catch (err: unknown) {
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [tab])

  const loadCardOptions = useCallback(async () => {
    if (!profile) return
    try {
      const holders = await getHolders(profile.id, asRole(profile))
      setHolders(holders)
      const allCards: { id: string; label: string; card: CreditCard }[] = []
      await Promise.all(
        holders.map(async (h) => {
          const cards = await getCardsByHolder(h.id)
          cards.forEach(c => {
            allCards.push({
              id: c.id,
              label: `${h.name} - ${c.bank_name} ${c.card_name}`,
              card: c,
            })
          })
        })
      )
      setCardOptions(allCards)
    } catch {
      // ignore — user may not have data yet
    }
  }, [profile])

  useEffect(() => { loadData() }, [loadData])
  useEffect(() => { loadCardOptions() }, [loadCardOptions])

  const handleCreateBill = async (data: Omit<Bill, 'id' | 'created_at' | 'status'> & { items?: BillItemInput[] }) => {
    await createBill({ ...data, status: 'unpaid' })
    loadData()
  }

  return (
    <Box sx={{ p: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="h6" fontWeight={700}>账单管理</Typography>
      </Box>

      {/* Tab 切换 */}
      <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
        {['未还清', '全部账单'].map((label, i) => (
          <Box
            key={label}
            onClick={() => setTab(i)}
            sx={{
              px: 2, py: 0.5, borderRadius: 2, cursor: 'pointer',
              bgcolor: tab === i ? 'primary.main' : 'grey.200',
              color: tab === i ? 'white' : 'text.primary',
              fontWeight: tab === i ? 700 : 400,
              fontSize: '0.875rem',
              transition: 'all 0.2s',
            }}
          >
            {label}
          </Box>
        ))}
      </Box>

      {error && (
        <Alert
          severity="error"
          action={
            <Button size="small" startIcon={<RefreshIcon />} onClick={loadData}>
              重试
            </Button>
          }
          sx={{ mb: 2 }}
        >
          {error}
        </Alert>
      )}

      {loading ? (
        Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} variant="rounded" height={100} sx={{ mb: 1.5 }} />
        ))
      ) : bills.length === 0 ? (
        <Typography color="text.secondary" textAlign="center" sx={{ mt: 4 }}>
          {tab === 0 ? '目前没有需要还款的账单' : '还没有任何账单记录'}
        </Typography>
      ) : (
        bills.map(b => (
          <BillCard
            key={b.id}
            bill={b}
            onClick={() => router.push(`/bills/${b.id}`)}
          />
        ))
      )}

      {canManage && (
        <SpeedDial
          ariaLabel="账单操作"
          sx={{ position: 'fixed', bottom: 80, right: 16 }}
          icon={<SpeedDialIcon icon={<AddIcon />} openIcon={<RefreshIcon />} />}
        >
          <SpeedDialAction
            icon={<AddIcon />}
            tooltipTitle="手动添加"
            onClick={() => setFormOpen(true)}
          />
          <SpeedDialAction
            icon={<AutoAwesome />}
            tooltipTitle="智能导入"
            onClick={() => setImportOpen(true)}
          />
          <SpeedDialAction
            icon={<FileDownload />}
            tooltipTitle="导出数据"
            onClick={() => setExportOpen(true)}
          />
        </SpeedDial>
      )}

      <BillForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSubmit={handleCreateBill}
        cards={cardOptions}
      />

      <BillImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImportSuccess={() => {
          setImportOpen(false)
          loadData()
        }}
        cards={cardOptions}
        userId={profile?.id || ''}
      />

      <ExportDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        holderId={profile?.id || ''}
        holders={holders}
        cards={cardOptions}
      />
    </Box>
  )
}
