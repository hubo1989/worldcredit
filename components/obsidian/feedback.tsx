'use client'

import type { ReactNode } from 'react'
import { AlertCircleIcon, CheckIcon, AlertIcon } from '@/components/icons/WcIcon'

// ObsidianUI 反馈件：行内横幅、进度条、加载圈、骨架块。

const BANNER_TONE: Record<string, { box: string; icon: ReactNode }> = {
  success: {
    box: 'border-d-success-ink/30 bg-d-success-soft text-d-success-ink',
    icon: <CheckIcon size={18} />,
  },
  info: {
    box: 'border-d-accent/40 bg-d-subtle text-d-accent-light',
    icon: <AlertIcon size={18} />,
  },
  warning: {
    box: 'border-d-warn-ink/40 bg-d-subtle text-d-warn-ink',
    icon: <AlertIcon size={18} />,
  },
  error: {
    box: 'border-d-danger/40 bg-d-danger-soft text-d-danger-ink',
    icon: <AlertCircleIcon size={18} />,
  },
}

/** 行内横幅（对应 MUI Alert）。带 role/aria-live，屏幕阅读器可感知。 */
export function Alert({
  severity = 'info',
  children,
  action,
}: {
  severity?: 'success' | 'info' | 'warning' | 'error'
  children: ReactNode
  /** 右侧操作区（按钮等） */
  action?: ReactNode
}) {
  const tone = BANNER_TONE[severity] ?? BANNER_TONE.info
  return (
    <div
      role={severity === 'error' ? 'alert' : 'status'}
      className={
        'flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-[13px] leading-5 ' + tone.box
      }
    >
      <span className='mt-0.5 shrink-0'>{tone.icon}</span>
      <div className='min-w-0 flex-1'>{children}</div>
      {action ? <div className='shrink-0 self-center'>{action}</div> : null}
    </div>
  )
}

/** 线性进度条（对应 MUI LinearProgress）。value 为 0-100；缺省为不确定进度。 */
export function ProgressBar({ value, className }: { value?: number; className?: string }) {
  const clamped = typeof value === 'number' ? Math.min(100, Math.max(0, value)) : undefined
  return (
    <div
      role='progressbar'
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      className={'h-1.5 w-full overflow-hidden rounded-full bg-d-border ' + (className ?? '')}
    >
      {clamped !== undefined ? (
        <div className='h-full rounded-full bg-d-accent transition-[width] duration-300' style={{ width: `${clamped}%` }} />
      ) : (
        <div className='h-full w-1/2 animate-[wc-indeterminate_1.2s_ease-in-out_infinite] rounded-full bg-d-accent' />
      )}
    </div>
  )
}

/** 圆形加载指示（对应 MUI CircularProgress）。 */
export function Spinner({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <span
      role='status'
      aria-label='加载中'
      className={
        'inline-block animate-spin rounded-full border-2 border-d-border border-t-d-accent ' + (className ?? '')
      }
      style={{ width: size, height: size }}
    />
  )
}

/** 骨架占位块（对应 MUI Skeleton）。默认 14px 高的圆角条。 */
export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden='true' className={'block animate-pulse rounded-lg bg-d-subtle ' + (className ?? ' h-3.5 w-full')} />
}
