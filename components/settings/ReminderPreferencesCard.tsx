'use client'

import { useState, useEffect } from 'react'
import { BellIcon, ClockIcon } from '@/components/icons/WcIcon'
import type { NotificationItemSwitches, UserReminderConfig } from '@/lib/types'
import {
  DEFAULT_ACTIVITY_DAYS,
  DEFAULT_TASK_DAYS,
  NOTIFICATION_SWITCH_ITEMS,
  resolveNotificationSwitches,
} from '@/lib/notifications.shared'
import { Toggle } from '@/components/obsidian/controls'
import { ConfirmDialog, Toast } from '@/components/obsidian/overlays'
import { sendTestPush } from '@/lib/api/push'
import {
  DEFAULT_QUIET_HOURS_END,
  DEFAULT_QUIET_HOURS_START,
  DEFAULT_REMINDER_LOCAL_TIME,
  DEFAULT_REMINDER_TIME_ZONE,
  isWebPushChannelEnabled,
  resolveEffectiveChannels,
  formatTimezoneOptionLabel,
  TIMEZONE_PRESETS,
  isTimeInQuietHours,
} from './shared'

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
const ACTIVITY_DAY_CHOICES = [1, 3, 7, 15]
const TASK_DAY_CHOICES = [0, 1, 3, 7]

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

  // 存量口径判定：若 enabled_channels 未设置而旧 opportunities.web_push_enabled === false 则默认关闭，否则默认开启
  const isWebPushEnabled = isWebPushChannelEnabled(config)

  // 存量迁移写回：读取到 enabled_channels 未设置且旧 opportunities.web_push_enabled === false 时，写回一次
  useEffect(() => {
    if (config.enabled_channels === undefined && config.opportunities?.web_push_enabled === false) {
      onChange({ enabled_channels: [] })
    }
  }, [config.enabled_channels, config.opportunities?.web_push_enabled, onChange])

  const handleToggleWebPush = (enabled: boolean) => {
    const currentChannels = resolveEffectiveChannels(config)
    const channels = new Set(currentChannels)
    if (enabled) channels.add('web_push')
    else channels.delete('web_push')
    onChange({ enabled_channels: Array.from(channels) })
  }

  const handleSendTestPush = async () => {
    if (!isWebPushEnabled) {
      setTestNotice({
        open: true,
        message: '站外推送通道已关闭，请先开启通道后再测试。',
        severity: 'info',
      })
      return
    }
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

          // 服务端真实下发成功后仅用 Toast 提示，不与本地 new Notification 重复
          setTestNotice({
            open: true,
            message: '测试通知已成功下发至设备通知栏！',
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

  const switches = resolveNotificationSwitches(config)
  const billSwitchItems = NOTIFICATION_SWITCH_ITEMS.filter((item) => item.group === 'bills')
  const oppSwitchItems = NOTIFICATION_SWITCH_ITEMS.filter((item) => item.group === 'opportunities')

  const handleToggleItemSwitch = (key: keyof NotificationItemSwitches, nextVal: boolean) => {
    const nextItems: NotificationItemSwitches = { ...switches, [key]: nextVal }
    if (key === 'opportunity_reset') {
      onChange({
        items: nextItems,
        opportunities: { ...(opp ?? {}), reset_enabled: nextVal },
      })
    } else if (key === 'opportunity_booking') {
      onChange({
        items: nextItems,
        opportunities: { ...(opp ?? {}), booking_enabled: nextVal },
      })
    } else {
      onChange({ items: nextItems })
    }
  }

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

  // 存量时区合并：基于 Intl.DateTimeFormat 动态生成夏令时与当前偏移
  const timezoneChoices = (() => {
    const currentTz = opp?.time_zone
    const base = TIMEZONE_PRESETS.map((def) => ({
      value: def.value,
      label: formatTimezoneOptionLabel(def.value, def.name),
    }))
    if (currentTz && !base.some((opt) => opt.value === currentTz)) {
      return [
        { value: currentTz, label: `${currentTz} (当前设置)` },
        ...base,
      ]
    }
    return base
  })()

  const activeTimeZone = opp?.time_zone ?? DEFAULT_REMINDER_TIME_ZONE
  const activeLocalTime = opp?.local_time ?? DEFAULT_REMINDER_LOCAL_TIME
  const activeQuietStart = config.quiet_hours_start ?? DEFAULT_QUIET_HOURS_START
  const activeQuietEnd = config.quiet_hours_end ?? DEFAULT_QUIET_HOURS_END
  const isPostponedByQuietHours = isTimeInQuietHours(activeLocalTime, activeQuietStart, activeQuietEnd)

  const handleUseDeviceTimeZone = () => {
    try {
      const detected = Intl.DateTimeFormat().resolvedOptions().timeZone
      if (detected) {
        updateOpp({ time_zone: detected })
      }
    } catch {
      // ignore unsupported environments
    }
  }

  return (
    <div className='flex flex-col gap-5 text-d-text'>
      {/* 区块一：账单与固定支出通知 */}
      <div className='rounded-2xl border border-d-border bg-d-subtle/50 p-4'>
        <div className='mb-3 flex items-center gap-2 text-d-accent-light'>
          <BellIcon size={18} />
          <h4 className='text-[15px] font-bold leading-5'>账单与固定支出通知</h4>
        </div>

        <div className='flex flex-col gap-3'>
          {/* 6 项账单/固定支出/免息期独立开关 */}
          <div className='divide-y divide-d-border/60'>
            {billSwitchItems.map((item) => (
              <div key={item.key} className='flex min-h-[52px] items-center justify-between gap-3 py-2.5'>
                <div className='min-w-0 flex-1'>
                  <p className='text-[14px] font-medium text-d-text'>{item.label}</p>
                  <p className='text-[12px] text-d-muted'>{item.description}</p>
                </div>
                <Toggle
                  checked={switches[item.key]}
                  onChange={(nextVal) => handleToggleItemSwitch(item.key, nextVal)}
                  disabled={disabled}
                  ariaLabel={item.label}
                />
              </div>
            ))}
          </div>

          {/* 提醒节点多选 */}
          <div className='border-t border-d-border/60 pt-3'>
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

          {/* 站外推送总通道 */}
          <div className='flex min-h-[48px] items-center justify-between border-t border-d-border/60 pt-3'>
            <div>
              <p className='text-[14px] font-medium text-d-text'>站外推送通知（Web Push / iOS APNs）</p>
              <p className='text-[12px] text-d-muted'>关闭后所有账单与权益仅写站内通知中心，不下发系统推送</p>
            </div>
            <Toggle
              checked={isWebPushEnabled}
              onChange={handleToggleWebPush}
              disabled={disabled}
              ariaLabel='站外推送通知（Web Push / iOS APNs）'
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
                  value={config.quiet_hours_start ?? DEFAULT_QUIET_HOURS_START}
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
                  value={config.quiet_hours_end ?? DEFAULT_QUIET_HOURS_END}
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

      {/* 独立顶层区块：提醒时区与推送时间（同时驱动每日账单 Cron 与权益定时提醒） */}
      <div className='rounded-2xl border border-d-border bg-d-subtle/50 p-4'>
        <div className='mb-3 flex items-center justify-between gap-2'>
          <div className='flex items-center gap-2 text-d-accent-light'>
            <ClockIcon size={18} />
            <h4 className='text-[15px] font-bold leading-5'>提醒时区与推送时间</h4>
          </div>
          <button
            type='button'
            disabled={disabled}
            onClick={handleUseDeviceTimeZone}
            className='min-h-[36px] rounded-full border border-d-border bg-d-bg px-3 text-[12px] font-semibold text-d-accent-light transition-colors active:bg-d-subtle disabled:opacity-50'
          >
            使用当前设备时区
          </button>
        </div>

        <div className='flex flex-col gap-3'>
          <div>
            <label htmlFor='opp-timezone-select' className='mb-1.5 block text-[13px] font-medium text-d-muted'>
              提醒时区
            </label>
            <select
              id='opp-timezone-select'
              value={activeTimeZone}
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

          <div>
            <label htmlFor='opp-localtime-input' className='mb-1.5 block text-[13px] font-medium text-d-muted'>
              每日提醒推送时间
            </label>
            <input
              id='opp-localtime-input'
              type='time'
              value={activeLocalTime}
              disabled={disabled}
              onChange={(e) => updateOpp({ local_time: e.target.value })}
              className='min-h-[44px] w-full rounded-xl border border-d-border bg-d-bg px-3 text-[16px] text-d-text outline-none focus:border-d-accent disabled:opacity-50'
            />
            <p className='mt-1.5 text-[12px] leading-4 text-d-muted'>
              该时刻用于确定权益/抢兑节点提醒的送达时刻（按 15 分钟精度在所选时区生效，落入免打扰时段将顺延至免打扰结束）；每日账单汇总与逾期提醒由服务端按调度计划推送，免打扰时段内不下发系统推送。
            </p>
            {isPostponedByQuietHours && (
              <p
                role='status'
                className='mt-2 rounded-xl border border-d-gold-deep/50 bg-d-gold-soft px-3 py-2 text-[12px] font-medium leading-4 text-d-warn-ink'
              >
                该时刻位于免打扰时段（{activeQuietStart}–{activeQuietEnd}）内，推送将顺延至免打扰结束（{activeQuietEnd}）后发出。
              </p>
            )}
          </div>
        </div>
      </div>

      {/* 区块二：权益机会提醒（总开关 + 6 项分项开关） */}
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
            {/* 6 项权益与优惠独立开关 */}
            <div className='divide-y divide-d-border/60'>
              {oppSwitchItems.map((item) => (
                <div key={item.key} className='flex min-h-[52px] items-center justify-between gap-3 py-2.5'>
                  <div className='min-w-0 flex-1'>
                    <p className='text-[14px] font-medium text-d-text'>{item.label}</p>
                    <p className='text-[12px] text-d-muted'>{item.description}</p>
                  </div>
                  <Toggle
                    checked={switches[item.key]}
                    onChange={(nextVal) => handleToggleItemSwitch(item.key, nextVal)}
                    disabled={disabled}
                    ariaLabel={item.label}
                  />
                </div>
              ))}
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

            {/* 优惠活动提醒节点 */}
            <div>
              <label className='mb-2 block text-[13px] font-medium text-d-muted'>优惠活动提醒节点：</label>
              <div className='flex flex-wrap gap-2'>
                {ACTIVITY_DAY_CHOICES.map((d) => {
                  const active = (opp?.activity_days_before ?? DEFAULT_ACTIVITY_DAYS).includes(d)
                  return (
                    <button
                      key={d}
                      type='button'
                      disabled={disabled}
                      onClick={() =>
                        updateOpp({ activity_days_before: toggleDayList(opp?.activity_days_before ?? DEFAULT_ACTIVITY_DAYS, d) })
                      }
                      className={
                        'min-h-[44px] rounded-full px-4 text-[13px] font-semibold transition-colors disabled:opacity-50 ' +
                        (active
                          ? 'border border-d-gold-deep bg-d-gold-soft text-d-gold'
                          : 'border border-d-border bg-d-bg text-d-muted active:bg-d-subtle')
                      }
                    >
                      提前 {d} 天
                    </button>
                  )
                })}
              </div>
            </div>

            {/* 达标任务提醒节点 */}
            <div>
              <label className='mb-2 block text-[13px] font-medium text-d-muted'>达标任务提醒节点：</label>
              <div className='flex flex-wrap gap-2'>
                {TASK_DAY_CHOICES.map((d) => {
                  const active = (opp?.task_days_before ?? DEFAULT_TASK_DAYS).includes(d)
                  const label = d === 0 ? '截止当天' : `提前 ${d} 天`
                  return (
                    <button
                      key={d}
                      type='button'
                      disabled={disabled}
                      onClick={() => updateOpp({ task_days_before: toggleDayList(opp?.task_days_before ?? DEFAULT_TASK_DAYS, d) })}
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
