// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import { ReminderPreferencesCard } from '@/components/settings/ReminderPreferencesCard'
import { TIMEZONE_PRESETS, isTimeInQuietHours } from '@/components/settings/shared'
import type { UserReminderConfig } from '@/lib/types'

describe('ReminderPreferencesCard 提醒时区与推送时间独立配置', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('包含 8 个常用时区预设选项且支持非预设自定义时区回显', () => {
    expect(TIMEZONE_PRESETS).toHaveLength(8)

    const { rerender } = render(
      <ReminderPreferencesCard
        config={{
          remind_days_before: [3, 1, 0],
          enabled_channels: ['web_push'],
          opportunities: {
            enabled: false,
            time_zone: 'Asia/Shanghai',
            local_time: '09:00',
          },
        }}
        onChange={vi.fn()}
      />
    )

    // 即使权益提醒总开关关闭，提醒时区与推送时间顶层区块依然保持可编辑
    const select = screen.getByLabelText('提醒时区') as unknown as HTMLSelectElement
    expect(select).toBeInTheDocument()
    expect(select.disabled).toBe(false)
    for (const preset of TIMEZONE_PRESETS) {
      expect(Array.from(select.options).some((o) => o.value === preset.value)).toBe(true)
    }

    // 自定义非预设时区作为首选项回显
    rerender(
      <ReminderPreferencesCard
        key='custom-tz'
        config={{
          remind_days_before: [3, 1, 0],
          enabled_channels: ['web_push'],
          opportunities: {
            enabled: false,
            time_zone: 'Europe/Paris',
            local_time: '09:00',
          },
        }}
        onChange={vi.fn()}
      />
    )
    const customSelect = screen.getByLabelText('提醒时区') as unknown as HTMLSelectElement
    expect(customSelect.value).toBe('Europe/Paris')
    expect(Array.from(customSelect.options)[0]?.value).toBe('Europe/Paris')
  })

  it('点击「使用当前设备时区」将本机 IANA 时区写入 opportunities.time_zone', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn<(updates: Partial<UserReminderConfig>) => void>()

    const origDateTimeFormat = Intl.DateTimeFormat
    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function (
      this: unknown,
      locale?: string | string[],
      options?: Intl.DateTimeFormatOptions
    ) {
      const real = new origDateTimeFormat(locale, options)
      if (!options?.timeZone && !options?.timeZoneName) {
        return {
          ...real,
          resolvedOptions: () => ({ ...real.resolvedOptions(), timeZone: 'America/New_York' }),
          format: real.format.bind(real),
          formatToParts: real.formatToParts.bind(real),
        } as Intl.DateTimeFormat
      }
      return real
    } as unknown as typeof Intl.DateTimeFormat)

    render(
      <ReminderPreferencesCard
        config={{
          remind_days_before: [3, 1, 0],
          enabled_channels: ['web_push'],
          opportunities: { enabled: true, time_zone: 'Asia/Shanghai', local_time: '09:00' },
        }}
        onChange={onChange}
      />
    )

    await user.click(screen.getByRole('button', { name: '使用当前设备时区' }))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0]?.[0]?.opportunities?.time_zone).toBe('America/New_York')
  })

  it('推送时间落在免打扰时段内时展示顺延提示（含跨午夜与同日区间）', () => {
    expect(isTimeInQuietHours('23:00', '22:00', '08:00')).toBe(true)
    expect(isTimeInQuietHours('07:30', '22:00', '08:00')).toBe(true)
    expect(isTimeInQuietHours('08:00', '22:00', '08:00')).toBe(false)
    expect(isTimeInQuietHours('14:00', '13:00', '15:00')).toBe(true)

    render(
      <ReminderPreferencesCard
        config={{
          remind_days_before: [3, 1, 0],
          enabled_channels: ['web_push'],
          quiet_hours_start: '22:00',
          quiet_hours_end: '08:00',
          opportunities: { enabled: true, time_zone: 'Asia/Shanghai', local_time: '23:00' },
        }}
        onChange={vi.fn()}
      />
    )

    expect(screen.getByRole('status')).toHaveTextContent(
      '该时刻位于免打扰时段（22:00–08:00）内，推送将顺延至免打扰结束（08:00）后发出。'
    )
  })

  it('免打扰起止为空字符串时按关闭处理，不显示顺延提示且文案区分每日账单与权益提醒', () => {
    render(
      <ReminderPreferencesCard
        config={{
          remind_days_before: [3, 1, 0],
          enabled_channels: ['web_push'],
          quiet_hours_start: '',
          quiet_hours_end: '',
          opportunities: { enabled: true, time_zone: 'Asia/Shanghai', local_time: '23:00' },
        }}
        onChange={vi.fn()}
      />
    )

    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByText(/每日账单汇总与逾期提醒由服务端按调度计划推送/)).toBeTruthy()
  })
})
