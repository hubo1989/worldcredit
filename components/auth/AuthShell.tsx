'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { CardIcon } from '@/components/icons/WcIcon'

/**
 * 认证页分屏壳（ObsidianUI 暗色）：桌面端左品牌面板（深蓝渐变 + 悬浮卡视觉）
 * + 右表单区；移动端收敛为表单优先的单列，品牌磁贴保留渐变签名。
 */

// 左侧面板的签名渐变卡（纯 CSS 视觉，即 DESIGN.md 的信用卡签名元素）
function CardVisual() {
  return (
    <div
      className='relative aspect-[1.6] w-[min(360px,78%)] animate-[wc-float-card_7s_cubic-bezier(0.45,0,0.55,1)_infinite_alternate]'
    >
      {/* 关键帧就近声明，避免污染全局 token */}
      <style>{`@keyframes wc-float-card { from { transform: translateY(-6px) rotate(-3deg); } to { transform: translateY(8px) rotate(-3deg); } }`}</style>
      {/* 底层卡边：增加纵深 */}
      <div className='absolute inset-0 translate-x-3.5 translate-y-3.5 rounded-[22px] bg-white/[0.07]' />
      {/* 主卡面 */}
      <div className='absolute inset-0 flex flex-col justify-between overflow-hidden rounded-[22px] bg-gradient-to-br from-[#0a1230] via-[#0d2a55] to-d-accent p-6 shadow-2xl'>
        {/* 高光 */}
        <div className='absolute inset-0 bg-[radial-gradient(120%_90%_at_85%_-10%,rgba(255,255,255,0.16)_0%,rgba(255,255,255,0)_55%)]' />
        <div className='relative flex items-start justify-between'>
          <span className='text-[15px] font-bold tracking-[0.02em] text-white'>WorldCredit</span>
          <span className='h-6 w-[34px] rounded-[5px] border border-white/35 bg-white/20' />
        </div>
        <span className='num-tabular text-[19px] font-semibold tracking-[0.12em] text-white/90'>
          •••• •••• •••• 0305
        </span>
        <div className='relative flex items-end justify-between'>
          <span className='text-[12px] text-white/65'>全家的卡 · 一处掌握</span>
          <span className='flex h-[30px] w-[30px] items-center justify-center rounded-full border border-white/30 bg-white/15 text-[13px] font-bold text-white'>
            W
          </span>
        </div>
      </div>
    </div>
  )
}

export function AuthShell({
  title,
  subtitle,
  crossLinkHref,
  crossLinkLabel,
  children,
}: {
  title: string
  subtitle: string
  crossLinkHref: '/login' | '/register'
  crossLinkLabel: string
  children: ReactNode
}) {
  return (
    <div className='obsidian-dashboard flex min-h-dvh bg-d-bg text-d-text'>
      {/* 品牌面板（md 及以上显示） */}
      <div className='relative hidden w-[42%] flex-col justify-between overflow-hidden bg-gradient-to-br from-[#0a1230] via-[#0b1f42] to-[#123a6b] p-8 lg:p-10 md:flex'>
        {/* 背景辉光 */}
        <div className='pointer-events-none absolute -left-[10%] top-[12%] h-[560px] w-[560px] rounded-full bg-[radial-gradient(circle,rgba(122,173,255,0.18)_0%,rgba(122,173,255,0)_70%)]' />
        <div className='relative flex items-center gap-2'>
          <span className='flex h-[38px] w-[38px] items-center justify-center rounded-[11px] border border-white/20 bg-white/10 text-white'>
            <CardIcon size={20} />
          </span>
          <span className='text-[16px] font-bold text-white'>WorldCredit</span>
        </div>
        <div className='relative flex justify-center py-8'>
          <CardVisual />
        </div>
        <div className='relative flex flex-col gap-2.5'>
          <p className='text-[20px] font-semibold leading-[1.5] text-white/90'>
            账单、权益、优惠，
            <br />
            全家的卡，一处掌握。
          </p>
          <p className='text-[13px] text-white/50'>© 2026 WorldCredit</p>
        </div>
      </div>

      {/* 表单区 */}
      <div className='flex flex-1 flex-col items-center justify-center px-6 py-10 md:px-10'>
        <div className='w-full max-w-[400px]'>
          {/* 移动端品牌行 */}
          <div className='mb-8 flex items-center gap-2 md:hidden'>
            <span className='flex h-9 w-9 items-center justify-center rounded-[10px] bg-gradient-to-br from-[#0a1230] to-d-accent text-white'>
              <CardIcon size={19} />
            </span>
            <span className='text-[15px] font-bold text-d-text'>WorldCredit</span>
          </div>

          <div className='mb-1 flex items-center justify-between'>
            <h1 className='text-[28px] font-bold leading-9 tracking-[-0.02em]'>{title}</h1>
            <Link
              href={crossLinkHref}
              className='text-[14px] font-semibold text-d-accent-light underline underline-offset-4'
            >
              {crossLinkLabel}
            </Link>
          </div>
          <p className='mb-8 text-[14px] leading-5 text-d-muted'>{subtitle}</p>
          {children}
        </div>
      </div>
    </div>
  )
}
