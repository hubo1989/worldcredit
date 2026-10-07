'use client'

import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Snackbar, Alert, CircularProgress,
  Box, Paper, Typography,
} from '@mui/material'

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
      <Dialog open={vm.payAllOpen} onClose={vm.onPayAllClose} maxWidth="xs" fullWidth>
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
          <Typography sx={{ fontSize: 'var(--type-body-size)', color: 'var(--muted)', mb: 1 }}>
            系统将把当前 <strong>{vm.metrics.overdueBills.length} 笔</strong>逾期账单全部标记为已结清。
          </Typography>
          <Typography sx={{ fontSize: 'var(--type-section-size)', fontWeight: 'var(--type-section-weight)', color: 'var(--danger)' }}>
            合计结清金额：{vm.formatMoney(vm.metrics.overdueAmount, vm.displayCurrency)}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          {/* 这里刻意不用 MUI Button：该主题把 palette.text.primary 设成 CSS 变量，
              MUI 的 alpha() 解析不了 var(...)，Button 一渲染就抛错（存量问题，
              全站受影响）。原生按钮既避开这条崩溃路径，也与暗色视图的样式一致。 */}
          <button
            type="button"
            onClick={vm.onPayAllClose}
            disabled={vm.paying}
            className="h-10 rounded-xl px-5 text-sm font-semibold text-d-muted disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={vm.onPayAllConfirm}
            disabled={vm.paying}
            className="flex h-10 items-center gap-2 rounded-xl bg-d-danger px-5 text-sm font-bold text-white disabled:opacity-50"
          >
            {vm.paying ? <CircularProgress size={16} color="inherit" /> : null}
            确认全部结清
          </button>
        </DialogActions>
      </Dialog>
      <Snackbar
        open={vm.toast.open}
        autoHideDuration={3500}
        onClose={vm.onToastClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={vm.toast.severity as 'success' | 'info' | 'error'} sx={{ fontWeight: 600 }}>
          {vm.toast.message}
        </Alert>
      </Snackbar>
      {vm.error && (
        <Box sx={{ mt: 3, px: 5 }}>
          <Paper
            elevation={0}
            sx={{
              p: 2,
              borderRadius: 2,
              bgcolor: 'rgba(207,46,46,0.06)',
              border: '1px solid rgba(207,46,46,0.20)',
              textAlign: 'center',
            }}
          >
            <Typography sx={{ fontSize: 'var(--type-body-size)', color: 'var(--danger)', mb: 1 }}>
              {vm.error}
            </Typography>
            <Box
              onClick={vm.onRetry}
              sx={{
                display: 'inline-block',
                px: 2,
                py: 0.5,
                borderRadius: 999,
                bgcolor: 'var(--danger)',
                color: 'var(--text-on-dark)',
                fontSize: 'var(--type-body-size)',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              重试
            </Box>
          </Paper>
        </Box>
      )}
    </>
  )
}
