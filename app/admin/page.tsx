'use client'

import { useEffect, useState, useCallback } from 'react'
import { Box, Grid, Typography, Skeleton, Stack } from '@mui/material'
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
      {/* 顶部欢迎 */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="body2" sx={{ color: '#636363', mb: 0.5 }}>
          平台运营概览
        </Typography>
        <Typography variant="h1" sx={{ color: '#030059', fontSize: '28px', fontWeight: 300 }}>
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
            color="#030059"
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <StatCard
            icon={<CardIcon />}
            label="卡产品数"
            value={stats?.totalCardProducts ?? 0}
            color="#007CBA"
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <StatCard
            icon={<TrendIcon />}
            label="活跃信用卡"
            value={stats?.activeCards ?? 0}
            color="#FCB900"
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <StatCard
            icon={<PromoIcon />}
            label="进行中活动"
            value={stats?.activePromos ?? 0}
            color="#7AADFF"
          />
        </Grid>
      </Grid>

      {/* 快捷模块入口 */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="h3" sx={{ color: '#030059', mb: 2, fontSize: '18px', fontWeight: 300, display: 'flex', alignItems: 'center', gap: 1 }}>
           核心管理模块
        </Typography>
        <Grid container spacing={2}>
           {[
            { title: '银行管理', path: '/admin/banks', icon: <BankIcon />, color: '#00AA00', desc: '维护支持的银行列表' },
            { title: '卡产品管理', path: '/admin/card-products', icon: <CardIcon />, color: '#030059', desc: '管理信用卡产品及账期' },
            { title: '优惠活动', path: '/admin/promos', icon: <PromoIcon />, color: '#FCB900', desc: '全平台营销活动维护' },
            { title: '权益管理', path: '/admin/benefits', icon: <BenefitIcon />, color: '#7A00DF', desc: '卡权益库及限额维护' }
           ].map(module => (
             <Grid key={module.path} size={{ xs: 12, sm: 6, md: 3 }}>
               <Box 
                 onClick={() => window.location.href = module.path}
                 sx={{ 
                   p: 2, bgcolor: '#FFFFFF', borderRadius: '5px', border: '1px solid #DDDDDD',
                   boxShadow: '0px 2px 4px rgba(0,0,0,0.08)',
                   cursor: 'pointer', transition: 'all 0.2s',
                   '&:hover': { borderColor: module.color, boxShadow: '0px 4px 8px rgba(0, 0, 0, 0.12)', transform: 'translateY(-2px)' }
                 }}
               >
                 <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1 }}>
                   <Box sx={{ p: 1, borderRadius: '5px', bgcolor: `${module.color}15`, color: module.color, display: 'flex' }}>
                     {module.icon}
                   </Box>
                   <Typography variant="subtitle1" sx={{ color: '#333333', fontWeight: 700 }}>{module.title}</Typography>
                 </Box>
                 <Typography variant="caption" sx={{ color: '#636363' }}>{module.desc}</Typography>
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
