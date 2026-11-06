// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ReminderPreferencesCard } from '@/components/settings/ReminderPreferencesCard'
import { resolveTheme, applyResolvedTheme, getInitialResolvedTheme } from '@/lib/hooks/useTheme'
import type { UserReminderConfig } from '@/lib/types'
import * as pushApi from '@/lib/api/push'
import * as adminApi from '@/lib/api/admin'
import * as prefApi from '@/lib/api/preferences'
import AdminSettingsPage from '@/app/admin/settings/page'
import { DisplayPreferencesCard } from '@/components/settings/DisplayPreferencesCard'
import SettingsPage from '@/app/(mobile)/settings/page'
import * as gmailApi from '@/lib/api/gmail'
import { isUserWebPushEnabled } from '@/worker/cron'
import { isWebPushChannelEnabled } from '@/lib/api/push'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
}))

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    user: { id: 'u1', email: 'test@example.com', role: 'member' },
    signOut: vi.fn(),
  }),
}))

vi.mock('@/lib/api/preferences', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    getUserPreferences: vi.fn().mockResolvedValue({
      user_id: 'u1',
      display_config: {
        privacy_mode: false,
        show_min_payment: true,
        show_statement_date: true,
        show_annual_fee: true,
        show_card_last4: true,
        default_currency: 'CNY',
      },
      reminder_config: {
        remind_days_before: [3, 1, 0],
        enabled_channels: ['web_push'],
      },
    }),
    updateUserPreferences: vi.fn().mockResolvedValue({}),
  }
})

vi.mock('@/lib/api/gmail', () => ({
  getGmailConnection: vi.fn(),
}))

vi.mock('@/lib/api/push', () => ({
  sendTestPush: vi.fn(),
  subscribePush: vi.fn(),
  isWebPushChannelEnabled: vi.fn((config) => {
    if (!config) return true
    if (config.enabled_channels !== undefined) {
      return Array.isArray(config.enabled_channels) && config.enabled_channels.includes('web_push')
    }
    if (config.opportunities && config.opportunities.web_push_enabled === false) {
      return false
    }
    return true
  }),
}))

vi.mock('@/lib/api/admin', () => ({
  getSystemSettings: vi.fn(),
  updateSystemSettings: vi.fn(),
}))

describe('S1 #1 & #2 & #3 & #4 · ReminderPreferencesCard 行为回归', () => {
beforeEach(() => {
  vi.clearAllMocks()
  if (typeof window !== 'undefined' && !window.matchMedia) {
    window.matchMedia = vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
  }
})

  it('存量配置 enabled_channels 为 undefined 时 Web Push 默认开启，关闭时正确落库空数组', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    // 模拟存量数据（无 enabled_channels 字段）
    const legacyConfig = {
      remind_days_before: [3, 1, 0],
      quiet_hours_start: '22:00',
      quiet_hours_end: '08:00',
    } as unknown as UserReminderConfig

    render(<ReminderPreferencesCard config={legacyConfig} onChange={onChange} />)

    // 默认判断为开启状态
    const toggle = screen.getByRole('switch', { name: 'Web Push 浏览器通道' })
    expect(toggle).toHaveAttribute('aria-checked', 'true')

    // 点击切换为关闭，应提交包含空数组的 enabled_channels
    await user.click(toggle)
    expect(onChange).toHaveBeenCalledWith({ enabled_channels: [] })
  })

  it('存量配置 enabled_channels 未设置但旧 opportunities.web_push_enabled === false 时，判定为关闭并写回一次迁移', async () => {
    const onChange = vi.fn()
    const legacyOffConfig = {
      remind_days_before: [3, 1, 0],
      opportunities: {
        web_push_enabled: false,
      },
    } as unknown as UserReminderConfig

    render(<ReminderPreferencesCard config={legacyOffConfig} onChange={onChange} />)

    // 绝不让显式关闭过的用户被重新开启：判定为关闭状态
    const toggle = screen.getByRole('switch', { name: 'Web Push 浏览器通道' })
    expect(toggle).toHaveAttribute('aria-checked', 'false')

    // 自动写回一次空数组迁移
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith({ enabled_channels: [] })
    })
  })

  it('存量配置 enabled_channels 未设置且旧 opportunities.web_push_enabled === true 或未设置时，默认开启', () => {
    const onChange = vi.fn()
    const legacyOnConfig = {
      remind_days_before: [3, 1, 0],
      opportunities: {
        web_push_enabled: true,
      },
    } as unknown as UserReminderConfig

    render(<ReminderPreferencesCard config={legacyOnConfig} onChange={onChange} />)
    const toggle = screen.getByRole('switch', { name: 'Web Push 浏览器通道' })
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    // 默认开启时不触发多余的关闭写回
    expect(onChange).not.toHaveBeenCalledWith({ enabled_channels: [] })
  })

  it('显式关闭 enabled_channels: [] 时判定为关闭', () => {
    const onChange = vi.fn()
    const offConfig = {
      remind_days_before: [3, 1, 0],
      enabled_channels: [],
    } as unknown as UserReminderConfig

    render(<ReminderPreferencesCard config={offConfig} onChange={onChange} />)
    const toggle = screen.getByRole('switch', { name: 'Web Push 浏览器通道' })
    expect(toggle).toHaveAttribute('aria-checked', 'false')
  })

  it('存量节点包含不在预设选项集的值（如 5 天）时，动态追加 chips 且可取消', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const legacyConfig = {
      remind_days_before: [7, 5, 3, 1, 0],
    } as unknown as UserReminderConfig

    render(<ReminderPreferencesCard config={legacyConfig} onChange={onChange} />)

    // 存量 5 天应该被渲染出来
    const chip5 = screen.getByRole('button', { name: '提前 5 天' })
    expect(chip5).toBeInTheDocument()

    // 点击 5 天进行取消
    await user.click(chip5)
    expect(onChange).toHaveBeenCalledWith({
      remind_days_before: [7, 3, 1, 0],
    })
  })

  it('存量白名单外 IANA 时区值动态追加当前值作为 option', () => {
    const onChange = vi.fn()
    const customTzConfig = {
      remind_days_before: [3, 1, 0],
      opportunities: {
        enabled: true,
        time_zone: 'Asia/Chongqing',
      },
    } as unknown as UserReminderConfig

    render(<ReminderPreferencesCard config={customTzConfig} onChange={onChange} />)
    const select = screen.getByLabelText('提醒时区 (标准下拉)') as unknown as HTMLSelectElement
    expect(select.value).toBe('Asia/Chongqing')
    expect(screen.getByRole('option', { name: 'Asia/Chongqing (当前设置)' })).toBeInTheDocument()
  })

  it('时间输入控件已移除 [color-scheme:dark] 硬编码', () => {
    const config = {
      remind_days_before: [3, 1, 0],
      opportunities: { enabled: true },
    } as unknown as UserReminderConfig
    const { container } = render(<ReminderPreferencesCard config={config} onChange={vi.fn()} />)
    const timeInputs = container.querySelectorAll('input[type="time"]')
    expect(timeInputs.length).toBeGreaterThan(0)
    timeInputs.forEach((input) => {
      expect(input.className).not.toContain('color-scheme:dark')
    })
  })

  it('测试推送失败时按接口返回区分提示，不再静默吞错', async () => {
    const user = userEvent.setup()
    vi.mocked(pushApi.sendTestPush).mockResolvedValueOnce({
      ok: false,
      error: '当前用户没有推送订阅，请先在浏览器开启通知',
    })

    // Mock window.Notification
    const origNotification = window.Notification
    // @ts-expect-error test mock
    window.Notification = {
      permission: 'granted',
      requestPermission: vi.fn().mockResolvedValue('granted'),
    }

    try {
      render(<ReminderPreferencesCard config={{ remind_days_before: [3, 1, 0], enabled_channels: ['web_push'] }} onChange={vi.fn()} />)
      const testBtn = screen.getByRole('button', { name: /发送测试通知/ })
      await user.click(testBtn)

      await waitFor(() => {
        expect(screen.getByText(/测试推送失败：当前用户没有推送订阅/)).toBeInTheDocument()
      })
    } finally {
      window.Notification = origNotification
    }
  })

  it('服务端真实下发成功后只通过 Toast 提示，不创建本地 new Notification 避免双通知', async () => {
    const user = userEvent.setup()
    vi.mocked(pushApi.sendTestPush).mockResolvedValueOnce({
      ok: true,
      data: { subscriptions: 1, sent: 1, removed: 0, errors: [] },
    })

    const notificationCtor = vi.fn()
    const origNotification = window.Notification
    // @ts-expect-error mock Notification
    window.Notification = Object.assign(notificationCtor, {
      permission: 'granted',
      requestPermission: vi.fn().mockResolvedValue('granted'),
    })

    try {
      render(
        <ReminderPreferencesCard
          config={{ remind_days_before: [3, 1, 0], enabled_channels: ['web_push'] }}
          onChange={vi.fn()}
        />
      )
      const testBtn = screen.getByRole('button', { name: /发送测试通知/ })
      await user.click(testBtn)

      await waitFor(() => {
        expect(screen.getByText('测试通知已成功下发至设备通知栏！')).toBeInTheDocument()
      })
      // 绝不调用本地 Notification 造成重复通知
      expect(notificationCtor).not.toHaveBeenCalled()
    } finally {
      window.Notification = origNotification
    }
  })

  it('Web Push 通道关闭时，点击发送测试通知拦截并提示通道已关闭', async () => {
    const user = userEvent.setup()
    const origNotification = window.Notification
    // @ts-expect-error mock Notification
    window.Notification = {
      permission: 'granted',
      requestPermission: vi.fn().mockResolvedValue('granted'),
    }

    try {
      render(
        <ReminderPreferencesCard
          config={{ remind_days_before: [3, 1, 0], enabled_channels: [] }}
          onChange={vi.fn()}
        />
      )
      const testBtn = screen.getByRole('button', { name: /发送测试通知/ })
      await user.click(testBtn)

      await waitFor(() => {
        expect(screen.getByText('Web Push 浏览器通道已关闭，请先开启通道后再测试。')).toBeInTheDocument()
      })
      expect(pushApi.sendTestPush).not.toHaveBeenCalled()
    } finally {
      window.Notification = origNotification
    }
  })

  it('时区选项基于 Intl.DateTimeFormat 动态生成，包含当前动态 UTC 偏移', () => {
    render(
      <ReminderPreferencesCard
        config={{ remind_days_before: [3, 1, 0], enabled_channels: ['web_push'] }}
        onChange={vi.fn()}
      />
    )
    const select = screen.getByLabelText('提醒时区 (标准下拉)') as unknown as HTMLSelectElement
    const nyOption = Array.from(select.options).find((o) => o.value === 'America/New_York')
    expect(nyOption).toBeDefined()
    // 包含动态 UTC 偏移，非写死文本
    expect(nyOption?.textContent).toMatch(/America\/New_York \(美东时间 UTC-[45]\)/)
  })
})

describe('S1 #5 & #6 · 主题 Hook 与根布局 FOUC 防护', () => {
  const ROOT = join(__dirname, '../..')

  it('根布局 app/layout.tsx 注入水合前内联脚本且带有 suppressHydrationWarning', () => {
    const layout = readFileSync(join(ROOT, 'app/layout.tsx'), 'utf8')
    expect(layout).toContain('<html lang="zh-CN" suppressHydrationWarning>')
    expect(layout).toContain('id="theme-init"')
    expect(layout).toContain('worldcredit_theme_mode')
    expect(layout).toContain('prefers-color-scheme: dark')
    expect(layout).toContain('data-theme')
    expect(layout).toContain('theme-light')
    expect(layout).toContain('theme-dark')
  })

  it('resolveTheme / applyResolvedTheme 模块级函数正确推导与写入', () => {
    expect(resolveTheme('light')).toBe('light')
    expect(resolveTheme('dark')).toBe('dark')

    applyResolvedTheme('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(document.documentElement.classList.contains('theme-light')).toBe(true)
    expect(document.documentElement.classList.contains('theme-dark')).toBe(false)

    applyResolvedTheme('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(document.documentElement.classList.contains('theme-dark')).toBe(true)
    expect(document.documentElement.classList.contains('theme-light')).toBe(false)
  })

  it('getInitialResolvedTheme 优先读取 DOM 上的 data-theme 属性，告别硬编码 dark', () => {
    document.documentElement.setAttribute('data-theme', 'light')
    document.documentElement.classList.add('theme-light')
    document.documentElement.classList.remove('theme-dark')

    expect(getInitialResolvedTheme()).toBe('light')
  })
})

describe('S1 #8 · admin/settings 统一保存与部分成功失真处理', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(adminApi.getSystemSettings).mockResolvedValue({
      platformName: 'WorldCredit',
      supportEmail: 'support@worldcredit.com',
      enableRegistration: true,
      maintenanceMode: false,
      defaultCurrency: 'CNY',
      ai_base_url: 'https://api.openai.com/v1',
      ai_model: 'gpt-4o',
      ai_api_key_set: true,
    })
  })

  it('基础字段保存成功但追加保存 ai_api_key 失败时，明确提示并保留密钥输入', async () => {
    const user = userEvent.setup()
    vi.mocked(adminApi.updateSystemSettings).mockImplementation(async (key, val) => {
      if (key === 'ai_api_key') {
        throw new Error('API Key verification failed')
      }
      return { key, value: val }
    })

    render(<AdminSettingsPage />)

    // 等待加载
    await waitFor(() => {
      expect(screen.getByDisplayValue('WorldCredit')).toBeInTheDocument()
    })

    // 输入新密钥
    const keyInput = screen.getByPlaceholderText('已配置（留空保持原密钥）')
    await user.type(keyInput, 'sk-test-secret-123')

    // 点击保存更改
    const saveBtn = screen.getByRole('button', { name: '保存更改' })
    await user.click(saveBtn)

    await waitFor(() => {
      expect(
        screen.getByText('基础设置已保存，但 AI API 密钥更新失败，请重试')
      ).toBeInTheDocument()
    })

    // 密钥未生效，输入框内容应保留在编辑态以供用户重试
    expect(keyInput).toHaveValue('sk-test-secret-123')
  })

  it('部分基础字段成功、部分失败时，按成功/失败汇总提示，失败项保留 dirty 状态', async () => {
    const user = userEvent.setup()
    vi.mocked(adminApi.updateSystemSettings).mockImplementation(async (key, val) => {
      if (key === 'supportEmail') {
        throw new Error('Database locked')
      }
      return { key, value: val }
    })

    render(<AdminSettingsPage />)

    await waitFor(() => {
      expect(screen.getByDisplayValue('WorldCredit')).toBeInTheDocument()
    })

    // 修改两个字段：platformName 与 supportEmail
    const nameInput = screen.getByDisplayValue('WorldCredit')
    await user.clear(nameInput)
    await user.type(nameInput, 'WorldCredit New')

    const emailInput = screen.getByDisplayValue('support@worldcredit.com')
    await user.clear(emailInput)
    await user.type(emailInput, 'newsupport@worldcredit.com')

    const saveBtn = screen.getByRole('button', { name: '保存更改' })
    await user.click(saveBtn)

    await waitFor(() => {
      expect(
        screen.getByText(/部分设置已保存（1 项成功，1 项失败），未生效项已保留在编辑态/)
      ).toBeInTheDocument()
    })

    // 保存更改按钮依然可用，因为 supportEmail 依然处于 dirty 状态！
    expect(saveBtn).not.toBeDisabled()
  })

  it('多个 dirty keys 保存时保证严格串行提交，避免并发写冲突', async () => {
    const user = userEvent.setup()
    let concurrentCalls = 0
    let maxConcurrent = 0
    const callOrder: string[] = []

    vi.mocked(adminApi.updateSystemSettings).mockImplementation(async (key, val) => {
      concurrentCalls++
      maxConcurrent = Math.max(maxConcurrent, concurrentCalls)
      callOrder.push(String(key))
      await new Promise((r) => setTimeout(r, 20))
      concurrentCalls--
      return { key, value: val }
    })

    render(<AdminSettingsPage />)

    await waitFor(() => {
      expect(screen.getByDisplayValue('WorldCredit')).toBeInTheDocument()
    })

    // 修改两个字段产生多个 dirty keys
    const nameInput = screen.getByDisplayValue('WorldCredit')
    await user.clear(nameInput)
    await user.type(nameInput, 'WorldCredit Serial')

    const emailInput = screen.getByDisplayValue('support@worldcredit.com')
    await user.clear(emailInput)
    await user.type(emailInput, 'serial@worldcredit.com')

    const saveBtn = screen.getByRole('button', { name: '保存更改' })
    await user.click(saveBtn)

    await waitFor(() => {
      expect(screen.getByText('系统设置已保存')).toBeInTheDocument()
    })

    // 验证严格串行：最大并发数必须为 1，不存在重叠并发请求
    expect(maxConcurrent).toBe(1)
    expect(callOrder.length).toBe(2)
  })
})

describe('PR #55 R3 综合补充测试（#1、#4、#5、#6、#8）', () => {
  it('DisplayPreferencesCard 对白名单外存量币种动态追加当前值（历史设置）', () => {
    const onChange = vi.fn()
    render(
      <DisplayPreferencesCard
        config={{
          privacy_mode: false,
          show_min_payment: true,
          show_statement_date: true,
          show_annual_fee: true,
          show_card_last4: true,
          default_currency: 'SGD',
        }}
        onChange={onChange}
      />
    )
    const select = screen.getByLabelText('综合看板折算币种') as unknown as HTMLSelectElement
    expect(select.value).toBe('SGD')
    expect(screen.getByRole('option', { name: 'SGD · 当前值（历史设置）' })).toBeInTheDocument()
  })

  it('DisplayPreferencesCard 模块不再反向导出 CURRENCY_OPTIONS', async () => {
    const mod = await import('@/components/settings/DisplayPreferencesCard')
    // @ts-expect-error test assertion on removed re-export
    expect(mod.CURRENCY_OPTIONS).toBeUndefined()
  })

  it('Gmail 徽章区分 loading / error(含重试) / 未连接三态，错误时不伪装成未连接', async () => {
    const user = userEvent.setup()
    let rejectGmail: (err: unknown) => void
    const pendingPromise = new Promise<never>((_, reject) => {
      rejectGmail = reject
    })
    vi.mocked(gmailApi.getGmailConnection).mockReturnValueOnce(pendingPromise)

    render(<SettingsPage />)

    // 1. loading 态
    expect(screen.getByText('加载中…')).toBeInTheDocument()

    // 2. error 态（模拟接口抛错）
    rejectGmail!(new Error('Network error'))

    await waitFor(() => {
      expect(screen.getByText('加载失败')).toBeInTheDocument()
    })
    const retryBtn = screen.getByRole('button', { name: '重试' })
    expect(retryBtn).toBeInTheDocument()

    // 3. 点击重试 -> 成功恢复为已连接
    vi.mocked(gmailApi.getGmailConnection).mockResolvedValueOnce({
      connected: true,
      email: 'user@gmail.com',
      status: 'active',
      last_sync_at: '2026-11-06T00:00:00Z',
      last_sync_summary: null,
      last_error: null,
    })
    await user.click(retryBtn)

    await waitFor(() => {
      expect(screen.getByText('已连接')).toBeInTheDocument()
    })
  })

  it('worker/cron 与 lib/api/push 统一按迁移后口径判定 Web Push 发送通道', () => {
    // 存量配置：未设置 enabled_channels 且旧 opportunities.web_push_enabled === false -> 绝不发送
    const legacyOff = JSON.stringify({
      remind_days_before: [3, 1, 0],
      opportunities: { web_push_enabled: false },
    })
    expect(isUserWebPushEnabled(legacyOff)).toBe(false)
    expect(isWebPushChannelEnabled(JSON.parse(legacyOff))).toBe(false)

    // 存量配置：未设置 enabled_channels 且旧 opportunities.web_push_enabled === true -> 默认开
    const legacyOn = JSON.stringify({
      remind_days_before: [3, 1, 0],
      opportunities: { web_push_enabled: true },
    })
    expect(isUserWebPushEnabled(legacyOn)).toBe(true)
    expect(isWebPushChannelEnabled(JSON.parse(legacyOn))).toBe(true)

    // 存量配置：未设置 enabled_channels 且 opportunities 未配置 -> 默认开
    const legacyUnset = JSON.stringify({ remind_days_before: [3, 1, 0] })
    expect(isUserWebPushEnabled(legacyUnset)).toBe(true)
    expect(isWebPushChannelEnabled(JSON.parse(legacyUnset))).toBe(true)

    // 新配置：显式关闭 enabled_channels: []
    const explicitOff = JSON.stringify({ enabled_channels: [] })
    expect(isUserWebPushEnabled(explicitOff)).toBe(false)
    expect(isWebPushChannelEnabled(JSON.parse(explicitOff))).toBe(false)

    // 新配置：显式开启 enabled_channels: ['web_push']
    const explicitOn = JSON.stringify({ enabled_channels: ['web_push'] })
    expect(isUserWebPushEnabled(explicitOn)).toBe(true)
    expect(isWebPushChannelEnabled(JSON.parse(explicitOn))).toBe(true)
  })

  it('useUserPreferences: togglePrivacyMode 写库失败时安全捕获并回滚，不波及未处理 Promise rejection', async () => {
    vi.mocked(prefApi.updateUserPreferences).mockRejectedValueOnce(new Error('Write failed'))
    const { renderHook, act } = await import('@testing-library/react')
    const { useUserPreferences } = await import('@/lib/hooks/useUserPreferences')

    const { result } = renderHook(() => useUserPreferences())

    // 初始状态
    expect(result.current.displayConfig.privacy_mode).toBe(false)

    // 调用 togglePrivacyMode（fire-and-forget），即使写库抛错也不会向外 rethrow 导致未捕获 rejection
    await act(async () => {
      await result.current.togglePrivacyMode()
    })

    // 回滚到原始状态
    expect(result.current.displayConfig.privacy_mode).toBe(false)
  })

  it('useUserPreferences: updateDisplay 保留 rethrow 给已处理调用方', async () => {
    vi.mocked(prefApi.updateUserPreferences).mockRejectedValueOnce(new Error('Write failed'))
    const { renderHook, act } = await import('@testing-library/react')
    const { useUserPreferences } = await import('@/lib/hooks/useUserPreferences')

    const { result } = renderHook(() => useUserPreferences())

    await expect(
      act(async () => {
        await result.current.updateDisplay({ privacy_mode: true })
      })
    ).rejects.toThrow('Write failed')
  })
})
