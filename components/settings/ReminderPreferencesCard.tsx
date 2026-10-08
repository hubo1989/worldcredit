'use client'

import { useState } from 'react'
import { BellIcon, ClockIcon, PlusIcon, CheckIcon } from '@/components/icons/WcIcon'
import type { UserReminderConfig } from '@/lib/types'
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Snackbar, Alert,
} from '@mui/material'

interface ReminderPreferencesCardProps {
  config: UserReminderConfig
  onChange: (updates: Partial<UserReminderConfig>) => void
  disabled?: boolean
}

/** 还款适时提醒规则（暗色）。props 契约与亮色版一致。 */
export function ReminderPreferencesCard({ config, onChange, disabled }: ReminderPreferencesCardProps) {
  const [testing, setTesting] = useState(false)
  const [testNotice, setTestNotice] = useState<{ open: boolean; message: string; severity: 'success' | 'info' | 'error' }>({
    open: false,
    message: '',
    severity: 'success',
  })
  // 测试推送无法在渲染里直接弹系统通知预览时，用说明弹窗承载权限引导
  const [guideOpen, setGuideOpen] = useState(false)

  const handleToggleDay = (day: number) => {
    const current = config.remind_days_before || []
    const updated = current.includes(day)
      ? current.filter(d => d !== day)
      : [...current, day].sort((a, b) => b - a)
    onChange({ remind_days_before: updated })
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
          new Notification('🔔 WorldCredit 适时提醒', {
            body: '这是一条测试还款提醒！您的提醒节点与免打扰时间配置已生效。',
            icon: '/pwa-192x192.png',
            tag: 'worldcredit-test-reminder'
          })
          setTestNotice({
            open: true,
            message: '测试通知已成功推送到您的设备系统通知栏！',
            severity: 'success'
          })
        } else {
          setTestNotice({
            open: true,
            message: '未开启浏览器通知权限，请在浏览器地址栏允许通知后再试。',
            severity: 'info'
          })
        }
      } else {
        setGuideOpen(true)
      }
    } catch (err) {
      setTestNotice({ open: true, message: '测试发送失败: ' + (err instanceof Error ? err.message : String(err)), severity: 'error' })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className='obsidian-dashboard rounded-2xl border border-d-border bg-d-surface p-4'>
      <div className='mb-3 flex items-center gap-3'>
        <div className='flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-d-gold-soft text-d-warn-ink'>
          <BellIcon size={20} />
        </div>
        <div className='min-w-0 flex-1'>
          <p className='text-[15px] font-bold leading-5 text-d-text'>还款适时提醒规则</p>
          <p className='mt-0.5 text-[12px] leading-4 text-d-muted'>
            定制到期前的提醒时间节点与夜间免打扰时段
          </p>
        </div>
      </div>

      <div className='my-3 border-t border-dashed border-d-border' />

      <div className='flex flex-col gap-3'>
        <div>
          <p className='mb-1.5 text-[11px] font-bold text-d-muted'>提醒提前时间节点 (支持多选)：</p>
          <div className='flex flex-wrap gap-2'>
            {[7, 5, 3, 1, 0].map(day => {
              const active = (config.remind_days_before || []).includes(day)
              const label = day === 0 ? '到期当天' : '提前 ' + day + ' 天'
              return (
                <button
                  key={day}
                  type='button'
                  disabled={disabled}
                  onClick={() => handleToggleDay(day)}
                  className={
                    'rounded-full px-3.5 py-1.5 text-[13px] font-bold transition-colors disabled:opacity-50 ' +
                    (active
                      ? 'bg-d-accent text-white'
                      : 'border border-d-border bg-d-surface text-d-muted')
                  }
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>

        <div className='border-t border-dashed border-d-border' />

        <div>
          <div className='mb-1.5 flex items-center gap-1.5'>
            <ClockIcon size={14} className='text-d-muted' />
            <p className='text-[11px] font-bold text-d-muted'>免打扰时段 (Quiet Hours)：</p>
          </div>
          <div className='flex items-center gap-2.5'>
            <input
              type='time'
              aria-label='免打扰开始时间'
              disabled={disabled}
              value={config.quiet_hours_start || '22:00'}
              onChange={e => onChange({ quiet_hours_start: e.target.value })}
              className='h-10 rounded-xl border border-d-border bg-d-bg px-2.5 text-[13px] text-d-text [color-scheme:dark] disabled:opacity-50'
              style={{ width: 130 }}
            />
            <span className='text-[12px] text-d-muted'>至</span>
            <input
              type='time'
              aria-label='免打扰结束时间'
              disabled={disabled}
              value={config.quiet_hours_end || '08:00'}
              onChange={e => onChange({ quiet_hours_end: e.target.value })}
              className='h-10 rounded-xl border border-d-border bg-d-bg px-2.5 text-[13px] text-d-text [color-scheme:dark] disabled:opacity-50'
              style={{ width: 130 }}
            />
          </div>
        </div>

        <div className='border-t border-dashed border-d-border' />

        <div className='flex items-center justify-between gap-3 rounded-xl bg-d-bg p-3'>
          <div className='min-w-0 flex-1'>
            <p className='text-[13px] font-bold leading-5 text-d-text'>验证设备连通性</p>
            <p className='mt-0.5 text-[11px] leading-4 text-d-muted'>
              点此发送一条测试推送，验证系统通知是否正常到达
            </p>
          </div>
          <button
            type='button'
            disabled={testing || disabled}
            onClick={handleSendTestPush}
            className='flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl border border-d-accent px-3.5 text-[12px] font-semibold text-d-accent-light disabled:opacity-50'
          >
            <PlusIcon size={14} />
            {testing ? '测试中...' : '测试通知'}
          </button>
        </div>
      </div>

      {/* 当前设备不支持 Push API 时的降级说明（替代亮色版 info Alert） */}
      <Dialog open={guideOpen} onClose={() => setGuideOpen(false)} maxWidth='xs' fullWidth>
        <DialogTitle
          sx={{ fontSize: 'var(--type-section-size)', fontWeight: 'var(--type-section-weight)', color: 'var(--text)' }}
        >
          测试提醒
        </DialogTitle>
        <DialogContent>
          <p className='text-[13px] leading-5 text-d-muted'>
            您的应用还款提醒机制正常（当前设备暂不支持系统 Push API）。
          </p>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <button
            type='button'
            onClick={() => setGuideOpen(false)}
            className='h-10 rounded-xl bg-d-accent px-5 text-sm font-semibold text-white'
          >
            知道了
          </button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={testNotice.open}
        autoHideDuration={4000}
        onClose={() => setTestNotice(prev => ({ ...prev, open: false }))}
      >
        <Alert
          severity={testNotice.severity}
          icon={testNotice.severity === 'success' ? <CheckIcon fontSize='small' /> : undefined}
          onClose={() => setTestNotice(prev => ({ ...prev, open: false }))}
        >
          {testNotice.message}
        </Alert>
      </Snackbar>
    </div>
  )
}
