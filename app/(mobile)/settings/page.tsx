'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { BottomSheet, ConfirmDialog, Toast } from '@/components/obsidian/overlays'
import { Alert, Spinner } from '@/components/obsidian/feedback'
import { useAuth } from '@/lib/auth'
import { useUserPreferences } from '@/lib/hooks/useUserPreferences'
import { useTheme } from '@/lib/hooks/useTheme'
import { DisplayPreferencesCard } from '@/components/settings/DisplayPreferencesCard'
import { ReminderPreferencesCard } from '@/components/settings/ReminderPreferencesCard'
import { GmailConnectPanel } from '@/components/mobile/GmailConnectPanel'
import { getGmailConnection, type GmailConnectionStatus } from '@/lib/api/gmail'
import {
  UserIcon,
  PromoIcon,
  BenefitIcon,
  ImportIcon,
  BellIcon,
  SettingsIcon,
  ChevronRightIcon,
} from '@/components/icons/WcIcon'

const DOMAIN = '20160325.xyz'

/** 我的页列表项（暗色/亮色自适应）。整行点击热区 ≥ 48px */
function SettingsMenuRow({
  icon,
  title,
  subtitle,
  onClick,
  badge,
}: {
  icon: React.ReactNode
  title: string
  subtitle: string
  onClick: () => void
  badge?: React.ReactNode
}) {
  return (
    <button
      type='button'
      onClick={onClick}
      className='flex min-h-[52px] w-full items-center gap-3.5 px-4 py-3 text-left transition-colors active:bg-d-subtle'
    >
      <span className='flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-d-subtle text-d-accent-light'>
        {icon}
      </span>
      <span className='min-w-0 flex-1'>
        <span className='block truncate text-[15px] font-semibold leading-5 text-d-text'>{title}</span>
        <span className='mt-0.5 block truncate text-[12px] leading-4 text-d-muted'>{subtitle}</span>
      </span>
      {badge}
      <span className='shrink-0 text-d-muted opacity-60'>
        <ChevronRightIcon size={18} />
      </span>
    </button>
  )
}

export default function SettingsPage() {
  const { user, signOut } = useAuth()
  const router = useRouter()
  const { theme, setTheme } = useTheme()
  const {
    displayConfig,
    reminderConfig,
    updateDisplay,
    updateReminder,
    loading: loadingPrefs,
    loadError,
    reload,
  } = useUserPreferences()

  const [gmailStatus, setGmailStatus] = useState<GmailConnectionStatus | null>(null)
  const [showGmailSheet, setShowGmailSheet] = useState(false)
  const [showReminderSheet, setShowReminderSheet] = useState(false)
  const [showDisplaySheet, setShowDisplaySheet] = useState(false)
  const [showLogoutDialog, setShowLogoutDialog] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)

  const [notice, setNotice] = useState<{ open: boolean; message: string; severity: 'success' | 'error' | 'info' }>({
    open: false,
    message: '',
    severity: 'success',
  })

  const loadGmail = useCallback(async () => {
    try {
      const res = await getGmailConnection()
      setGmailStatus(res)
    } catch {
      setGmailStatus(null)
    }
  }, [])

  useEffect(() => {
    void loadGmail()
  }, [loadGmail])

  const isAdmin = user?.role === 'admin'
  const forwardAddress = user ? 'bills+' + user.id + '@' + DOMAIN : null

  const handleSignOut = async () => {
    setLoggingOut(true)
    try {
      await signOut()
      setShowLogoutDialog(false)
      router.push('/login')
    } catch (err) {
      setNotice({ open: true, message: err instanceof Error ? err.message : '退出登录失败', severity: 'error' })
    } finally {
      setLoggingOut(false)
    }
  }

  const copyText = async (text: string, label = '已复制') => {
    try {
      await navigator.clipboard.writeText(text)
      setNotice({ open: true, message: label, severity: 'success' })
    } catch {
      const el = document.createElement('textarea')
      el.value = text
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
      setNotice({ open: true, message: label, severity: 'success' })
    }
  }

  const cycleTheme = () => {
    if (theme === 'system') setTheme('dark')
    else if (theme === 'dark') setTheme('light')
    else setTheme('system')
  }

  const themeLabel = theme === 'dark' ? '🌙 暗色' : theme === 'light' ? '☀️ 亮色' : '💻 跟随系统'

  // 计算偏好摘要胶囊文案
  const gmailSummary = gmailStatus?.connected ? '已连接' : gmailStatus?.last_error ? '需重连' : '未连接'
  const billDays = reminderConfig?.remind_days_before ?? [3, 1, 0]
  const oppEnabled = reminderConfig?.opportunities?.enabled !== false
  const reminderSummary = `提前${billDays.slice(0, 3).join('/')}天 · 权益${oppEnabled ? '开' : '关'}`
  const displaySummary = `${displayConfig?.default_currency || 'CNY'} · ${displayConfig?.privacy_mode ? '隐私开启' : '隐私关闭'}`

  return (
    <div className='obsidian-dashboard min-h-dvh bg-d-bg px-4 sm:px-5 pb-24 pt-4 text-d-text'>
      {/* 顶部标题栏 + 主题切换 */}
      <div className='mb-3 flex items-center justify-between'>
        <h1 className='text-[22px] font-bold tracking-tight text-d-text'>我的</h1>
        <button
          type='button'
          onClick={cycleTheme}
          aria-label='切换外观主题'
          className='inline-flex min-h-[36px] items-center gap-1.5 rounded-full border border-d-border bg-d-surface px-3 py-1 text-[12px] font-semibold text-d-muted transition-colors active:bg-d-subtle hover:text-d-text'
        >
          {themeLabel}
        </button>
      </div>

      {/* 首屏加载失败防护条 */}
      {loadError && (
        <div className='mb-3'>
          <Alert severity='error'>
            <div className='flex items-center justify-between gap-3'>
              <span className='text-[12px]'>偏好设置加载失败，已展示默认或本地缓存项</span>
              <button
                type='button'
                onClick={() => reload()}
                className='shrink-0 rounded-lg border border-d-border bg-d-subtle px-2.5 py-1 text-[11px] font-semibold text-d-accent-light'
              >
                重试
              </button>
            </div>
          </Alert>
        </div>
      )}

      {/* 账号头卡（消除硬编码渐变，角色胶囊与进入后台按钮平顺统一） */}
      <div className='mb-4 flex items-center gap-3.5 rounded-2xl border border-d-border bg-d-surface p-4'>
        <div className='flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-d-accent/40 bg-d-subtle text-[18px] font-bold text-d-accent-light'>
          {(user?.email?.[0] || 'U').toUpperCase()}
        </div>
        <div className='min-w-0 flex-1'>
          <p className='truncate text-[15px] font-bold leading-5 text-d-text'>
            {user?.email || '已登录用户'}
          </p>
          <div className='mt-1 flex items-center gap-2 flex-wrap'>
            {isAdmin ? (
              <>
                <span className='inline-flex items-center gap-1 rounded-full border border-d-gold-deep/60 bg-d-gold-soft px-2.5 py-0.5 text-[11px] font-semibold text-d-gold'>
                  ◆ 管理员
                </span>
                <button
                  type='button'
                  onClick={() => router.push('/admin/settings')}
                  className='inline-flex items-center text-[12px] font-semibold text-d-accent-light hover:underline active:opacity-80'
                >
                  进入后台 →
                </button>
              </>
            ) : (
              <span className='inline-flex items-center rounded-full border border-d-border bg-d-subtle px-2.5 py-0.5 text-[11px] font-medium text-d-muted'>
                普通用户
              </span>
            )}
          </div>
        </div>
      </div>

      {loadingPrefs && !displayConfig ? (
        <div className='flex justify-center py-12'>
          <Spinner size={24} />
        </div>
      ) : (
        <div className='flex flex-col gap-3'>
          {/* 分组一：卡包与权益管理（路由跳转组） */}
          <div>
            <p className='mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-d-muted'>
              卡包与权益管理
            </p>
            <div className='overflow-hidden rounded-2xl border border-d-border bg-d-surface divide-y divide-d-border/60'>
              <SettingsMenuRow
                icon={<UserIcon size={20} />}
                title='家庭管理'
                subtitle='持卡人与卡片管理'
                onClick={() => router.push('/holders')}
              />
              <SettingsMenuRow
                icon={<PromoIcon size={20} />}
                title='优惠活动'
                subtitle='可用优惠'
                onClick={() => router.push('/promos')}
              />
              <SettingsMenuRow
                icon={<BenefitIcon size={20} />}
                title='我的权益'
                subtitle='权益使用进度'
                onClick={() => router.push('/benefits')}
              />
            </div>
          </div>

          {/* 分组二：数据同步与偏好设置（BottomSheet 二级抽屉组） */}
          <div>
            <p className='mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-d-muted'>
              数据同步与偏好设置
            </p>
            <div className='overflow-hidden rounded-2xl border border-d-border bg-d-surface divide-y divide-d-border/60'>
              {/* 邮箱账单导入 */}
              <SettingsMenuRow
                icon={<ImportIcon size={20} />}
                title='邮箱账单导入'
                subtitle='Gmail 直连拉取与专属 .eml 补录'
                onClick={() => setShowGmailSheet(true)}
                badge={
                  <span
                    className={
                      'mr-0.5 shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ' +
                      (gmailStatus?.connected
                        ? 'border border-d-success-ink/30 bg-d-success-soft text-d-success-ink'
                        : gmailStatus?.last_error
                        ? 'border border-d-gold-deep/50 bg-d-gold-soft text-d-gold'
                        : 'border border-d-border bg-d-subtle text-d-muted')
                    }
                  >
                    {gmailSummary}
                  </span>
                }
              />

              {/* 提醒偏好 */}
              <SettingsMenuRow
                icon={<BellIcon size={20} />}
                title='提醒偏好'
                subtitle='还款节点、权益到期与免打扰时段'
                onClick={() => setShowReminderSheet(true)}
                badge={
                  <span className='mr-0.5 shrink-0 rounded-full border border-d-accent/30 bg-d-subtle px-2.5 py-0.5 text-[11px] font-semibold text-d-accent-light'>
                    {reminderSummary}
                  </span>
                }
              />

              {/* 显示与币种 */}
              <SettingsMenuRow
                icon={<SettingsIcon size={20} />}
                title='显示与币种'
                subtitle='折算目标币种、卡面字段与隐私遮罩'
                onClick={() => setShowDisplaySheet(true)}
                badge={
                  <span className='mr-0.5 shrink-0 rounded-full border border-d-gold-deep/40 bg-d-gold-soft px-2.5 py-0.5 text-[11px] font-semibold text-d-gold'>
                    {displaySummary}
                  </span>
                }
              />
            </div>
          </div>

          {/* 分组三：账号退出 */}
          <div className='mt-1 overflow-hidden rounded-2xl border border-d-border bg-d-surface'>
            <button
              type='button'
              onClick={() => setShowLogoutDialog(true)}
              className='flex min-h-[48px] w-full items-center justify-center gap-2 text-[14px] font-bold text-d-danger-ink transition-colors active:bg-d-danger-soft'
            >
              ⎋ 退出登录
            </button>
          </div>
        </div>
      )}

      {/* BottomSheet 1: 邮箱账单导入 */}
      <BottomSheet
        open={showGmailSheet}
        title='邮箱账单导入'
        onClose={() => {
          setShowGmailSheet(false)
          void loadGmail()
        }}
      >
        <div className='flex flex-col gap-3.5 pb-6 text-d-text'>
          {/* Gmail 直连面板 */}
          <GmailConnectPanel />

          {/* 查看流水入口 */}
          <button
            type='button'
            onClick={() => {
              setShowGmailSheet(false)
              router.push('/gmail-ledger')
            }}
            className='flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-d-border bg-d-surface px-4 text-[13px] font-semibold text-d-accent-light transition-colors active:bg-d-subtle'
          >
            <ImportIcon size={16} />
            查看邮箱账单明细流水 →
          </button>

          {/* 专属 .eml 补录卡片 */}
          <div className='rounded-2xl border border-d-border bg-d-surface p-4'>
            <p className='text-[14px] font-semibold text-d-text'>收账单邮箱（补录通道）</p>
            <p className='mt-1 text-[12px] leading-4 text-d-muted'>
              把账单邮件作为附件（.eml）转发到此专属地址补录。银行自动转发会被 DMARC 拒收，日常导入建议使用 Gmail 直连。
            </p>

            {forwardAddress && (
              <div className='mt-3 flex items-center gap-2.5 rounded-xl bg-d-bg p-3 border border-d-border/80'>
                <div className='min-w-0 flex-1'>
                  <p className='text-[11px] font-medium text-d-muted'>专属地址</p>
                  <p className='mt-0.5 break-all font-mono text-[12px] font-semibold text-d-gold'>
                    {forwardAddress}
                  </p>
                </div>
                <button
                  type='button'
                  aria-label='复制专属地址'
                  onClick={() => copyText(forwardAddress, '专属地址已复制')}
                  className='min-h-[40px] shrink-0 rounded-lg border border-d-border bg-d-subtle px-3 text-[12px] font-semibold text-d-accent-light active:bg-d-surface'
                >
                  复制
                </button>
              </div>
            )}
          </div>
        </div>
      </BottomSheet>

      {/* BottomSheet 2: 提醒偏好配置 */}
      <BottomSheet
        open={showReminderSheet}
        title='提醒偏好配置'
        onClose={() => setShowReminderSheet(false)}
      >
        <div className='pb-6'>
          <ReminderPreferencesCard
            config={reminderConfig}
            onChange={async (updates) => {
              try {
                await updateReminder(updates)
                setNotice({ open: true, message: '提醒规则已保存', severity: 'success' })
              } catch (err) {
                setNotice({
                  open: true,
                  message: err instanceof Error ? err.message : '保存失败，已自动回滚',
                  severity: 'error',
                })
              }
            }}
            disabled={loadingPrefs}
          />
        </div>
      </BottomSheet>

      {/* BottomSheet 3: 显示与币种偏好 */}
      <BottomSheet
        open={showDisplaySheet}
        title='显示与币种偏好'
        onClose={() => setShowDisplaySheet(false)}
      >
        <div className='pb-6'>
          <DisplayPreferencesCard
            config={displayConfig}
            onChange={async (updates) => {
              try {
                await updateDisplay(updates)
                setNotice({ open: true, message: '显示偏好已保存', severity: 'success' })
              } catch (err) {
                setNotice({
                  open: true,
                  message: err instanceof Error ? err.message : '保存失败，已自动回滚',
                  severity: 'error',
                })
              }
            }}
            disabled={loadingPrefs}
          />
        </div>
      </BottomSheet>

      {/* 退出登录二次确认弹窗 */}
      <ConfirmDialog
        open={showLogoutDialog}
        title='退出登录'
        onClose={() => !loggingOut && setShowLogoutDialog(false)}
        actions={
          <>
            <button
              type='button'
              disabled={loggingOut}
              onClick={() => setShowLogoutDialog(false)}
              className='min-h-[40px] rounded-xl border border-d-border bg-d-subtle px-4 text-[13px] font-semibold text-d-muted transition-colors active:bg-d-surface'
            >
              取消
            </button>
            <button
              type='button'
              disabled={loggingOut}
              onClick={handleSignOut}
              className='min-h-[40px] rounded-xl bg-d-danger px-4 text-[13px] font-semibold text-white transition-opacity active:opacity-85 disabled:opacity-50'
            >
              {loggingOut ? '退出中…' : '确认退出'}
            </button>
          </>
        }
      >
        <p className='text-[13px] leading-5 text-d-muted'>
          确定要退出当前账号吗？本地缓存与偏好配置将安全保留。
        </p>
      </ConfirmDialog>

      {/* 操作提示 Toast */}
      <Toast
        open={notice.open}
        message={notice.message}
        severity={notice.severity}
        autoHideMs={2500}
        onClose={() => setNotice((prev) => ({ ...prev, open: false }))}
      />
    </div>
  )
}
