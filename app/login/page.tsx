'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/lib/auth'
import { AuthShell } from '@/components/auth/AuthShell'
import { useRouter } from 'next/navigation'
import { getFriendlyAuthErrorMessage } from '@/lib/utils/auth-error'
import { useSearchParams } from 'next/navigation'
import { Button } from '@/components/obsidian/controls'
import { TextField } from '@/components/obsidian/fields'
import { Alert } from '@/components/obsidian/feedback'
import { Toast } from '@/components/obsidian/overlays'
import { GoogleIcon, MailIcon, EyeIcon, EyeOffIcon } from '@/components/icons/WcIcon'

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

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Landing route keys off the session role, never a browser-side email list.
// The server stamps role from the admin allowlist when it signs the cookie
// (lib/admin-emails.ts), so the browser cannot drift from the real allowlist.
const getPostLoginRoute = (role?: string | null) =>
  role === 'admin' ? '/admin' : '/dashboard'

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

  // Toast 自动消失由 Toast autoHideMs 处理；此处仅切换登录方式时清理错误
  useEffect(() => {
    setErrors({})
    setOtpSent(false)
    setGlobalError('')
  }, [loginMethod])

  useEffect(() => {
    if (!authLoading && user) {
      router.replace(getPostLoginRoute(user.role))
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
        google_state_invalid: '登录请求已失效（页面可能停留过久或非本次发起），请重新点击 Google 登录',
        google_id_token_invalid: 'Google 返回的身份信息未通过校验，请重新登录',
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
      // Redirect is handled by the effect above once the session user lands;
      // the route depends on the server-issued role, not the typed address.
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
      <div className='w-full rounded-3xl border border-d-border bg-d-surface p-7 shadow-2xl md:p-9'>
        {/* ===== Google 登录按钮 ===== */}
        <Button
          variant='secondary'
          type='button'
          loading={googleLoading}
          disabled={loading}
          onClick={handleGoogleLogin}
          className='w-full'
        >
          {googleLoading ? null : <GoogleIcon size={20} />}
          {googleLoading ? '正在唤起 Google 登录…' : '使用 Google 账号登录'}
        </Button>

        {/* ===== 分隔线 ===== */}
        <div className='my-6 flex items-center gap-4'>
          <span className='h-px flex-1 bg-gradient-to-r from-transparent via-d-border to-transparent' />
          <span className='text-[11px] font-semibold uppercase tracking-[0.08em] text-d-muted'>或使用邮箱登录</span>
          <span className='h-px flex-1 bg-gradient-to-r from-transparent via-d-border to-transparent' />
        </div>

        {/* ===== 登录方式切换 ===== */}
        <div className='mb-4 flex gap-1.5 rounded-xl bg-d-subtle p-1'>
          {(['password', 'otp'] as LoginMethod[]).map(method => (
            <button
              key={method}
              type='button'
              onClick={() => setLoginMethod(method)}
              aria-pressed={loginMethod === method}
              className={
                'flex-1 select-none rounded-[10px] py-2 text-[13px] font-semibold transition-colors ' +
                (loginMethod === method
                  ? 'bg-d-surface text-d-accent-light shadow-sm'
                  : 'text-d-muted active:text-d-text')
              }
            >
              {method === 'password' ? '密码登录' : '验证码登录'}
            </button>
          ))}
        </div>

        {/* ===== 全局错误提示 ===== */}
        {globalError && (
          <div className='mb-4'>
            <Alert severity='error'>{globalError}</Alert>
          </div>
        )}

        {/* ===== 密码登录表单 ===== */}
        {loginMethod === 'password' ? (
          <form onSubmit={handlePasswordLogin} noValidate className='flex flex-col gap-4'>
            {/* 邮箱 */}
            <TextField
              label='邮箱地址' required
              type='email'
              placeholder='请输入邮箱地址'
              autoComplete='email'
              inputMode='email'
              value={email}
              onChange={e => handleEmailChange(e.target.value)}
              error={!!errors.email}
              helperText={errors.email}
              endAdornment={<MailIcon size={18} />}
            />

            {/* 密码 */}
            <TextField
              label='输入密码' required
              type={showPassword ? 'text' : 'password'}
              placeholder='请输入密码'
              autoComplete='current-password'
              value={password}
              onChange={e => handlePasswordChange(e.target.value)}
              error={!!errors.password}
              helperText={errors.password}
              endAdornment={
                <button
                  type='button'
                  onClick={() => setShowPassword(v => !v)}
                  aria-label={showPassword ? '隐藏密码' : '显示密码'}
                  className='pointer-events-auto rounded-full p-1 text-d-muted transition-colors hover:text-d-text'
                >
                  {showPassword ? <EyeOffIcon size={20} /> : <EyeIcon size={20} />}
                </button>
              }
            />

            {/* 提交按钮 */}
            <Button type='submit' loading={loading} disabled={loading} className='mt-2 w-full'>
              登录系统
            </Button>
          </form>
        ) : (
          /* ===== 验证码登录表单 ===== */
          <form
            onSubmit={otpSent ? handleOtpLogin : (e) => { e.preventDefault(); handleSendOtp() }}
            noValidate
            className='flex flex-col gap-4'
          >
            {/* 邮箱 */}
            <TextField
              label='邮箱地址' required
              type='email'
              placeholder='请输入邮箱地址'
              autoComplete='email'
              inputMode='email'
              value={email}
              onChange={e => { handleEmailChange(e.target.value); if (otpSent) setOtpSent(false) }}
              error={!!errors.email}
              helperText={errors.email}
              disabled={otpSent}
              endAdornment={<MailIcon size={18} />}
            />

            {/* 验证码（发送后显示） */}
            {otpSent && (
              <TextField
                label='6 位验证码' required
                placeholder='000000'
                value={otp}
                onChange={e => handleOtpChange(e.target.value)}
                error={!!errors.otp}
                helperText={errors.otp}
                autoFocus
                maxLength={6}
                inputMode='numeric'
                style={{ textAlign: 'center', fontSize: '1.25rem', fontWeight: 700, letterSpacing: '0.3rem' }}
              />
            )}

            {/* 主按钮：发送 / 验证 */}
            <Button
              type='submit'
              loading={loading}
              disabled={loading}
              variant={otpSent ? 'primary' : 'secondary'}
              className='mt-2 w-full'
            >
              {otpSent ? '验证并登录' : '获取验证码'}
            </Button>

            {/* 已发送：重新发送 */}
            {otpSent && !loading && (
              <Button
                variant='ghost'
                size='sm'
                onClick={() => { setOtpSent(false); setOtp('') }}
                className='mx-auto'
              >
                重新发送
              </Button>
            )}
          </form>
        )}

        {/* ===== 忘记密码 ===== */}
        <div className='mt-6 text-center'>
          <a
            href='#'
            onClick={handleForgotPassword}
            className='text-[13px] font-semibold text-d-accent-light underline-offset-4 hover:underline'
          >
            忘记密码？
          </a>
        </div>
      </div>

      {/* ===== Toast ===== */}
      <Toast
        open={toast.open}
        message={toast.message}
        severity={toast.severity}
        autoHideMs={3500}
        onClose={closeToast}
      />
    </AuthShell>
  )
}
