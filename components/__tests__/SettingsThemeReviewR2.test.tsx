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
import AdminSettingsPage from '@/app/admin/settings/page'

vi.mock('@/lib/api/push', () => ({
  sendTestPush: vi.fn(),
  subscribePush: vi.fn(),
}))

vi.mock('@/lib/api/admin', () => ({
  getSystemSettings: vi.fn(),
  updateSystemSettings: vi.fn(),
}))

describe('S1 #1 & #2 & #3 & #4 · ReminderPreferencesCard 行为回归', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
})
