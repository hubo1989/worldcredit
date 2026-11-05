'use client'

import { useState } from 'react'
import { BellIcon, ClockIcon } from '@/components/icons/WcIcon'
import type { UserReminderConfig } from '@/lib/types'
import { Toggle } from '@/components/obsidian/controls'
import { ConfirmDialog, Toast } from '@/components/obsidian/overlays'
import { sendTestPush } from '@/lib/api/push'

interface ReminderPreferencesCardProps {
  config: UserReminderConfig
  onChange: (updates: Partial<UserReminderConfig>) => void
  disabled?: boolean
}

const BILL_DAY_CHOICES = [
  { day: 7, label: '提前 7 天' },
  { day: 3, label: '提前 3 天' },
  { day: 1, label: '提前 1 天' },
  { day: 0, label: '还款日当天' },
]

const OPPORTUNITY_DAY_CHOICES = [0, 1, 3, 7, 15]

const TIMEZONE_OPTIONS = [
  { value: 'Asia/Shanghai', label: 'Asia/Shanghai (中国标准时间 UTC+8)' },
  { value: 'America/New_York', label: 'America/New_York (美东时间 UTC-5)' },
  { value: 'Europe/London', label: 'Europe/London (格林威治时间 UTC+0)' },
  { value: 'Asia/Tokyo', label: 'Asia/Tokyo (日本标准时间 UTC+9)' },
  { value: 'Asia/Hong_Kong', label: 'Asia/Hong_Kong (香港时间 UTC+8)' },
]

function toggleDayList(list: number[] | undefined, day: number): number[] {
  const current = list ?? []
  return current.includes(day)
    ? current.filter((d) => d !== day)
    : [...current, day].sort((a, b) => b - a)
}

/** 还款与权益适时提醒规则（移动端 BottomSheet 内置）。扁平结构，无嵌套卡片，零硬编码色值。 */
export function ReminderPreferencesCard({ config, onChange, disabled }: ReminderPreferencesCardProps) {
  const [testing, setTesting] = useState(false)
  const [testNotice, setTestNotice] = useState<{ open: boolean; message: string; severity: 'success' | 'info' | 'error' }>({
    open: false,
    message: '',
    severity: 'success',
  })
  const [guideOpen, setGuideOpen] = useState(false)

  const handleToggleBillDay = (day: number) => {
    const current = config.remind_days_before || []
    onChange({ remind_days_before: toggleDayList(current, day) })
  }

  // 存量用户没有 enabled_channels 字段时，按旧语义默认开启 Web Push
  const isWebPushEnabled = (config.enabled_channels ?? ['web_push']).includes('web_push')
  const handleToggleWebPush = (enabled: boolean) => {
    const currentChannels = config.enabled_channels ?? ['web_push']
    const channels = new Set(currentChannels)
    if (enabled) channels.add('web_push')
    else channels.delete('web_push')
    onChange({ enabled_channels: Array.from(channels) })
  }

  const handleSendTestPush = async () => {
    setTesting(true)
    try {
      if (typeof window !== 'undefined' && 'Notification' in window) {
        let perm = Notification.permission
        if (perm === 'default') {
          perm = await Notification.requestPermission()
        }

        if (perm === 'granted') {
          const res = await sendTestPush()
          if (!res.ok) {
            setTestNotice({
              open: true,
              message: `测试推送失败：${res.error || '服务端响应异常'}`,
              severity: 'error',
            })
            return
          }

          new Notification('🔔 WorldCredit 适时提醒', {
            body: '这是一条测试还款提醒！您的提醒节点与免打扰时间配置已生效。',
            icon: '/pwa-192x192.png',
            tag: 'worldcredit-test-reminder',
          })
          setTestNotice({
            open: true,
            message: '测试通知已成功发送至系统通知栏！',
            severity: 'success',
          })
        } else {
          setTestNotice({
            open: true,
            message: '未开启浏览器通知权限，请在浏览器地址栏允许通知后再试。',
            severity: 'info',
          })
        }
      } else {
        setGuideOpen(true)
      }
    } catch (err) {
      setTestNotice({
        open: true,
        message: '测试发送失败: ' + (err instanceof Error ? err.message : String(err)),
        severity: 'error',
      })
    } finally {
      setTesting(false)
    }
  }

  const opp = config.opportunities
  const updateOpp = (patch: Partial<NonNullable<UserReminderConfig['opportunities']>>) =>
    onChange({ opportunities: { ...(opp ?? {}), ...patch } })

  // 存量节点合并：已选但不在预设选项集的值动态追加，支持查看与点击取消
  const billDayChoices = (() => {
    const selected = config.remind_days_before || []
    const choiceDays = new Set(BILL_DAY_CHOICES.map((c) => c.day))
    const extra = selected
      .filter((d) => !choiceDays.has(d))
      .map((d) => ({
        day: d,
        label: d === 0 ? '还款日当天' : `提前 ${d} 天`,
      }))
    return [...BILL_DAY_CHOICES, ...extra].sort((a, b) => b.day - a.day)
  })()

  // 存量时区合并：不在白名单内的 IANA 值动态追加为选项，避免存量设置显示空白
  const timezoneChoices = (() => {
    const currentTz = opp?.time_zone
    if (currentTz && !TIMEZONE_OPTIONS.some((opt) => opt.value === currentTz)) {
      return [...TIMEZONE_OPTIONS, { value: currentTz, label: `${currentTz} (当前设置)` }]
    }
    return TIMEZONE_OPTIONS
  })()

  return (
    <div className='flex flex-col gap-5 text-d-text'>
      {/* 区块一：账单还款提醒 */}
      <div className='rounded-2xl border border-d-border bg-d-subtle/50 p-4'>
        <div className='mb-3 flex items-center gap-2 text-d-accent-light'>
          <BellIcon size={18} />
          <h4 className='text-[15px] font-bold leading-5'>账单还款提醒</h4>
        </div>

        <div className='flex flex-col gap-4'>
          {/* 提醒节点多选 */}
          <div>
            <label className='mb-2 block text-[13px] font-medium text-d-muted'>
              还款日前提醒节点（多选）：
            </label>
            <div className='flex flex-wrap gap-2'>
              {billDayChoices.map(({ day, label }) => {
                const active = (config.remind_days_before || []).includes(day)
                return (
                  <button
                    key={day}
                    type='button'
                    disabled={disabled}
                    onClick={() => handleToggleBillDay(day)}
                    className={
                      'min-h-[44px] rounded-full px-4 text-[13px] font-semibold transition-colors disabled:opacity-50 ' +
                      (active
                        ? 'bg-d-accent text-white shadow-sm'
                        : 'border border-d-border bg-d-bg text-d-muted active:bg-d-subtle')
                    }
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Web Push 通道 */}
          <div className='flex min-h-[48px] items-center justify-between border-t border-d-border/60 pt-3'>
            <div>
              <p className='text-[14px] font-medium text-d-text'>Web Push 浏览器通道</p>
              <p className='text-[12px] text-d-muted'>通过系统通知中心直达设备</p>
            </div>
            <Toggle
              checked={isWebPushEnabled}
              onChange={handleToggleWebPush}
              disabled={disabled}
              ariaLabel='Web Push 浏览器通道'
            />
          </div>

          {/* 免打扰时段 */}
          <div className='border-t border-d-border/60 pt-3'>
            <div className='mb-2 flex items-center gap-1.5 text-d-muted'>
              <ClockIcon size={14} />
              <label className='text-[13px] font-medium'>免打扰时段 (Quiet Hours)：</label>
            </div>
            <div className='flex items-center gap-3'>
              <div className='flex-1'>
                <span className='mb-1 block text-[11px] text-d-muted'>起始</span>
                <input
                  type='time'
                  aria-label='免打扰起始'
                  disabled={disabled}
                  value={config.quiet_hours_start || '22:00'}
                  onChange={(e) => onChange({ quiet_hours_start: e.target.value })}
                  className='min-h-[44px] w-full rounded-xl border border-d-border bg-d-bg px-3 text-[16px] text-d-text outline-none focus:border-d-accent disabled:opacity-50'
                />
              </div>
              <span className='mt-5 text-[13px] text-d-muted'>至</span>
              <div className='flex-1'>
                <span className='mb-1 block text-[11px] text-d-muted'>结束</span>
                <input
                  type='time'
                  aria-label='免打扰结束'
                  disabled={disabled}
                  value={config.quiet_hours_end || '08:00'}
                  onChange={(e) => onChange({ quiet_hours_end: e.target.value })}
                  className='min-h-[44px] w-full rounded-xl border border-d-border bg-d-bg px-3 text-[16px] text-d-text outline-none focus:border-d-accent disabled:opacity-50'
                />
              </div>
            </div>
          </div>

          {/* 测试通知 */}
          <button
            type='button'
            disabled={testing || disabled}
            onClick={handleSendTestPush}
            className='mt-1 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-d-accent/50 bg-d-subtle px-4 text-[13px] font-semibold text-d-accent-light transition-colors active:bg-d-accent/10 disabled:opacity-50'
          >
            <span>🔔</span>
            <span>{testing ? '正在推送…' : '发送测试通知 (真实 /api/push/test)'}</span>
          </button>
        </div>
      </div>

      {/* 区块二：权益机会提醒 */}
      <div className='rounded-2xl border border-d-border bg-d-subtle/50 p-4'>
        <div className='mb-3 flex items-center justify-between'>
          <div className='flex items-center gap-2 text-d-gold'>
            <span className='text-[16px]'>👑</span>
            <h4 className='text-[15px] font-bold leading-5'>权益机会提醒</h4>
          </div>
          <Toggle
            checked={opp?.enabled ?? true}
            onChange={(v) => updateOpp({ enabled: v })}
            disabled={disabled}
            ariaLabel='权益机会提醒'
          />
        </div>

        {(opp?.enabled ?? true) && (
          <div className='flex flex-col gap-4 border-t border-d-border/60 pt-3'>
            {/* 提醒时区下拉 */}
            <div>
              <label htmlFor='opp-timezone-select' className='mb-1.5 block text-[13px] font-medium text-d-muted'>
                提醒时区 (标准下拉)
              </label>
              <select
                id='opp-timezone-select'
                value={opp?.time_zone ?? 'Asia/Shanghai'}
                disabled={disabled}
                onChange={(e) => updateOpp({ time_zone: e.target.value })}
                className='min-h-[44px] w-full rounded-xl border border-d-border bg-d-bg px-3 text-[16px] text-d-text outline-none focus:border-d-accent disabled:opacity-50'
              >
                {timezoneChoices.map((opt) => (
                  <option key={opt.value} value={opt.value} className='bg-d-surface text-d-text'>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* 每日提醒推送时间 */}
            <div>
              <label htmlFor='opp-localtime-input' className='mb-1.5 block text-[13px] font-medium text-d-muted'>
                每日提醒推送时间
              </label>
              <input
                id='opp-localtime-input'
                type='time'
                value={opp?.local_time ?? '09:00'}
                disabled={disabled}
                onChange={(e) => updateOpp({ local_time: e.target.value })}
                className='min-h-[44px] w-full rounded-xl border border-d-border bg-d-bg px-3 text-[16px] text-d-text outline-none focus:border-d-accent disabled:opacity-50'
              />
            </div>

            {/* 到期提醒节点 */}
            <div>
              <label className='mb-2 block text-[13px] font-medium text-d-muted'>权益到期提醒节点：</label>
              <div className='flex flex-wrap gap-2'>
                {OPPORTUNITY_DAY_CHOICES.map((d) => {
                  const active = (opp?.expiry_days_before ?? []).includes(d)
                  const label = d === 0 ? '到期当天' : `提前 ${d} 天`
                  return (
                    <button
                      key={d}
                      type='button'
                      disabled={disabled}
                      onClick={() => updateOpp({ expiry_days_before: toggleDayList(opp?.expiry_days_before, d) })}
                      className={
                        'min-h-[44px] rounded-full px-4 text-[13px] font-semibold transition-colors disabled:opacity-50 ' +
                        (active
                          ? 'border border-d-gold-deep bg-d-gold-soft text-d-gold'
                          : 'border border-d-border bg-d-bg text-d-muted active:bg-d-subtle')
                      }
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* 领取截止提醒节点 */}
            <div>
              <label className='mb-2 block text-[13px] font-medium text-d-muted'>权益领取截止提醒节点：</label>
              <div className='flex flex-wrap gap-2'>
                {[0, 1, 3].map((d) => {
                  const active = (opp?.claim_days_before ?? []).includes(d)
                  const label = d === 0 ? '截止当天' : `提前 ${d} 天`
                  return (
                    <button
                      key={d}
                      type='button'
                      disabled={disabled}
                      onClick={() => updateOpp({ claim_days_before: toggleDayList(opp?.claim_days_before, d) })}
                      className={
                        'min-h-[44px] rounded-full px-4 text-[13px] font-semibold transition-colors disabled:opacity-50 ' +
                        (active
                          ? 'border border-d-gold-deep bg-d-gold-soft text-d-gold'
                          : 'border border-d-border bg-d-bg text-d-muted active:bg-d-subtle')
                      }
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={guideOpen}
        title='测试提醒'
        onClose={() => setGuideOpen(false)}
        actions={
          <button
            type='button'
            onClick={() => setGuideOpen(false)}
            className='min-h-[44px] rounded-xl bg-d-accent px-5 text-sm font-semibold text-white'
          >
            知道了
          </button>
        }
      >
        <p className='text-[13px] leading-5 text-d-muted'>
          您的应用还款提醒机制正常（当前设备暂不支持系统 Push API）。
        </p>
      </ConfirmDialog>

      <Toast
        open={testNotice.open}
        message={testNotice.message}
        severity={testNotice.severity}
        autoHideMs={4000}
        onClose={() => setTestNotice((prev) => ({ ...prev, open: false }))}
      />
    </div>
  )
}
