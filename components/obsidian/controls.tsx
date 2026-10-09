'use client'

import type { ButtonHTMLAttributes } from 'react'
import { Spinner } from './feedback'

// ObsidianUI 暗色视图的基础控件：按钮 / 开关 / 复选行。
// 只依赖 d-* token 与原生元素，避免 MUI 表单控件在暗色底上的样式冲突。

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-d-accent text-white active:bg-d-accent/85',
  secondary: 'border border-d-border bg-d-subtle text-d-text active:bg-d-border/50',
  ghost: 'text-d-muted active:text-d-text',
  danger: 'bg-d-danger text-white active:bg-d-danger/85',
}

/** 通用按钮（对应 MUI Button）。loading 时禁点并内嵌 Spinner。 */
export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: 'sm' | 'md'
  loading?: boolean
}) {
  return (
    <button
      disabled={disabled || loading}
      className={
        'inline-flex items-center justify-center gap-1.5 rounded-xl font-semibold transition-colors ' +
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-d-accent ' +
        'disabled:pointer-events-none disabled:opacity-50 ' +
        (size === 'sm' ? 'h-9 px-3.5 text-[13px] ' : 'h-11 px-5 text-[14px] ') +
        BUTTON_VARIANT[variant] +
        (className ? ' ' + className : '')
      }
      {...rest}
    >
      {loading ? <Spinner size={16} className='border-white/40 border-t-white' /> : null}
      {children}
    </button>
  )
}

export function Toggle({
  checked, onChange, disabled, ariaLabel,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  ariaLabel?: string
}) {
  return (
    <button
      type='button'
      role='switch'
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={
        'relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ' +
        (checked ? 'bg-d-accent' : 'bg-d-border')
      }
    >
      <span
        className={
          'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ' +
          (checked ? 'left-[22px]' : 'left-0.5')
        }
      />
    </button>
  )
}

export function CheckRow({
  checked, onChange, disabled, children,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type='button'
      role='checkbox'
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={
        'flex min-h-[44px] items-center gap-2.5 rounded-xl border px-3 py-2 text-left text-[13px] transition-colors disabled:opacity-50 ' +
        (checked
          ? 'border-d-accent bg-d-subtle text-d-text'
          : 'border-d-border bg-d-surface text-d-muted')
      }
    >
      <span
        className={
          'flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded border text-[10px] font-bold leading-none ' +
          (checked ? 'border-d-accent bg-d-accent text-white' : 'border-d-border bg-transparent')
        }
        style={{ width: 18, height: 18 }}
      >
        {checked ? '✓' : ''}
      </span>
      {children}
    </button>
  )
}
