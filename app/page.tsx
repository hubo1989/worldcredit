'use client'

import { useRouter } from 'next/navigation'
import { Button } from '@/components/obsidian/controls'
import { WalletIcon, ShieldIcon, GaugeIcon, RocketIcon } from '@/components/icons/WcIcon'

export default function LandingPage() {
  const router = useRouter()

  return (
    <div className='obsidian-dashboard flex min-h-dvh flex-col bg-d-bg text-d-text'>
      {/* 顶部导航占位 */}
      <div className='mx-auto flex w-full max-w-5xl items-center justify-between py-4'>
        <span className='text-[20px] font-extrabold tracking-tight text-d-accent-light'>WorldCredit</span>
        <Button variant='secondary' size='sm' onClick={() => router.push('/login')}>
          登录
        </Button>
      </div>

      {/* Hero Content */}
      <div className='mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center py-12'>
        <div className='mb-12 text-center'>
          <h1 className='mb-6 bg-gradient-to-r from-d-accent-light to-d-gold bg-clip-text text-[2.5rem] font-extrabold leading-tight text-transparent md:text-[4rem]'>
            家庭信用卡管理<br />全新体验
          </h1>
          <p className='mx-auto mb-10 max-w-xl text-[16px] leading-[1.6] text-d-muted'>
            专业、简洁地聚合您的账单、权益和信用卡资产。提供智能分析与提醒，帮您轻松掌控家庭财务健康。
          </p>
          <div className='flex flex-col items-center justify-center gap-3 sm:flex-row'>
            <Button onClick={() => router.push('/dashboard')} className='h-12 px-8 text-[16px]'>
              开始使用
              <RocketIcon size={18} />
            </Button>
            <Button
              variant='secondary'
              onClick={() => router.push('/login')}
              className='h-12 px-8 text-[16px]'
            >
              登录系统
            </Button>
          </div>
        </div>

        {/* Features */}
        <div className='grid grid-cols-1 gap-5 md:grid-cols-3'>
          <div className='h-full rounded-2xl border border-d-border bg-d-surface p-6 transition-transform duration-200 hover:-translate-y-1'>
            <WalletIcon size={36} className='mb-4 text-d-accent-light' />
            <p className='mb-2 text-[16px] font-bold'>全景账单</p>
            <p className='text-[14px] leading-[1.6] text-d-muted'>
              一站式聚合所有信用卡账单，清爽直观的负债总览，告别逾期风险。
            </p>
          </div>
          <div className='h-full rounded-2xl border border-d-border bg-d-surface p-6 transition-transform duration-200 hover:-translate-y-1'>
            <ShieldIcon size={36} className='mb-4 text-d-success-ink' />
            <p className='mb-2 text-[16px] font-bold'>数据安全</p>
            <p className='text-[14px] leading-[1.6] text-d-muted'>
              独立部署的基础设施，严格的访问控制保护，您的财务数据仅您可见。
            </p>
          </div>
          <div className='h-full rounded-2xl border border-d-border bg-d-surface p-6 transition-transform duration-200 hover:-translate-y-1'>
            <GaugeIcon size={36} className='mb-4 text-d-warn-ink' />
            <p className='mb-2 text-[16px] font-bold'>极致体验</p>
            <p className='text-[14px] leading-[1.6] text-d-muted'>
              专为移动端优化的交互设计，功能全面且无广告打扰，秒级触达。
            </p>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className='py-6 text-center text-[13px] text-d-muted'>
        &copy; {new Date().getFullYear()} WorldCredit. All rights reserved.
      </div>
    </div>
  )
}
