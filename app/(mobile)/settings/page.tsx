'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Toast } from '@/components/obsidian/overlays'
import { useAuth } from '@/lib/auth'
import { useUserPreferences } from '@/lib/hooks/useUserPreferences'
import { DisplayPreferencesCard } from '@/components/settings/DisplayPreferencesCard'
import { ReminderPreferencesCard } from '@/components/settings/ReminderPreferencesCard'
import { GmailConnectPanel } from '@/components/mobile/GmailConnectPanel'
import {
  UserIcon,
  PromoIcon,
  BenefitIcon,
  ImportIcon,
  BellIcon,
  SettingsIcon,
  ChevronRightIcon,
  ChevronDownIcon,
} from '@/components/icons/WcIcon'

const DOMAIN = '20160325.xyz'

/** 我的页管理入口行（§5.1，暗色）。点击整行触发 onClick（跳转或展开）。 */
function MineEntry({
  icon, title, subtitle, onClick, expanded, rightSlot,
}: {
  icon: React.ReactNode
  title: string
  subtitle: string
  onClick: () => void
  expanded?: boolean
  rightSlot?: React.ReactNode
}) {
  return (
    <button
      type='button'
      onClick={onClick}
      className='flex w-full items-center gap-3 rounded-xl border border-d-border bg-d-surface px-3.5 py-3 text-left transition-colors active:bg-d-subtle'
    >
      <span className='flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-d-subtle text-d-accent-light'>
        {icon}
      </span>
      <span className='min-w-0 flex-1'>
        <span className='block truncate text-[15px] font-semibold leading-5 text-d-text'>{title}</span>
        <span className='mt-0.5 block text-[12px] leading-4 text-d-muted'>{subtitle}</span>
      </span>
      {rightSlot}
      <span className='shrink-0 text-d-muted'>
        {expanded ? <ChevronDownIcon size={20} /> : <ChevronRightIcon size={20} />}
      </span>
    </button>
  )
}

export default function SettingsPage() {
  const { user, signOut } = useAuth()
  const router = useRouter()
  const { displayConfig, reminderConfig, updateDisplay, updateReminder, loading: loadingPrefs } = useUserPreferences()

  // 用会话 role 判定（服务端按 lib/admin-emails.ts 写入），不再在浏览器端
  // 维护第二份邮箱白名单，避免与服务端口径漂移。
  const isAdmin = user?.role === 'admin'

  const handleSignOut = async () => {
    try {
      await signOut()
      router.push('/login')
    } catch (err) {
      setNotice({ open: true, message: err instanceof Error ? err.message : '退出登录失败', severity: 'error' })
    }
  }

  // 折叠面板：提醒偏好 / 设置 / Gmail 账单导入
  const [openReminder, setOpenReminder] = useState(false)
  const [openSettings, setOpenSettings] = useState(false)
  const [openGmail, setOpenGmail] = useState(false)

  const [notice, setNotice] = useState<{ open: boolean; message: string; severity: 'success' | 'error' | 'info' }>({
    open: false,
    message: '',
    severity: 'success',
  })

  const forwardAddress = user ? 'bills+' + user.id + '@' + DOMAIN : null

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

  return (
    <div className='obsidian-dashboard min-h-dvh bg-d-bg px-5 pb-24 pt-4 text-d-text'>
      {/* 顶部标题「我的」+ 用户标识 */}
      <p className='text-[20px] font-bold leading-7 text-d-text'>我的</p>
      <p className='mb-2.5 mt-0.5 break-all text-[12px] leading-4 text-d-muted'>
        {user?.email || '已登录用户'}
      </p>

      <div className='flex flex-col gap-2.5'>
        {/* 管理员专属控制台卡片 */}
        {isAdmin && (
          <div
            className='flex items-center justify-between gap-3 rounded-2xl p-4 text-white'
            style={{
              background: 'linear-gradient(135deg, #4338ca 0%, #4f46e5 100%)',
              boxShadow: '0 8px 32px rgba(67, 56, 202, 0.28)',
            }}
          >
            <div className='min-w-0'>
              <div className='mb-0.5 flex items-center gap-2'>
                <span className='text-[#c7d2fe]'>◆</span>
                <p className='text-[15px] font-bold leading-5'>系统管理员权限</p>
              </div>
              <p className='text-[12px] leading-4 text-white/85'>
                管理全平台银行、卡产品、公共权益与 AI 配置
              </p>
            </div>
            <button
              type='button'
              onClick={() => router.push('/admin')}
              className='h-10 shrink-0 whitespace-nowrap rounded-full bg-[#f59e0b] px-3.5 text-[12px] font-bold text-[#3b2a00]'
            >
              进入后台
            </button>
          </div>
        )}

        {/* 管理入口列表（§5.1） */}
        <MineEntry
          icon={<UserIcon size={22} />}
          title='家庭管理'
          subtitle='持卡人与卡片管理'
          onClick={() => router.push('/holders')}
        />

        <MineEntry
          icon={<PromoIcon size={22} />}
          title='优惠活动'
          subtitle='可用优惠'
          onClick={() => router.push('/promos')}
        />

        <MineEntry
          icon={<BenefitIcon size={22} />}
          title='我的权益'
          subtitle='权益使用进度'
          onClick={() => router.push('/benefits')}
        />

        <MineEntry
          icon={<ImportIcon size={22} />}
          title='邮箱账单导入'
          subtitle='Gmail 直连拉取，专属地址补录'
          onClick={() => setOpenGmail(v => !v)}
          expanded={openGmail}
          rightSlot={
            <span className='mr-0.5 shrink-0 rounded-full border border-d-accent px-2 py-0.5 text-[11px] font-semibold leading-4 text-d-accent-light'>
              专属就绪
            </span>
          }
        />

        {/* 邮箱账单导入展开区：Gmail 直连为主，专属地址保留为补录通道 */}
        {openGmail && (
          <div className='flex flex-col gap-2.5'>
            <GmailConnectPanel />

            <div className='flex justify-end'>
              <button
                type='button'
                onClick={() => router.push('/gmail-ledger')}
                className='flex h-10 items-center gap-1.5 rounded-full border border-d-accent px-3.5 text-[12px] font-semibold text-d-accent-light'
              >
                <ImportIcon size={14} />
                查看邮箱账单明细流水
              </button>
            </div>

            {/* 账单补录地址 */}
            <div className='rounded-2xl border border-d-border bg-d-surface p-4'>
              <div className='mb-3 flex items-center gap-3'>
                <div className='flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-d-subtle text-d-accent-light'>
                  <ImportIcon size={20} />
                </div>
                <div className='min-w-0 flex-1'>
                  <p className='text-[15px] font-semibold leading-5 text-d-text'>收账单邮箱（补录）</p>
                  <p className='mt-0.5 text-[12px] leading-4 text-d-muted'>
                    把账单邮件作为附件（.eml）转发到此地址补录。银行自动转发会被 DMARC 拒收，日常导入请用上方 Gmail 直连
                  </p>
                </div>
              </div>

              <div className='my-3 border-t border-dashed border-d-border' />

              {forwardAddress && (
                <div className='flex items-center gap-2.5 rounded-xl bg-d-bg p-3'>
                  <div className='min-w-0 flex-1'>
                    <p className='text-[12px] font-semibold leading-4 text-d-muted'>专属地址</p>
                    <p className='num-tabular mt-0.5 break-all font-mono text-[12px] font-semibold leading-4 text-d-text'>
                      {forwardAddress}
                    </p>
                  </div>
                  <button
                    type='button'
                    aria-label='复制专属地址'
                    onClick={() => copyText(forwardAddress, '专属地址已复制')}
                    className='h-10 shrink-0 rounded-xl border border-d-border px-3 text-[12px] font-semibold text-d-accent-light'
                  >
                    复制
                  </button>
                </div>
              )}

              <div className='mt-3 rounded-xl border-l-2 border-d-accent bg-d-subtle p-3'>
                <p className='text-[11px] leading-4 text-d-muted'>
                  该地址包含你的用户 ID，系统按收件地址归属到你的账号。仅用于手动转发 .eml 附件补录，勿配置自动转发规则。
                </p>
              </div>
            </div>
          </div>
        )}

        {/* 提醒偏好：折叠保留 ReminderPreferencesCard 全部功能 */}
        <MineEntry
          icon={<BellIcon size={22} />}
          title='提醒偏好'
          subtitle='还款提醒通道与节点'
          onClick={() => setOpenReminder(v => !v)}
          expanded={openReminder}
        />
        {openReminder && (
          <ReminderPreferencesCard
            config={reminderConfig}
            onChange={async updates => {
              await updateReminder(updates)
              setNotice({ open: true, message: '提醒规则设置已保存', severity: 'success' })
            }}
            disabled={loadingPrefs}
          />
        )}

        {/* 设置：折叠保留 DisplayPreferencesCard 全部功能 */}
        <MineEntry
          icon={<SettingsIcon size={22} />}
          title='设置'
          subtitle='界面显示偏好与隐私模式'
          onClick={() => setOpenSettings(v => !v)}
          expanded={openSettings}
        />
        {openSettings && (
          <DisplayPreferencesCard
            config={displayConfig}
            onChange={async updates => {
              await updateDisplay(updates)
              setNotice({ open: true, message: '界面显示偏好已保存', severity: 'success' })
            }}
            disabled={loadingPrefs}
          />
        )}

        {/* 退出登录（单独一行，避免误触） */}
        <div className='mt-1 rounded-xl border border-d-border bg-d-surface px-3.5 py-2'>
          <button
            type='button'
            onClick={handleSignOut}
            className='flex h-11 w-full items-center justify-center gap-2 rounded-full text-[14px] font-bold text-d-danger-ink'
          >
            ⎋ 退出登录
          </button>
        </div>
      </div>

      <Toast
        open={notice.open}
        message={notice.message}
        severity={notice.severity}
        autoHideMs={2500}
        onClose={() => setNotice(prev => ({ ...prev, open: false }))}
      />
    </div>
  )
}
