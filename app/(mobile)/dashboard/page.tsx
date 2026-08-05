'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  Container, Typography, Box, Stack, Paper,
  Button, Skeleton, Card, CardContent, IconButton, Tooltip
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import SyncIcon from '@mui/icons-material/Sync'
import AlertIcon from '@mui/icons-material/NotificationsActive'
import AiIcon from '@mui/icons-material/AutoAwesome'
import ShowIcon from '@mui/icons-material/Visibility'
import HideIcon from '@mui/icons-material/VisibilityOff'
import { useRouter } from 'next/navigation'
import { insforge } from '@/lib/insforge'
import { getBillDashboardItems, type BillDashboardItem } from '@/lib/api/bills'
import { useUserPreferences } from '@/lib/hooks/useUserPreferences'
import { BillStatusCard } from '@/components/mobile/BillStatusCard'
import { useAuth } from '@/lib/auth'

export default function DashboardPage() {
  const { user } = useAuth()
  const { displayConfig, togglePrivacyMode } = useUserPreferences()
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({
    totalLimit: 0,
    totalOwed: 0,
    activeCards: 0,
    pendingBills: 0
  })
  const [upcomingBills, setUpcomingBills] = useState<BillDashboardItem[]>([])
  const router = useRouter()

  const loadData = useCallback(async () => {
    if (!user) return
    try {
      setLoading(true)

      // 并行请求：1. 用户卡片汇总  2. 账单列表
      const [cardsRes, allBills] = await Promise.all([
        insforge.database
          .from('credit_cards')
          .select('id, credit_limit, card_holders!inner(created_by)')
          .eq('card_holders.created_by', user.id),
        getBillDashboardItems(100, user.id)
      ])

      const userCards = cardsRes.data || []
      const totalLimit = userCards.reduce((acc: number, c: any) => acc + Number(c.credit_limit || 0), 0)
      const activeCards = userCards.length

      const unpaidBills = allBills.filter(b => b.computed_status !== 'paid')
      const totalOwed = unpaidBills.reduce((acc, b) => acc + (b.remaining_amount || 0), 0)
      const pendingBills = unpaidBills.length

      setStats({ totalLimit, totalOwed, activeCards, pendingBills })
      setUpcomingBills(unpaidBills.slice(0, 3))

    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => { loadData() }, [loadData])

  const blurClass = displayConfig.privacy_mode ? 'privacy-blur' : 'privacy-clear'

  if (loading) {
    return (
      <Container sx={{ py: 3 }}>
        <Skeleton variant="text" width="40%" height={40} sx={{ mb: 2 }} />
        <Box sx={{ display: 'flex', gap: 2, mb: 4 }}>
          <Paper sx={{ flex: 1, p: 2, borderRadius: 4, bgcolor: 'grey.50', textAlign: 'center' }}>
            <Typography variant="h6" fontWeight={700}>{stats.pendingBills}</Typography>
            <Typography variant="caption" color="text.secondary">待还账单</Typography>
          </Paper>
          <Paper sx={{ flex: 1, p: 2, borderRadius: 4, bgcolor: 'grey.50', textAlign: 'center' }}>
            <Typography variant="h6" fontWeight={700}>¥{stats.totalOwed.toLocaleString()}</Typography>
            <Typography variant="caption" color="text.secondary">本月负债</Typography>
          </Paper>
        </Box>
        <Skeleton variant="rounded" height={200} sx={{ borderRadius: 4 }} />
      </Container>
    )
  }

  return (
    <Container sx={{ py: 3, pb: 10 }}>
      {/* 顶部标题与隐私模式切换 */}
      <Box sx={{ mb: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Box>
          <Typography variant="h1" sx={{ fontSize: '28px', fontWeight: 300, color: '#030059' }}>概览</Typography>
          <Typography variant="body2" color="#636363">管控您的信用卡资产与还款日程</Typography>
        </Box>
        <Tooltip title={displayConfig.privacy_mode ? '显示敏感金额' : '隐匿敏感金额'}>
          <IconButton
            onClick={togglePrivacyMode}
            sx={{
              bgcolor: '#FFFFFF',
              boxShadow: '0px 2px 4px rgba(0,0,0,0.08)',
              border: '1px solid #DDDDDD',
              color: '#030059'
            }}
          >
            {displayConfig.privacy_mode ? <HideIcon fontSize="small" /> : <ShowIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
      </Box>

      {/* 核心统计卡片 (Solutions Treatment Center 深蓝基底) */}
      <Paper sx={{ 
        p: 3, mb: 3, borderRadius: '10px', 
        background: 'linear-gradient(135deg, #030059 0%, #007CBA 100%)',
        color: '#FFFFFF',
        boxShadow: '0px 4px 8px rgba(0, 0, 0, 0.12)',
        position: 'relative',
        overflow: 'hidden'
      }}>
        <Typography variant="subtitle2" sx={{ color: '#A2C6FF', mb: 1, fontWeight: 400 }}>应还总额 (所有银行卡)</Typography>
        
        {/* 金额 */}
        <Typography variant="h1" sx={{ color: '#FFFFFF', fontSize: '32px', fontWeight: 300, mb: 2.5 }} className={blurClass}>
          ¥{stats.totalOwed.toLocaleString()}
        </Typography>

        <Box sx={{ display: 'flex', gap: 4 }}>
          <Box>
            <Typography variant="caption" sx={{ color: '#A2C6FF', display: 'block', mb: 0.25 }}>总授信</Typography>
            <Typography variant="body1" sx={{ color: '#FFFFFF', fontWeight: 700 }} className={blurClass}>
              ¥{(stats.totalLimit / 10000).toFixed(1)}w
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" sx={{ color: '#A2C6FF', display: 'block', mb: 0.25 }}>已开卡</Typography>
            <Typography variant="body1" sx={{ color: '#FFFFFF', fontWeight: 700 }}>{stats.activeCards} 张</Typography>
          </Box>
        </Box>
      </Paper>

      {/* 快捷操作按键组 */}
      <Stack direction="row" spacing={2} sx={{ mb: 4 }}>
        <Button 
          fullWidth variant="contained"
          startIcon={<AddIcon />}
          onClick={() => router.push('/holders')}
          sx={{ 
            borderRadius: '3px', py: 1.2, 
            backgroundColor: '#A2C6FF', color: '#FFFFFF', fontWeight: 700,
            '&:hover': { backgroundColor: '#7AADFF' }
          }}
        >
          持卡人
        </Button>
        <Button 
          fullWidth variant="outlined"
          startIcon={<SyncIcon />}
          onClick={() => router.push('/bills')}
          sx={{ 
            borderRadius: '3px', py: 1.2, 
            borderColor: '#030059', color: '#030059', fontWeight: 400,
            '&:hover': { backgroundColor: 'rgba(162, 198, 255, 0.2)', borderColor: '#7AADFF' }
          }}
        >
          账单
        </Button>
        <Button 
          fullWidth variant="outlined"
          startIcon={<AiIcon />}
          onClick={() => router.push('/ai')}
          sx={{ 
            borderRadius: '3px', py: 1.2, 
            borderColor: '#7AADFF', color: '#007CBA', fontWeight: 400,
            '&:hover': { backgroundColor: 'rgba(162, 198, 255, 0.2)' }
          }}
        >
          AI 助手
        </Button>
      </Stack>

      {/* 临近提醒 */}
      <Box sx={{ mb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h3" sx={{ fontSize: '18px', fontWeight: 300, color: '#030059', display: 'flex', alignItems: 'center', gap: 1 }}>
          <AlertIcon sx={{ color: '#FCB900', fontSize: 20 }} />
          临近还款
        </Typography>
        <Button size="small" onClick={() => router.push('/bills')} sx={{ color: '#030059', textDecoration: 'underline' }}>查看全部</Button>
      </Box>

      {upcomingBills.length === 0 ? (
        <Paper sx={{ p: 4, textAlign: 'center', borderRadius: '5px', bgcolor: '#FFFFFF', border: '1px solid #DDDDDD', boxShadow: '0px 2px 4px rgba(0,0,0,0.08)' }}>
          <Typography color="#636363" variant="body2">暂无待还账单，赞！</Typography>
        </Paper>
      ) : (
        <Stack spacing={1}>
          {upcomingBills.map(bill => (
            <BillStatusCard key={bill.id} bill={bill} onClick={() => router.push('/bills')} />
          ))}
        </Stack>
      )}

      {/* 财务健康卡片 (运用 Design.md 的 Info Box 样式) */}
      <Box sx={{ mt: 4, mb: 2 }}>
         <Typography variant="h3" sx={{ fontSize: '18px', fontWeight: 300, color: '#030059' }}>财务健康</Typography>
      </Box>
      <Box className="info-box">
        <Stack direction="row" spacing={2} alignItems="center">
          <Typography variant="h4">🛡️</Typography>
          <Box>
            <Typography variant="body1" fontWeight={700} color="#030059">授信利用率适中</Typography>
            <Typography variant="body2" color="#333333">
              您的负债率为 {(stats.totalLimit > 0 ? (stats.totalOwed / stats.totalLimit * 100).toFixed(1) : 0)}%，表现稳健。
            </Typography>
          </Box>
        </Stack>
      </Box>
    </Container>
  )
}
