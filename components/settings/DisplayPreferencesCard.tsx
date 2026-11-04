'use client'

import type { UserDisplayConfig } from '@/lib/types'
import { Toggle } from '@/components/obsidian/controls'

interface DisplayPreferencesCardProps {
  config: UserDisplayConfig
  onChange: (updates: Partial<UserDisplayConfig>) => void
  disabled?: boolean
}

const CURRENCY_OPTIONS = [
  { value: 'CNY', label: 'CNY · 人民币 (¥)' },
  { value: 'USD', label: 'USD · 美元 ($)' },
  { value: 'HKD', label: 'HKD · 港币 (HK$)' },
  { value: 'JPY', label: 'JPY · 日元 (円)' },
  { value: 'EUR', label: 'EUR · 欧元 (€)' },
  { value: 'GBP', label: 'GBP · 英镑 (£)' },
]

/** 显示要素与币种偏好抽屉（移动端 BottomSheet 内置）。零硬编码色值，使用 d-* 令牌。 */
export function DisplayPreferencesCard({ config, onChange, disabled }: DisplayPreferencesCardProps) {
  return (
    <div className='flex flex-col gap-4 text-d-text'>
      {/* 隐私模式卡片 */}
      <div className='rounded-2xl border border-d-border bg-d-subtle/50 p-4'>
        <div className='flex min-h-[44px] items-center justify-between gap-3'>
          <div className='min-w-0 flex-1'>
            <div className='flex items-center gap-2'>
              <p className='text-[15px] font-semibold leading-5 text-d-text'>高斯模糊隐私模式</p>
              {config.privacy_mode && (
                <span className='rounded-full bg-d-accent/20 px-2 py-0.5 text-[11px] font-semibold text-d-accent-light border border-d-accent/30'>
                  已开启
                </span>
              )}
            </div>
            <p className='mt-1 text-[12px] leading-4 text-d-muted'>
              在看板及账单列表平滑遮罩敏感金额，防止公开场合被窥视
            </p>
          </div>
          <Toggle
            checked={config.privacy_mode}
            onChange={(v) => onChange({ privacy_mode: v })}
            disabled={disabled}
            ariaLabel='高斯模糊隐私模式'
          />
        </div>
      </div>

      {/* 开放字段：default_currency 目标折算币种 */}
      <div className='rounded-2xl border border-d-border bg-d-subtle/50 p-4'>
        <div className='mb-2 flex items-center justify-between'>
          <label htmlFor='default-currency-select' className='text-[14px] font-semibold text-d-text'>
            综合看板折算币种
          </label>
          <span className='inline-flex items-center rounded border border-d-gold-deep/50 bg-d-gold-soft px-1.5 py-0.5 text-[10px] font-bold text-d-gold'>
            开放字段
          </span>
        </div>
        <select
          id='default-currency-select'
          value={config.default_currency || 'CNY'}
          onChange={(e) => onChange({ default_currency: e.target.value })}
          disabled={disabled}
          className='min-h-[44px] w-full rounded-xl border border-d-border bg-d-bg px-3 text-[16px] text-d-text outline-none transition-colors focus:border-d-accent disabled:opacity-50'
        >
          {CURRENCY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value} className='bg-d-surface text-d-text'>
              {opt.label}
            </option>
          ))}
        </select>
        <p className='mt-2 text-[12px] leading-4 text-d-muted'>
          所有持卡人的外币消费与未出账明细将实时折算为该基础币种，便于全局资产概览。
        </p>
      </div>

      {/* 账单卡片显隐要素定制（含开放的 show_annual_fee） */}
      <div className='rounded-2xl border border-d-border bg-d-subtle/50 p-4'>
        <p className='mb-3 text-[14px] font-semibold text-d-text'>账单卡片字段定制：</p>
        <div className='flex flex-col divide-y divide-d-border/60'>
          {/* 最低还款额 */}
          <div className='flex min-h-[48px] items-center justify-between py-2'>
            <div>
              <p className='text-[14px] font-medium text-d-text'>最低还款额</p>
              <p className='text-[12px] text-d-muted'>卡片显示最低还款额度提示</p>
            </div>
            <Toggle
              checked={config.show_min_payment}
              onChange={(v) => onChange({ show_min_payment: v })}
              disabled={disabled}
              ariaLabel='最低还款额'
            />
          </div>

          {/* 账单日 */}
          <div className='flex min-h-[48px] items-center justify-between py-2'>
            <div>
              <p className='text-[14px] font-medium text-d-text'>账单日</p>
              <p className='text-[12px] text-d-muted'>卡片展示每月出账日期</p>
            </div>
            <Toggle
              checked={config.show_statement_date}
              onChange={(v) => onChange({ show_statement_date: v })}
              disabled={disabled}
              ariaLabel='账单日'
            />
          </div>

          {/* 卡号后 4 位 */}
          <div className='flex min-h-[48px] items-center justify-between py-2'>
            <div>
              <p className='text-[14px] font-medium text-d-text'>卡号后 4 位</p>
              <p className='text-[12px] text-d-muted'>展示末四位尾号用于快速核对</p>
            </div>
            <Toggle
              checked={config.show_card_last4}
              onChange={(v) => onChange({ show_card_last4: v })}
              disabled={disabled}
              ariaLabel='卡号后 4 位'
            />
          </div>

          {/* 开放字段：show_annual_fee */}
          <div className='flex min-h-[48px] items-center justify-between py-2'>
            <div>
              <div className='flex items-center gap-1.5'>
                <p className='text-[14px] font-medium text-d-text'>卡片年费信息</p>
                <span className='inline-flex items-center rounded border border-d-gold-deep/50 bg-d-gold-soft px-1.5 py-0.5 text-[10px] font-bold text-d-gold'>
                  开放字段
                </span>
              </div>
              <p className='text-[12px] text-d-muted'>常驻年费收取周期与减免达标进度</p>
            </div>
            <Toggle
              checked={config.show_annual_fee ?? false}
              onChange={(v) => onChange({ show_annual_fee: v })}
              disabled={disabled}
              ariaLabel='卡片年费信息'
            />
          </div>
        </div>
      </div>
    </div>
  )
}
