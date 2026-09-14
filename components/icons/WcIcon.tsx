'use client'

import type { SVGProps } from 'react'

/**
 * WorldCredit SVG 线性图标库。
 * 统一 1.6px stroke，currentColor，24x24 viewBox。
 * 用于底部导航、金刚区、状态徽章、列表项等。禁用 emoji。
 */

type IconProps = Omit<SVGProps<SVGSVGElement>, 'strokeWidth'> & {
  size?: number
}

function Base({ size = 24, strokeWidth = 1.6, children, ...rest }: IconProps & { children: React.ReactNode; strokeWidth?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  )
}

/** 首页 · 统计看板 */
export function HomeIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5" />
      <path d="M9.5 21v-6h5v6" />
    </Base>
  )
}

/** 账单 · 列表 */
export function BillsIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M6 3h9l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M14 3v5h5" />
      <path d="M8.5 13h7" />
      <path d="M8.5 16.5h7" />
      <path d="M8.5 9.5h3" />
    </Base>
  )
}

/** 我的 · 用户 */
export function MineIcon(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </Base>
  )
}

/** 记一笔 · 编辑/铅笔 */
export function NoteIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M4 20h4l10.5-10.5a2.121 2.121 0 0 0-3-3L5 17v3z" />
      <path d="M13.5 6.5l3 3" />
    </Base>
  )
}

/** 优惠 · 标签 */
export function PromoIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M3 12.5 11 4.5h7.5a1 1 0 0 1 1 1V13l-8 8a1.5 1.5 0 0 1-2.12 0l-5.38-5.38a1.5 1.5 0 0 1 0-2.12z" />
      <circle cx="15.5" cy="8.5" r="1.4" />
    </Base>
  )
}

/** 权益 · 礼物/奖杯 */
export function BenefitIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M4 9h16v4a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V9z" />
      <path d="M4 9a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3" />
      <path d="M12 6v11" />
      <path d="M8 9c-1.2-1-1.2-3 .5-3M16 9c1.2-1 1.2-3-.5-3" />
      <path d="M9 21h6" />
    </Base>
  )
}

/** 导入账单 · 邮件/同步 */
export function ImportIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M4 6h16v12H4z" />
      <path d="M4 7l8 6 8-6" />
    </Base>
  )
}

/** 同步/刷新 */
export function SyncIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M4 12a8 8 0 0 1 13.66-5.66L20 8" />
      <path d="M20 4v4h-4" />
      <path d="M20 12a8 8 0 0 1-13.66 5.66L4 16" />
      <path d="M4 20v-4h4" />
    </Base>
  )
}

/** 银行 · 建筑 */
export function BankIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M3 9l9-5 9 5" />
      <path d="M4 9v8" />
      <path d="M20 9v8" />
      <path d="M8 9v8" />
      <path d="M12 9v8" />
      <path d="M16 9v8" />
      <path d="M3 20h18" />
    </Base>
  )
}

/** 信用卡 */
export function CardIcon(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 10h18" />
      <path d="M7 15h4" />
    </Base>
  )
}

/** 用户/持卡人 */
export function UserIcon(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </Base>
  )
}

/** 设置 · 齿轮 */
export function SettingsIcon(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" />
    </Base>
  )
}

/** 提醒 · 钟 */
export function BellIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6z" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </Base>
  )
}

/** 警告/逾期 · 三角 */
export function AlertIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12 3 2.5 20h19L12 3z" />
      <path d="M12 10v5" />
      <circle cx="12" cy="17.5" r="0.6" fill="currentColor" />
    </Base>
  )
}

/** 已还清 · 勾 */
export function CheckIcon(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12.5l2.5 2.5 5-5.5" />
    </Base>
  )
}

/** 时钟 · 待还 */
export function ClockIcon(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </Base>
  )
}

/** 右箭头 */
export function ChevronRightIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M9 5l7 7-7 7" />
    </Base>
  )
}

/** 左箭头 */
export function ChevronLeftIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M15 5l-7 7 7 7" />
    </Base>
  )
}

/** 加号 */
export function PlusIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12 5v14M5 12h14" />
    </Base>
  )
}

/** 关闭/X */
export function CloseIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Base>
  )
}

/** AI · 星花（金色） */
export function AiSparkleIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" />
      <path d="M19 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2z" />
    </Base>
  )
}

/** 眼睛 · 显示 */
export function EyeIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </Base>
  )
}

/** 眼睛关闭 · 隐藏 */
export function EyeOffIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M3 3l18 18" />
      <path d="M10.6 6.1A10.9 10.9 0 0 1 12 6c6 0 10 7 10 7a18 18 0 0 1-3.2 3.9" />
      <path d="M6.1 6.1A18 18 0 0 0 2 12s4 7 10 7a10.9 10.9 0 0 0 3.4-.5" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </Base>
  )
}

/** 附件 */
export function PaperclipIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M21 11.5 12.5 20a5 5 0 0 1-7-7L14 4.5a3.5 3.5 0 0 1 5 5L10.5 18a2 2 0 0 1-3-3l7-7" />
    </Base>
  )
}

/** 展开/向下 */
export function ChevronDownIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M5 9l7 7 7-7" />
    </Base>
  )
}

/** 重试 */
export function RetryIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M4 4v6h6" />
      <path d="M4 10a8 8 0 1 1-1.5 5" />
    </Base>
  )
}

/** 筛选 · 滑杆 */
export function FilterIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M4 7h9" />
      <path d="M19 7h1" />
      <circle cx="16" cy="7" r="2" />
      <path d="M4 12h3" />
      <path d="M13 12h7" />
      <circle cx="10" cy="12" r="2" />
      <path d="M4 17h9" />
      <path d="M19 17h1" />
      <circle cx="16" cy="17" r="2" />
    </Base>
  )
}

/** 排序 · 双向箭头 */
export function SortIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M7 20V4" />
      <path d="M3.5 16.5 7 20l3.5-3.5" />
      <path d="M17 4v16" />
      <path d="M13.5 7.5 17 4l3.5 3.5" />
    </Base>
  )
}
