'use client'

import { ConfirmDialog, Toast } from './overlays'

interface BillsOverlaysProps {
  overdueCount: number
  overdueTotalLabel: string
  payAllOpen: boolean
  onPayAllClose: () => void
  onPayAllConfirm: () => void
  paying: boolean
  toast: { open: boolean; message: string }
  onToastClose: () => void
}

/** Bills 暗色视图的功能性覆盖层：一键还清确认 + 同步/还款 toast。 */
export function BillsOverlays(vm: BillsOverlaysProps) {
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
              className='h-10 rounded-xl bg-d-danger px-5 text-sm font-bold text-white disabled:opacity-50'
            >
              确认全部结清
            </button>
          </>
        }
      >
        <p className='text-[13px] leading-5 text-d-muted'>
          系统将把当前 <strong className='text-d-text'>{vm.overdueCount} 笔</strong>
          逾期账单全部标记为已结清。
        </p>
        <p className='mt-2 text-[14px] font-bold leading-5 text-d-danger-ink'>
          合计结清金额：{vm.overdueTotalLabel}
        </p>
      </ConfirmDialog>

      <Toast
        open={vm.toast.open}
        message={vm.toast.message}
        severity='success'
        autoHideMs={4000}
        onClose={vm.onToastClose}
      />
    </>
  )
}
