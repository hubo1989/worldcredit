export interface CurrencyOption {
  value: string
  label: string
}

export const CURRENCY_OPTIONS: CurrencyOption[] = [
  { value: 'CNY', label: 'CNY · 人民币 (¥)' },
  { value: 'USD', label: 'USD · 美元 ($)' },
  { value: 'HKD', label: 'HKD · 港币 (HK$)' },
  { value: 'JPY', label: 'JPY · 日元 (円)' },
  { value: 'EUR', label: 'EUR · 欧元 (€)' },
  { value: 'GBP', label: 'GBP · 英镑 (£)' },
]
