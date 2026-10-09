# WorldCredit — 技术交接文档

## 1. 项目概述

家庭信用卡管理 PWA：帮助一个管理员统一管理多个家庭成员的信用卡账单、还款、权益和优惠活动。有移动端用户界面（H5/PWA）和桌面端管理后台两套 UI。

---

## 2. 技术栈

| 层级 | 技术 | 版本/说明 |
|------|------|----------|
| 框架 | vinext | Next.js App Router 的 Vite 实现（`^0.0.32`） |
| UI 框架 | React 19 + React DOM 19 | |
| UI 组件库 | ObsidianUI（自建暗色体系） | d-* token（Tailwind v4 `@theme`），组件在 `components/obsidian/` |
| 图标 | 自建 WcIcon 线性图标集 | |
| 运行时 | Cloudflare Workers | vinext 构建，`worker/index.ts` 为入口 |
| 数据库 | Cloudflare D1（SQLite） | 通过 `lib/db/` 的 `getDb()` 取 binding |
| 对象存储 | Cloudflare R2 | `worldcredit-attachments` 桶（账单附件） |
| 日期处理 | date-fns | v4 |
| 构建工具 | Vite 7 + @vitejs/plugin-rsc | |
| PWA | vite-plugin-pwa | v1（manifest/service worker） |
| 开发语言 | TypeScript 5 | strict 模式 |
| 路径别名 | `@/*` → 项目根目录 | |

启动方式：`portless credit --app-port 3050 -- vinext dev -H 0.0.0.0 -p 3050`

访问地址：`http://credit.localhost:3050`（需要 portless 工具）

---

## 3. 目录结构

```
worldcredit/
├── app/                        # App Router 路由
│   ├── layout.tsx              # 根布局：ThemeRegistry + AuthProvider
│   ├── page.tsx                # 落地页（未登录用户的宣传首页）
│   ├── login/page.tsx          # 登录页（密码/OTP/Google 三种方式）
│   ├── register/page.tsx       # 注册页（填信息 → 邮箱验证码激活）
│   ├── (mobile)/               # 移动端路由组（需登录）
│   │   ├── layout.tsx          # → MobileShell（路由保护 + 底部导航）
│   │   ├── dashboard/page.tsx  # 概览页（总负债/统计/临近账单）
│   │   ├── holders/
│   │   │   ├── page.tsx        # 持卡人列表
│   │   │   └── [id]/
│   │   │       ├── page.tsx    # 持卡人详情（信用卡列表+统计）
│   │   │       └── stats/page.tsx  # 持卡人历史账单趋势（6个月图表）
│   │   ├── bills/page.tsx      # 账单管理（全部/待还/已结清，按月分组）
│   │   ├── benefits/page.tsx   # 我的权益（使用进度+登记使用）
│   │   └── promos/page.tsx     # 发现优惠（活动列表+参与领取）
│   └── admin/                  # 管理后台（深色桌面端）
│       ├── layout.tsx          # → AdminShell（侧边栏导航）
│       ├── page.tsx            # 管理仪表盘（统计卡片+数据概览）
│       ├── banks/page.tsx      # 银行目录管理（CRUD+搜索+分页）
│       ├── card-products/page.tsx  # 卡产品管理（CRUD+AI一键补全）
│       ├── benefits/page.tsx   # 权益配置管理（CRUD）
│       ├── promos/page.tsx     # 优惠活动管理（CRUD）
│       └── settings/page.tsx   # 系统设置（平台信息+AI配置）
├── components/
│   ├── ThemeRegistry.tsx       # 字体注册 + 透传（主题职责已由 globals.css 的 d-* token 接管）
│   ├── mobile/
│   │   ├── MobileShell.tsx     # 移动端布局壳（未登录重定向）
│   │   ├── BottomNav.tsx       # 底部导航（首页/持卡人/账单/优惠）
│   │   ├── HolderCard.tsx      # 持卡人列表项
│   │   ├── HolderForm.tsx      # 持卡人表单弹窗（新增/编辑）
│   │   ├── CreditCardItem.tsx  # 信用卡展示卡片（渐变蓝）
│   │   ├── CardForm.tsx        # 信用卡表单弹窗
│   │   ├── BillStatusCard.tsx  # 账单状态卡片（颜色区分逾期/待还/已还）
│   │   └── PaymentForm.tsx     # 还款登记弹窗
│   └── admin/
│       ├── AdminShell.tsx      # 管理后台布局（侧边栏+顶栏）
│       ├── StatCard.tsx        # 统计数字卡片
│       ├── UserActivityStats.tsx   # 近7天活跃度面板
│       ├── CardProductOverview.tsx # 卡产品表格
│       ├── PromoOverview.tsx   # 优惠活动概览
│       ├── BenefitOverview.tsx # 权益使用概览
│       └── AiCompleteButton.tsx    # AI一键补全按钮组件
├── lib/
│   ├── db/                     # D1 客户端（worker 注入 binding，globalThis 共享）
│   ├── session.ts              # HMAC 签名 session cookie（服务端）
│   ├── auth.tsx                # AuthContext + AuthProvider（自建 auth，走 /api/rpc）
│   ├── types.ts                # 全局 TypeScript 类型定义
│   ├── constants.ts            # COUNTRIES 国家列表常量
│   ├── utils.ts                # 工具函数（账单日计算、金额格式化、幂等键）
│   └── api/
│       ├── admin.ts            # 管理后台 API（银行/卡产品/权益/优惠/系统设置 CRUD）
│       ├── rpc-client.ts       # 浏览器端 RPC 传输（/api/rpc/<module>/<fn> 白名单调用）
│       ├── holders.ts          # 持卡人 API（CRUD + 统计聚合）
│       ├── cards.ts            # 信用卡 API（CRUD）
│       ├── bills.ts            # 账单 API（查询/创建/还款登记）
│       ├── benefits.ts         # 权益 API（查询/登记使用）
│       ├── dashboard.ts        # 管理后台数据聚合 API
│       └── ai.ts               # AI补全逻辑（Wikipedia搜索增强 + LLM调用）
├── db/
│   ├── migrations/             # D1 SQL 迁移（wrangler d1 migrations）
│   └── seed*.ts                # 旧 InsForge 时代的种子脚本（已不适用，仅存档）
├── worker/                    # Cloudflare Worker 入口（index.ts + cron.ts 每日 9 点账单提醒）
├── email-worker/               # 独立 Email Worker（Cloudflare Email Routing，直写 D1）
├── scripts/                    # 旧 InsForge 时代脚本（已不适用，仅存档）
├── docs/
│   ├── plans/2026-03-20-credit-card-manager-design.md  # 原始设计文档
│   └── plan/admin-dashboard.md # 管理后台实施计划
├── public/                     # PWA 图标资源
├── wrangler.jsonc              # Cloudflare Workers 配置（D1/R2/cron/vars，生产域名 app.all-bill.com）
├── vite.config.mts           # Vite 配置（端口3050 + vinext插件，.mts 保证 ESM 加载）
├── tsconfig.json               # TypeScript 配置
└── package.json
```

---

## 4. 数据模型

所有表均使用 UUID 主键，存储在 Cloudflare D1（SQLite）。

### 平台基础数据（管理员维护）

| 表名 | 核心字段 | 说明 |
|------|---------|------|
| `banks` | `name, full_name, logo_url, country, customer_service_phone, website_url, is_active` | 银行目录，name UNIQUE |
| `card_products` | `bank_id→banks, bank_name, card_name, currency, payment_due_type(fixed/after_billing), payment_due_value, annual_fee, annual_fee_waiver, description_md, apply_url, rewards_summary, is_active` | 信用卡产品目录 |
| `benefits` | `card_product_id→card_products, name, description, quota, period(yearly/monthly/one_time), reset_month, expiry_date` | 卡产品权益定义 |
| `promos` | `card_product_id→card_products, bank_id→banks, bank_name, title, description, discount_type(满减/折扣/积分/返现), start_date, end_date, conditions, max_uses, is_active` | 优惠活动 |
| `system_settings` | `key TEXT PRIMARY KEY, value JSONB, updated_at` | KV 系统配置 |

### 用户数据

| 表名 | 核心字段 | 说明 |
|------|---------|------|
| `card_holders` | `created_by(Auth user.id), name, phone, avatar_color` | 持卡人档案 |
| `credit_cards` | `holder_id→card_holders, card_product_id→card_products, card_number_last4, credit_limit, billing_day(1-31), status(active/frozen/cancelled)` | 用户持有的信用卡 |
| `bills` | `card_id→credit_cards, bill_month('2026-03'), statement_start, statement_end, bill_amount, min_payment, due_date, status(unpaid/partial/paid/overdue)` | 账单，UNIQUE(card_id, bill_month) |
| `payments` | `bill_id→bills, amount, paid_at, channel, note, idempotency_key UNIQUE` | 还款记录，idempotency_key 防重复 |
| `benefit_usages` | `benefit_id→benefits, used_at, note` | 权益使用记录 |
| `promo_usages` | `promo_id→promos, card_id→credit_cards, used_at, note` | 优惠参与记录 |

### 关系图

```
wc_user（自建账号表）
    └─(created_by)─► card_holders
                         └─(holder_id)─► credit_cards
                                             ├─(card_id)─► bills
                                             │                └─(bill_id)─► payments
                                             └─(card_product_id)─► card_products
                                                                       ├─► benefits
                                                                       │       └─► benefit_usages
                                                                       └─► promos
                                                                               └─► promo_usages
```

---

## 5. 路由结构

### 移动端（`app/(mobile)/`）

| 路由 | 组件 | 功能 |
|------|------|------|
| `/` | `app/page.tsx` | 未登录落地页 |
| `/login` | `app/login/page.tsx` | 登录（密码/OTP/Google） |
| `/register` | `app/register/page.tsx` | 注册 → 邮箱验证 |
| `/dashboard` | `(mobile)/dashboard/page.tsx` | 概览（总负债、统计、临近账单） |
| `/holders` | `(mobile)/holders/page.tsx` | 持卡人列表 |
| `/holders/[id]` | `(mobile)/holders/[id]/page.tsx` | 持卡人详情（信用卡列表、统计、CRUD） |
| `/holders/[id]/stats` | `(mobile)/holders/[id]/stats/page.tsx` | 6个月账单趋势图表 |
| `/bills` | `(mobile)/bills/page.tsx` | 账单管理（按月分组、还款登记） |
| `/benefits` | `(mobile)/benefits/page.tsx` | 我的权益（进度条、登记使用） |
| `/promos` | `(mobile)/promos/page.tsx` | 发现优惠活动 |

### 管理后台（`app/admin/`）

| 路由 | 功能 |
|------|------|
| `/admin` | 运营仪表盘（统计卡片、卡产品表、活跃度、优惠概览） |
| `/admin/banks` | 银行目录 CRUD（搜索、按国家筛选、分页、状态开关） |
| `/admin/card-products` | 卡产品 CRUD（AI一键补全、按银行筛选） |
| `/admin/benefits` | 卡产品权益 CRUD（配额、重置周期） |
| `/admin/promos` | 优惠活动 CRUD（折扣类型、日期、关联产品） |
| `/admin/settings` | 系统设置（平台名称、注册开关、维护模式、AI API配置） |

---

## 6. 核心功能

### 已实现

**认证**
- 邮箱+密码登录
- 邮箱 OTP 验证码登录
- Google OAuth 登录
- 邮箱注册（两步：填信息 → OTP 验证激活）
- 自建认证：密码（PBKDF2）、邮箱 OTP、Google OAuth（ID token 验证）；HMAC 签名 session cookie（`lib/session.ts`），secret 走 Worker 环境变量 SESSION_SECRET

**移动端**
- 概览仪表盘：总负债、总授信、已开卡数、授信利用率计算、临近还款账单
- 持卡人管理：CRUD、头像颜色选择、统计（持卡数/银行数/待还金额/待还卡数）
- 信用卡管理：关联卡产品目录、设置额度/账单日/卡号后四位、编辑/删除
- 账单管理：自动同步（为每张卡生成本月账单框架）、按状态筛选（全部/待还/已结清）、按月分组展示
- 还款登记：记录还款金额/日期/渠道，金额足够时自动标记已还
- 持卡人统计页：总额度/使用率/可用额度进度条、四格快捷统计（卡数/本月账单/待还/逾期）、近6个月账单趋势柱状图
- 权益管理：展示名下所有卡产品权益、配额使用进度条、登记使用记录
- 优惠活动：展示平台优惠列表、参与领取（写 promo_usages）

**管理后台**
- 深色主题桌面端控制台（侧边栏可折叠）
- 运营仪表盘：注册用户数/卡产品数/活跃卡数/进行中活动数四格统计，近7天活跃度，卡产品目录表，优惠概览，权益概览
- 银行目录：CRUD + 搜索 + 按国家筛选 + 分页 + 状态开关 + **AI一键补全**（自动填写全称/客服电话/网址/Logo）
- 卡产品管理：CRUD + 搜索 + 按银行筛选 + 分页 + 状态开关 + **AI一键补全**（自动填写卡片介绍/申请链接/积分规则/年费/年费减免）
- 权益配置：CRUD（关联卡产品、配额、周期、重置月份）
- 优惠活动：CRUD（折扣类型、有效期、关联产品）
- 系统设置：平台名称/支持邮箱/默认币种、注册开关、维护模式开关、AI API配置（BaseURL/Model/APIKey）

**AI 补全**
- 服务端调用 OpenAI 兼容 API（`lib/api/ai.server.ts`），配置存 `system_settings` 表
- 流程：Wikipedia 中英文搜索增强 → 拼接上下文 → 调用 LLM → 解析 JSON → 后处理（自动生成 logo_url）
- 支持全字段一键补全和逐字段单独补全

**数据初始化**
- `db/seed.ts`：5家银行 + 4个卡产品
- `db/seed-mainstream.ts`：约70家银行（国内六大行+股份制行+城商行，美国10家，香港10家）+ 500+个卡产品（含特定知名卡片定义）

---

## 7. 外部依赖

### Cloudflare（核心依赖）

- **Workers**：主应用（`worldcredit`），生产域名 `https://app.all-bill.com`，wrangler.jsonc 定义 bindings
- **D1**：`worldcredit` 数据库（SQLite），迁移在 `db/migrations/`，`wrangler d1 migrations apply worldcredit`
- **R2**：`worldcredit-attachments` 桶存账单附件
- **Images**：图片优化 binding
- **Email Routing**：`email-worker/` 接收 `bills+{userId}@20160325.xyz` 转发账单邮件，直写 D1
- **Cron**：每日 09:00（`0 9 * * *`）账单提醒 + Web Push 通知扫描（`worker/cron.ts`）
- **部署**：`npx vinext deploy`（本地 build + wrangler 上传）；密钥用 `wrangler secret put`
- 历史备注：项目曾用 InsForge（Supabase 兼容 BaaS），2026 年已完全迁出，相关脚本仅存档

### AI 服务（可选，通过系统设置配置）

- OpenAI 兼容接口，配置项存储在 `system_settings` 表（KV）
- 字段：`ai_api_key`、`ai_base_url`、`ai_model`
- 默认 model：`gpt-4o`，默认 baseURL：`https://api.openai.com/v1`
- 未配置 API Key 时，AI补全功能不可用（抛出错误）

### Wikipedia API

- 直接调用 Wikipedia 公开 API（无需 Key），用于 AI 补全的搜索增强
- 先查中文维基（`zh.wikipedia.org`），不命中则查英文（`en.wikipedia.org`）

---

## 8. 当前状态

### 完成度

移动端核心功能全部实现（仪表盘/持卡人/信用卡/账单/权益/优惠），管理后台全部 6 个页面完整实现，AI 补全完整实现。项目整体功能完整，可以正常使用。

### 已知问题

1. **持卡人列表卡片数量硬编码为 0**：`HolderCard` 的 `cardCount` 写死，注释 `// TODO: 联调信用卡数量`
2. **utils.ts 类型引用错误**：`getDueDate` 使用 `card.payment_due_type/value`，但 `CreditCard` 类型中没有这两个字段（在 `CardProduct` 上）
3. **还款状态更新粗糙**：只判断单次还款 >= 账单金额，不累计历史还款
4. **权益使用次数未按周期过滤**：统计所有历史记录，已重置的周期仍显示旧数据
5. **管理后台无权限校验**：任何登录用户均可访问 `/admin/*`
6. **Edge Function 未调用**：AI 补全在前端直连 OpenAI，Edge Function 版本闲置

### 缺失功能（设计文档有，代码没有）

- PWA 推送通知
- 账单智能识别（拍照识别）
- 数据导入/导出
- 持卡人独立账号（`auth_user_id` 字段预留但未激活）
- Row Level Security（RLS）策略

---

## 9. 开发指南

### 启动开发服务器

```bash
npm install
npm run dev        # 监听 localhost:3050
```

访问 `http://credit.localhost:3050`（需 portless）或 `http://127.0.0.1:3050`

### 数据库迁移

```bash
npx wrangler d1 migrations apply worldcredit --remote   # 生产 D1
npx wrangler d1 migrations apply worldcredit --local    # 本地 D1
```

### 部署

```bash
npx vinext deploy    # build + 上传 Cloudflare Workers（生产 app.all-bill.com）
```

### 数据操作模式

服务端（API 路由 / server 组件）通过 `lib/db/` 取 D1 binding 执行 SQL：

```typescript
import { getDb } from '@/lib/db'
const { results } = await getDb().prepare('SELECT * FROM bills WHERE id = ?').bind(id).all()
```

浏览器端不碰 SQL：组件调用 `lib/api/*.ts` 包装函数，经 `/api/rpc/<module>/<fn>` 命名白名单路由到服务端函数（`lib/api/rpc-client.ts`）。
