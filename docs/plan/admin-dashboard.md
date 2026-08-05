# 管理员控制台仪表盘实施计划

> 创建时间：2026-03-24  
> 状态：已实现，待验证

## 1. 背景与目标

WorldCredit 当前仅有移动端用户界面（`(mobile)` 路由组）。管理员登录后需要一个**桌面端控制台**页面，以总览平台运营数据，而非具体用户维度的持卡人/账单信息。

### 管理员关注点（区别于普通用户）

| 维度 | 管理员视角 | 用户视角 |
|------|-----------|---------|
| 用户 | 注册总数、活跃趋势 | 自己的持卡人档案 |
| 信用卡 | 卡产品目录、开卡量 | 自己的卡片明细 |
| 账单 | ~~不关注~~ | 应还金额、逾期提醒 |
| 优惠 | 活动管理、使用量 | 可用优惠列表 |
| 权益 | 各产品权益使用率 | 个人权益剩余 |

## 2. 技术方案

### 2.1 路由结构

```
app/
├── layout.tsx              # 全局根布局（ThemeRegistry + AuthProvider）
├── login/page.tsx          # 登录页（登录后跳转 /admin）
├── (mobile)/               # 用户移动端路由组
│   ├── layout.tsx          # MobileShell
│   └── page.tsx            # 用户首页
└── admin/                  # 管理员控制台路由
    ├── layout.tsx          # AdminShell 布局容器
    └── page.tsx            # Dashboard 主页面
```

> 采用 `/admin` 独立路径而非 `(admin)` 路由组，避免与 `(mobile)` 在 `/` 路径冲突。

### 2.2 Dashboard 页面模块

```
┌────────────────────────────────────────────────────────┐
│ Sidebar  │  顶栏：仪表盘                     日期      │
│          │─────────────────────────────────────────────│
│ 仪表盘   │                                             │
│ 卡产品   │  [注册用户] [卡产品数] [活跃卡] [进行中活动] │
│ 优惠活动 │                                             │
│ 权益管理 │  ┌─────────────────────┬──────────────────┐ │
│ 系统设置 │  │ 信用卡产品目录       │ 近7天用户活跃度   │ │
│          │  │ (表格)              │ (列表)           │ │
│          │  └─────────────────────┴──────────────────┘ │
│          │  ┌──────────────┬─────────────────────────┐ │
│          │  │ 优惠活动     │ 权益使用概览             │ │
│          │  └──────────────┴─────────────────────────┘ │
│  用户头像│                                             │
└────────────────────────────────────────────────────────┘
```

### 2.3 配色方案

- 整体背景：`#0f1117`（深灰黑）
- 侧边栏：`#13151d`
- 卡片背景：`#181a24`
- 边框：`rgba(255,255,255,0.06)`
- 主文字：`#e4e6eb`
- 辅助文字：`#6b7280`
- 主题色：`#818cf8`（靛蓝）/ `#34d399`（绿）/ `#fbbf24`（橙）/ `#f472b6`（粉）

## 3. 文件清单

### 3.1 数据层

#### [NEW] `lib/api/dashboard.ts`

提供 5 个聚合查询函数：

| 函数 | 用途 | 查询表 |
|------|------|--------|
| `getDashboardStats()` | 平台概数：用户数、卡产品数、活跃卡数、权益使用次数、进行中活动数 | card_holders, card_products, credit_cards, benefit_usages, promos |
| `getUserActivity()` | 近 7 天活跃度：新增用户、还款次数、开卡次数、权益使用次数 | card_holders, payments, credit_cards, benefit_usages |
| `getCardProductStats()` | 卡产品列表 + 各产品开卡数 | card_products, credit_cards |
| `getPromoList()` | 优惠活动列表 + 使用次数 + 是否进行中 | promos, promo_usages |
| `getBenefitStats()` | 权益列表 + 使用次数 + 关联产品名 | benefits, card_products, benefit_usages |

### 3.2 组件层

#### [NEW] `components/admin/AdminShell.tsx`

控制台布局外壳：
- 固定侧边栏 260px，深色背景
- 导航项：仪表盘 / 卡产品管理 / 优惠活动 / 权益管理 / 系统设置
- 顶栏：页面标题 + 当前日期
- 底部：用户邮箱 + 退出登录
- 支持侧边栏折叠

#### [NEW] `components/admin/StatCard.tsx`

统计数字卡片：图标 + 数值 + 标签 + 可选趋势副标题。四种颜色主题。

#### [NEW] `components/admin/UserActivityStats.tsx`

近 7 天活跃度面板：列表形式展示新增用户、还款操作、新开卡、权益使用四项计数。

#### [NEW] `components/admin/CardProductOverview.tsx`

卡产品目录表格：银行 | 卡片名称 | 币种 | 年费 | 年费减免 | 开卡数。

#### [NEW] `components/admin/PromoOverview.tsx`

优惠活动列表：标题、银行、折扣类型标签（满减/折扣/积分/返现）、截止日期、使用次数、活跃状态。

#### [NEW] `components/admin/BenefitOverview.tsx`

权益使用概览：权益名、周期标签（年度/月度/一次性）、使用/配额进度条、关联产品。

### 3.3 路由层

#### [NEW] `app/admin/layout.tsx`

引入 `AdminShell` 作为布局容器。

#### [NEW] `app/admin/page.tsx`

Dashboard 主页面，使用 MUI Grid 响应式布局：
- 第一行：4 个 StatCard（xs:12 sm:6 lg:3）
- 第二行：CardProductOverview（lg:8）+ UserActivityStats（lg:4）
- 第三行：PromoOverview（lg:6）+ BenefitOverview（lg:6）

### 3.4 修改文件

#### [MODIFY] `app/login/page.tsx`

登录成功后跳转从 `/` 改为 `/admin`。

## 4. 验证计划

1. 启动 dev server，访问 `http://credit.localhost:1355/admin`
2. 确认深色控制台布局：侧边栏、顶栏、内容区三部分正确呈现
3. 确认统计卡片显示数据库真实数据
4. 确认卡产品表格、优惠列表、权益概览渲染无误
5. 确认侧边栏折叠/展开功能正常
6. 确认退出登录功能正常
7. 确认桌面宽度下无溢出/遮挡问题
