// app/(mobile)/page.tsx
'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  Box, Typography, Grid, Card, CardContent,
  IconButton, Button, Stack, Avatar
} from '@mui/material'
import {
  Notifications as BellIcon,
  Add as AddIcon,
  ChevronRight as ChevronRightIcon,
  CreditCard as CreditCardIcon,
  People as PeopleIcon,
} from '@mui/icons-material'
import { useAuth } from '@/lib/auth'
import { insforge } from '@/lib/insforge'
import { getUnpaidBills } from '@/lib/api/bills'
import { getPaymentsByBill } from '@/lib/api/payments'
import { getHolders } from '@/lib/api/holders'
import { getAllCards } from '@/lib/api/cards'
import { DashboardSummary } from '@/components/mobile/DashboardSummary'
import { UpcomingBills } from '@/components/mobile/UpcomingBills'
import type { CardHolder, CreditCard } from '@/lib/types'

export default function HomePage() {
  const { user } = useAuth()
  const router = useRouter()
  const [stats, setStats] = useState({ cards: 0, holders: 0, totalLimit: 0 })
  const [bills, setBills] = useState<any[]>([])
  const [holders, setHolders] = useState<CardHolder[]>([])
  const [cards, setCards] = useState<CreditCard[]>([])
  const [loading, setLoading] = useState(true)

  const loadData = useCallback(async () => {
    try {
      const [holdersData, cardsData] = await Promise.all([
        getHolders().catch(() => [] as CardHolder[]),
        getAllCards().catch(() => [] as CreditCard[]),
      ])
      setHolders(holdersData)
      setCards(cardsData)

      const totalLimit = cardsData.reduce((sum, c) => sum + c.credit_limit, 0)
      setStats({
        cards: cardsData.length,
        holders: holdersData.length,
        totalLimit,
      })

      // Load unpaid bills
      const unpaidBills = await getUnpaidBills().catch(() => [])
      // Enrich with payment info
      const enrichedBills = await Promise.all(
        unpaidBills.map(async (b: any) => {
          try {
            const p = await getPaymentsByBill(b.id)
            const card = cardsData.find(c => c.id === b.card_id)
            return {
              ...b,
              paid_amount: p.reduce((s: number, pm: any) => s + pm.amount, 0),
              card: card ? { bank_name: card.bank_name, card_name: card.card_name, currency: card.currency } : undefined
            }
          } catch {
            return { ...b, paid_amount: 0 }
          }
        })
      )
      setBills(enrichedBills)
    } catch (err) {
      console.error('Dashboard load failed:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  return (
    <Box sx={{ p: 2, pb: 4 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h6" fontWeight={800}>
            👋 Hi, {user?.name || '管理员'}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {bills.filter(b => b.status !== 'paid').length} 笔待还款项
          </Typography>
        </Box>
        <IconButton sx={{ bgcolor: 'white', border: '1px solid #eee' }}>
          <BellIcon fontSize="small" />
        </IconButton>
      </Box>

      {/* Dashboard Summary */}
      <DashboardSummary bills={bills} />

      {/* Upcoming Bills */}
      <UpcomingBills bills={bills} />

      {/* Quick Stats Grid */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={4}>
          <Card sx={{ borderRadius: 3, textAlign: 'center' }}>
            <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
              <PeopleIcon color="primary" fontSize="small" />
              <Typography variant="h6" fontWeight={700}>{stats.holders}</Typography>
              <Typography variant="caption" color="text.secondary">持卡人</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={4}>
          <Card sx={{ borderRadius: 3, textAlign: 'center' }}>
            <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
              <CreditCardIcon color="primary" fontSize="small" />
              <Typography variant="h6" fontWeight={700}>{stats.cards}</Typography>
              <Typography variant="caption" color="text.secondary">信用卡</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={4}>
          <Card sx={{ borderRadius: 3, textAlign: 'center' }}>
            <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
              <Typography variant="caption" color="text.secondary">总额度</Typography>
              <Typography variant="body2" fontWeight={700}>
                {stats.totalLimit > 10000
                  ? `${(stats.totalLimit / 10000).toFixed(1)}万`
                  : stats.totalLimit.toLocaleString()}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Holder Previews */}
      {holders.length > 0 && (
        <Box sx={{ mb: 3 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
            <Typography variant="subtitle1" fontWeight={700}>持卡人</Typography>
            <Button size="small" endIcon={<ChevronRightIcon />} href="/holders">全部</Button>
          </Box>
          <Stack direction="row" spacing={1.5} sx={{ overflowX: 'auto', pb: 1 }}>
            {holders.map(h => {
              const holderCards = cards.filter(c => c.holder_id === h.id)
              return (
                <Card
                  key={h.id}
                  sx={{
                    minWidth: 140, borderRadius: 3, flexShrink: 0,
                    cursor: 'pointer'
                  }}
                  onClick={() => router.push(`/holders/${h.id}`)}
                >
                  <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 }, textAlign: 'center' }}>
                    <Avatar sx={{ bgcolor: h.avatar_color, width: 40, height: 40, mx: 'auto', mb: 1 }}>
                      {h.name.charAt(0)}
                    </Avatar>
                    <Typography variant="body2" fontWeight={600} noWrap>{h.name}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {holderCards.length} 张卡
                    </Typography>
                  </CardContent>
                </Card>
              )
            })}
            <Card
              sx={{
                minWidth: 80, borderRadius: 3, flexShrink: 0,
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}
              onClick={() => router.push('/holders')}
            >
              <CardContent sx={{ textAlign: 'center', p: 1.5, '&:last-child': { pb: 1.5 } }}>
                <AddIcon sx={{ color: '#999' }} />
              </CardContent>
            </Card>
          </Stack>
        </Box>
      )}

      {/* Empty State (when no data at all) */}
      {holders.length === 0 && cards.length === 0 && (
        <Box sx={{
          textAlign: 'center', p: 4, bgcolor: '#fff', borderRadius: 4,
          border: '2px dashed #eee'
        }}>
          <CreditCardIcon sx={{ fontSize: 48, color: '#ccc', mb: 2 }} />
          <Typography variant="subtitle1" fontWeight={600}>暂无信用卡数据</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            添加持卡人后，即可录入其名下的信用卡
          </Typography>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            sx={{ borderRadius: 3, px: 4 }}
            href="/holders"
          >
            立即开始
          </Button>
        </Box>
      )}
    </Box>
  )
}
