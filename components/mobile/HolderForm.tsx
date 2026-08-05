// components/mobile/HolderForm.tsx
'use client'

import { useState, useEffect } from 'react'
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Button, Box,
} from '@mui/material'
import type { CardHolder } from '@/lib/types'

const COLORS = ['#1976d2', '#d32f2f', '#388e3c', '#f57c00', '#7b1fa2', '#00796b']

const PHONE_REGEX = /^1[3-9]\d{9}$/

interface Props {
  open: boolean
  onClose: () => void
  onSubmit: (data: { name: string; phone?: string; email?: string; avatar_color: string }) => Promise<void>
  initial?: CardHolder
}

export function HolderForm({ open, onClose, onSubmit, initial }: Props) {
  const [name, setName] = useState(initial?.name ?? '')
  const [phone, setPhone] = useState(initial?.phone ?? '')
  const [email, setEmail] = useState(initial?.email ?? '')
  const [color, setColor] = useState(initial?.avatar_color ?? COLORS[0])
  const [submitting, setSubmitting] = useState(false)
  const [nameError, setNameError] = useState('')
  const [phoneError, setPhoneError] = useState('')

  useEffect(() => {
    if (open) {
      setName(initial?.name ?? '')
      setPhone(initial?.phone ?? '')
      setEmail(initial?.email ?? '')
      setColor(initial?.avatar_color ?? COLORS[0])
      setSubmitting(false)
      setNameError('')
      setPhoneError('')
    }
  }, [open, initial])

  const validateName = (value: string) => {
    if (!value.trim()) {
      setNameError('姓名不能为空')
      return false
    }
    setNameError('')
    return true
  }

  const validatePhone = (value: string) => {
    if (value.trim() && !PHONE_REGEX.test(value.trim())) {
      setPhoneError('请输入正确的手机号')
      return false
    }
    setPhoneError('')
    return true
  }

  const handleSubmit = async () => {
    const nameOk = validateName(name)
    const phoneOk = validatePhone(phone)
    if (!nameOk || !phoneOk) return

    setSubmitting(true)
    try {
      await onSubmit({ name: name.trim(), phone: phone.trim() || undefined, email: email.trim() || undefined, avatar_color: color })
      onClose()
    } catch {
      setSubmitting(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !submitting) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{initial ? '编辑持卡人' : '添加持卡人'}</DialogTitle>
      <DialogContent>
        <TextField
          fullWidth
          label="姓名"
          margin="normal"
          required
          value={name}
          onChange={e => { setName(e.target.value); if (nameError) validateName(e.target.value) }}
          onBlur={() => validateName(name)}
          onKeyDown={handleKeyDown}
          error={!!nameError}
          helperText={nameError}
          autoFocus
          disabled={submitting}
        />
        <TextField
          fullWidth
          label="手机号"
          margin="normal"
          placeholder="选填，11位手机号"
          value={phone}
          onChange={e => { setPhone(e.target.value); if (phoneError) validatePhone(e.target.value) }}
          onBlur={() => validatePhone(phone)}
          onKeyDown={handleKeyDown}
          error={!!phoneError}
          helperText={phoneError}
          disabled={submitting}
        />
        <TextField
          fullWidth
          label="邮箱"
          margin="normal"
          placeholder="选填，用于自动绑定会员"
          value={email}
          onChange={e => setEmail(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={submitting}
        />
        <Box sx={{ display: 'flex', gap: 1, mt: 2 }}>
          {COLORS.map(c => (
            <Box
              key={c}
              onClick={() => !submitting && setColor(c)}
              sx={{
                width: 36, height: 36, borderRadius: '50%', bgcolor: c,
                cursor: submitting ? 'not-allowed' : 'pointer',
                border: c === color ? '3px solid #000' : '3px solid transparent',
                opacity: submitting ? 0.6 : 1,
                transition: 'border 0.15s',
              }}
            />
          ))}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>取消</Button>
        <Button variant="contained" onClick={handleSubmit} disabled={submitting}>
          {submitting ? '保存中…' : '保存'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
