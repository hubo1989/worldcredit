// components/mobile/HolderBindingDialog.tsx
'use client'

import { useState } from 'react'
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Button, Alert, CircularProgress, Typography,
} from '@mui/material'
import { bindHolderByEmail, unbindHolder } from '@/lib/api/holders'

interface Props {
  open: boolean
  onClose: () => void
  holderId: string
  holderName: string
  holderEmail?: string
  isBound: boolean
  onSuccess: () => void
}

export function HolderBindingDialog({ open, onClose, holderId, holderName, holderEmail, isBound, onSuccess }: Props) {
  const [mode, setMode] = useState<'view' | 'bind' | 'unbind'>('view')
  const [email, setEmail] = useState(holderEmail || '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleBind = async () => {
    if (!email.trim()) {
      setError('请输入邮箱地址')
      return
    }

    setLoading(true)
    setError(null)
    try {
      await bindHolderByEmail(holderId, email.trim())
      onSuccess()
      onClose()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '绑定失败')
    } finally {
      setLoading(false)
    }
  }

  const handleUnbind = async () => {
    setLoading(true)
    setError(null)
    try {
      await unbindHolder(holderId)
      onSuccess()
      onClose()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '解绑失败')
    } finally {
      setLoading(false)
    }
  }

  const resetState = () => {
    setMode('view')
    setEmail(holderEmail || '')
    setError(null)
    setLoading(false)
  }

  const handleClose = () => {
    resetState()
    onClose()
  }

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      {mode === 'view' && (
        <>
          <DialogTitle>成员账号绑定</DialogTitle>
          <DialogContent>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              持卡人：{holderName}
            </Typography>
            <Typography variant="body2" sx={{ mb: 1 }}>
              当前状态：
              {isBound ? (
                <Typography component="span" color="success.main" fontWeight={600}>
                  已绑定成员账号
                </Typography>
              ) : holderEmail ? (
                <Typography component="span" color="warning.main" fontWeight={600}>
                  等待绑定
                </Typography>
              ) : (
                <Typography component="span" color="text.secondary">
                  未填写邮箱
                </Typography>
              )}
            </Typography>
            {holderEmail && (
              <Typography variant="body2" color="text.secondary">
                邮箱：{holderEmail}
              </Typography>
            )}
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2 }}>
            <Button onClick={handleClose}>关闭</Button>
            {!isBound && holderEmail && (
              <Button
                variant="contained"
                onClick={() => setMode('bind')}
                color="primary"
              >
                按邮箱绑定
              </Button>
            )}
            {!isBound && !holderEmail && (
              <Button
                variant="contained"
                onClick={() => setMode('bind')}
                color="primary"
              >
                手动绑定
              </Button>
            )}
            {isBound && (
              <Button
                variant="outlined"
                color="error"
                onClick={() => setMode('unbind')}
              >
                解除绑定
              </Button>
            )}
          </DialogActions>
        </>
      )}

      {mode === 'bind' && (
        <>
          <DialogTitle>绑定成员账号</DialogTitle>
          <DialogContent>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              输入成员邮箱地址进行绑定
            </Typography>
            <TextField
              fullWidth
              label="成员邮箱"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              disabled={loading}
              autoFocus
              sx={{ mb: 1 }}
            />
            {error && <Alert severity="error" sx={{ mt: 1 }}>{error}</Alert>}
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2 }}>
            <Button onClick={() => setMode('view')} disabled={loading}>
              取消
            </Button>
            <Button
              variant="contained"
              onClick={handleBind}
              disabled={loading}
              startIcon={loading && <CircularProgress size={16} />}
            >
              {loading ? '绑定中…' : '确认绑定'}
            </Button>
          </DialogActions>
        </>
      )}

      {mode === 'unbind' && (
        <>
          <DialogTitle>解除绑定</DialogTitle>
          <DialogContent>
            <Alert severity="warning" sx={{ mb: 2 }}>
              解除绑定后，该成员将无法访问此持卡人的任何数据（信用卡、账单、权益等）。
            </Alert>
            <Typography variant="body2">
              确定要解除持卡人「{holderName}」的成员账号绑定吗？
            </Typography>
            {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2 }}>
            <Button onClick={() => setMode('view')} disabled={loading}>
              取消
            </Button>
            <Button
              variant="contained"
              color="error"
              onClick={handleUnbind}
              disabled={loading}
              startIcon={loading && <CircularProgress size={16} />}
            >
              {loading ? '解绑中…' : '确认解绑'}
            </Button>
          </DialogActions>
        </>
      )}
    </Dialog>
  )
}
