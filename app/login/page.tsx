'use client'

import { useEffect, useState } from 'react'
import { Box, Button, IconButton, InputAdornment, Link, Snackbar, Stack, TextField, Typography } from '@mui/material'
import {
  Google as GoogleIcon,
  Email as EmailIcon,
  Visibility,
  VisibilityOff,
  ErrorOutline as ErrorOutlineIcon,
} from '@mui/icons-material'
import { useAuth } from '@/lib/auth'
import { AuthShell } from '@/components/auth/AuthShell'
import { useRouter } from 'next/navigation'
import { getFriendlyAuthErrorMessage } from '@/lib/utils/auth-error'
import { useSearchParams } from 'next/navigation'

/* ============ 类型与常量 ============ */

type LoginMethod = 'password' | 'otp'

interface FieldErrors {
  email?: string
  password?: string
  otp?: string
}

interface ToastState {
  open: boolean
  message: string
  severity: 'error' | 'success'
}

const ADMIN_EMAILS = ['admin@worldcredit.com']

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const getPostLoginRoute = (em?: string | null) =>
  em && ADMIN_EMAILS.includes(em.trim().toLowerCase()) ? '/admin' : '/dashboard'

/* ============ 页面 ============ */

export default function LoginPage() {
  const [loginMethod, setLoginMethod] = useState<LoginMethod>('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [otp, setOtp] = useState('')
  const [otpSent, setOtpSent] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  const [errors, setErrors] = useState<FieldErrors>({})
  const [globalError, setGlobalError] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [toast, setToast] = useState<ToastState>({ open: false, message: '', severity: 'error' })

  const { user, loading: authLoading, signIn, resendVerificationEmail, verifyEmail, signInWithGoogle } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()

  // Toast 自动消失由 Snackbar autoHideDuration 处理；此处仅切换登录方式时清理错误
  useEffect(() => {
    setErrors({})
    setOtpSent(false)
    setGlobalError('')
  }, [loginMethod])

  useEffect(() => {
    if (!authLoading && user) {
      router.replace(getPostLoginRoute(user.email))
    }
  }, [authLoading, user, router])

  // Surface OAuth callback failures that bounce back to /login?error=...
  useEffect(() => {
    const oauthError = searchParams.get('error')
    if (oauthError) {
      const friendly: Record<string, string> = {
        google_no_code: 'Google 回调缺少授权码，请重新登录',
        google_not_configured: 'Google 登录未配置，请联系管理员',
        google_token_exchange: 'Google 授权码换取登录态失败，请重试',
        google_no_id_token: 'Google 未返回身份信息，请重试',
        google_no_email: 'Google 账号缺少邮箱，无法登录',
        google_callback_error: 'Google 登录处理异常，请重试',
      }
      setGlobalError(friendly[oauthError] || `Google 登录失败（${oauthError}）`)
    }
  }, [searchParams])

  /* ----- 工具函数 ----- */

  const showToast = (message: string, severity: 'error' | 'success' = 'error') => {
    setToast({ open: true, message, severity })
  }

  const closeToast = () => setToast(prev => ({ ...prev, open: false }))

  const validateEmail = (v: string) => EMAIL_REGEX.test(v)

  const routeAfterLogin = (em: string) => {
    router.push(getPostLoginRoute(em))
  }

  /* ----- 实时校验：输入变化时清除对应错误 ----- */

  const handleEmailChange = (v: string) => {
    setEmail(v)
    if (errors.email && v && validateEmail(v)) {
      setErrors(prev => ({ ...prev, email: undefined }))
    }
  }

  const handlePasswordChange = (v: string) => {
    setPassword(v)
    if (errors.password && v.length >= 6) {
      setErrors(prev => ({ ...prev, password: undefined }))
    }
  }

  const handleOtpChange = (v: string) => {
    setOtp(v)
    if (errors.otp && /^\d{6}$/.test(v)) {
      setErrors(prev => ({ ...prev, otp: undefined }))
    }
  }

  /* ----- 提交：密码登录 ----- */

  const validatePasswordForm = () => {
    const next: FieldErrors = {}
    if (!email.trim()) next.email = '请输入邮箱地址'
    else if (!validateEmail(email.trim())) next.email = '请输入有效的邮箱地址'

    if (!password) next.password = '请输入密码'
    else if (password.length < 6) next.password = '密码至少需要 6 个字符'

    setErrors(next)
    return Object.keys(next).length === 0
  }

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setGlobalError('')
    if (!validatePasswordForm()) return

    setLoading(true)
    try {
      await signIn(email.trim(), password)
      showToast('登录成功，正在跳转…', 'success')
      routeAfterLogin(email)
    } catch (err: unknown) {
      setGlobalError(getFriendlyAuthErrorMessage(err, '邮箱或密码错误，请检查后重试'))
    } finally {
      setLoading(false)
    }
  }

  /* ----- 提交：验证码登录 ----- */

  const validateOtpForm = (requireOtp: boolean) => {
    const next: FieldErrors = {}
    if (!email.trim()) next.email = '请输入邮箱地址'
    else if (!validateEmail(email.trim())) next.email = '请输入有效的邮箱地址'

    if (requireOtp) {
      if (!otp) next.otp = '请输入验证码'
      else if (!/^\d{6}$/.test(otp)) next.otp = '验证码应为 6 位数字'
    }

    setErrors(next)
    return Object.keys(next).length === 0
  }

  const handleSendOtp = async () => {
    setGlobalError('')
    if (!validateOtpForm(false)) return

    setLoading(true)
    try {
      await resendVerificationEmail(email.trim())
      setOtpSent(true)
      showToast('验证码已发送至您的邮箱', 'success')
    } catch (err: unknown) {
      setGlobalError(getFriendlyAuthErrorMessage(err, '发送验证码失败，请稍后重试'))
    } finally {
      setLoading(false)
    }
  }

  const handleOtpLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setGlobalError('')
    if (!validateOtpForm(true)) return

    setLoading(true)
    try {
      await verifyEmail(email.trim(), otp)
      showToast('登录成功，正在跳转…', 'success')
      routeAfterLogin(email)
    } catch (err: unknown) {
      setGlobalError(getFriendlyAuthErrorMessage(err, '验证码错误或已失效，请重新获取'))
    } finally {
      setLoading(false)
    }
  }

  /* ----- Google 登录 ----- */

  const handleGoogleLogin = async () => {
    setGlobalError('')
    setGoogleLoading(true)
    try {
      await signInWithGoogle()
      // 成功时通常已重定向到 Google OAuth 页面，无需额外处理
    } catch (err: unknown) {
      setGlobalError(getFriendlyAuthErrorMessage(err, 'Google 登录唤起失败，请重试'))
      setGoogleLoading(false)
    }
  }

  /* ----- 忘记密码（演示） ----- */

  const handleForgotPassword = (e: React.MouseEvent) => {
    e.preventDefault()
    const em = email.trim()
    if (!em || !validateEmail(em)) {
      showToast('请先输入您的邮箱地址', 'error')
      return
    }
    showToast('密码重置链接已发送至 ' + em, 'success')
  }

  /* ============ 渲染 ============ */

  return (
    <AuthShell title="欢迎回来" subtitle="登录你的 WorldCredit 账户" crossLinkHref="/register" crossLinkLabel="创建账户">
      {/* 登录卡片 */}
      <Box
        sx={{
          position: 'relative',
          zIndex: 1,
          width: '100%',
          maxWidth: 400,
          borderRadius: { xs: '26px', sm: '32px' },
          p: { xs: '36px 26px 32px', sm: '44px 36px 38px' },
          background: 'linear-gradient(165deg, rgba(255,255,255,0.98) 0%, rgba(250,252,255,0.97) 50%, rgba(245,248,254,0.96) 100%)',
          boxShadow: `
            0 1px 2px rgba(0,0,0,0.04),
            0 4px 12px rgba(0,0,0,0.06),
            0 16px 48px rgba(27,94,154,0.14),
            inset 0 0 0 1px rgba(255,255,255,0.6)
          `,
          overflow: 'hidden',
        }}
      >
        {/* 顶部高光线 */}
        <Box
          sx={{
            position: 'absolute',
            top: 0, left: '16%', right: '16%', height: '1px',
            background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.7), transparent)',
          }}
        />

        {/* ===== Google 登录按钮 ===== */}
        <Button
          fullWidth
          type="button"
          onClick={handleGoogleLogin}
          disabled={googleLoading || loading}
          startIcon={googleLoading ? undefined : <GoogleIcon sx={{ fontSize: 22 }} />}
          sx={{
            height: 50,
            borderRadius: '16px',
            border: '1.5px solid #e2e8f0',
            background: 'linear-gradient(to bottom, #ffffff 0%, #fafbfc 100%)',
            color: '#334155',
            fontSize: 15,
            fontWeight: 600,
            textTransform: 'none',
            boxShadow: 'none',
            '&:hover': {
              borderColor: '#cbd5e1',
              background: 'linear-gradient(to bottom, #f8fafb 0%, #f1f5f9 100%)',
              boxShadow: '0 2px 10px rgba(0,0,0,0.05), 0 1px 3px rgba(0,0,0,0.04)',
              transform: 'translateY(-0.5px)',
            },
            '&:active': { transform: 'translateY(0) scale(0.985)' },
            '&.Mui-disabled': {
              background: 'linear-gradient(to bottom, #ffffff 0%, #fafbfc 100%)',
              color: '#334155',
              opacity: 0.65,
              border: '1.5px solid #e2e8f0',
            },
          }}
        >
          {googleLoading ? '正在唤起 Google 登录…' : '使用 Google 账号登录'}
        </Button>

        {/* ===== 分隔线 ===== */}
        <Stack direction="row" alignItems="center" spacing={2} sx={{ my: 3.25 }}>
          <Box sx={{ flex: 1, height: '1px', background: 'linear-gradient(90deg, transparent, #e2e8f0, transparent)' }} />
          <Typography sx={{ fontSize: 12.5, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            或使用邮箱登录
          </Typography>
          <Box sx={{ flex: 1, height: '1px', background: 'linear-gradient(90deg, transparent, #e2e8f0, transparent)' }} />
        </Stack>

        {/* ===== 登录方式切换 ===== */}
        <Stack direction="row" spacing={1} sx={{ mb: 2.5 }}>
          {(['password', 'otp'] as LoginMethod[]).map(method => (
            <Box
              key={method}
              onClick={() => setLoginMethod(method)}
              sx={{
                flex: 1,
                textAlign: 'center',
                py: 0.75,
                borderRadius: '10px',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 600,
                color: loginMethod === method ? '#2563EB' : '#94a3b8',
                background: loginMethod === method ? 'rgba(37,99,235,0.06)' : 'transparent',
                border: '1px solid',
                borderColor: loginMethod === method ? 'rgba(37,99,235,0.2)' : 'transparent',
                transition: 'all 0.2s ease',
                userSelect: 'none',
              }}
            >
              {method === 'password' ? '密码登录' : '验证码登录'}
            </Box>
          ))}
        </Stack>

        {/* ===== 全局错误提示 ===== */}
        {globalError && (
          <Box
            sx={{
              mb: 2.25,
              px: 1.75,
              py: 1.25,
              borderRadius: '12px',
              display: 'flex',
              alignItems: 'center',
              gap: 1.25,
              color: '#b91c1c',
              background: 'linear-gradient(135deg, #fef2f2 0%, #fff1f2 100%)',
              border: '1px solid #fecaca',
              boxShadow: '0 2px 6px rgba(239,68,68,0.06)',
            }}
          >
            <ErrorOutlineIcon sx={{ fontSize: 20, color: '#ef4444', flexShrink: 0 }} />
            <Typography sx={{ fontSize: 13, fontWeight: 600, lineHeight: 1.4, color: '#b91c1c' }}>
              {globalError}
            </Typography>
          </Box>
        )}

        {/* ===== 密码登录表单 ===== */}
        {loginMethod === 'password' ? (
          <Box component="form" onSubmit={handlePasswordLogin} noValidate>
            <Stack spacing={2.25}>
              {/* 邮箱 */}
              <FieldLabel label="邮箱地址" required />
              <TextField
                fullWidth
                type="email"
                placeholder="请输入邮箱地址"
                autoComplete="email"
                value={email}
                onChange={e => handleEmailChange(e.target.value)}
                error={!!errors.email}
                helperText={errors.email}
                inputMode="email"
                sx={fieldSx(!!errors.email)}
                InputProps={{
                  disableUnderline: true,
                  endAdornment: (
                    <InputAdornment position="end" sx={{ pr: 1 }}>
                      <EmailIcon sx={{ fontSize: 19, color: '#94a3b8' }} />
                    </InputAdornment>
                  ),
                }}
              />

              {/* 密码 */}
              <FieldLabel label="输入密码" required />
              <TextField
                fullWidth
                type={showPassword ? 'text' : 'password'}
                placeholder="请输入密码"
                autoComplete="current-password"
                value={password}
                onChange={e => handlePasswordChange(e.target.value)}
                error={!!errors.password}
                helperText={errors.password}
                sx={fieldSx(!!errors.password)}
                InputProps={{
                  disableUnderline: true,
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        onClick={() => setShowPassword(v => !v)}
                        edge="end"
                        aria-label={showPassword ? '隐藏密码' : '显示密码'}
                        sx={{ color: '#94a3b8', '&:hover': { color: '#475569', background: 'rgba(0,0,0,0.04)' } }}
                      >
                        {showPassword ? <VisibilityOff sx={{ fontSize: 20 }} /> : <Visibility sx={{ fontSize: 20 }} />}
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
              />

              {/* 提交按钮 */}
              <SubmitButton loading={loading} disabled={loading}>
                登录系统
              </SubmitButton>
            </Stack>
          </Box>
        ) : (
          /* ===== 验证码登录表单 ===== */
          <Box component="form" onSubmit={otpSent ? handleOtpLogin : (e) => { e.preventDefault(); handleSendOtp() }} noValidate>
            <Stack spacing={2.25}>
              {/* 邮箱 */}
              <FieldLabel label="邮箱地址" required />
              <TextField
                fullWidth
                type="email"
                placeholder="请输入邮箱地址"
                autoComplete="email"
                value={email}
                onChange={e => { handleEmailChange(e.target.value); if (otpSent) setOtpSent(false) }}
                error={!!errors.email}
                helperText={errors.email}
                disabled={otpSent}
                inputMode="email"
                sx={fieldSx(!!errors.email)}
                InputProps={{
                  disableUnderline: true,
                  endAdornment: (
                    <InputAdornment position="end" sx={{ pr: 1 }}>
                      <EmailIcon sx={{ fontSize: 19, color: '#94a3b8' }} />
                    </InputAdornment>
                  ),
                }}
              />

              {/* 验证码（发送后显示） */}
              {otpSent && (
                <>
                  <FieldLabel label="6 位验证码" required />
                  <TextField
                    fullWidth
                    placeholder="000000"
                    value={otp}
                    onChange={e => handleOtpChange(e.target.value)}
                    error={!!errors.otp}
                    helperText={errors.otp}
                    autoFocus
                    inputProps={{
                      maxLength: 6,
                      inputMode: 'numeric',
                      style: { textAlign: 'center', fontSize: '1.25rem', fontWeight: 700, letterSpacing: '0.3rem' },
                    }}
                    sx={fieldSx(!!errors.otp)}
                    InputProps={{ disableUnderline: true }}
                  />
                </>
              )}

              {/* 主按钮：发送 / 验证 */}
              <SubmitButton loading={loading} disabled={loading} variant={otpSent ? 'primary' : 'secondary'}>
                {otpSent ? '验证并登录' : '获取验证码'}
              </SubmitButton>

              {/* 已发送：重新发送 */}
              {otpSent && !loading && (
                <Button
                  variant="text"
                  size="small"
                  onClick={() => { setOtpSent(false); setOtp('') }}
                  sx={{ color: '#2563EB', fontSize: 13, fontWeight: 600, textTransform: 'none' }}
                >
                  重新发送
                </Button>
              )}
            </Stack>
          </Box>
        )}

        {/* ===== 忘记密码 ===== */}
        <Box sx={{ textAlign: 'center', mt: 2.75 }}>
          <Link
            href="#"
            onClick={handleForgotPassword}
            sx={{
              color: '#2563EB',
              fontSize: 13,
              fontWeight: 600,
              textDecoration: 'none',
              '&:hover': { color: '#1D4ED8', textDecoration: 'underline', textUnderlineOffset: '3px' },
            }}
          >
            忘记密码？
          </Link>
        </Box>
      </Box>

      {/* ===== Toast（Snackbar）===== */}
      <Snackbar
        open={toast.open}
        autoHideDuration={3500}
        onClose={closeToast}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
        sx={{
          top: { xs: 16, sm: 24 },
          '& .MuiSnackbarContent-root': {
            minWidth: 'auto',
            maxWidth: '90vw',
            px: 2.5,
            py: 1.25,
            borderRadius: '14px',
            fontSize: 14,
            fontWeight: 600,
            backdropFilter: 'blur(8px)',
            ...(toast.severity === 'error'
              ? {
                  background: 'linear-gradient(135deg, #fef2f2 0%, #fff1f2 100%)',
                  border: '1px solid #fecaca',
                  color: '#dc2626',
                  boxShadow: '0 4px 16px rgba(220,38,38,0.12), 0 1px 4px rgba(220,38,38,0.08)',
                }
              : {
                  background: 'linear-gradient(135deg, #f0fdf4 0%, #ecfdf5 100%)',
                  border: '1px solid #bbf7d0',
                  color: '#15803d',
                  boxShadow: '0 4px 16px rgba(22,163,74,0.12), 0 1px 4px rgba(22,163,74,0.08)',
                }),
          },
        }}
        message={toast.message}
      />
    </AuthShell>
  )
}

/* ============ 子组件 ============ */

/** 字段标签（带必填星号） */
function FieldLabel({ label, required }: { label: string; required?: boolean }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.875 }}>
      <Typography component="label" sx={{ fontSize: 13, fontWeight: 650, color: '#475569', letterSpacing: '0.01em' }}>
        {label}
      </Typography>
      {required && (
        <Box component="span" aria-hidden="true" sx={{ color: '#ef4444', fontWeight: 700 }}>
          *
        </Box>
      )}
    </Box>
  )
}

/** 提交按钮：主色 / 次要（描边）双样式 */
function SubmitButton({
  children,
  loading,
  disabled,
  variant = 'primary',
}: {
  children: React.ReactNode
  loading?: boolean
  disabled?: boolean
  variant?: 'primary' | 'secondary'
}) {
  const isPrimary = variant === 'primary'
  return (
    <Button
      fullWidth
      type="submit"
      disabled={disabled}
      sx={{
        mt: 1.25,
        height: 50,
        borderRadius: '16px',
        fontSize: 16,
        fontWeight: 700,
        textTransform: 'none',
        letterSpacing: '0.01em',
        color: '#fff',
        background: isPrimary
          ? 'linear-gradient(145deg, #3B82F6 0%, #2563EB 40%, #1D4ED8 100%)'
          : 'linear-gradient(145deg, #475569 0%, #334155 100%)',
        boxShadow: isPrimary
          ? '0 2px 6px rgba(37,99,235,0.25), 0 4px 16px rgba(37,99,235,0.18), inset 0 1px 0 rgba(255,255,255,0.12)'
          : 'none',
        '&:hover': {
          background: isPrimary
            ? 'linear-gradient(145deg, #2563EB 0%, #1D4ED8 50%, #1E40AF 100%)'
            : 'linear-gradient(145deg, #334155 0%, #1e293b 100%)',
          boxShadow: isPrimary
            ? '0 4px 12px rgba(37,99,235,0.35), 0 8px 28px rgba(37,99,235,0.22), inset 0 1px 0 rgba(255,255,255,0.15)'
            : 'none',
          transform: 'translateY(-1.5px)',
        },
        '&:active': {
          transform: 'translateY(0) scale(0.98)',
          boxShadow: isPrimary ? '0 2px 8px rgba(37,99,235,0.25)' : 'none',
          transitionDuration: '0.08s',
        },
        '&.Mui-disabled': {
          background: 'linear-gradient(145deg, #94a3b8 0%, #64748b 100%)',
          color: '#fff',
          boxShadow: 'none',
          transform: 'none',
        },
      }}
    >
      {loading ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box
            component="span"
            sx={{
              width: 18,
              height: 18,
              borderRadius: '50%',
              border: '2.5px solid rgba(255,255,255,0.3)',
              borderTopColor: '#fff',
              animation: 'login-spin 0.7s linear infinite',
            }}
          />
          <span style={{ visibility: 'hidden' }}>{children}</span>
        </Box>
      ) : (
        children
      )}
      <Box component="style">{`@keyframes login-spin { to { transform: rotate(360deg); } }`}</Box>
    </Button>
  )
}

/* ============ 样式工厂 ============ */

/** TextField 的统一样式（错误态变红） */
function fieldSx(hasError: boolean) {
  return {
    '& .MuiOutlinedInput-root': {
      padding: '0',
      borderRadius: '14px',
      background: hasError
        ? 'linear-gradient(to bottom, #fef2f2 0%, #fff1f2 100%)'
        : 'linear-gradient(to bottom, #ffffff 0%, #f8fafc 100%)',
      '& fieldset': {
        border: '1.5px solid',
        borderColor: hasError ? '#fca5a5' : '#e2e8f0',
        borderRadius: '14px',
      },
      '&:hover fieldset': {
        borderColor: hasError ? '#f87171' : '#cbd5e1',
      },
      '&.Mui-focused fieldset': {
        borderColor: hasError ? '#f87171' : '#3B82F6',
        boxShadow: hasError
          ? '0 0 0 3.5px rgba(239,68,68,0.06)'
          : '0 0 0 3.5px rgba(59,130,246,0.1), 0 1px 3px rgba(59,130,246,0.08)',
      },
      '&.Mui-disabled fieldset': {
        borderColor: '#e2e8f0',
        background: '#f8fafc',
      },
    },
    '& input': {
      padding: '13px 15px',
      fontSize: 15,
      color: '#0f172a',
      '&::placeholder': { color: '#94a3b8', fontWeight: 400, opacity: 1 },
    },
    '& .MuiFormHelperText-root': {
      color: '#dc2626',
      fontSize: 12,
      mt: 0.625,
      ml: 0,
      fontWeight: 500,
      lineHeight: 1.4,
    },
  }
}
