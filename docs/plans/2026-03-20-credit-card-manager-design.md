# WorldCredit — 信用卡管理 WebApp 设计文档

## 概述

一个面向家庭/小团队的信用卡管理 PWA，帮助一个人管理多个家庭成员的信用卡账单、还款、优惠、权益和额度。

- **手机端 PWA**：日常查看和操作，Android/iOS 免安装
- **Web 后台**：管理员在桌面端录入和维护信用卡基础信息库

## 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 前端框架 | React 18 + vinext | Cloudflare 的 Vite + Next.js API 实现 |
| UI 组件库 | MUI (Material UI v5) | Material Design 风格 |
| 后端平台 | InsForge | Agentic 后端，Postgres + Auth + Storage |
| PWA | vite-plugin-pwa | Service Worker + 推送通知 |
| 部署 | Cloudflare Workers | vinext deploy 一键部署 |

## 用户角色

| 角色 | 说明 | 权限 |
|------|------|------|
| **管理员** | 管理信用卡基础信息库和所有持卡人 | Web 后台 + 手机端全部功能 |
| **持卡人（家庭成员）** | 查看自己的信用卡信息 | 仅手机端，仅看自己的数据 |

> MVP 阶段只做管理员角色，但数据模型已预留持卡人独立账号的扩展能力。

---

## 数据模型

```text
┌─────────────┐     ┌──────────────────┐     ┌────────────────┐
│   User      │────▶│   CardHolder     │────▶│   CreditCard   │
│ (Auth 账号)  │ 1:N │   (持卡人档案)    │ 1:N │   (信用卡)      │
└─────────────┘     └──────────────────┘     └────────────────┘
      │                     │                       │
      │              ┌──────┘                ┌──────┼──────────────┐
      ▼              ▼                       ▼      ▼              ▼
┌──────────┐  ┌───────────┐         ┌──────────┐ ┌──────────┐ ┌──────────┐
│ Access   │  │ Benefit   │         │  Bill    │ │ Benefit  │ │  Promo   │
│ Control  │  │  Usages   │         │ (账单)   │ │ (权益)   │ │ (优惠)   │
└──────────┘  └───────────┘         └────┬─────┘ └────┬─────┘ └────┬─────┘
                                         ▼            ▼            ▼
                                    ┌──────────┐ ┌──────────┐ ┌──────────┐
                                    │ Payment  │ │ Benefit  │ │  Promo   │
                                    │ (还款)   │ │  Usage   │ │  Usage   │
                                    └──────────┘ └──────────┘ └──────────┘
```

### 核心表

#### users（Auth 账号）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | uuid | 主键，InsForge Auth 用户 ID |
| email | text | 登录邮箱 |
| name | text | 用户名 |
| role | text | 角色：admin / member（MVP 阶段仅 admin） |
| created_at | timestamptz | 创建时间 |

#### card_holders（持卡人档案）

> 持卡人档案与 Auth 账号分离。管理员通过 `managed_by` 管理持卡人，
> 持卡人未来可通过 `auth_user_id` 关联独立登录账号，无需数据迁移。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | uuid | 主键 |
| managed_by | uuid | 管理员 → users.id |
| auth_user_id | uuid | 持卡人独立账号 → users.id（可选，Phase 3 启用） |
| name | text | 持卡人姓名 |
| phone | text | 手机号（可选） |
| avatar_color | text | 头像颜色标识 |
| created_at | timestamptz | 创建时间 |

> **RLS 策略**：`managed_by = auth.uid()` OR `auth_user_id = auth.uid()`，
> Phase 1 只走前者，Phase 3 激活后者即可，零迁移成本。

#### credit_cards（信用卡）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | uuid | 主键 |
| holder_id | uuid | 所属持卡人 → card_holders.id |
| country | text | 发卡国家/地区代码（如 "CN"、"US"、"HK"），ISO 3166-1 alpha-2 |
| bank_name | text | 发卡行（如"招商银行"） |
| card_name | text | 卡种名称（如"经典白金卡"） |
| card_number_last4 | text | 卡号后四位 |
| card_image_id | text | 卡面图片 ID（可选，关联 InsForge Storage） |
| credit_limit | numeric | 信用额度 |
| currency | text | 额度币种（如 "CNY"、"USD"），ISO 4217 |
| billing_day | int | 账单日（每月几号，1-31；31 表示自然月最后一天） |
| payment_due_type | text | 还款日类型：fixed / after_billing |
| payment_due_value | int | fixed 时为每月几号，after_billing 时为账单日后天数 |
| annual_fee | numeric | 年费 |
| annual_fee_waiver | text | 免年费条件 |
| status | text | 状态：active / frozen / cancelled |
| created_at | timestamptz | 创建时间 |

> **已删除 `used_amount`**：已用额度不再作为存储字段，改为从最新未还账单实时计算：
> `used = SUM(bills.bill_amount - bills.paid_amount) WHERE status != 'paid'`
> 这避免了冗余数据漂移的风险。

> **billing_day 取值 1-31**：对于自然月不足 31 天的情况，约定取当月最后一天。
> 例如 billing_day=31 在二月等效于 28/29 号。

#### bills（账单）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | uuid | 主键 |
| card_id | uuid | 关联信用卡 → credit_cards.id |
| bill_month | text | 账单月份 "2026-03" |
| statement_start | date | 账单周期起始日 |
| statement_end | date | 账单周期截止日 |
| statement_date | date | 实际出账日期 |
| bill_amount | numeric | 账单金额 |
| min_payment | numeric | 最低还款额 |
| due_date | date | 还款截止日（由 payment_due_type/value 计算后存储） |
| status | text | unpaid / partial / paid / overdue |
| created_at | timestamptz | 创建时间 |

> **已删除 `paid_amount`**：已还金额从 payments 表汇总计算，不再冗余存储。
> `paid = SUM(payments.amount) WHERE bill_id = ?`
> **status 更新规则**：paid >= bill_amount → paid；paid > 0 → partial；
> due_date 已过且 paid < bill_amount → overdue。

#### payments（还款记录）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | uuid | 主键 |
| bill_id | uuid | 关联账单 → bills.id |
| amount | numeric | 还款金额 |
| paid_at | date | 还款日期 |
| channel | text | 还款渠道（如"手动还款"、"自动扣款"） |
| note | text | 备注（可选） |
| idempotency_key | text | 幂等键，防止重复提交（UNIQUE） |
| created_at | timestamptz | 创建时间 |

#### benefits（权益定义）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | uuid | 主键 |
| card_id | uuid | 关联信用卡 → credit_cards.id |
| name | text | 权益名称（如"机场贵宾厅"） |
| description | text | 权益描述 |
| quota | int | 每周期总次数/额度（如每年 6 次） |
| period | text | 周期：yearly / monthly / one_time |
| reset_month | int | 重置月份（1-12，yearly 类型有效） |
| expiry_date | date | 过期日期 |

> **已删除 `used_count`**：使用次数从 benefit_usages 表计算，支持明细审计和纠错。

#### benefit_usages（权益使用记录）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | uuid | 主键 |
| benefit_id | uuid | 关联权益 → benefits.id |
| used_at | date | 使用日期 |
| note | text | 使用备注（如"浦东 T2 贵宾厅"） |
| created_at | timestamptz | 创建时间 |

> **剩余额度**：`remaining = quota - COUNT(benefit_usages) WHERE used_at IN current_period`
> 周期重置时无需清数据，按时间范围查询自然归零。

#### promos（优惠活动定义）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | uuid | 主键 |
| card_id | uuid | 关联信用卡（可选，null 表示全行通用） |
| bank_name | text | 发卡行 |
| title | text | 优惠标题 |
| description | text | 优惠详情 |
| discount_type | text | 满减 / 折扣 / 积分 / 返现 |
| start_date | date | 开始日期 |
| end_date | date | 结束日期 |
| conditions | text | 使用条件 |
| max_uses | int | 最大可用次数（null 表示不限） |

> **已删除 `is_used`**：使用状态拆到 promo_usages 表，支持多人多卡多次使用。

#### promo_usages（优惠使用记录）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | uuid | 主键 |
| promo_id | uuid | 关联优惠 → promos.id |
| card_id | uuid | 使用的信用卡 → credit_cards.id |
| used_at | date | 使用日期 |
| note | text | 使用备注 |
| created_at | timestamptz | 创建时间 |

---

## 页面设计

### 手机端 PWA（5 个核心页面）

#### 1. 首页 / 仪表盘

- 本月还款概览（总待还金额 + 进度条）
- 最近还款日提醒（倒计时卡片）
- 各持卡人快速入口
- 即将到期的优惠提醒

#### 2. 持卡人页面

- 持卡人列表（头像 + 姓名 + 持卡数量）
- 点击进入某持卡人的卡片列表
- 每张卡片显示：银行 Logo + 卡名 + 额度使用环形图

#### 3. 卡片详情页

- 卡面视觉展示（卡片图片或银行默认样式）
- 额度信息：总额度 / 已用（实时计算） / 可用
- 本月账单信息 + 还款状态 + 还款记录
- 权益列表（带使用进度，基于明细记录计算）
- 可用优惠列表

#### 4. 账单页面

- 月度账单时间线
- 按月份切换查看
- 每月各卡账单汇总
- 还款状态颜色标识（绿色已还 / 黄色部分 / 红色逾期）
- 每笔账单可展开查看还款记录明细

#### 5. 优惠活动页面

- 当前有效优惠列表
- 按银行/卡片筛选
- 即将过期提醒
- 使用记录归档

### Web 后台（3 个管理页面）

#### 1. 持卡人管理

- 增删改持卡人信息
- 查看每个持卡人名下的卡片

#### 2. 信用卡管理

- 添加/编辑信用卡信息
- 录入账单
- 管理权益配置

#### 3. 优惠活动管理

- 添加/编辑优惠活动
- 批量导入（可选，后续功能）

---

## 项目结构

```text
worldcredit/
├── app/                        # vinext App Router
│   ├── layout.tsx              # 根布局
│   ├── page.tsx                # 首页/仪表盘
│   ├── holders/
│   │   ├── page.tsx            # 持卡人列表
│   │   └── [id]/
│   │       └── page.tsx        # 持卡人详情（卡片列表）
│   ├── cards/
│   │   └── [id]/
│   │       └── page.tsx        # 卡片详情
│   ├── bills/
│   │   └── page.tsx            # 账单页面
│   ├── promos/
│   │   └── page.tsx            # 优惠活动
│   └── admin/                  # Web 后台
│       ├── layout.tsx          # 后台布局（侧边栏）
│       ├── holders/
│       │   └── page.tsx        # 持卡人管理
│       ├── cards/
│       │   └── page.tsx        # 信用卡管理
│       └── promos/
│           └── page.tsx        # 优惠管理
├── components/
│   ├── mobile/                 # 手机端组件
│   │   ├── BottomNav.tsx       # 底部导航栏
│   │   ├── CreditCardVisual.tsx # 卡面视觉组件
│   │   ├── BillCard.tsx        # 账单卡片
│   │   └── BenefitProgress.tsx # 权益进度条
│   └── admin/                  # 后台组件
│       ├── Sidebar.tsx         # 侧边栏导航
│       └── DataTable.tsx       # 数据表格
├── lib/
│   ├── insforge.ts             # InsForge 客户端配置
│   ├── types.ts                # TypeScript 类型定义
│   └── utils.ts                # 工具函数（含还款日/额度计算逻辑）
├── public/
│   ├── manifest.json           # PWA Manifest
│   └── sw.js                   # Service Worker
├── next.config.ts              # vinext 配置
├── vite.config.ts              # Vite 配置
└── package.json
```

---

## PWA 推送通知

### 触发场景

1. **还款提醒**：还款日前 3 天、前 1 天、当天
2. **账单出账**：账单日当天
3. **优惠到期**：优惠结束前 3 天
4. **权益重置**：权益额度重置时

### 实现方式

- 使用 Web Push API + Service Worker
- InsForge Edge Functions 作为定时任务触发器
- 推送订阅信息存储在 InsForge 数据库

---

## MVP 范围

### Phase 1（MVP）

- [ ] 管理员登录（InsForge Auth）
- [ ] 持卡人 CRUD
- [ ] 信用卡 CRUD
- [ ] 账单录入和查看（含还款记录）
- [ ] 首页仪表盘（还款概览）
- [ ] 额度监控（从账单实时计算）

### Phase 2

- [ ] 权益管理（含使用记录明细）
- [ ] 优惠活动管理（含使用记录）
- [ ] PWA 推送通知
- [ ] Web 后台管理页面

### Phase 3

- [ ] 持卡人独立账号（激活 auth_user_id + RLS 第二条件）
- [ ] 数据导入/导出
- [ ] 账单智能识别（拍照识别）
- [ ] 更多通知渠道（微信/飞书）

---

## 错误处理

- **离线缓存**：只读数据使用 Service Worker 缓存，离线时可查看
- **连接失败**：InsForge 连接失败时显示友好提示 + 手动重试按钮
- **写入操作**：所有写入请求携带 `idempotency_key`（客户端生成 UUID），
  服务端依赖 UNIQUE 约束去重，避免网络抖动导致的重复写入
- **冲突解决**：采用 last-write-wins 策略，单用户场景下冲突概率极低

> 不做自动重试写入操作。只读请求可自动重试（指数退避，最多 3 次）。

## 安全性

- InsForge Auth 处理认证
- Row Level Security 确保数据隔离
  - `card_holders.managed_by = auth.uid()` — 管理员访问
  - `card_holders.auth_user_id = auth.uid()` — 持卡人自助访问（Phase 3）
- 敏感信息（卡号后四位）仅管理员可见
- HTTPS 全程加密
