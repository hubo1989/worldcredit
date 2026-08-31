---
name: WorldCredit
description: 家庭信用卡管理 PWA —— 账单、还款、权益、优惠的家庭财务台面
colors:
  primary: "#1976d2"
  primary-dark: "#1565c0"
  primary-deep: "#0d47a1"
  ink-navy: "#030059"
  gradient-purple: "#9c27b0"
  mist-bg: "#F5F8FF"
  surface: "#FFFFFF"
  text-body: "#333333"
  text-secondary: "#636363"
  text-disabled: "#999999"
  border-light: "#DDDDDD"
  success: "#2e7d32"
  warning: "#ed6c02"
  danger: "#d32f2f"
  info: "#0277bd"
  admin-night: "#181a24"
  admin-panel: "#1e2028"
  admin-indigo: "#4f46e5"
  admin-indigo-deep: "#4338ca"
  admin-indigo-light: "#818cf8"
  admin-ink: "#e4e6eb"
  admin-muted: "#9ca3af"
  amber-accent: "#f59e0b"
  emerald: "#10b981"
  rose: "#f43f5e"
  sky-on-navy: "#A2C6FF"
  ink-slate: "#1F2937"
  card-gradient-deep: "#004f78"
typography:
  display:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, PingFang SC, HarmonyOS Sans SC, MiSans, Noto Sans SC Variable, Noto Sans SC, Microsoft YaHei, sans-serif"
    fontSize: "clamp(2.5rem, 6vw, 4.5rem)"
    fontWeight: 800
    lineHeight: 1.2
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, PingFang SC, HarmonyOS Sans SC, MiSans, Noto Sans SC Variable, Noto Sans SC, Microsoft YaHei, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.35
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, PingFang SC, HarmonyOS Sans SC, MiSans, Noto Sans SC Variable, Noto Sans SC, Microsoft YaHei, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, PingFang SC, HarmonyOS Sans SC, MiSans, Noto Sans SC Variable, Noto Sans SC, Microsoft YaHei, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 700
rounded:
  xs: "3px"
  sm: "5px"
  md: "8px"
  lg: "10px"
  pill: "12px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "24px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "#ffffff"
    rounded: "{rounded.xs}"
    height: "40px"
  button-primary-hover:
    backgroundColor: "{colors.primary-dark}"
  button-text:
    textColor: "{colors.primary-dark}"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-body}"
    rounded: "{rounded.sm}"
    padding: "24px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-body}"
    rounded: "{rounded.sm}"
    height: "40px"
  chip:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary}"
    rounded: "{rounded.pill}"
---

# Design System: WorldCredit

## Overview

**Creative North Star: "家庭财务的仪表台"（The Family Ledger Console）**

WorldCredit 是家庭自用的信用卡管理工具：一个管理员在手机 PWA 上打理全家的账单、还款、权益和优惠，在桌面管理后台维护银行/卡产品目录。视觉体系服务于「可信、清晰、不焦虑地看钱」：亮色世界（移动端 + 落地页）以品牌蓝 #1976d2 为唯一主色，深藏青 #030059 做文字锚点；暗色世界（管理后台）是独立主题的深色运营台，靛蓝做行动色。色彩用量克制——蓝只属于动作、选中和状态，渐变只属于信用卡视觉和落地页一个瞬间。

> 历史：2026-08 之前代码中并存三套视觉世界（声明主题「疗养中心藏青」、移动端 MUI 默认蓝、管理端硬编码暗色）。本次统一以移动端蓝为基底收敛为双主题体系（`lib/theme.ts` 的 lightTheme + adminDarkTheme），三世界详情见 git 历史中的 DESIGN.md 版本。

**Key Characteristics:**

- 双主题：全局亮色（lightTheme）+ 管理后台暗色（adminDarkTheme，独立 ThemeProvider），取色一律走 MUI token
- 中文优先字体体系：系统 Latin → 原生 CJK（苹方/鸿蒙/小米）→ 真实加载的 Noto Sans SC Variable（@fontsource-variable，unicode-range 子集按需下载）→ 雅黑兜底
- WCAG AA 为硬底线：主色填充 #1976d2 白字 4.6:1；主色作文字用 primary-dark #1565c0（雾底上 5.4:1）
- 语义状态色承担账单语言：待还/部分/已还/逾期各有固定色，不只靠色相区分
- 隐私本能：金额支持 `.privacy-blur` 打码
- 单组件库 MUI v7；无第二套 UI 库

## Colors

冷静可信的蓝色系工具台面：雾蓝底上白卡片，一个行动蓝，状态色只出现在账单和开关上。

### Primary
- **品牌蓝 Brand Blue** (#1976d2)：主色，只用于填充——按钮底、开关、进度、选中态。白字其上 4.6:1（AA ✓）。viewport themeColor 同色。
- **品牌深蓝 Brand Blue Deep** (#1565c0)：主色作文字/描边时的强制档位——文字按钮、链接、outline 描边。雾底 #F5F8FF 上 5.4:1（AA ✓）。hover 深档 #0d47a1。

### Secondary
- **墨藏青 Ink Navy** (#030059)：文字锚点与品牌印记——标题、底部导航激活态、管理端侧边栏底、focus outline。白底上 ≈15:1。
- **渐变紫 Gradient Purple** (#9c27b0)：唯一装饰色，只出现在落地页标题渐变（`90deg, #1976d2 → #9c27b0`）的尾端。

### Neutral
- **雾底 Mist** (#F5F8FF)：全局背景；**面板白 Surface** (#FFFFFF)：卡片、输入框、底栏；**正文灰 Text Body** (#333333)：主文字；**次级灰 Text Secondary** (#636363)：说明文字（白底 6.0:1 ✓）；**分隔线 Border Light** (#DDDDDD)：1px 边框与分隔。

### Semantic / Status
- **成功绿** (#2e7d32，白字 5.1:1)：已结清、权益已用尽、开关开启
- **警告橙** (#ed6c02，配墨藏青文字 5.9:1)：待还、临期
- **错误红** (#d32f2f，白字 5.0:1)：逾期、删除、失败
- **信息蓝** (#0277bd，白字 4.6:1)：部分还款、提示

### 管理后台暗色世界（adminDarkTheme，仅在 /admin 生效）
- **夜色底 Night** (#181a24) / **面板 Panel** (#1e2028)：两级表面
- **面板字 Ink** (#e4e6eb，12:1 ✓) / **次级字 Muted** (#9ca3af，6.8:1 ✓)：文字两档
- **管理靛蓝 Admin Indigo**：填充用 #4f46e5（白字 6.3:1 ✓），hover #4338ca；暗底上的靛蓝文字/图标用 light 档 #818cf8（5.8:1 ✓）
- 语义色适配暗底：成功 #10b981、警告 #f59e0b、错误 #f87171（暗底文字 5.9:1）

### Named Rules

**The One Blue Rule.** 亮色世界只有一个主色 #1976d2。填充用 main 档，文字/描边一律降到 dark 档 #1565c0——这是 AA 的机械保证，不逐处争论。

**The Two-Worlds Rule.** 亮色主题与暗色主题是两套独立构图，不是明暗互转；管理端配色只经由 adminDarkTheme 的 token 表达，禁止在页面里硬编码色值。

## Typography

**字体栈（全站唯一，`lib/theme.ts` fontStack）：** `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "HarmonyOS Sans SC", "MiSans", "Noto Sans SC Variable", "Noto Sans SC", "Microsoft YaHei", sans-serif`

**加载方式：** `@fontsource-variable/noto-sans-sc` 在 ThemeRegistry 中 import，Vite 打包，unicode-range 子集按需下载；装有原生 CJK（macOS/鸿蒙/小米/Windows 雅黑）的设备直接用原生字体，其余平台回退 Noto Sans SC。

**Character:** 系统原生优先、网页字体兜底的实用主义组合——中文渲染永远清晰，不赌网络。CJK 不使用斜体和 300 以下字重。

### Hierarchy
- **Display**（800，clamp 2.5rem–4.5rem，1.2）：仅落地页主标题（渐变填充）
- **Title**（600，1.5rem±，1.35）：页面与卡片标题；金额数字同权重、建议 tabular-nums
- **Body**（400，14–16px，1.6）：列表、表单、说明；表单输入 ≥16px 防 iOS 聚焦缩放
- **Label**（700，12px）：Chip、状态徽标、表单标签

### Named Rules

**The Loaded-Font Rule.** 字体必须「声明 + 真实加载」成对出现；`fontFamily` 里出现的名字要么有 @font-face/包来源，要么从栈里删掉。

## Layout

双外壳：移动端单列 + 底部 TabBar（首页/持卡人/账单/优惠），页面纵向滚动；管理端 260px 藏青侧边栏（可折叠，paper 以 transform 平移动画，内容区瞬时重排）+ 顶栏 + 内容区。断点以 MUI `sx` 的 xs/md 粒度响应；管理端面向桌面属设计意图。间距走 MUI 8px 网格，卡片内边距 16–24px。

## Elevation & Depth

低浮雕：亮色世界白卡 + 1px #DDDDDD 边 + `0 2px 4px rgba(0,0,0,0.08)` 微影；暗色世界以表面明度差（#181a24 → #1e2028）+ 1px `rgba(255,255,255,0.08)` 分隔表达层级，几乎不用阴影。阴影只在浮层（菜单、对话框）出现。

## Shapes

圆角五档：按钮 3px、卡片/输入 5px、管理端面板 8px、对话框/英雄卡 10px、Chip 12px。小圆角工具感。边框语言：亮色 1px #DDDDDD，暗色 1px rgba(255,255,255,0.08)。禁止 >1px 的单侧彩色边条（side-tab）。

## Components

### Buttons
- **Shape:** 3px 圆角、40px 高、无阴影
- **Primary:** #1976d2 底白字，hover #1565c0；文字按钮/outline 用 #1565c0 字
- **Focus:** 2px #030059 outline + 2px offset（管理端 2px #818cf8）
- **Disabled:** MUI 默认灰

### Cards / Containers
- **Corner Style:** 5px（亮）/ 8px（暗）
- **Background:** #FFFFFF（亮）/ #181a24、#1e2028（暗）
- **Border:** 1px #DDDDDD（亮）/ 1px rgba(255,255,255,0.08)（暗）
- **Internal Padding:** 16–24px

### Inputs / Fields
- **Style:** MUI OutlinedInput，白底、#CCCCCC 描边、40px 高、输入 ≥16px
- **Focus:** 主色描边 + 3px rgba(25,118,210,0.15) 光晕；管理端走暗色主题默认

### Navigation
- **移动端底部 TabBar:** 白底，激活 #030059，未激活 #636363
- **管理端:** 藏青 #030059 侧边栏，选中项 #4f46e5 底白字；顶栏 background.paper + text.primary

### 信用卡视觉（Signature）
135° 藏青→深青渐变卡面（`#030059 → #004f78`，尾色深度保证天蓝说明字 ≥5:1），大圆角白字；银行品牌色表见 CreditCardVisual（数据性用色，不进体系）。

### 状态徽标（Chips）
语义色底 + AA 校验文字色；待还=警告橙（配墨藏青字）、已结清=成功绿、逾期=错误红、部分=信息蓝。状态永远带文字，不只靠颜色。

## Do's and Don'ts

### Do:

- **Do** 一律从 `lib/theme.ts` 的两个主题取 token（`primary.main`、`background.paper`、`success.main`…）
- **Do** 主色填充用 `primary.main`，主色文字/描边用 `primary.dark`（The One Blue Rule）
- **Do** 账单状态走语义 token：unpaid→warning、paid→success、overdue→error、partial→info，且附文字标签
- **Do** 金额、日期用 tabular-nums；金额界面提供 privacy-blur
- **Do** 动画只用 transform/opacity（如侧边栏 paper 平移），200–300ms ease-out

### Don't:

- **Don't** 在页面组件里硬编码十六进制色值（检测器的 design-system-color advisory 就是这个债）
- **Don't** 白字配浅蓝底（#A2C6FF/#7AADFF 均不达 AA）；主色文字勿用 main 档压雾底
- **Don't** CJK 用 300 字重或斜体（合成渲染发虚）
- **Don't** 用 width/height/margin 做动画
- **Don't** 给管理端页面内联覆盖暗色配色——它已经属于 adminDarkTheme
