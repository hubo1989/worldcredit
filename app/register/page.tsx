// app/register/page.tsx
'use client'

import { useState } from 'react'
import {
  Box, Card, CardContent, TextField, Button,
  Typography, Alert, CircularProgress, Link
} from '@mui/material'
import { CreditCard as CreditCardIcon } from '@mui/icons-material'
import { useAuth } from '@/lib/auth'
import { useRouter } from 'next/navigation'

export default function RegisterPage() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { signUp } = useAuth()
  const router = useRouter()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (password !== confirmPassword) {
      setError('两次输入的密码不一致')
      return
    }
    if (password.length < 6) {
      setError('密码至少需要 6 个字符')
      return
    }

    setLoading(true)
    try {
      await signUp(email, password, name)
      router.push('/')
    } catch (err: any) {
      // 检查是否是"用户已存在"错误，引导去登录
      const msg = err.message || ''
      if (msg.includes('already registered') || msg.includes('already exists') || msg.includes('conflict')) {
        setError('该邮箱已注册，请直接登录')
      } else {
        setError(msg || '注册失败')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <Box sx={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      p: 2,
    }}>
      <Card sx={{ maxWidth: 400, width: '100%' }}>
        <CardContent sx={{ p: 4 }}>
          <Box sx={{ textAlign: 'center', mb: 3 }}>
            <CreditCardIcon sx={{ fontSize: 48, color: 'primary.main' }} />
            <Typography variant="h5" fontWeight={700} mt={1}>
              注册 WorldCredit
            </Typography>
            <Typography color="text.secondary" variant="body2">
              创建你的信用卡管理账号
            </Typography>
          </Box>

          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

          <form onSubmit={handleSubmit}>
            <TextField
              fullWidth label="姓名" margin="normal"
              value={name} onChange={e => setName(e.target.value)}
              required autoFocus autoComplete="name"
              placeholder="你的名字"
            />
            <TextField
              fullWidth label="邮箱" type="email" margin="normal"
              value={email} onChange={e => setEmail(e.target.value)}
              required autoComplete="email"
              placeholder="用于登录的邮箱地址"
            />
            <TextField
              fullWidth label="密码" type="password" margin="normal"
              value={password} onChange={e => setPassword(e.target.value)}
              required autoComplete="new-password"
              placeholder="至少 6 个字符"
            />
            <TextField
              fullWidth label="确认密码" type="password" margin="normal"
              value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
              required autoComplete="new-password"
              error={!!confirmPassword && confirmPassword !== password}
              helperText={confirmPassword && confirmPassword !== password ? '两次密码不一致' : ''}
            />

            <Button
              fullWidth variant="contained" type="submit" size="large"
              disabled={loading} sx={{ mt: 2 }}
            >
              {loading ? <CircularProgress size={24} /> : '注册'}
            </Button>
          </form>

          <Box sx={{ mt: 2, textAlign: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              已有账号？{' '}
              <Link href="/login" underline="hover">
                立即登录
              </Link>
            </Typography>
          </Box>
        </CardContent>
      </Card>
    </Box>
  )
}
