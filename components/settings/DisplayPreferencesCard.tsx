'use client'

import { SettingsIcon } from '@/components/icons/WcIcon'
import type { UserDisplayConfig } from '@/lib/types'
import { CheckRow, Toggle } from '@/components/obsidian/controls'

interface DisplayPreferencesCardProps {
  config: UserDisplayConfig
  onChange: (updates: Partial<UserDisplayConfig>) => void
  disabled?: boolean
}

/** 显示要素与隐私保护（暗色）。props 契约与亮色版一致。 */
export function DisplayPreferencesCard({ config, onChange, disabled }: DisplayPreferencesCardProps) {
  return (
    <div className='rounded-2xl border border-d-border bg-d-surface p-4'>
      <div className='mb-3 flex items-center gap-3'>
        <div className='flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-d-subtle text-d-accent-light'>
          <SettingsIcon size={20} />
        </div>
        <div className='min-w-0 flex-1'>
          <p className='text-[15px] font-bold leading-5 text-d-text'>显示要素与隐私保护</p>
          <p className='mt-0.5 text-[12px] leading-4 text-d-muted'>
            自定义看板遮罩规则与卡片展示字段
          </p>
        </div>
      </div>

      <div className='my-3 border-t border-dashed border-d-border' />

      <div className='flex flex-col gap-3'>
        <div
          className={
            'rounded-xl border p-3 transition-colors ' +
            (config.privacy_mode ? 'border-d-accent bg-d-subtle' : 'border-d-border bg-d-bg')
          }
        >
          <div className='flex items-start justify-between gap-3'>
            <div className='min-w-0 flex-1'>
              <div className='flex flex-wrap items-center gap-2'>
                <p className='text-[13px] font-bold leading-5 text-d-text'>
                  高斯模糊隐私模式 (隐匿敏感金额)
                </p>
                {config.privacy_mode && (
                  <span className='rounded-full bg-d-accent px-2 py-0.5 text-[11px] font-semibold leading-[16px] text-white'>
                    已开启
                  </span>
                )}
              </div>
              <p className='mt-1 text-[11px] leading-4 text-d-muted'>
                开启后，看板与账单列表的敏感金额将通过高斯模糊平滑遮罩
              </p>
            </div>
            <Toggle
              checked={config.privacy_mode}
              onChange={v => onChange({ privacy_mode: v })}
              disabled={disabled}
              ariaLabel='高斯模糊隐私模式'
            />
          </div>
        </div>

        <div>
          <p className='mb-1.5 text-[11px] font-bold text-d-muted'>账单卡片显隐要素定制：</p>
          <div className='flex flex-col gap-2'>
            <CheckRow
              checked={config.show_min_payment}
              onChange={v => onChange({ show_min_payment: v })}
              disabled={disabled}
            >
              最低还款额
            </CheckRow>
            <CheckRow
              checked={config.show_statement_date}
              onChange={v => onChange({ show_statement_date: v })}
              disabled={disabled}
            >
              账单日
            </CheckRow>
            <CheckRow
              checked={config.show_card_last4}
              onChange={v => onChange({ show_card_last4: v })}
              disabled={disabled}
            >
              卡号后4位
            </CheckRow>
          </div>
        </div>
      </div>
    </div>
  )
}
