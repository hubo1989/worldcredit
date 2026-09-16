'use client'

import { useEffect, useState, useCallback } from 'react'
import { Box, Grid, Typography, Skeleton } from '@mui/material'
import {
  People as PeopleIcon,
  CreditCard as CardIcon,
  LocalOffer as PromoIcon,
  CardGiftcard as BenefitIcon,
  TrendingUp as TrendIcon,
  AccountBalance as BankIcon
} from '@mui/icons-material'
import { StatCard } from '@/components/admin/StatCard'
import { UserActivityStats } from '@/components/admin/UserActivityStats'
import { CardProductOverview } from '@/components/admin/CardProductOverview'
import { PromoOverview } from '@/components/admin/PromoOverview'
import { BenefitOverview } from '@/components/admin/BenefitOverview'
import {
  getDashboardStats, getUserActivity, getCardProductStats,
  getPromoList, getBenefitStats,
  type DashboardStats, type UserActivity, type CardProductStat,
  type PromoItem, type BenefitStat
} from '@/lib/api/dashboard'

export default function AdminDashboardPage() {
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [activity, setActivity] = useState<UserActivity | null>(null)
  const [products, setProducts] = useState<CardProductStat[]>([])
  const [promos, setPromos] = useState<PromoItem[]>([])
  const [benefits, setBenefits] = useState<BenefitStat[]>([])

  const loadData = useCallback(async () => {
    try {
      setLoading(true)
      const [s, a, p, pr, b] = await Promise.all([
        getDashboardStats(),
        getUserActivity(),
        getCardProductStats(),
        getPromoList(),
        getBenefitStats(),
      ])
      setStats(s)
      setActivity(a)
      setProducts(p)
      setPromos(pr)
      setBenefits(b)
    } catch (err) {
      console.error('Failed to load dashboard:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  if (loading) {
    return (
      <Box>
        <Grid container spacing={2.5} sx={{ mb: 3 }}>
          {[1, 2, 3, 4].map(i => (
            <Grid key={i} size={{ xs: 12, sm: 6, lg: 3 }}>
              <Skeleton variant="rounded" height={100} sx={{ borderRadius: 3, bgcolor: 'rgba(255,255,255,0.04)' }} />
            </Grid>
          ))}
        </Grid>
        <Grid container spacing={2.5}>
          <Grid size={{ xs: 12, lg: 8 }}>
            <Skeleton variant="rounded" height={300} sx={{ borderRadius: 3, bgcolor: 'rgba(255,255,255,0.04)' }} />
          </Grid>
          <Grid size={{ xs: 12, lg: 4 }}>
            <Skeleton variant="rounded" height={300} sx={{ borderRadius: 3, bgcolor: 'rgba(255,255,255,0.04)' }} />
          </Grid>
        </Grid>
      </Box>
    )
  }

  return (
    <Box>
      {/* 顶部欢迎：本页在 adminDarkTheme 下渲染，文字必须走主题 token。
          此前这里硬编码亮色世界的 #636363 / #030059，落在 #181a24 暗底上
          分别是 2.88:1 和 1.06:1——标题几乎不可见。 */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 0.5 }}>
          平台运营概览
        </Typography>
        <Typography variant="h1" sx={{ color: 'text.primary', fontSize: '28px', fontWeight: 600 }}>
          WorldCredit 控制台
        </Typography>
      </Box>

      {/* 统计卡片 */}
      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <StatCard
            icon={<PeopleIcon />}
            label="注册用户"
            value={stats?.totalUsers ?? 0}
            subtitle={activity && activity.recentNewUsers > 0 ? `近 7 天 +${activity.recentNewUsers}` : undefined}
            color="#818cf8"
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <StatCard
            icon={<CardIcon />}
            label="卡产品数"
            value={stats?.totalCardProducts ?? 0}
            color="#38bdf8"
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <StatCard
            icon={<TrendIcon />}
            label="活跃信用卡"
            value={stats?.activeCards ?? 0}
            color="#f59e0b"
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <StatCard
            icon={<PromoIcon />}
            label="进行中活动"
            value={stats?.activePromos ?? 0}
            color="#c084fc"
          />
        </Grid>
      </Grid>

      {/* 快捷模块入口 */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="h3" sx={{ color: 'text.primary', mb: 2, fontSize: '18px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 1 }}>
           核心管理模块
        </Typography>
        <Grid container spacing={2}>
           {[
            { title: '银行管理', path: '/admin/banks', icon: <BankIcon />, color: 'success.main', desc: '维护支持的银行列表' },
            { title: '卡产品管理', path: '/admin/card-products', icon: <CardIcon />, color: 'primary.light', desc: '管理信用卡产品及账期' },
            { title: '优惠活动', path: '/admin/promos', icon: <PromoIcon />, color: 'warning.main', desc: '全平台营销活动维护' },
            { title: '权益管理', path: '/admin/benefits', icon: <BenefitIcon />, color: 'primary.light', desc: '卡权益库及限额维护' }
           ].map(module => (
             <Grid key={module.path} size={{ xs: 12, sm: 6, md: 3 }}>
              <Box
                onClick={() => window.location.href = module.path}
                sx={{
                  // 与 StatCard 同一处缺陷：暗色世界里放白卡 + 亮色文字。
                  // 表面与文字一律走 adminDarkTheme token。
                  p: 2, bgcolor: 'background.paper', borderRadius: '5px', border: '1px solid', borderColor: 'divider',
                  boxShadow: '0px 2px 4px rgba(0,0,0,0.24)',
                  cursor: 'pointer', transition: 'all 0.2s',
                  '&:hover': { borderColor: module.color, boxShadow: '0px 4px 8px rgba(0, 0, 0, 0.32)', transform: 'translateY(-2px)' }
                }}
              >
                 <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1 }}>
                   <Box sx={{ p: 1, borderRadius: '5px', bgcolor: `${module.color}15`, color: module.color, display: 'flex' }}>
                     {module.icon}
                   </Box>
                  <Typography variant="subtitle1" sx={{ color: 'text.primary', fontWeight: 700 }}>{module.title}</Typography>
                </Box>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>{module.desc}</Typography>
               </Box>
             </Grid>
           ))}
        </Grid>
      </Box>


      {/* 第二行：卡产品表 + 用户活跃度 */}
      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, lg: 8 }}>
          <CardProductOverview data={products} />
        </Grid>
        <Grid size={{ xs: 12, lg: 4 }}>
          {activity && <UserActivityStats data={activity} />}
        </Grid>
      </Grid>

      {/* 第三行：优惠活动 + 权益概览 */}
      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12, lg: 6 }}>
          <PromoOverview data={promos} />
        </Grid>
        <Grid size={{ xs: 12, lg: 6 }}>
          <BenefitOverview data={benefits} />
        </Grid>
      </Grid>
    </Box>
  )
}
