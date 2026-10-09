'use client'

import { useEffect, type ReactNode } from 'react'
import { CloseIcon } from '@/components/icons/WcIcon'

/** 浮层通用行为：Esc 关闭 + 背景滚动锁定。 */
function useOverlay(open: boolean, onClose: () => void, dismissible: boolean) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissible) onClose()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose, dismissible])
}

/** 通用模态弹窗（对应 MUI Dialog）：居中卡片 + 标题 + 内容 + 底部操作区。 */
export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  dismissible = true,
  maxWidth = 'sm',
}: {
  open: boolean
  title?: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  /** 确认中置 false 可禁止 Esc/遮罩关闭 */
  dismissible?: boolean
  maxWidth?: 'sm' | 'md'
}) {
  useOverlay(open, onClose, dismissible)
  if (!open) return null

  return (
    <div className='fixed inset-0 z-[1300] flex items-center justify-center p-4'>
      <button
        type='button'
        aria-label='关闭'
        onClick={() => dismissible && onClose()}
        className='absolute inset-0 bg-black/60'
      />
      <div
        role='dialog'
        aria-modal='true'
        className={
          'relative flex max-h-[85dvh] w-full flex-col rounded-2xl border border-d-border bg-d-surface text-d-text shadow-2xl ' +
          (maxWidth === 'md' ? 'max-w-md' : 'max-w-sm')
        }
      >
        {title ? (
          <div className='flex items-center justify-between px-5 pt-5'>
            <p className='text-[17px] font-semibold leading-6'>{title}</p>
            {dismissible ? (
              <button
                type='button'
                aria-label='关闭'
                onClick={onClose}
                className='-mr-1.5 -mt-1 rounded-full p-1.5 text-d-muted transition-colors hover:text-d-text'
              >
                <CloseIcon size={18} />
              </button>
            ) : null}
          </div>
        ) : null}
        <div className='min-h-0 flex-1 overflow-y-auto px-5 py-4'>{children}</div>
        {footer ? <div className='flex justify-end gap-2 px-5 pb-5'>{footer}</div> : null}
      </div>
    </div>
  )
}

/** 底部抽屉（对应 MUI Drawer bottom / SwipeableDrawer）。底部圆角 + 拖拽把手装饰。 */
export function BottomSheet({
  open,
  title,
  onClose,
  children,
  footer,
  dismissible = true,
}: {
  open: boolean
  title?: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  dismissible?: boolean
}) {
  useOverlay(open, onClose, dismissible)
  if (!open) return null

  return (
    <div className='fixed inset-0 z-[1300] flex items-end justify-center'>
      <button
        type='button'
        aria-label='关闭'
        onClick={() => dismissible && onClose()}
        className='absolute inset-0 bg-black/60'
      />
      <div
        role='dialog'
        aria-modal='true'
        className='relative flex max-h-[85dvh] w-full max-w-[600px] flex-col rounded-t-2xl border-t border-d-border bg-d-surface text-d-text shadow-2xl'
      >
        <span aria-hidden='true' className='mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-d-border' />
        {title ? (
          <div className='flex items-center justify-between px-5 pt-3'>
            <p className='text-[17px] font-semibold leading-6'>{title}</p>
            {dismissible ? (
              <button
                type='button'
                aria-label='关闭'
                onClick={onClose}
                className='-mr-1.5 -mt-1 rounded-full p-1.5 text-d-muted transition-colors hover:text-d-text'
              >
                <CloseIcon size={18} />
              </button>
            ) : null}
          </div>
        ) : null}
        <div className='min-h-0 flex-1 overflow-y-auto px-5 py-4'>{children}</div>
        {footer ? (
          <div className='flex justify-end gap-2 border-t border-d-border px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]'>
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  )
}

/** 暗色确认框。Esc / 点遮罩关闭；确认中不响应关闭。 */
export function ConfirmDialog({
  open, title, onClose, children, actions,
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  actions: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className='fixed inset-0 z-[1300] flex items-end justify-center px-4 pb-8 sm:items-center sm:pb-0'>
      <button
        type='button'
        aria-label='关闭'
        onClick={onClose}
        className='absolute inset-0 bg-black/60'
      />
      <div
        role='dialog'
        aria-modal='true'
        aria-label={title}
        className='relative w-full max-w-sm rounded-2xl border border-d-border bg-d-surface p-5 text-d-text'
      >
        <p className='text-[17px] font-semibold leading-6'>{title}</p>
        <div className='mt-3'>{children}</div>
        <div className='mt-4 flex justify-end gap-2'>{actions}</div>
      </div>
    </div>
  )
}

const TOAST_TONE: Record<string, string> = {
  success: 'border-d-success-ink/40 bg-d-success-soft text-d-success-ink',
  info: 'border-d-accent/40 bg-d-subtle text-d-accent-light',
  error: 'border-d-danger/40 bg-d-danger-soft text-d-danger-ink',
}

/** 底部短时提示。autoHideMs 为 0 时不自动关闭。 */
export function Toast({
  open, message, severity = 'success', onClose, autoHideMs = 3500,
}: {
  open: boolean
  message: string
  severity?: 'success' | 'info' | 'error'
  onClose: () => void
  autoHideMs?: number
}) {
  useEffect(() => {
    if (!open || autoHideMs <= 0) return
    const timer = window.setTimeout(onClose, autoHideMs)
    return () => window.clearTimeout(timer)
  }, [open, message, autoHideMs, onClose])

  if (!open || !message) return null

  return (
    <div className='pointer-events-none fixed inset-x-0 bottom-24 z-[1400] flex justify-center px-4'>
      <div
        role='status'
        className={
          'pointer-events-auto max-w-sm rounded-xl border px-4 py-3 text-[13px] font-semibold leading-5 ' +
          (TOAST_TONE[severity] ?? TOAST_TONE.success)
        }
      >
        {message}
      </div>
    </div>
  )
}
