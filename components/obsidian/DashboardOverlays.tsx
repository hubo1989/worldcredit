'use client'

import { ConfirmDialog, Toast } from './overlays'

interface DashboardOverlaysProps {
  metrics: { overdueBills: unknown[]; overdueAmount: number }
  displayCurrency: string
  formatMoney: (n: number, currency: string) => string
  payAllOpen: boolean
  onPayAllClose: () => void
  onPayAllConfirm: () => void
  paying: boolean
  toast: { open: boolean; message: string; severity: 'success' | 'info' | 'error' }
  onToastClose: () => void
  error: string | null
  onRetry: () => void
}

export function DashboardOverlays(vm: DashboardOverlaysProps) {
  return (
    <>
      <ConfirmDialog
        open={vm.payAllOpen}
        title='确认一键完成全部还款？'
        onClose={vm.paying ? () => {} : vm.onPayAllClose}
        actions={
          <>
            <button
              type='button'
              onClick={vm.onPayAllClose}
              disabled={vm.paying}
              className='h-10 rounded-xl px-5 text-sm font-semibold text-d-muted disabled:opacity-50'
            >
              取消
            </button>
            <button
              type='button'
              onClick={vm.onPayAllConfirm}
              disabled={vm.paying}
              className='flex h-10 items-center gap-2 rounded-xl bg-d-danger px-5 text-sm font-bold text-white disabled:opacity-50'
            >
              {vm.paying ? (
                <span className='h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white' />
              ) : null}
              确认全部结清
            </button>
          </>
        }
      >
        <p className='text-[13px] leading-5 text-d-muted'>
          系统将把当前 <strong className='text-d-text'>{vm.metrics.overdueBills.length} 笔</strong>
          逾期账单全部标记为已结清。
        </p>
        <p className='mt-2 text-[14px] font-bold leading-5 text-d-danger-ink'>
          合计结清金额：{vm.formatMoney(vm.metrics.overdueAmount, vm.displayCurrency)}
        </p>
      </ConfirmDialog>

      <Toast
        open={vm.toast.open}
        message={vm.toast.message}
        severity={vm.toast.severity}
        onClose={vm.onToastClose}
      />

      {vm.error && (
        <div className='px-5 pt-3'>
          <div className='rounded-2xl border border-d-danger/30 bg-d-danger-soft px-4 py-4 text-center'>
            <p className='text-[13px] leading-5 text-d-danger-ink'>{vm.error}</p>
            <button
              type='button'
              onClick={vm.onRetry}
              className='mt-3 inline-flex h-9 items-center rounded-full bg-d-danger px-4 text-[13px] font-semibold text-white'
            >
              重试
            </button>
          </div>
        </div>
      )}
    </>
  )
}
