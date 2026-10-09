'use client'

import { usePathname, useRouter } from 'next/navigation'
import { HomeIcon, BillsIcon, MineIcon } from '@/components/icons/WcIcon'

const navItems = [
  // §2.1: 3 tab（首页 / 账单 / 我的）；图标统一来自 WcIcon 线性 SVG 库
  { label: '首页', icon: <HomeIcon />, path: '/dashboard' },
  { label: '账单', icon: <BillsIcon />, path: '/bills' },
  { label: '我的', icon: <MineIcon />, path: '/settings' },
]

/** 底部导航（暗色）。3 tab，选中态顶部品牌色短线沿用 §7.3 语义。 */
export function BottomNav() {
  const pathname = usePathname()
  const router = useRouter()

  // 计算当前选中的索引（匹配 3 个新 tab 的路径）
  const currentIndex = navItems.findIndex(item =>
    pathname === item.path || (item.path !== '/' && pathname.startsWith(item.path))
  )
  const activeIdx = currentIndex === -1 ? 0 : currentIndex

  return (
    <nav
      aria-label='底部导航'
      className='fixed bottom-0 left-0 right-0 z-[1000] border-t border-d-border bg-d-surface'
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className='mx-auto flex max-w-[600px]'>
        {navItems.map((item, idx) => {
          const selected = idx === activeIdx
          return (
            <button
              key={item.path}
              type='button'
              onClick={() => router.push(item.path)}
              className={
                'relative flex h-[60px] flex-1 flex-col items-center justify-center gap-0.5 transition-colors ' +
                (selected ? 'text-d-accent-light' : 'text-d-muted')
              }
            >
              {/* 选中态顶部品牌色短线（§7.3 语义的暗色表达） */}
              {selected && (
                <span className='absolute left-1/2 top-0 h-[3px] w-6 -translate-x-1/2 rounded-full bg-d-accent' />
              )}
              {item.icon}
              <span className={'text-[12px] leading-4 ' + (selected ? 'font-semibold' : 'font-normal')}>
                {item.label}
              </span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
