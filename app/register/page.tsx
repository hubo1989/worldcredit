'use client'

import { useState } from 'react'
import { AuthShell } from '@/components/auth/AuthShell'
import { useAuth } from '@/lib/auth'
import { useRouter } from 'next/navigation'
import { getFriendlyAuthErrorMessage } from '@/lib/utils/auth-error'
import { Button } from '@/components/obsidian/controls'
import { TextField } from '@/components/obsidian/fields'
import { Alert } from '@/components/obsidian/feedback'
import { GoogleIcon, EyeIcon, EyeOffIcon } from '@/components/icons/WcIcon'

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
      {error && (
        <div className='mb-5'>
          <Alert severity='error'>{error}</Alert>
        </div>
      )}
      {notice && <p className='mb-4 text-[13px] font-semibold text-d-success-ink'>{notice}</p>}

      {step === 'info' ? (
        <form onSubmit={handleSignUp} className='flex flex-col gap-5'>
          <TextField
            label='姓名' required
            id='reg-name'
            value={name}
            onChange={e => setName(e.target.value)}
            autoComplete='name'
          />
          <TextField
            label='邮箱地址' required
            id='reg-email'
            type='email'
            value={email}
            onChange={e => setEmail(e.target.value)}
            autoComplete='email'
          />
          <TextField
            label='设置密码' required
            id='reg-password'
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoComplete='new-password'
            endAdornment={
              <button
                type='button'
                aria-label={showPassword ? '隐藏密码' : '显示密码'}
                onClick={() => setShowPassword(!showPassword)}
                className='rounded-full p-1 text-d-muted transition-colors hover:text-d-text'
              >
                {showPassword ? <EyeOffIcon size={20} /> : <EyeIcon size={20} />}
              </button>
            }
          />
          <Button type='submit' loading={loading} className='mt-2 w-full'>
            创建账户
          </Button>
        </form>
      ) : (
        <form onSubmit={handleVerify} className='flex flex-col gap-5'>
          <TextField
            label='验证码' required
            id='reg-otp'
            value={otp}
            onChange={e => setOtp(e.target.value)}
            autoFocus
            maxLength={6}
            inputMode='numeric'
            style={{ textAlign: 'center', fontSize: '1.25rem', letterSpacing: '0.3rem', fontWeight: 700 }}
          />
          <Button type='submit' loading={loading} className='w-full'>
            验证并登录
          </Button>
          <div className='flex justify-between'>
            <Button variant='ghost' size='sm' onClick={() => setStep('info')}>
              返回修改信息
            </Button>
            <Button variant='ghost' size='sm' onClick={handleResend} className='font-semibold'>
              重新发送验证码
            </Button>
          </div>
        </form>
      )}

      {/* 分隔线 + Google 登录 */}
      <div className='mb-5 mt-8 flex items-center gap-4'>
        <span className='h-px flex-1 bg-d-border' />
        <span className='text-[12px] text-d-muted'>或</span>
        <span className='h-px flex-1 bg-d-border' />
      </div>
      <Button variant='secondary' onClick={handleGoogle} className='w-full'>
        <GoogleIcon size={20} />
        使用 Google 账户继续
      </Button>
    </AuthShell>
  )
}
