/**
 * 认证相关的错误信息本地化与友好提示转换工具
 */

export function getFriendlyAuthErrorMessage(err: any, fallbackMessage = '操作失败，请重试'): string {
  if (!err) return fallbackMessage

  const raw = String(err?.message || err?.error_description || err?.error || err || '').trim()
  const lower = raw.toLowerCase()

  // 1. 登录凭证错误
  if (
    lower.includes('invalid login credentials') ||
    lower.includes('invalid_grant') ||
    lower.includes('invalid password') ||
    lower.includes('invalid email or password') ||
    lower.includes('wrong password')
  ) {
    return '邮箱或密码不正确，请检查后重试'
  }

  // 2. 账号未找到 / 不存在
  if (lower.includes('user not found') || lower.includes('no user found')) {
    return '该邮箱尚未注册，请先注册账号'
  }

  // 3. 邮箱未验证
  if (lower.includes('email not confirmed') || lower.includes('email_not_confirmed')) {
    return '该邮箱尚未完成验证，请点击下方“验证码登录”进行邮箱验证'
  }

  // 4. 账号已存在
  if (
    lower.includes('user already registered') ||
    lower.includes('already exists') ||
    lower.includes('email already in use')
  ) {
    return '该邮箱已被注册，请直接使用密码或验证码登录'
  }

  // 5. 验证码错误 / 过期
  if (
    lower.includes('invalid otp') ||
    lower.includes('token has expired') ||
    lower.includes('token is expired') ||
    lower.includes('otp expired') ||
    lower.includes('invalid token') ||
    lower.includes('bad verification code')
  ) {
    return '验证码错误或已过期，请重新获取验证码'
  }

  // 6. 请求频次限制
  if (lower.includes('too many requests') || lower.includes('rate limit') || lower.includes('over_email_send_rate_limit')) {
    return '操作过于频繁，请稍候几分钟后再试'
  }

  // 7. 密码强度不足
  if (lower.includes('password') && (lower.includes('short') || lower.includes('at least') || lower.includes('weak'))) {
    return '密码长度不能少于 6 位字符'
  }

  // 8. 网络或连接问题
  if (
    lower.includes('failed to fetch') ||
    lower.includes('network request failed') ||
    lower.includes('networkerror') ||
    lower.includes('load failed')
  ) {
    return '网络连接失败，请检查网络后重试'
  }

  // 9. 第三方 OAuth 错误
  if (lower.includes('oauth') || lower.includes('provider not supported')) {
    return '第三方登录授权失败，请稍后重试或使用邮箱登录'
  }

  // 10. 服务端内部错误
  if (lower.includes('internal server error') || lower.includes('500') || lower.includes('database error')) {
    return '服务暂时繁忙，请稍后重试'
  }

  // 如果原始信息本身已经是中文，则直接使用
  if (/[\u4e00-\u9fa5]/.test(raw)) {
    return raw
  }

  return fallbackMessage
}
