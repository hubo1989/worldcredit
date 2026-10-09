'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useAuth } from '@/lib/auth'
import {
  HomeIcon,
  CardIcon,
  PromoIcon,
  BenefitIcon,
  SettingsIcon,
  LogoutIcon,
  MenuIcon,
  ChevronLeftIcon,
  BankIcon,
  MailIcon,
  PhoneIcon,
} from '@/components/icons/WcIcon'

const NAV_ITEMS = [
  { label: '仪表盘', icon: <HomeIcon size={20} />, path: '/admin' },
  { label: '银行管理', icon: <BankIcon size={20} />, path: '/admin/banks' },
  { label: '卡产品管理', icon: <CardIcon size={20} />, path: '/admin/card-products' },
  { label: '优惠活动', icon: <PromoIcon size={20} />, path: '/admin/promos' },
  { label: '权益管理', icon: <BenefitIcon size={20} />, path: '/admin/benefits' },
  { label: '邮件日志', icon: <MailIcon size={20} />, path: '/admin/email-logs' },
  { label: '系统设置', icon: <SettingsIcon size={20} />, path: '/admin/settings' },
]

/** admin 表格用三态复选框（原生 checkbox + indeterminate）。 */
export function AdminCheckbox({
  checked,
  indeterminate = false,
  onChange,
  ariaLabel,
}: {
  checked: boolean
  indeterminate?: boolean
  onChange: (next: boolean) => void
  ariaLabel?: string
}) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate
  }, [indeterminate])
  return (
    <input
      ref={ref}
      type='checkbox'
      aria-label={ariaLabel}
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className='h-4 w-4 cursor-pointer accent-d-accent'
    />
  )
}

/** admin 表格分页条（对应 MUI TablePagination）。page 从 0 计。 */
export function AdminPagination({
  count,
  page,
  rowsPerPage,
  onPageChange,
  onRowsPerPageChange,
  rowsPerPageOptions = [5, 10, 25],
}: {
  count: number
  page: number
  rowsPerPage: number
  onPageChange: (page: number) => void
  onRowsPerPageChange: (n: number) => void
  rowsPerPageOptions?: number[]
}) {
  const totalPages = Math.max(1, Math.ceil(count / rowsPerPage))
  const from = count === 0 ? 0 : page * rowsPerPage + 1
  const to = Math.min((page + 1) * rowsPerPage, count)
  return (
    <div className='flex flex-wrap items-center justify-end gap-3 border-t border-d-border px-3 py-2.5 text-[13px] text-d-muted'>
      <span>
        第 {from}-{to} 条，共 {count} 条
      </span>
      <label className='flex items-center gap-1.5'>
        每页
        <select
          value={rowsPerPage}
          onChange={(e) => onRowsPerPageChange(Number(e.target.value))}
          className='h-8 rounded-lg border border-d-border bg-d-surface px-2 text-d-text'
        >
          {rowsPerPageOptions.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        行
      </label>
      <div className='flex items-center gap-1'>
        <button
          type='button'
          aria-label='上一页'
          disabled={page === 0}
          onClick={() => onPageChange(page - 1)}
          className='flex h-8 w-8 items-center justify-center rounded-lg border border-d-border text-d-muted disabled:opacity-40'
        >
          <ChevronLeftIcon size={16} />
        </button>
        <span className='px-1 tabular-nums'>
          {page + 1} / {totalPages}
        </span>
        <button
          type='button'
          aria-label='下一页'
          disabled={page + 1 >= totalPages}
          onClick={() => onPageChange(page + 1)}
          className='flex h-8 w-8 items-center justify-center rounded-lg border border-d-border text-d-muted disabled:opacity-40'
        >
          <ChevronLeftIcon size={16} className='rotate-180' />
        </button>
      </div>
    </div>
  )
}

export function AdminShell({ children }: { children: ReactNode }) {
  const { user, loading, signOut } = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(true)
  const userMenuRef = useRef<HTMLDivElement>(null)

  // 权限校验：未登录或非管理员重定向到 /dashboard。
  // 判定用会话里的 role，而不是浏览器端再维护一份邮箱白名单：role 由服务端
  // 在签发 cookie 时按 lib/admin-emails.ts 的白名单写入，客户端无法与之漂移，
  // 也避免出现「服务端认的管理员打不开 /admin」这种两边名单不一致的问题。
  useEffect(() => {
    if (loading) return
    if (!user) {
      router.replace('/login')
      return
    }
    if (user.role !== 'admin') {
      router.replace('/dashboard')
    }
  }, [user, loading, router])

  // 点击外部关闭用户菜单
  useEffect(() => {
    if (!userMenuOpen) return
    const onDown = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [userMenuOpen])

  const handleLogout = async () => {
    setUserMenuOpen(false)
    await signOut()
    window.location.href = '/login'
  }

  const handleNavigate = (path: string) => {
    router.push(path)
  }

  // 加载中或无权限时不渲染管理后台内容
  if (loading || !user || user.role !== 'admin') {
    return null
  }

  return (
    <div className='flex min-h-dvh bg-d-bg'>
      {/* 侧边栏：可收起的常驻 aside */}
      <aside
        className={
          'sticky top-0 flex h-dvh shrink-0 flex-col overflow-hidden border-r border-d-border bg-d-surface ' +
          'transition-[width] duration-300 ' +
          (drawerOpen ? 'w-[260px]' : 'w-0 border-r-0')
        }
      >
        <div className='flex w-[260px] flex-1 flex-col'>
          {/* Logo 区域 */}
          <div className='flex items-center justify-between px-3.5 py-3.5'>
            <div className='flex items-center gap-2'>
              <span className='flex h-9 w-9 items-center justify-center rounded-lg bg-d-accent-light text-base font-bold text-d-bg'>
                W
              </span>
              <span>
                <span className='block text-[15px] font-bold leading-tight'>WorldCredit</span>
                <span className='block text-[11px] text-d-accent-light'>管理控制台</span>
              </span>
            </div>
            <button
              type='button'
              aria-label='收起侧边栏'
              onClick={() => setDrawerOpen(false)}
              className='rounded-lg p-1.5 text-d-accent-light hover:bg-d-subtle'
            >
              <ChevronLeftIcon size={18} />
            </button>
          </div>

          <div className='mx-2.5 h-px bg-d-border' />

          {/* 导航菜单 */}
          <nav className='mt-2 flex flex-col gap-0.5 px-2'>
            {NAV_ITEMS.map((item) => {
              const selected = pathname === item.path
              return (
                <button
                  key={item.label}
                  type='button'
                  onClick={() => handleNavigate(item.path)}
                  aria-current={selected ? 'page' : undefined}
                  className={
                    'flex items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-left text-[14px] transition-colors ' +
                    (selected
                      ? 'bg-d-accent font-bold text-white'
                      : 'text-d-text/85 hover:bg-d-subtle')
                  }
                >
                  <span className={selected ? 'text-white' : 'text-d-muted'}>{item.icon}</span>
                  {item.label}
                </button>
              )
            })}
          </nav>

          {/* 底部用户信息 */}
          <div className='mt-auto p-3'>
            <div className='mb-3 h-px bg-d-border' />
            <div ref={userMenuRef} className='relative'>
              <button
                type='button'
                onClick={() => setUserMenuOpen((v) => !v)}
                className='flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-left hover:bg-d-subtle'
              >
                <span className='flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-d-accent-light text-sm font-bold text-d-bg'>
                  {user?.email?.[0]?.toUpperCase() || 'A'}
                </span>
                <span className='min-w-0 flex-1'>
                  <span className='block truncate text-[13px] font-medium'>{user?.email || '管理员'}</span>
                  <span className='block text-[11px] text-d-accent-light'>系统管理员</span>
                </span>
              </button>
              {userMenuOpen ? (
                <div className='absolute bottom-full left-0 z-50 mb-2 w-48 overflow-hidden rounded-xl border border-d-border bg-d-surface shadow-xl'>
                  <button
                    type='button'
                    onClick={() => {
                      setUserMenuOpen(false)
                      router.push('/dashboard')
                    }}
                    className='flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-[14px] hover:bg-d-subtle'
                  >
                    <PhoneIcon size={16} className='text-d-muted' /> 返回前台 App
                  </button>
                  <button
                    type='button'
                    onClick={handleLogout}
                    className='flex w-full items-center gap-2 border-t border-d-border px-3.5 py-2.5 text-left text-[14px] text-d-danger-ink hover:bg-d-subtle'
                  >
                    <LogoutIcon size={16} /> 退出登录
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </aside>

      {/* 主内容区 */}
      <div className='flex min-w-0 flex-1 flex-col'>
        {/* 顶栏 */}
        <header className='sticky top-0 z-40 border-b border-d-border bg-d-surface'>
          <div className='flex min-h-[52px] items-center gap-3 px-4'>
            {!drawerOpen && (
              <button
                type='button'
                aria-label='展开侧边栏'
                onClick={() => setDrawerOpen(true)}
                className='rounded-lg p-1.5 text-d-muted hover:bg-d-subtle'
              >
                <MenuIcon size={20} />
              </button>
            )}
            <h1 className='text-[16px] font-semibold'>控制台</h1>
            <div className='flex-1' />
            <button
              type='button'
              onClick={() => router.push('/dashboard')}
              className='flex h-9 items-center gap-1.5 rounded-xl border border-d-accent/50 px-3.5 text-[13px] font-semibold text-d-accent-light hover:bg-d-subtle'
            >
              <PhoneIcon size={16} />
              返回前台 App
            </button>
            <span className='text-[12px] text-d-muted'>
              {new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })}
            </span>
          </div>
        </header>

        {/* 页面内容 */}
        <main className='flex-1 overflow-y-auto bg-d-bg p-6'>{children}</main>
      </div>
    </div>
  )
}
