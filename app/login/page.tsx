'use client'

import { useState } from 'react'
import {
  Box, Card, CardContent, TextField, Button,
  Typography, Alert, CircularProgress, Stack,
  Divider, Tab, Tabs, InputAdornment, IconButton
} from '@mui/material'
import { 
  CreditCard as CreditCardIcon,
  Google as GoogleIcon,
  Email as EmailIcon,
  Lock as LockIcon,
  Visibility,
  VisibilityOff
} from '@mui/icons-material'
import { useAuth } from '@/lib/auth'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function LoginPage() {
  const [loginMethod, setLoginMethod] = useState<'password' | 'otp'>('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [otp, setOtp] = useState('')
  const [otpSent, setOtpSent] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { signIn, resendVerificationEmail, verifyEmail, signInWithGoogle } = useAuth()
  const router = useRouter()

const ADMIN_EMAILS = ['admin@worldcredit.com']

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await signIn(email, password)
      const targetRoute = ADMIN_EMAILS.includes(email.trim().toLowerCase()) ? '/admin' : '/dashboard'
      router.push(targetRoute)
    } catch (err: any) {
      setError(err.message || '登录失败')
    } finally {
      setLoading(false)
    }
  }

  const handleSendOtp = async () => {
    if (!email) {
      setError('请输入邮箱以接收验证码')
      return
    }
    setError('')
    setLoading(true)
    try {
      await resendVerificationEmail(email)
      setOtpSent(true)
    } catch (err: any) {
      setError(err.message || '发送验证码失败')
    } finally {
      setLoading(false)
    }
  }

  const handleOtpLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await verifyEmail(email, otp)
      const targetRoute = ADMIN_EMAILS.includes(email.trim().toLowerCase()) ? '/admin' : '/dashboard'
      router.push(targetRoute)
    } catch (err: any) {
      setError(err.message || '验证码登录失败')
    } finally {
      setLoading(false)
    }
  }

  const handleGoogleLogin = async () => {
    setError('')
    setLoading(true)
    try {
      await signInWithGoogle()
    } catch (err: any) {
      setError(err.message || 'Google 登录失败')
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
          px: 3, pt: 4, pb: 2, textAlign: 'center' 
        }}>
          <CreditCardIcon sx={{ fontSize: 44, color: '#A2C6FF', mb: 1 }} />
          <Typography variant="h2" sx={{ color: '#FFFFFF', fontSize: '24px', fontWeight: 300, mb: 1 }}>
            欢迎回来
          </Typography>
          <Typography sx={{ color: '#A2C6FF', fontSize: '14px', fontWeight: 400, mb: 3 }}>
            随时随地掌控您的信用卡资产
          </Typography>
          
          <Tabs 
            value={loginMethod} 
            onChange={(_, val) => { setLoginMethod(val); setError(''); setOtpSent(false); }} 
            centered 
            sx={{ 
              '& .MuiTab-root': { color: 'rgba(255, 255, 255, 0.7)', fontFamily: '"Open Sans", sans-serif' },
              '& .Mui-selected': { color: '#FFFFFF', fontWeight: 700 },
              '& .MuiTabs-indicator': { backgroundColor: '#A2C6FF' }
            }}
          >
            <Tab label="密码登录" value="password" />
            <Tab label="验证码登录" value="otp" />
          </Tabs>
        </Box>

        <CardContent sx={{ p: { xs: 3, md: 4 } }}>
          {error && <Alert severity="error" sx={{ mb: 3, borderRadius: '5px' }}>{error}</Alert>}

          {loginMethod === 'password' ? (
            <form onSubmit={handlePasswordLogin}>
              <Stack spacing={2.5}>
                <TextField
                  fullWidth
                  label="邮箱地址"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <EmailIcon fontSize="small" sx={{ color: '#636363' }} />
                      </InputAdornment>
                    ),
                  }}
                />
                <TextField
                  fullWidth
                  label="登录密码"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <LockIcon fontSize="small" sx={{ color: '#636363' }} />
                      </InputAdornment>
                    ),
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
                  {loading ? <CircularProgress size={24} color="inherit" /> : '登 录'}
                </Button>
              </Stack>
            </form>
          ) : (
            <form onSubmit={handleOtpLogin}>
              <Stack spacing={2.5}>
                <TextField
                  fullWidth
                  label="邮箱地址"
                  type="email"
                  value={email}
                  onChange={e => { setEmail(e.target.value); setOtpSent(false); }}
                  required
                  disabled={otpSent}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <EmailIcon fontSize="small" sx={{ color: '#636363' }} />
                      </InputAdornment>
                    ),
                  }}
                />
                
                {otpSent ? (
                  <TextField
                    fullWidth
                    label="6 位验证码"
                    placeholder="000000"
                    value={otp}
                    onChange={e => setOtp(e.target.value)}
                    required
                    autoFocus
                    inputProps={{ 
                      maxLength: 6, 
                      style: { textAlign: 'center', fontSize: '1.25rem', fontWeight: 700, letterSpacing: '0.3rem' } 
                    }}
                  />
                ) : null}

                <Button
                  fullWidth
                  variant={otpSent ? "contained" : "outlined"}
                  onClick={otpSent ? undefined : handleSendOtp}
                  type={otpSent ? "submit" : "button"}
                  disabled={loading}
                  sx={{ 
                    height: 44, 
                    borderRadius: '3px', 
                    fontWeight: 700,
                    ...(otpSent ? {
                      backgroundColor: '#A2C6FF',
                      color: '#FFFFFF',
                      '&:hover': { backgroundColor: '#7AADFF' }
                    } : {
                      color: '#030059',
                      borderColor: '#030059',
                      '&:hover': { backgroundColor: 'rgba(162, 198, 255, 0.2)', borderColor: '#7AADFF' }
                    })
                  }}
                >
                  {loading ? (
                    <CircularProgress size={24} color="inherit" />
                  ) : otpSent ? (
                    '验证并登录'
                  ) : (
                    '获 取 验 证 码'
                  )}
                </Button>
                
                {otpSent && (
                  <Button variant="text" size="small" onClick={() => setOtpSent(false)} sx={{ color: '#030059' }}>
                    重新发送
                  </Button>
                )}
              </Stack>
            </form>
          )}

          <Box sx={{ my: 3 }}>
            <Divider sx={{ "&::before, &::after": { borderColor: "#DDDDDD" } }}>
              <Typography variant="caption" sx={{ color: "#636363", px: 1 }}>
                或者使用
              </Typography>
            </Divider>
          </Box>

          <Button
            fullWidth
            variant="outlined"
            startIcon={<GoogleIcon />}
            onClick={handleGoogleLogin}
            disabled={loading}
            sx={{ 
              height: 44, 
              borderRadius: '3px', 
              color: '#030059', 
              borderColor: '#030059',
              fontWeight: 400,
              '&:hover': { borderColor: '#7AADFF', bgcolor: 'rgba(162, 198, 255, 0.2)' }
            }}
          >
            Google 登录
          </Button>

          <Box sx={{ mt: 3, textAlign: 'center' }}>
            <Typography variant="body2" color="#636363">
              还没有账号？{' '}
              <Link href="/register" style={{ color: '#030059', textDecoration: 'underline', fontWeight: 600 }}>
                立即注册
              </Link>
            </Typography>
          </Box>
        </CardContent>
      </Card>
    </Box>
  )
}
