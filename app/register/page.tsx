'use client'

import { useState } from 'react'
import {
  Box, TextField, Button,
  Typography, Alert, CircularProgress, Stack,
  IconButton, InputAdornment
} from '@mui/material'
import { Visibility, VisibilityOff } from '@mui/icons-material'
import { AuthShell } from '@/components/auth/AuthShell'
import { useAuth } from '@/lib/auth'
import { useRouter } from 'next/navigation'
import { getFriendlyAuthErrorMessage } from '@/lib/utils/auth-error'

// Google 官方四色 G 标（内联 SVG，无外部依赖）
function GoogleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92a8.78 8.78 0 0 0 2.68-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.81.54-1.84.86-3.05.86-2.34 0-4.33-1.58-5.04-3.71H.96v2.33A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.96 10.71a5.41 5.41 0 0 1 0-3.42V4.96H.96a9 9 0 0 0 0 8.08l3-2.33z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.46.89 11.42 0 9 0A9 9 0 0 0 .96 4.96l3 2.33C4.67 5.16 6.66 3.58 9 3.58z" />
    </svg>
  )
}

const fieldSx = {
  '& .MuiOutlinedInput-root': { height: 56, borderRadius: '14px', bgcolor: 'background.paper' },
  '& .MuiOutlinedInput-input': { padding: '16px', fontSize: 16 },
} as const

function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <Box>
      <Typography
        component="label"
        htmlFor={id}
        sx={{ display: 'block', fontSize: 14, fontWeight: 500, color: 'text.primary', mb: 1 }}
      >
        {label}
      </Typography>
      {children}
    </Box>
  )
}

export default function RegisterPage() {
  const [step, setStep] = useState<'info' | 'otp'>('info')
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [otp, setOtp] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(false)
  const { signUp, verifyEmail, resendVerificationEmail, signInWithGoogle } = useAuth()
  const router = useRouter()

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { requireEmailVerification } = await signUp(email, password, name)
      if (requireEmailVerification) {
        setStep('otp')
      } else {
        router.push('/dashboard')
      }
    } catch (err) {
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
    } catch (err) {
      setError(getFriendlyAuthErrorMessage(err, '验证码错误或已过期，请重试'))
    } finally {
      setLoading(false)
    }
  }

  const handleResend = async () => {
    setError('')
    setNotice('')
    try {
      await resendVerificationEmail(email)
      setNotice('验证码已重新发送，请查收邮件')
    } catch (err) {
      setError(err instanceof Error ? err.message : '重新发送失败')
    }
  }

  const handleGoogle = async () => {
    setError('')
    try {
      await signInWithGoogle()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google 登录失败')
    }
  }

  return (
    <AuthShell
      title={step === 'info' ? '创建账户' : '验证邮箱'}
      subtitle={step === 'info' ? '开始管理全家的信用卡' : `验证码已发送至 ${email}`}
      crossLinkHref="/login"
      crossLinkLabel="直接登录"
    >
      {error && <Alert severity="error" sx={{ mb: 3, borderRadius: 2 }}>{error}</Alert>}
      {notice && <Typography variant="body2" color="success.main" sx={{ mb: 2 }}>{notice}</Typography>}

      {step === 'info' ? (
        <form onSubmit={handleSignUp}>
          <Stack spacing={3}>
            <Field label="姓名" id="reg-name">
              <TextField
                id="reg-name"
                fullWidth
                variant="outlined"
                value={name}
                onChange={e => setName(e.target.value)}
                required
                autoComplete="name"
                sx={fieldSx}
              />
            </Field>
            <Field label="邮箱地址" id="reg-email">
              <TextField
                id="reg-email"
                fullWidth
                type="email"
                variant="outlined"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoComplete="email"
                sx={fieldSx}
              />
            </Field>
            <Field label="设置密码" id="reg-password">
              <TextField
                id="reg-password"
                fullWidth
                type={showPassword ? 'text' : 'password'}
                variant="outlined"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoComplete="new-password"
                sx={fieldSx}
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton aria-label={showPassword ? '隐藏密码' : '显示密码'} onClick={() => setShowPassword(!showPassword)} edge="end">
                        {showPassword ? <VisibilityOff /> : <Visibility />}
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
              />
            </Field>
            <Button
              fullWidth
              variant="contained"
              type="submit"
              disabled={loading}
              sx={{
                mt: 2,
                height: 56,
                borderRadius: '28px',
                fontSize: 16,
                fontWeight: 700,
              }}
            >
              {loading ? <CircularProgress size={24} color="inherit" /> : '创建账户'}
            </Button>
          </Stack>
        </form>
      ) : (
        <form onSubmit={handleVerify}>
          <Stack spacing={3}>
            <Field label="验证码" id="reg-otp">
              <TextField
                id="reg-otp"
                fullWidth
                variant="outlined"
                value={otp}
                onChange={e => setOtp(e.target.value)}
                required
                autoFocus
                inputProps={{
                  maxLength: 6,
                  style: { textAlign: 'center', fontSize: '1.25rem', letterSpacing: '0.3rem', fontWeight: 700 }
                }}
                sx={fieldSx}
              />
            </Field>
            <Button
              fullWidth
              variant="contained"
              type="submit"
              disabled={loading}
              sx={{
                height: 56,
                borderRadius: '28px',
                fontSize: 16,
                fontWeight: 700,
              }}
            >
              {loading ? <CircularProgress size={24} color="inherit" /> : '验证并登录'}
            </Button>
            <Stack direction="row" justifyContent="space-between">
              <Button variant="text" onClick={() => setStep('info')} sx={{ color: 'text.secondary', textTransform: 'none' }}>
                返回修改信息
              </Button>
              <Button variant="text" onClick={handleResend} sx={{ color: 'primary.dark', textTransform: 'none', fontWeight: 600 }}>
                重新发送验证码
              </Button>
            </Stack>
          </Stack>
        </form>
      )}

      {/* 分隔线 + Google 登录 */}
      <Stack direction="row" alignItems="center" spacing={2} sx={{ mt: 5, mb: 3 }}>
        <Box sx={{ flex: 1, height: 1, bgcolor: 'divider' }} />
        <Typography variant="body2" color="text.secondary">或</Typography>
        <Box sx={{ flex: 1, height: 1, bgcolor: 'divider' }} />
      </Stack>
      <Button
        fullWidth
        variant="outlined"
        onClick={handleGoogle}
        startIcon={<GoogleIcon />}
        sx={{
          height: 56,
          borderRadius: '28px',
          fontSize: 16,
          fontWeight: 600,
          color: 'text.primary',
          borderColor: 'divider',
          '&:hover': { bgcolor: 'action.hover', borderColor: 'divider' },
        }}
      >
        使用 Google 账户继续
      </Button>
    </AuthShell>
  )
}
