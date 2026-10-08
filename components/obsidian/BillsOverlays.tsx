'use client'

import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Snackbar, Alert,
} from '@mui/material'

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
      <Dialog open={vm.payAllOpen} onClose={vm.onPayAllClose} maxWidth='xs' fullWidth>
        <DialogTitle
          sx={{
            fontSize: 'var(--type-section-size)',
            fontWeight: 'var(--type-section-weight)',
            color: 'var(--text)',
          }}
        >
          确认一键完成全部还款？
        </DialogTitle>
        <DialogContent>
          <p className='mb-2 text-[13px] leading-5 text-d-muted'>
            系统将把当前 <strong className='text-d-text'>{vm.overdueCount} 笔</strong>
            逾期账单全部标记为已结清。
          </p>
          <p className='text-[14px] font-bold leading-5 text-d-danger-ink'>
            合计结清金额：{vm.overdueTotalLabel}
          </p>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          {/* 刻意不用 MUI Button：主题把 palette.text.primary 设成 CSS 变量，
              MUI 的 alpha() 解析不了 var(...)，Button 一渲染就抛错（存量问题）。 */}
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
        </DialogActions>
      </Dialog>

      <Snackbar
        open={vm.toast.open}
        autoHideDuration={4000}
        onClose={vm.onToastClose}
      >
        <Alert
          severity='success'
          onClose={vm.onToastClose}
          sx={{ fontWeight: 600 }}
        >
          {vm.toast.message}
        </Alert>
      </Snackbar>
    </>
  )
}
