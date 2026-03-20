// app/login/page.tsx
'use client'

import { useState } from 'react'
import {
  Box, Card, CardContent, TextField, Button,
  Typography, Alert, CircularProgress
} from '@mui/material'
import { CreditCard as CreditCardIcon } from '@mui/icons-material'
import { useAuth } from '@/lib/auth'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { signIn } = useAuth()
  const router = useRouter()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await signIn(email, password)
      router.push('/')
    } catch (err: any) {
      setError(err.message || '登录失败')
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
              WorldCredit
            </Typography>
            <Typography color="text.secondary" variant="body2">
              信用卡管理
            </Typography>
          </Box>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          <form onSubmit={handleSubmit}>
            <TextField
              fullWidth label="邮箱" type="email" margin="normal"
              value={email} onChange={e => setEmail(e.target.value)}
              required autoFocus
            />
            <TextField
              fullWidth label="密码" type="password" margin="normal"
              value={password} onChange={e => setPassword(e.target.value)}
              required
            />
            <Button
              fullWidth variant="contained" type="submit" size="large"
              disabled={loading} sx={{ mt: 2 }}
            >
              {loading ? <CircularProgress size={24} /> : '登录'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </Box>
  )
}
