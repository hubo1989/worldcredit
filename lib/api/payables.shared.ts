// lib/api/payables.shared.ts — 周期应付的纯类型与纯函数（无数据库依赖）。
//
// 放在 .shared 而不是 .server：界面上要显示类型标签（房租/贷款），如果从
// .server 模块取这个纯函数，就会把 D1 相关的 import 链一起拖进浏览器包
// （与 preferences.shared.ts 同样的边界约定）。

export type PayableCategory = 'rent' | 'loan' | 'utility' | 'insurance' | 'other'

const CATEGORY_LABELS: Record<PayableCategory, string> = {
  rent: '房租',
  loan: '贷款',
  utility: '水电物业',
  insurance: '保险',
  other: '其他',
}

export function categoryLabel(category: PayableCategory): string {
  return CATEGORY_LABELS[category] ?? CATEGORY_LABELS.other
}

export const PAYABLE_CATEGORIES: { value: PayableCategory; label: string }[] = (
  Object.keys(CATEGORY_LABELS) as PayableCategory[]
).map(value => ({ value, label: CATEGORY_LABELS[value] }))
