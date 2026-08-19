'use client'

import { useState } from 'react'
import {
  Box, Card, CardContent, TextField, Button,
  Typography, Alert, CircularProgress, Stack,
  IconButton, InputAdornment
} from '@mui/material'
import {
  CreditCard as CreditCardIcon,
  ArrowBack as BackIcon,
  Visibility,
  VisibilityOff
} from '@mui/icons-material'
import { useAuth } from '@/lib/auth'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { getFriendlyAuthErrorMessage } from '@/lib/utils/auth-error'

export default function RegisterPage() {
  const [step, setStep] = useState<'info' | 'otp'>('info')
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [otp, setOtp] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { signUp, verifyEmail } = useAuth()
  const router = useRouter()

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const data = await signUp(email, password, name)
      if (data?.requireEmailVerification) {
        setStep('otp')
      } else {
        router.push('/dashboard')
      }
    } catch (err: any) {
      setError(getFriendlyAuthErrorMessage(err, '注册失败，请检查填写信息后重试'))
    } finally {
      setLoading(false)
    }
  }

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await verifyEmail(email, otp)
      router.push('/dashboard')
    } catch (err: any) {
      setError(getFriendlyAuthErrorMessage(err, '验证码错误或已过期，请重试'))
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
      backgroundColor: '#F5F8FF',
      p: 2,
    }}>
      <Card sx={{ 
        maxWidth: 450, 
        width: '100%', 
        borderRadius: '5px', 
        overflow: 'hidden', 
        border: '1px solid #DDDDDD',
        boxShadow: '0px 4px 8px rgba(0, 0, 0, 0.12)',
        bgcolor: '#FFFFFF'
      }}>
        <Box sx={{ 
          bgcolor: '#030059', 
          color: '#FFFFFF',
          px: 3, pt: 4, pb: 3, textAlign: 'center' 
        }}>
          <CreditCardIcon sx={{ fontSize: 44, color: '#A2C6FF', mb: 1 }} />
          <Typography variant="h2" sx={{ color: '#FFFFFF', fontSize: '24px', fontWeight: 300, mb: 1 }}>
            {step === 'info' ? '加入 WorldCredit' : '验证邮箱'}
          </Typography>
          <Typography sx={{ color: '#A2C6FF', fontSize: '14px', fontWeight: 400 }}>
            {step === 'info' 
              ? '开启您的专业信用卡管理之旅' 
              : `验证码已发送至 ${email}`}
          </Typography>
        </Box>

        <CardContent sx={{ p: { xs: 3, md: 4 } }}>
          {error && <Alert severity="error" sx={{ mb: 3, borderRadius: '5px' }}>{error}</Alert>}

          {step === 'info' ? (
            <form onSubmit={handleSignUp}>
              <Stack spacing={2.5}>
                <TextField
                  fullWidth
                  label="姓名"
                  variant="outlined"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  required
                />
                <TextField
                  fullWidth
                  label="邮箱地址"
                  type="email"
                  variant="outlined"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                />
                <TextField
                  fullWidth
                  label="设置密码"
                  type={showPassword ? 'text' : 'password'}
                  variant="outlined"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  InputProps={{
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton onClick={() => setShowPassword(!showPassword)} edge="end">
                          {showPassword ? <VisibilityOff /> : <Visibility />}
                        </IconButton>
                      </InputAdornment>
                    ),
                  }}
                />
                <Button
                  fullWidth
                  variant="contained"
                  type="submit"
                  disabled={loading}
                  sx={{ 
                    mt: 1, 
                    height: 44, 
                    borderRadius: '3px',
                    fontWeight: 700,
                    backgroundColor: '#A2C6FF',
                    color: '#FFFFFF',
                    '&:hover': {
                      backgroundColor: '#7AADFF'
                    }
                  }}
                >
                  {loading ? <CircularProgress size={24} color="inherit" /> : '立 即 注 册'}
                </Button>
              </Stack>
            </form>
          ) : (
            <form onSubmit={handleVerify}>
              <Stack spacing={2.5}>
                <Typography variant="body2" color="#636363" textAlign="center">
                  请输入邮件中的 6 位验证码以激活账号
                </Typography>
                <TextField
                  fullWidth
                  label="验证码"
                  placeholder="000000"
                  variant="outlined"
                  value={otp}
                  onChange={e => setOtp(e.target.value)}
                  required
                  autoFocus
                  inputProps={{ 
                    maxLength: 6, 
                    style: { textAlign: 'center', fontSize: '1.25rem', letterSpacing: '0.3rem', fontWeight: 700 } 
                  }}
                />
                <Button
                  fullWidth
                  variant="contained"
                  type="submit"
                  disabled={loading}
                  sx={{ 
                    height: 44, 
                    borderRadius: '3px', 
                    fontWeight: 700,
                    backgroundColor: '#A2C6FF',
                    color: '#FFFFFF',
                    '&:hover': { backgroundColor: '#7AADFF' }
                  }}
                >
                  {loading ? <CircularProgress size={24} color="inherit" /> : '激活并登录'}
                </Button>
                <Button 
                  fullWidth 
                  variant="text" 
                  onClick={() => setStep('info')}
                  startIcon={<BackIcon />}
                  sx={{ color: '#030059' }}
                >
                  返回修改信息
                </Button>
              </Stack>
            </form>
          )}

          <Box sx={{ mt: 3, textAlign: 'center' }}>
            <Typography variant="body2" color="#636363">
              已有账号？{' '}
              <Link href="/login" style={{ color: '#030059', textDecoration: 'underline', fontWeight: 600 }}>
                返回登录
              </Link>
            </Typography>
          </Box>
        </CardContent>
      </Card>
    </Box>
  )
}
