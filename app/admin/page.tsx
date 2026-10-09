'use client'

import { useEffect, useState, useCallback } from 'react'
import { Skeleton } from '@/components/obsidian/feedback'
import {
  PeopleIcon,
  CardIcon,
  PromoIcon,
  BenefitIcon,
  TrendUpIcon,
  BankIcon,
} from '@/components/icons/WcIcon'
import { StatCard } from '@/components/admin/StatCard'
import { UserActivityStats } from '@/components/admin/UserActivityStats'
import { CardProductOverview } from '@/components/admin/CardProductOverview'
import { PromoOverview } from '@/components/admin/PromoOverview'
import { BenefitOverview } from '@/components/admin/BenefitOverview'
import {
  getDashboardStats, getUserActivity, getCardProductStats,
  getPromoList, getBenefitStats,
  type DashboardStats, type UserActivity, type CardProductStat,
  type PromoItem, type BenefitStat,
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
      <div>
        <div className='mb-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4'>
          {[1, 2, 3, 4].map(i => (
            <Skeleton key={i} className='h-[100px] rounded-2xl' />
          ))}
        </div>
        <div className='grid grid-cols-1 gap-5 lg:grid-cols-8'>
          <div className='lg:col-span-5'>
            <Skeleton className='h-[300px] rounded-2xl' />
          </div>
          <div className='lg:col-span-3'>
            <Skeleton className='h-[300px] rounded-2xl' />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      {/* 顶部欢迎 */}
      <div className='mb-6'>
        <p className='mb-1 text-[13px] text-d-muted'>平台运营概览</p>
        <h1 className='text-[28px] font-semibold'>WorldCredit 控制台</h1>
      </div>

      {/* 统计卡片 */}
      <div className='mb-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4'>
        <StatCard
          icon={<PeopleIcon size={22} />}
          label="注册用户"
          value={stats?.totalUsers ?? 0}
          subtitle={activity && activity.recentNewUsers > 0 ? `近 7 天 +${activity.recentNewUsers}` : undefined}
          color="#818cf8"
        />
        <StatCard
          icon={<CardIcon size={22} />}
          label="卡产品数"
          value={stats?.totalCardProducts ?? 0}
          color="#38bdf8"
        />
        <StatCard
          icon={<TrendUpIcon size={22} />}
          label="活跃信用卡"
          value={stats?.activeCards ?? 0}
          color="#f59e0b"
        />
        <StatCard
          icon={<PromoIcon size={22} />}
          label="进行中活动"
          value={stats?.activePromos ?? 0}
          color="#c084fc"
        />
      </div>

      {/* 快捷模块入口 */}
      <div className='mb-8'>
        <h2 className='mb-4 flex items-center gap-2 text-[18px] font-semibold'>核心管理模块</h2>
        <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4'>
          {[
            { title: '银行管理', path: '/admin/banks', icon: <BankIcon size={22} />, color: '#6ee7a0', desc: '维护支持的银行列表' },
            { title: '卡产品管理', path: '/admin/card-products', icon: <CardIcon size={22} />, color: '#7aadff', desc: '管理信用卡产品及账期' },
            { title: '优惠活动', path: '/admin/promos', icon: <PromoIcon size={22} />, color: '#ffc46b', desc: '全平台营销活动维护' },
            { title: '权益管理', path: '/admin/benefits', icon: <BenefitIcon size={22} />, color: '#7aadff', desc: '卡权益库及限额维护' },
          ].map(module => (
            <button
              key={module.path}
              type='button'
              onClick={() => window.location.href = module.path}
              className='rounded-2xl border border-d-border bg-d-surface p-4 text-left transition-colors hover:border-d-accent'
            >
              <div className='mb-2 flex items-center gap-2'>
                <span
                  className='flex rounded-lg p-2'
                  style={{ backgroundColor: `${module.color}26`, color: module.color }}
                >
                  {module.icon}
                </span>
                <span className='text-[16px] font-bold'>{module.title}</span>
              </div>
              <p className='text-[12px] text-d-muted'>{module.desc}</p>
            </button>
          ))}
        </div>
      </div>

      {/* 第二行：卡产品表 + 用户活跃度 */}
      <div className='mb-6 grid grid-cols-1 gap-5 lg:grid-cols-8'>
        <div className='lg:col-span-5'>
          <CardProductOverview data={products} />
        </div>
        <div className='lg:col-span-3'>
          {activity && <UserActivityStats data={activity} />}
        </div>
      </div>

      {/* 第三行：优惠活动 + 权益概览 */}
      <div className='grid grid-cols-1 gap-5 lg:grid-cols-2'>
        <PromoOverview data={promos} />
        <BenefitOverview data={benefits} />
      </div>
    </div>
  )
}
