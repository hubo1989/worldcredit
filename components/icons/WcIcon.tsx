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

/** 日历 */
export function CalendarIcon(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="3.5" y="5" width="17" height="16" rx="2" />
      <path d="M3.5 10h17" />
      <path d="M8 3v4M16 3v4" />
      <path d="M8 14h2M14 14h2M8 17.5h2M14 17.5h2" />
    </Base>
  )
}

/** 删除 · 垃圾桶 */
export function TrashIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M4 7h16" />
      <path d="M9.5 7V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2" />
      <path d="M6.5 7l.8 12.1a2 2 0 0 0 2 1.9h5.4a2 2 0 0 0 2-1.9L17.5 7" />
      <path d="M10 11v6M14 11v6" />
    </Base>
  )
}

/** 退出登录 · 门+箭头 */
export function LogoutIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M14 4H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h8" />
      <path d="M10 12h11" />
      <path d="M17.5 8.5 21 12l-3.5 3.5" />
    </Base>
  )
}

/** 搜索 · 放大镜 */
export function SearchIcon(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M15.8 15.8 21 21" />
    </Base>
  )
}

/** 收起/向上 */
export function ChevronUpIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M5 15l7-7 7 7" />
    </Base>
  )
}

/** 剪贴板 · 粘贴 */
export function ClipboardIcon(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1H9V4z" />
      <path d="M9 10h6M9 13.5h6M9 17h4" />
    </Base>
  )
}

/** 邮件 · 信封 */
export function MailIcon(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3.5 7l8.5 6 8.5-6" />
    </Base>
  )
}

/** 全部完成 · 双勾 */
export function DoneAllIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M2 12.5l4.5 4.5L15 8.5" />
      <path d="M9.5 15.5 11 17l8-8" />
    </Base>
  )
}

/** 合并 · 分支汇入 */
export function MergeIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M6 4v3.5c0 2 1 3.8 2.6 5L12 15" />
      <path d="M18 4v3.5c0 2-1 3.8-2.6 5L12 15" />
      <path d="M12 15v5" />
      <circle cx="6" cy="4" r="0.6" fill="currentColor" />
      <circle cx="18" cy="4" r="0.6" fill="currentColor" />
      <circle cx="12" cy="20.5" r="0.6" fill="currentColor" />
    </Base>
  )
}

/** 添加用户 */
export function UserPlusIcon(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="10" cy="8" r="3.5" />
      <path d="M3.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M18.5 8v5M16 10.5h5" />
    </Base>
  )
}

/** 多人 · 持卡人组 */
export function PeopleIcon(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="9" cy="8.5" r="3" />
      <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
      <path d="M16 6.2a3 3 0 0 1 0 5.6" />
      <path d="M17.5 14.2a5.5 5.5 0 0 1 3 4.8" />
    </Base>
  )
}

/** 手机 */
export function PhoneIcon(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="7" y="2.5" width="10" height="19" rx="2" />
      <path d="M11 18.5h2" />
    </Base>
  )
}

/** 火箭 · 启程 */
export function RocketIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12 15c-1.5-3.5-1.5-7.5.5-11 3.5 1.5 5.5 5 5 9l-2.7 2.7a1 1 0 0 1-1.4 0L12 15z" />
      <path d="M12 15c-3.5 1.5-7.5 1.5-8.5.5-.5-2 1-4.5 4-6.5" />
      <path d="M14.5 17.5c0 3-1 4.5-2.5 5-1.5-.5-2.5-2-2.5-5" />
      <circle cx="14" cy="9" r="1.2" />
    </Base>
  )
}

/** 盾牌 · 安全 */
export function ShieldIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12 3l7 2.5v5.5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V5.5L12 3z" />
      <path d="M9 12l2 2 4-4.5" />
    </Base>
  )
}

/** 速度 · 仪表 */
export function GaugeIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M4 17a9 9 0 1 1 16 0" />
      <path d="M12 14l4-4" />
      <circle cx="12" cy="14" r="1.2" fill="currentColor" />
    </Base>
  )
}

/** 钱包 */
export function WalletIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18a1 1 0 0 1 1 1v1.5" />
      <rect x="4" y="7.5" width="17" height="12" rx="2" />
      <path d="M15.5 13.5h2" />
    </Base>
  )
}

/** 上传 · 托盘箭头上 */
export function UploadIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12 16V4" />
      <path d="M7.5 8.5 12 4l4.5 4.5" />
      <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    </Base>
  )
}

/** 下载 · 托盘箭头下 */
export function DownloadIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12 4v12" />
      <path d="M7.5 11.5 12 16l4.5-4.5" />
      <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    </Base>
  )
}

/** 文档 */
export function FileIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M13.5 3v4.5H18" />
      <path d="M9 12h6M9 15.5h6" />
    </Base>
  )
}

/** 外链 · 新窗口 */
export function OpenInNewIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M14 4h6v6" />
      <path d="M20 4l-8.5 8.5" />
      <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </Base>
  )
}

/** 上升趋势 */
export function TrendUpIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M3 17l6-6 4 4 8-8" />
      <path d="M15 7h6v6" />
    </Base>
  )
}

/** 圆叉 · 取消/失效 */
export function XCircleIcon(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9 9l6 6M15 9l-6 6" />
    </Base>
  )
}

/** 圆叹号 · 错误 */
export function AlertCircleIcon(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5V13" />
      <circle cx="12" cy="16.5" r="0.6" fill="currentColor" />
    </Base>
  )
}

/** 纸币 · 金额 */
export function PaymentsIcon(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6 9.5v5M18 9.5v5" />
    </Base>
  )
}

/** 汉堡菜单 */
export function MenuIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M4 6.5h16M4 12h16M4 17.5h16" />
    </Base>
  )
}

/** Google 品牌标识（四色填充，不走 Base 线性体系） */
export function GoogleIcon({ size = 18, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...rest}>
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47a5.54 5.54 0 0 1-2.4 3.63v3.02h3.86c2.26-2.09 3.56-5.17 3.56-8.89z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3.02c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.13A11.99 11.99 0 0 0 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.27A7.2 7.2 0 0 1 4.89 12c0-.79.14-1.55.38-2.27V6.6H1.29a12 12 0 0 0 0 10.8l3.98-3.13z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42A11.98 11.98 0 0 0 12 0 11.99 11.99 0 0 0 1.29 6.6l3.98 3.13C6.22 6.86 8.87 4.75 12 4.75z"
      />
    </svg>
  )
}
