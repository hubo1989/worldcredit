# 信用卡优惠权益：数据、接口与一致性设计

- 编号：WC-BEN-12-T
- 日期：2026-10-15
- 状态：实施设计，尚未创建下述业务代码和数据库迁移
- 产品规则：[WC-BEN-12](./12-credit-card-benefits-opportunities.md)
- 实施步骤：[plan](../plans/2026-10-15-credit-card-benefits-opportunities.md)

## 1. 架构与边界

沿用 `app/` → `lib/api/*.ts` → `/api/rpc/<module>/<fn>` → `.server.ts` → D1。新增 `lib/opportunities/` 放不依赖 React 的日期、状态、余额、任务及提醒逻辑；定时任务直接复用这些服务，不再复制另一套周期算法。

`benefits` 和 `promos` 保留为旧目录兼容层，新增定义包装和不可变规则版本。个人账户、配额批次、使用记录、事件流水是新业务的权威来源。新 UI 不用旧的产品级 `usage_count` 做个人余额。

P1 建立通用配额和原子事件机制；P2 在同一机制上接任务与领取／预约，不引入第二份余额。共享范围只支持单卡和同持卡人多卡；没有跨人的余额池。

数据库迁移放 `migrations/d1/`。当前最大序号 0012；实施前若序号已占用，按实际最大值顺延，并在 plan 更新路径。本文件的 SQL 是待实现迁移的核心约束模板，不是已应用数据库。

## 2. 服务端身份与授权

### 2.1 新接口的身份注入

当前 route 只为成员执行 `memberGuard`，管理员会跳过。因此新增 RPC entry 字段 `prependActor?: true`，调用前由 route 注入：

```ts
export interface OpportunityActor {
  user_id: string;
  role: "admin" | "member";
}

export type PublicScopedRpc<F> = F extends (actor: OpportunityActor, ...args: infer A) => infer R
  ? (...args: A) => R
  : never;
```

调用顺序固定：验 session → 旧 `bindUser/bindField` → 旧 memberGuard → 对带 `prependActor` 的 entry 用 `[actor, ...finalArgs]` 调 impl。不能把客户端的 actor 合并进可信对象。新服务同时给管理员和成员执行内部授权；不能只在 registry 上标一个已鉴权 flag。

客户端例：

```ts
export function getOpportunityPage(filters: OpportunityFilters) {
  return callRpc<PublicScopedRpc<typeof Server.getOpportunityPage>>(
    "opportunities",
    "getOpportunityPage",
    filters,
  );
}
```

旧 RPC 的 guard 和参数位置保持兼容。权限契约测试须认识 `prependActor`，同时对每个新 entry 验证服务内确实使用 scope。单纯把字段加入“允许列表”不等于完成隔离。

### 2.2 数据范围

`resolveOpportunityScope(actor)` 返回可访问 holder IDs，查询不返回全库后再前端过滤：

- admin：`card_holders.created_by = actor.user_id OR managed_by = actor.user_id`。
- member：`card_holders.auth_user_id = actor.user_id`。

账户、使用、任务、履约均先由 holder 关联判定。写入还要验证 actual card 与账户关联、目标卡持卡人、规则适用范围、revision。对象不存在和无权统一 `FORBIDDEN_OR_NOT_FOUND`，避免探测私人资源。

私人定义只允许其 holder 范围读取；共享定义可作为目录公开给已登录用户，但私人实例、用量、备注、计数不能公开。管理员目录权限继续由 `admin: true` 控制。

## 3. 模块和文件契约

| 新文件                                      | 责任                                          |
| ------------------------------------------- | --------------------------------------------- |
| `lib/opportunities/types.ts`                | DTO、枚举、请求和结果类型，客户端可安全引用   |
| `lib/opportunities/dates.ts`                | 日期校验、IANA 时区、当地今天、锚点及半开周期 |
| `lib/opportunities/availability.ts`         | 可用性、原因、动作、排序和首页计数纯函数      |
| `lib/opportunities/scope.server.ts`         | actor→holder 查询、账户／卡／任务授权         |
| `lib/opportunities/catalog.server.ts`       | 定义包装、候选、发布版本、归档及旧目录适配    |
| `lib/opportunities/accounts.server.ts`      | 账户、关联卡、周期、期初核对、历史归属        |
| `lib/opportunities/writes.server.ts`        | 幂等命令、D1 batch、事件和余额原子写入        |
| `lib/opportunities/usages.server.ts`        | 使用、撤销、更正和历史 DTO                    |
| `lib/opportunities/queries.server.ts`       | 批量列表、聚合、卡片机会、导出                |
| `lib/opportunities/reminders.ts`            | 日历事件、提醒身份、阈值和 quiet hours 纯函数 |
| `lib/opportunities/notifications.server.ts` | 提醒状态、待发作业、投递与重试                |
| `lib/opportunities/tasks.ts`                | 手动任务条件、缺口和发放窗口纯函数            |
| `lib/opportunities/tasks.server.ts`         | 任务及周期进度持久化                          |
| `lib/opportunities/fulfillments.server.ts`  | 领取、到账、预约及结算                        |
| `lib/api/opportunities{,.server}.ts`        | 面向 UI 的新命名 RPC 包装和服务门面           |

服务门面不复制业务逻辑。`cards.server.ts`、旧 benefits/promos API、统计、导出和 Cron 都调用以上服务。`lib/api/*Usages.ts` 改为客户端 RPC，禁止继续导入 D1。

## 4. 规则快照与状态计算

### 4.1 RuleSnapshotV1

数据库 `rules_json` 必须通过运行时验证器，不用 TypeScript 断言代替校验。未识别 schema_version 拒绝发布，读取历史版本时给出需升级错误，不能静默使用默认规则。

```ts
export interface RuleSnapshotV1 {
  schema_version: 1;
  title: string;
  description: string | null;
  category: "food" | "shopping" | "transport" | "travel" | "health" | "membership" | "other";
  time_zone: string;
  bank_id: string | null;
  card_product_ids: string[];
  valid_from: string | null;
  valid_until_before: string | null;
  open_ended: boolean;
  weekdays: number[] | null; // ISO 1=周一，7=周日
  cycle: {
    kind: "daily" | "weekly" | "monthly" | "annual" | "anniversary" | "one_time";
    anchor_month: number | null;
    anchor_day: number | null;
    anchor_source: "issued_on" | "activated_on" | null;
  };
  allocation: "recurring" | "claim_gated" | "grant_only";
  count_limit: number | null;
  amount_limit_minor: number | null;
  currency: string | null;
  unit_label: string;
  eligibility_text: string | null;
  requires_personal_confirmation: boolean;
  claim_window: { starts_at: string | null; ends_at: string | null } | null;
  booking_window: { opens_at: string | null; closes_at: string | null } | null;
  workflow_time_basis: "fixed" | "per_cycle";
  booking_consumes: "reserve_then_use";
  cancellation_rule: "confirm_with_issuer";
  entry: { website_url: string | null; app_name: string | null; app_path: string | null };
}
```

`valid_*` 是规则当地日期，`*_at` 是 RFC3339 UTC 时间，展示时附规则时区。录入结束日期为包含当天时，发布服务转成翌日 `valid_until_before`。只有有证据时设置 open_ended；缺失截止日和明确无期限是不同状态。

`workflow_time_basis=fixed` 表示领取／预约窗口使用规则中的固定时间；`per_cycle` 表示每个配额批次录入自己的绝对窗口，`opportunity_cycles.workflow_json` 保存该批次的 claim_window/booking_window。未录入具体窗口就标“待补充”，不从含糊文案推算。这样可记录月度领取截止且不会把首月时间错误复用于以后每月；复杂相对日程公式不在本期实现。

`count_limit=null` 表示次数不限；`amount_limit_minor=null` 表示金额不限。两者都 null 必须明确勾选无限配额。至少一个非 null 时按对应维度限制；非负整数，包括 0。金额上限非 null 时 currency 必填，并采用项目认可的货币小数位，不一律乘 100（例如 JPY 为 1）。默认次数型单位“次”；金额型仍可保存实际使用笔数，但不显示次数上限。

### 4.2 周期结果

```ts
export interface CycleWindow {
  cycle_key: string;
  period_start_on: string;
  period_end_before: string | null;
  usable_start_on: string;
  usable_end_before: string | null;
  next_reset_on: string | null;
  time_zone: string;
}

export function getCycleWindow(
  rules: RuleSnapshotV1,
  localDate: string,
  anchor: { issued_on: string | null; activated_on: string | null },
): CycleWindow;
```

所有函数显式传 `localDate/now`，测试可冻结时间。日期运算先转换为合法 civil date，避免用 UTC 字符串和主机时区混算。周期 key 为 `regular:<period_start_on>` 或 `grant:<fulfillment_id>`，不因备注和标题变化生成新周期。

常规版本发布只影响以后开始的周期；已开始但迟后才 materialize 的周期，优先选择其名义开始日有效的版本。**首次建模发生在周期中间**且名义开始日尚无任何规则版本时，允许选该窗口内最早发布生效的版本，保存 `version_as_of_on=max(period_start_on,首个版本.effective_from)`；若已有覆盖周期起点的旧版本，不能借此规则改选较新的版本。

`opportunity_accounts.eligible_from_on` 保存用户可确认的个人资格生效日，未知时取本次确认的当地日，不用 `created_at` 充当银行核卡日。首期 `usable_start_on=max(period_start_on,version_as_of_on,eligible_from_on,rules.valid_from)`，结束取周期和规则结束的较早值；无交集则不建可用批次。例：10 月 15 日才建模的月度权益名义周期仍为 10/01—11/01，可用从 10/15 开始，不必等 11 月；之前使用没有证据就进入历史待核对。后续周期按原始锚点恢复完整窗口。

`getCycleWindow` 只计算名义 civil-date 窗口，账户服务的 `resolveCycleVersion` 负责上述首期例外和可用窗口裁剪，避免纯日期工具隐含读库。grant 使用领取／到账当日选择的已确认规则版本；若奖励从历史任务规则生成，则先建立保留该快照的私人版本，不能挂在时点不匹配的共享新版本上。

规则版本和 `version_as_of_on` 在 Cycle 创建时固定。个人资格生效日的纠正需要审计，仅影响尚未创建的周期；已有批次不静默重算 usable 窗口。单次历史周期保留自己的规则。活动紧急终止存定义 `terminated_at` 与理由，影响尚未发生的使用及提醒；新写入的真实历史补记按当时有效窗口判定，不篡改历史。

常规 Cycle 按需创建，以 `(account_id,cycle_key)` 唯一约束防重复。日历对未来事件可纯计算，不为了显示 3 个月日历而创建全部未来账户配额。新周期必须在用户已确认余额口径或无遗留风险时标 `balance_verified=1`。

### 4.3 Balance 和 Opportunity DTO

```ts
export interface Balance {
  count_limit: number | null;
  amount_limit_minor: number | null;
  opening_used_count: number;
  opening_used_minor: number;
  used_count: number;
  used_minor: number;
  reserved_count: number;
  reserved_minor: number;
  remaining_count: number | null;
  remaining_minor: number | null;
  currency: string | null;
  verified: boolean;
}

export interface Opportunity {
  account_id: string;
  definition_id: string;
  kind: "benefit" | "promo" | "private_reward";
  title: string;
  holder_id: string;
  holder_name: string;
  eligible_cards: Array<{ id: string; name: string; last4: string | null }>;
  selected_card_id: string | null;
  cycle_id: string | null;
  cycle: CycleWindow | null;
  balance: Balance | null;
  availability:
    | "available"
    | "needs_claim"
    | "needs_confirmation"
    | "not_started"
    | "exhausted"
    | "expired"
    | "suspended";
  fulfillment_status:
    | "none"
    | "claimable"
    | "claimed"
    | "booked"
    | "used"
    | "expired"
    | "pending_settlement";
  is_expiring: boolean;
  followed: boolean;
  reason_codes: string[];
  actions: Array<
    "record_usage" | "record_claim" | "record_booking" | "confirm" | "follow" | "view_source"
  >;
  version: number;
}
```

可用性优先检查：授权 → 归档／停止／卡状态 → 生效窗口 → 来源与资格完整性 → 周期锚点与余额可信度 → 是否需领取 → 配额 → 当地星期限制。`is_expiring` 独立于主状态，只在剩余可用额度或未完成领取动作存在时为 true。默认 reason 文案来自 code 映射，不拼接模型判断。

## 5. 数据表与关系

### 5.1 新增字段

`credit_cards` 新增 `issued_on TEXT`、`activated_on TEXT`，均 nullable civil date；字段名不能映射到 `created_at`。不改现有 CreditCard 其他语义。应用读写通过 `cards.server.ts` 和 CardForm 扩展，旧客户端不传时保留。

### 5.2 表清单

| 表                                    | 关键字段与责任                                                            | 约束                                                      |
| ------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------- |
| `opportunity_definitions`             | 旧 benefit/promo 包装或私人奖励，visibility/holder、status、terminated_at | 旧 ID 各自唯一；共享与私人归属一致；归档不删除            |
| `opportunity_rule_versions`           | definition、version、effective_from、rules_json、来源复核、published_at   | 已发布版本不可原位修改；有效版本不得重叠                  |
| `opportunity_accounts`                | definition、holder、scope_kind/key、eligibility、revision                 | definition+scope_key 唯一；不可更改历史 holder            |
| `opportunity_account_cards`           | account、definition、holder、card、retired_at                             | 同一实际卡同定义只能有一个 active link；保留 retired 历史 |
| `opportunity_cycles`                  | 账户、周期、规则版本、有效期、限额、已用和预留投影                        | 非负、限额、窗口及唯一周期约束                            |
| `opportunity_commands`                | actor、request key/hash、操作类型、result_json                            | actor+key 唯一；同 key 不同 hash 冲突                     |
| `opportunity_write_checks`            | batch 中的显式前置断言                                                    | ok 只能为 1；任一断言不满足使整个 batch 失败              |
| `opportunity_usages`                  | 当前使用投影、actual card、local used_on、revision/status                 | 保留撤销行，关联真实账户及 Cycle                          |
| `opportunity_events`                  | 命令、对象、before/after、额度六维 delta                                  | 不可 UPDATE/DELETE，触发器更新 Cycle 投影                 |
| `opportunity_legacy_links`            | old table/id→new usage                                                    | 同一旧记录映射一次，不复制归属                            |
| `opportunity_user_states`             | user+account 的 follow 状态                                               | 私人状态不影响资格和别人                                  |
| `opportunity_reminder_states`         | user+event 的 read steps、dismiss、snooze                                 | scope 校验，revision 防旧请求覆盖                         |
| `opportunity_notification_jobs`       | user、event/delivery key、scheduled_at、lease/status                      | user+delivery key 唯一，状态机及重试上限                  |
| `opportunity_notification_deliveries` | job+subscription 的发送结果                                               | 成功设备不重发；删除订阅后历史仍保留                      |
| P2 `opportunity_tasks`                | holder、关联卡列表、条件规则、reward plan、revision/status                | 单持卡人多卡，schema 验证                                 |
| P2 `opportunity_task_cycles`          | task+period、progress_json、截止／发放窗口、revision                      | 一周期一行，进度绝对快照，事件保存历史                    |
| P2 `opportunity_fulfillments`         | claim/grant/booking、account/cycle/task、实际卡、时间、结算状态           | 奖励业务来源唯一；所有配额变化仍经 events                 |

不新增通用工作流引擎、消息队列、共享家庭表或交易明细导入服务。

## 6. P1 核心 DDL 模板

以下代码块分属待创建的 0013／0014／0015。迁移应在一次性本地库验证，不直接执行远端。

### 6.1 0013：定义、归属、配额、命令与流水

```sql
ALTER TABLE credit_cards ADD COLUMN issued_on TEXT;
ALTER TABLE credit_cards ADD COLUMN activated_on TEXT;
CREATE UNIQUE INDEX idx_opportunity_card_holder ON credit_cards(id, holder_id);

CREATE TABLE opportunity_definitions (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('benefit','promo','private_reward')),
  legacy_benefit_id TEXT UNIQUE REFERENCES benefits(id) ON DELETE RESTRICT,
  legacy_promo_id TEXT UNIQUE REFERENCES promos(id) ON DELETE RESTRICT,
  visibility TEXT NOT NULL CHECK (visibility IN ('shared','private')),
  private_holder_id TEXT REFERENCES card_holders(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  terminated_at TEXT,
  termination_reason TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  CHECK ((visibility='private' AND private_holder_id IS NOT NULL) OR
         (visibility='shared' AND private_holder_id IS NULL)),
  CHECK (NOT (legacy_benefit_id IS NOT NULL AND legacy_promo_id IS NOT NULL)),
  CHECK (kind!='private_reward' OR visibility='private'),
  CHECK (created_by IS NOT NULL OR legacy_benefit_id IS NOT NULL OR legacy_promo_id IS NOT NULL)
);
CREATE TABLE opportunity_rule_versions (
  id TEXT PRIMARY KEY,
  definition_id TEXT NOT NULL REFERENCES opportunity_definitions(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL CHECK (version > 0),
  effective_from TEXT NOT NULL,
  effective_until_before TEXT,
  rules_json TEXT NOT NULL CHECK (json_valid(rules_json)),
  verification TEXT NOT NULL CHECK (verification IN ('unverified','user_confirmed','official_verified')),
  source_url TEXT,
  source_excerpt TEXT,
  checked_at TEXT,
  checked_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
  published_at TEXT NOT NULL,
  UNIQUE(definition_id, version),
  UNIQUE(id, definition_id),
  CHECK (effective_until_before IS NULL OR effective_until_before > effective_from)
);
CREATE TABLE opportunity_accounts (
  id TEXT PRIMARY KEY,
  definition_id TEXT NOT NULL REFERENCES opportunity_definitions(id) ON DELETE RESTRICT,
  holder_id TEXT NOT NULL REFERENCES card_holders(id) ON DELETE RESTRICT,
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('card','holder')),
  scope_key TEXT NOT NULL,
  eligibility TEXT NOT NULL DEFAULT 'unknown' CHECK (eligibility IN ('unknown','confirmed','ineligible')),
  eligibility_note TEXT,
  eligibility_confirmed_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
  eligibility_confirmed_at TEXT,
  eligible_from_on TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  UNIQUE(definition_id, scope_key),
  UNIQUE(id, definition_id, holder_id)
);
CREATE INDEX idx_opportunity_accounts_holder ON opportunity_accounts(holder_id,status);
CREATE TABLE opportunity_account_cards (
  account_id TEXT NOT NULL,
  definition_id TEXT NOT NULL,
  holder_id TEXT NOT NULL,
  card_id TEXT NOT NULL,
  retired_at TEXT,
  PRIMARY KEY(account_id, card_id),
  FOREIGN KEY(account_id,definition_id,holder_id)
    REFERENCES opportunity_accounts(id,definition_id,holder_id) ON DELETE RESTRICT,
  FOREIGN KEY(card_id,holder_id) REFERENCES credit_cards(id,holder_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX idx_opportunity_active_card_definition
  ON opportunity_account_cards(definition_id,card_id) WHERE retired_at IS NULL;
CREATE TABLE opportunity_cycles (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES opportunity_accounts(id) ON DELETE RESTRICT,
  version_id TEXT NOT NULL REFERENCES opportunity_rule_versions(id) ON DELETE RESTRICT,
  version_as_of_on TEXT NOT NULL,
  cycle_key TEXT NOT NULL,
  allocation_kind TEXT NOT NULL CHECK (allocation_kind IN ('regular','grant')),
  activation_state TEXT NOT NULL DEFAULT 'active' CHECK (activation_state IN ('active','pending_claim','voided')),
  period_start_on TEXT NOT NULL,
  period_end_before TEXT,
  usable_start_on TEXT NOT NULL,
  usable_end_before TEXT,
  time_zone TEXT NOT NULL,
  count_limit INTEGER CHECK (count_limit IS NULL OR count_limit >= 0),
  amount_limit_minor INTEGER CHECK (amount_limit_minor IS NULL OR amount_limit_minor >= 0),
  currency TEXT,
  workflow_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(workflow_json)),
  opening_used_count INTEGER NOT NULL DEFAULT 0 CHECK (opening_used_count >= 0),
  opening_used_minor INTEGER NOT NULL DEFAULT 0 CHECK (opening_used_minor >= 0),
  used_count INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  used_minor INTEGER NOT NULL DEFAULT 0 CHECK (used_minor >= 0),
  reserved_count INTEGER NOT NULL DEFAULT 0 CHECK (reserved_count >= 0),
  reserved_minor INTEGER NOT NULL DEFAULT 0 CHECK (reserved_minor >= 0),
  balance_verified INTEGER NOT NULL DEFAULT 0 CHECK (balance_verified IN (0,1)),
  verified_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
  verified_at TEXT,
  opening_as_of_on TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at TEXT NOT NULL,
  UNIQUE(account_id, cycle_key),
  UNIQUE(id,account_id),
  CHECK (period_end_before IS NULL OR period_end_before > period_start_on),
  CHECK (version_as_of_on>=period_start_on AND (period_end_before IS NULL OR version_as_of_on<period_end_before)),
  CHECK (usable_start_on>=version_as_of_on),
  CHECK (usable_end_before IS NULL OR usable_end_before > usable_start_on),
  CHECK (amount_limit_minor IS NULL OR currency IS NOT NULL),
  CHECK (count_limit IS NULL OR opening_used_count+used_count+reserved_count <= count_limit),
  CHECK (amount_limit_minor IS NULL OR opening_used_minor+used_minor+reserved_minor <= amount_limit_minor)
);
CREATE INDEX idx_opportunity_cycles_account_dates ON opportunity_cycles(account_id,usable_start_on,usable_end_before);
CREATE TABLE opportunity_commands (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  request_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  command_type TEXT NOT NULL,
  result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
  created_at TEXT NOT NULL,
  UNIQUE(actor_user_id,request_key)
);
CREATE TABLE opportunity_write_checks (
  command_id TEXT PRIMARY KEY REFERENCES opportunity_commands(id) ON DELETE RESTRICT,
  ok INTEGER NOT NULL CHECK (ok=1)
);
CREATE TABLE opportunity_usages (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES opportunity_accounts(id) ON DELETE RESTRICT,
  cycle_id TEXT NOT NULL,
  card_id TEXT NOT NULL,
  used_on TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  amount_minor INTEGER NOT NULL DEFAULT 0 CHECK (amount_minor >= 0),
  note TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','voided')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(cycle_id,account_id) REFERENCES opportunity_cycles(id,account_id) ON DELETE RESTRICT,
  FOREIGN KEY(account_id,card_id) REFERENCES opportunity_account_cards(account_id,card_id) ON DELETE RESTRICT
);
CREATE INDEX idx_opportunity_usages_history ON opportunity_usages(account_id,used_on,id);
CREATE TABLE opportunity_events (
  id TEXT PRIMARY KEY,
  command_id TEXT NOT NULL REFERENCES opportunity_commands(id) ON DELETE RESTRICT,
  entity_kind TEXT NOT NULL CHECK (entity_kind IN ('account','usage','cycle','task','fulfillment','legacy')),
  entity_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  account_id TEXT REFERENCES opportunity_accounts(id) ON DELETE RESTRICT,
  cycle_id TEXT,
  delta_opening_count INTEGER NOT NULL DEFAULT 0,
  delta_opening_minor INTEGER NOT NULL DEFAULT 0,
  delta_used_count INTEGER NOT NULL DEFAULT 0,
  delta_used_minor INTEGER NOT NULL DEFAULT 0,
  delta_reserved_count INTEGER NOT NULL DEFAULT 0,
  delta_reserved_minor INTEGER NOT NULL DEFAULT 0,
  before_json TEXT CHECK (before_json IS NULL OR json_valid(before_json)),
  after_json TEXT CHECK (after_json IS NULL OR json_valid(after_json)),
  reason TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(cycle_id,account_id) REFERENCES opportunity_cycles(id,account_id) ON DELETE RESTRICT,
  CHECK (cycle_id IS NOT NULL OR (
    delta_opening_count=0 AND delta_opening_minor=0 AND delta_used_count=0 AND delta_used_minor=0
    AND delta_reserved_count=0 AND delta_reserved_minor=0
  )),
  CHECK (cycle_id IS NULL OR account_id IS NOT NULL)
);
CREATE INDEX idx_opportunity_events_entity ON opportunity_events(entity_kind,entity_id,created_at,id);
CREATE TRIGGER opportunity_events_no_update BEFORE UPDATE ON opportunity_events
BEGIN SELECT RAISE(ABORT,'OPPORTUNITY_IMMUTABLE_EVENT'); END;
CREATE TRIGGER opportunity_events_no_delete BEFORE DELETE ON opportunity_events
BEGIN SELECT RAISE(ABORT,'OPPORTUNITY_IMMUTABLE_EVENT'); END;
CREATE TRIGGER opportunity_events_apply AFTER INSERT ON opportunity_events
WHEN NEW.cycle_id IS NOT NULL
BEGIN
  UPDATE opportunity_cycles SET
    opening_used_count=opening_used_count+NEW.delta_opening_count,
    opening_used_minor=opening_used_minor+NEW.delta_opening_minor,
    used_count=used_count+NEW.delta_used_count,
    used_minor=used_minor+NEW.delta_used_minor,
    reserved_count=reserved_count+NEW.delta_reserved_count,
    reserved_minor=reserved_minor+NEW.delta_reserved_minor,
    revision=revision+1
  WHERE id=NEW.cycle_id AND account_id=NEW.account_id;
END;
CREATE TABLE opportunity_legacy_links (
  source_table TEXT NOT NULL CHECK (source_table IN ('benefit_usages','promo_usages')),
  source_id TEXT NOT NULL,
  target_usage_id TEXT NOT NULL UNIQUE REFERENCES opportunity_usages(id) ON DELETE RESTRICT,
  included_in_opening INTEGER NOT NULL DEFAULT 0 CHECK (included_in_opening IN (0,1)),
  offset_opening_count INTEGER NOT NULL DEFAULT 0 CHECK (offset_opening_count>=0),
  offset_opening_minor INTEGER NOT NULL DEFAULT 0 CHECK (offset_opening_minor>=0),
  assigned_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL,
  assigned_at TEXT NOT NULL,
  PRIMARY KEY(source_table,source_id)
);
CREATE TABLE opportunity_user_states (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  account_id TEXT NOT NULL REFERENCES opportunity_accounts(id) ON DELETE RESTRICT,
  followed INTEGER NOT NULL DEFAULT 0 CHECK (followed IN (0,1)),
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(user_id,account_id)
);
```

已发布规则的 `rules_json`、来源、版本号和 `effective_from` 不可原位修改，只允许发布流程关闭旧版本 `effective_until_before`。旧版本的选择区间按 Cycle 保存的 `version_as_of_on` 解释，不能改变既有 Cycle 的规则快照或 usable 窗口；已生成未来 Cycle 必须在发布前处理并拒绝存在冲突预留的变更。

声明式数据库一致性保护补充如下，和上面的表／事件触发器一起放入 0013。JSON 字段内容和日期合法性仍由共享验证器检查。

```sql
CREATE TRIGGER opportunity_versions_immutable
BEFORE UPDATE OF definition_id,version,effective_from,rules_json,verification,source_url,source_excerpt,checked_at,checked_by,published_at ON opportunity_rule_versions
BEGIN SELECT RAISE(ABORT,'OPPORTUNITY_IMMUTABLE_VERSION'); END;
CREATE TRIGGER opportunity_versions_no_delete BEFORE DELETE ON opportunity_rule_versions
BEGIN SELECT RAISE(ABORT,'OPPORTUNITY_IMMUTABLE_VERSION'); END;
CREATE TRIGGER opportunity_versions_no_overlap BEFORE INSERT ON opportunity_rule_versions
WHEN EXISTS (
  SELECT 1 FROM opportunity_rule_versions v
  WHERE v.definition_id=NEW.definition_id
    AND (v.effective_until_before IS NULL OR NEW.effective_from<v.effective_until_before)
    AND (NEW.effective_until_before IS NULL OR v.effective_from<NEW.effective_until_before)
)
BEGIN SELECT RAISE(ABORT,'OPPORTUNITY_VERSION_OVERLAP'); END;
CREATE TRIGGER opportunity_versions_guard_end BEFORE UPDATE OF effective_until_before ON opportunity_rule_versions
WHEN (OLD.effective_until_before IS NOT NULL AND (NEW.effective_until_before IS NULL OR NEW.effective_until_before>OLD.effective_until_before))
  OR EXISTS (
    SELECT 1 FROM opportunity_rule_versions v
    WHERE v.definition_id=NEW.definition_id AND v.id!=NEW.id
      AND (v.effective_until_before IS NULL OR NEW.effective_from<v.effective_until_before)
      AND (NEW.effective_until_before IS NULL OR v.effective_from<NEW.effective_until_before)
  )
  OR EXISTS (
    SELECT 1 FROM opportunity_cycles c WHERE c.version_id=OLD.id
      AND (c.version_as_of_on<NEW.effective_from OR (NEW.effective_until_before IS NOT NULL AND c.version_as_of_on>=NEW.effective_until_before))
  )
BEGIN SELECT RAISE(ABORT,'OPPORTUNITY_VERSION_END_CONFLICT'); END;
CREATE TRIGGER opportunity_accounts_check_private BEFORE INSERT ON opportunity_accounts
WHEN EXISTS (
  SELECT 1 FROM opportunity_definitions d WHERE d.id=NEW.definition_id
    AND d.visibility='private' AND d.private_holder_id!=NEW.holder_id
)
BEGIN SELECT RAISE(ABORT,'OPPORTUNITY_PRIVATE_HOLDER_MISMATCH'); END;
CREATE TRIGGER opportunity_accounts_identity_immutable
BEFORE UPDATE OF definition_id,holder_id,scope_kind,scope_key ON opportunity_accounts
BEGIN SELECT RAISE(ABORT,'OPPORTUNITY_ACCOUNT_IDENTITY_IMMUTABLE'); END;
CREATE TRIGGER opportunity_cycles_check_version BEFORE INSERT ON opportunity_cycles
WHEN NOT EXISTS (
  SELECT 1 FROM opportunity_accounts a JOIN opportunity_rule_versions v ON v.definition_id=a.definition_id
  WHERE a.id=NEW.account_id AND v.id=NEW.version_id
    AND NEW.version_as_of_on>=v.effective_from
    AND (v.effective_until_before IS NULL OR NEW.version_as_of_on<v.effective_until_before)
)
BEGIN SELECT RAISE(ABORT,'OPPORTUNITY_CYCLE_VERSION_MISMATCH'); END;
CREATE TRIGGER opportunity_cycles_identity_immutable
BEFORE UPDATE OF account_id,version_id,version_as_of_on,cycle_key,allocation_kind,period_start_on,period_end_before,usable_start_on,usable_end_before,time_zone,count_limit,amount_limit_minor,currency ON opportunity_cycles
BEGIN SELECT RAISE(ABORT,'OPPORTUNITY_CYCLE_IDENTITY_IMMUTABLE'); END;
CREATE TRIGGER opportunity_links_identity_immutable
BEFORE UPDATE OF account_id,definition_id,holder_id,card_id ON opportunity_account_cards
BEGIN SELECT RAISE(ABORT,'OPPORTUNITY_CARD_LINK_IMMUTABLE'); END;
CREATE TRIGGER opportunity_card_holder_guard BEFORE UPDATE OF holder_id ON credit_cards
WHEN OLD.holder_id!=NEW.holder_id AND EXISTS (
  SELECT 1 FROM opportunity_account_cards ac WHERE ac.card_id=OLD.id
)
BEGIN SELECT RAISE(ABORT,'OPPORTUNITY_CARD_OWNERSHIP_CONFLICT'); END;
```

需要更换关联卡或共享范围时退休旧 link／账户再建新对象，不能改身份字段；已存在使用的旧 link 不删除。私人定义的 holder 与 visibility 同样在服务层禁止更改。Cycle.workflow_json 可通过显式审计命令修正，日期改变同时取消旧提醒作业。

历史严重超用数据不强塞进带限额的当前 Cycle；保留为待核对历史或明确的 legacy-only 历史周期，标数据异常，不调整原始事实去凑限额。

### 6.2 0014：个人提醒状态与投递

```sql
CREATE TABLE opportunity_reminder_states (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  event_key TEXT NOT NULL,
  read_steps_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(read_steps_json)),
  dismissed_at TEXT,
  snooze_until TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(user_id,event_key)
);
CREATE TABLE opportunity_notification_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  holder_id TEXT NOT NULL REFERENCES card_holders(id) ON DELETE RESTRICT,
  event_key TEXT NOT NULL,
  delivery_key TEXT NOT NULL,
  object_kind TEXT NOT NULL CHECK (object_kind IN ('account','task','fulfillment')),
  object_id TEXT NOT NULL,
  business_version TEXT NOT NULL,
  scheduled_at TEXT NOT NULL,
  expires_at TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','leased','sent','partial','failed','cancelled','skipped')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 4),
  lease_until TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id,delivery_key)
);
CREATE INDEX idx_opportunity_jobs_due ON opportunity_notification_jobs(status,scheduled_at);
CREATE TABLE opportunity_notification_deliveries (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES opportunity_notification_jobs(id) ON DELETE RESTRICT,
  subscription_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','accepted','failed','gone','skipped')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  accepted_at TEXT,
  last_error TEXT,
  UNIQUE(job_id,subscription_id)
);
```

### 6.3 0015：历史导入

0015 只做可证明的结构 backfill，按旧 benefit/promo ID 包装定义，来源标 `unverified`。旧目录没有可靠维护人时 `created_by=NULL`，该特例只允许带 legacy 源 ID 的定义；新发布或私人定义必须从 session 写真实创建人。不创建“migration 用户”、不随意选择一位管理员充当旧数据所有者。规则 effective_from 取该规则可证明的生效日，未知时使用本次迁移日并要求复核，不编造可追溯的过去资格。不能为全站每条定义向每张卡盲建账户。遗留无证据内容必须人工确认后才会成为可用机会。

无归属 benefit 使用仅由受限管理员入口读取原表；一个源 ID 可以通过命令映射一次。迁移／补归属在新流水写入的同时写 `opportunity_legacy_links`，幂等与失败回滚同时成立。旧表不增写、不删除。

**无法从旧全局 benefit 记录证明 holder 范围时，任何管理员都不能读取或自动认领原备注。** 可在自己账户看到“该定义存在待归属历史”的不含内容提示；管理员若有外部依据可输入源 ID、目标账户与理由提交归属，服务端只验证源记录存在、未映射及目标权限，不回传原备注。需核验原始内容的人工数据恢复另行取得数据库范围授权，不通过页面新增一个全库 admin 例外。

对有效 card_id 的 promo 记录，独立回填脚本先 dry-run 输出范围、数量、异常类型；获执行授权后再写。脚本只接受显式持久化目录和本地／远端目标，不默认 remote。任何不能确定的卡、日期、用户均进入待核对，不降级成全局共享。

## 7. 配额写入的一致性

### 7.1 命令协议

输入通过 canonical JSON（固定字段、sorted keys、无 undefined）计算 SHA-256，包含动作、业务 ID、数值、日期及期望 revision，不包含 actor 或客户端声明的余额。key 长度 16—128，正文和备注长度显式限制。

同一命令的以下 SQL 全部在一次 `db.batch()` 中：

1. `INSERT opportunity_commands`。
2. 前置条件 `INSERT opportunity_write_checks(command_id,ok) SELECT ?, CASE WHEN <数据库现值、scope、revision、状态与日期均满足> THEN 1 ELSE 0 END`。0 触发 CHECK 使整批失败。
3. 插入正／反向 `opportunity_events`；触发器更新 Cycle 投影并由 CHECK 阻止超额或负值。
4. 写入／更新 usage、fulfillment、task 或 account 当前投影，revision +1。
5. 把规范结果 JSON 存入 command；删除该 command 的 write_checks 临时断言行。

禁止“先读余额→单独写记录→单独改余额”。不使用跨网络请求的手工 BEGIN/COMMIT。D1 `batch()` 内任一 SQL 出错整批回滚；**UPDATE 0 行本身不算 SQL 错误**，所以前置断言不能省略。

示例断言（写入前仍要做可读的错误分类，批内断言负责防并发）：

```sql
INSERT INTO opportunity_write_checks(command_id,ok)
SELECT ?, CASE WHEN EXISTS (
  SELECT 1 FROM opportunity_usages u
  JOIN opportunity_accounts a ON a.id=u.account_id
  WHERE u.id=? AND u.revision=? AND u.status='active'
    AND a.holder_id IN (/* 服务端生成占位符 */ ?)
) THEN 1 ELSE 0 END;
```

在批内授权断言中还要重新验证用户与 holder 的绑定／管理关系、卡归属和 active 状态、account 资格及定义终止状态，不能只验证请求开始时计算的 holder ID 列表。前读权限检查只用于清晰报错，事务检查防止管理员解绑、冻结或终止与使用写入并发时绕过限制。

两个请求先读到相同 usage revision 时，先提交的成功，后提交的断言失败，不能反冲两次。两条不同使用抢最后额度时，Cycle CHECK 只允许一个成功。

失败后：唯一 key 冲突则读取原 command，hash 一致返回已提交结果，否则 `IDEMPOTENCY_CONFLICT`；写前置断言失败再按当前值分类 `REVISION_CONFLICT`／`QUOTA_EXCEEDED` 等。断言或事件插入失败时 command 也已回滚，不能把半成品作为成功重试结果。

### 7.2 六维流水

| 动作           | opening             | used  | reserved |
| -------------- | ------------------- | ----- | -------- |
| 直接使用 q/a   | 0                   | +q/+a | 0        |
| 撤销使用 q/a   | 0                   | −q/−a | 0        |
| 确认预约 q/a   | 0                   | 0     | +q/+a    |
| 预约转使用 q/a | 0                   | +q/+a | −q/−a    |
| 取消且确认退回 | 0                   | 0     | −q/−a    |
| 取消且银行扣除 | 0                   | +q/+a | −q/−a    |
| 期初核对       | 只调整 opening 差值 | 0     | 0        |

备注事件六个 delta 都 0。更正由同一 batch 的反冲及新事件组成，before/after JSON 保存完整事实，不靠可变投影追溯。每笔事件带 command 和当前 actor 间接关系。

更正旧周期使用时不改变新周期。核对表单输入的是本期截至核对时的**全部已耗用额**及 `as_of_on`，服务端先减去已明确录入且在该日期内的 used/reserved，得到额外的 opening；得到负数时拒绝并提示先纠正冲突记录。内部 RPC `confirmOpeningBalance` 接收这部分“未逐笔登记的期初耗用”与覆盖日期，不能把已录入 used/reserved 再加一遍；界面必须同时展示计算过程。

之后归属旧记录或补记历史使用时，**明确询问该条是否已包含在截至 opening_as_of_on 的核对总额中**，不只靠日期猜测。若是，同一 batch 写一条 `opening−q/a, used+q/a` 的转分类事件并创建 usage，合计耗用不变；opening 不足则整批失败，先核对。若否，正常 `used+q/a`，显示本次会进一步扣减。legacy link 保存包含标志和实际抵扣量，禁止同源重复抵扣。之后撤销该已归属 usage 表示确认原使用事实有误，正常 `used−q/a`，不自动加回 opening；若仅修正归属而使用事实仍成立，应在同一更正命令同步原账户 opening／used、目标账户余额和映射，不提供删除映射后重新导入的捷径。

### 7.3 对账

提供只读 `reconcileOpportunityCycle(cycleId)`：按 events 重放六维 delta，与 Cycle 投影比较，返回差异和相关 command；不自动修复、不吞掉异常。CI 和迁移演练必须证明二者一致；管理端若发现差异将账户标需核对，停止继续使用写入并给出可执行处理路径。

## 8. P2 数据与任务／履约约束

### 8.1 0016：手动任务

```sql
CREATE TABLE opportunity_tasks (
  id TEXT PRIMARY KEY,
  holder_id TEXT NOT NULL REFERENCES card_holders(id) ON DELETE RESTRICT,
  task_type TEXT NOT NULL CHECK (task_type IN ('annual_fee','welcome','monthly_spend','custom')),
  title TEXT NOT NULL,
  card_ids_json TEXT NOT NULL CHECK (json_valid(card_ids_json)),
  rules_json TEXT NOT NULL CHECK (json_valid(rules_json)),
  reward_json TEXT NOT NULL CHECK (json_valid(reward_json)),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_opportunity_tasks_holder ON opportunity_tasks(holder_id,status);
CREATE TABLE opportunity_task_cycles (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES opportunity_tasks(id) ON DELETE RESTRICT,
  cycle_key TEXT NOT NULL,
  rules_snapshot_json TEXT NOT NULL CHECK (json_valid(rules_snapshot_json)),
  reward_snapshot_json TEXT NOT NULL CHECK (json_valid(reward_snapshot_json)),
  period_start_on TEXT NOT NULL,
  period_end_before TEXT NOT NULL,
  deadline_at TEXT NOT NULL,
  expected_from_on TEXT,
  expected_until_before TEXT,
  progress_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(progress_json)),
  as_of_on TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
  updated_at TEXT NOT NULL,
  UNIQUE(task_id,cycle_key),
  CHECK (period_end_before > period_start_on)
);
```

关联卡 JSON 是一个有界的显式 ID 集合，最多 20 张；所有 ID 在创建及每次写进度时通过 SQL 验证属于该 holder，不能信任 JSON 本身。任务已有周期后规则修改只作用下期。

条件数据结构：

```ts
export interface TaskConditionsV1 {
  schema_version: 1;
  currency: string;
  groups: Array<{
    id: string;
    metrics: Array<
      | { id: string; kind: "amount"; target_minor: number }
      | { id: string; kind: "count"; target_count: number; per_txn_min_minor: number | null }
      | { id: string; kind: "check"; label: string }
    >;
  }>;
  eligible_spend_notes: string | null;
}
export interface ManualProgress {
  as_of_on: string;
  metric_values: Record<string, number | boolean>;
  note: string | null;
}
```

`evaluateTask` 对每个 metric 算 `max(0,target−progress)`，组内全部满足、组间任一满足即达标。不支持自动货币转换，不按总金额推算笔数。快照整批替换，旧 progress 保存在 event.before/after；actor、reason、revision 同 P1 命令协议。

### 8.2 0017：领取、到账和预约

```sql
CREATE TABLE opportunity_fulfillments (
  id TEXT PRIMARY KEY,
  holder_id TEXT NOT NULL REFERENCES card_holders(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('claim','grant','booking','task_result')),
  account_id TEXT REFERENCES opportunity_accounts(id) ON DELETE RESTRICT,
  cycle_id TEXT REFERENCES opportunity_cycles(id) ON DELETE RESTRICT,
  task_cycle_id TEXT REFERENCES opportunity_task_cycles(id) ON DELETE RESTRICT,
  reward_key TEXT,
  source_key TEXT NOT NULL UNIQUE,
  card_id TEXT REFERENCES credit_cards(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('recorded','cancelled','used','pending_settlement','expired')),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  amount_minor INTEGER NOT NULL DEFAULT 0 CHECK (amount_minor >= 0),
  recorded_on TEXT NOT NULL,
  service_at TEXT,
  service_time_zone TEXT,
  external_reference TEXT,
  entry_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(entry_json)),
  settlement TEXT CHECK (settlement IS NULL OR settlement IN ('returned','charged','unknown')),
  usage_id TEXT UNIQUE REFERENCES opportunity_usages(id) ON DELETE RESTRICT,
  note TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (kind='task_result' OR (account_id IS NOT NULL AND cycle_id IS NOT NULL)),
  CHECK (kind!='task_result' OR (account_id IS NULL AND cycle_id IS NULL AND task_cycle_id IS NOT NULL AND reward_key IS NOT NULL AND usage_id IS NULL)),
  CHECK (kind!='booking' OR (card_id IS NOT NULL AND cycle_id IS NOT NULL AND service_at IS NOT NULL AND service_time_zone IS NOT NULL)),
  CHECK (kind!='grant' OR (task_cycle_id IS NOT NULL AND reward_key IS NOT NULL AND cycle_id IS NOT NULL))
);
CREATE INDEX idx_opportunity_fulfillments_account ON opportunity_fulfillments(account_id,status,service_at);
```

服务端事务校验 fulfillment.holder、account.holder、cycle.account、task.holder、actual card 全部一致；数据库也使用同一个 guard view 拒绝不一致 INSERT/UPDATE，避免只验证 ID 存在：

```sql
CREATE VIEW opportunity_invalid_fulfillments AS
SELECT f.id FROM opportunity_fulfillments f
LEFT JOIN opportunity_accounts a ON a.id=f.account_id
LEFT JOIN opportunity_cycles c ON c.id=f.cycle_id
LEFT JOIN opportunity_task_cycles tc ON tc.id=f.task_cycle_id
LEFT JOIN opportunity_tasks t ON t.id=tc.task_id
WHERE (f.kind!='task_result' AND (a.id IS NULL OR a.holder_id!=f.holder_id))
  OR (f.cycle_id IS NOT NULL AND (c.id IS NULL OR c.account_id!=f.account_id))
  OR (f.task_cycle_id IS NOT NULL AND (tc.id IS NULL OR t.holder_id!=f.holder_id))
  OR (f.card_id IS NOT NULL AND f.kind='task_result' AND NOT EXISTS (
    SELECT 1 FROM credit_cards cc WHERE cc.id=f.card_id AND cc.holder_id=f.holder_id
  ))
  OR (f.card_id IS NOT NULL AND f.kind!='task_result' AND NOT EXISTS (
    SELECT 1 FROM opportunity_account_cards ac
    WHERE ac.account_id=f.account_id AND ac.card_id=f.card_id AND ac.holder_id=f.holder_id
  ))
  OR (f.status='used' AND (f.usage_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM opportunity_usages u WHERE u.id=f.usage_id AND u.status='active'
  )))
  OR (f.usage_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM opportunity_usages u
    WHERE u.id=f.usage_id AND u.account_id=f.account_id AND u.cycle_id=f.cycle_id AND u.card_id=f.card_id
  ));
CREATE TRIGGER opportunity_fulfillments_guard_insert AFTER INSERT ON opportunity_fulfillments
WHEN EXISTS (SELECT 1 FROM opportunity_invalid_fulfillments WHERE id=NEW.id)
BEGIN SELECT RAISE(ABORT,'OPPORTUNITY_FULFILLMENT_SCOPE_MISMATCH'); END;
CREATE TRIGGER opportunity_fulfillments_guard_update AFTER UPDATE ON opportunity_fulfillments
WHEN EXISTS (SELECT 1 FROM opportunity_invalid_fulfillments WHERE id=NEW.id)
BEGIN SELECT RAISE(ABORT,'OPPORTUNITY_FULFILLMENT_SCOPE_MISMATCH'); END;
CREATE TRIGGER opportunity_linked_usage_guard BEFORE UPDATE ON opportunity_usages
WHEN EXISTS (
  SELECT 1 FROM opportunity_fulfillments f WHERE f.usage_id=OLD.id AND (
    f.account_id!=NEW.account_id OR f.cycle_id!=NEW.cycle_id OR f.card_id!=NEW.card_id
    OR (f.status='used' AND NEW.status!='active')
  )
)
BEGIN SELECT RAISE(ABORT,'OPPORTUNITY_USE_FULFILLMENT_CORRECTION'); END;
CREATE TRIGGER opportunity_fulfillment_used_guard BEFORE UPDATE ON opportunity_fulfillments
WHEN NEW.status='used' AND (NEW.usage_id IS NULL OR NOT EXISTS (
  SELECT 1 FROM opportunity_usages u WHERE u.id=NEW.usage_id AND u.status='active'
))
BEGIN SELECT RAISE(ABORT,'OPPORTUNITY_ACTIVE_USAGE_REQUIRED'); END;
```

来源 key：普通领取 `claim:<account>:<cycle>`；所有任务奖励统一 `reward:<task_cycle>:<reward_key>`，不因 quota／non_quota 类型不同而变 key；预约 `booking:<uuid>`。普通领取同周期一次；任务奖励业务唯一不依赖客户端幂等 key。

`reward_json` 必须显式区分 `kind='quota'` 与 `kind='non_quota'`。前者记录 `grant` 并创建有有效期的配额；后者记录 `task_result`，account_id/cycle_id 为 null，保存年费减免或礼品实际结果，不生成私人券、不进入今天可用数量。两类都保留 task_cycle、reward_key、actor、日期和事件。

到账创建 Cycle 后登记 fulfillment（可预先生成两个 UUID），整个 batch 成功才存在。该配额不继承一个额外 regular 周期；grant-only 分支绝不创建 regular Cycle。撤销已用奖励不得破坏引用关系，按产品 spec 的整体纠正规则执行。

预约状态迁移：recorded → used／cancelled／pending_settlement；pending_settlement → cancelled（returned）或 cancelled（charged）。使用完再点击使用返回原结果／冲突，不再次扣额度。

由预约完成产生的 usage 不允许直接调用通用 correct/void，返回 `USE_FULFILLMENT_CORRECTION` 并导航履约纠正。统一纠正命令使用同一 batch：先将 fulfillment 临时置为 `pending_settlement` 且清空 usage_id（不改变额度），再反冲／更正 usage 和 Cycle 事件，最后同步 fulfillment 的卡、周期、时间、usage_id 与最终状态，并取消旧提醒作业；任一步失败回滚。仅修正备注也写共同审计，不产生配额 delta。数据库 usage/fulfillment 触发器使绕过服务的直接改动失败。

## 9. RPC 契约

所有新函数首个服务端参数为 actor；下表为客户端可见参数。统一 scope、输入验证、分页与命令服务。

| 函数                             | 输入                                                                         | 输出／行为                                         |
| -------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------- |
| `getOpportunityPage`             | holder_id/card_id/bank_id/category/kind/status/q/cursor/limit                | items、next_cursor、按相同 scope 计算 counts       |
| `getBenefitLedger`               | holder_id/card_id/status/cursor/limit                                        | 账户+本期 Balance+周期+历史异常提示                |
| `getCardOpportunities`           | card_id、limit                                                               | 同一 DTO，账户去重                                 |
| `getOpportunityDetail`           | account_id                                                                   | 关联卡、当前批次、来源、动作、revision             |
| `createOpportunityAccount`       | definition_id、holder_id、card_ids、scope_kind、request_key                  | 新账户；管理员／本人可用的已确认定义按权限初始化   |
| `confirmOpportunityEligibility`  | account_id、eligibility、eligible_from_on、note、expected_revision、key      | 个人资格确认，事件保留                             |
| `confirmOpeningBalance`          | cycle_id、opening_used_count/minor、as_of_on、reason、expected_revision、key | 未逐笔登记的耗用及覆盖日期，不重复计已用           |
| `updateOpportunityCycleWorkflow` | cycle_id、claim_window/booking_window、reason、expected_revision、key        | 更新该批次已确认窗口并重建对应提醒                 |
| `getUsageHistory`                | account_id、from_on/to_on、status、cursor、limit                             | 使用当前投影和审计链                               |
| `recordOpportunityUsage`         | account_id/cycle_id/card_id/used_on/quantity/amount_minor/note/key           | usage+最新 Balance+revision                        |
| `correctOpportunityUsage`        | usage_id、新字段、reason、expected_revision、key                             | 原子更正；失败原状保留                             |
| `voidOpportunityUsage`           | usage_id、reason、expected_revision、key                                     | 幂等撤销                                           |
| `setOpportunityFollowed`         | account_id、followed、expected_revision                                      | 用户状态                                           |
| `getOpportunityCalendar`         | from_on、to_before、holder_id/card_id                                        | 规范 CalendarEvent[]，最多 92 天                   |
| `getOpportunityReminders`        | holder_id/card_id、cursor、limit                                             | 待办+个人状态                                      |
| `updateOpportunityReminderState` | event_key、action、until_at?、expected_revision                              | read/dismiss/snooze/restore                        |
| `exportOpportunityUsages`        | holder_id/card_id/from_on/to_before/kind                                     | 已限定范围的扁平导出 DTO，分页批量                 |
| `getUnassignedLegacyUsages`      | holder_id?、cursor、limit                                                    | 仅管理端，无法归属他人范围时不暴露备注             |
| `assignLegacyUsage`              | source_table/id、account/cycle/card、included_in_opening、reason、key        | 单次映射；必要时 opening→used 原子转分类           |
| `getOpportunityTasks`            | holder_id/card_id/status                                                     | 任务周期+缺口+奖励状态                             |
| `saveOpportunityTask`            | task fields、expected_revision?、key                                         | 创建或下期规则更新                                 |
| `updateManualTaskProgress`       | task_cycle_id、progress、reason、expected_revision、key                      | 当前进度与达标计算                                 |
| `recordOpportunityClaim`         | account/cycle/card、claimed_on、note、key                                    | 激活现有批次，不加额                               |
| `recordTaskRewardReceived`       | task_cycle/reward_key、received_on、reward_kind、usable window?、key         | quota 创建新配额；non_quota 只保存结果，均来源唯一 |
| `recordOpportunityBooking`       | account/cycle/card、service_at/time_zone、quantity/amount、note、key         | 占用配额及 booking                                 |
| `completeOpportunityBooking`     | fulfillment_id、used_on、expected_revision、key                              | reserved→used+usage                                |
| `cancelOpportunityBooking`       | fulfillment_id、settlement、reason、expected_revision、key                   | 三种结算分支                                       |
| `correctOpportunityFulfillment`  | fulfillment_id、允许更正字段、reason、expected_revision、key                 | 领取／预约纠正；跨周期原子处理                     |
| `archiveOpportunityObject`       | object_kind/id、reason、expected_revision、key                               | 逻辑归档，不删除历史                               |

目录管理继续在 `admin` 模块增加 `previewOpportunityCandidates`、`publishOpportunityVersion`、`archiveOpportunityDefinition`；AI 返回候选不写库。旧 `autoEnrichCardBenefits` 保留兼容入口但走候选复核，未复核只返回明确的 `REVIEW_REQUIRED` 提示，不偷偷改变旧数据。

### 9.1 错误格式兼容

保持现有 `{data,error}` envelope，新增可选 `code`、`details`、`request_id`。客户端扩展 `RpcError extends Error`，保留 `.message`，现有 catch 不受影响。

- 400 `INVALID_INPUT`：非法日期、单位、金额、URL、时区、字段长度。
- 401 `UNAUTHENTICATED`。
- 403 `FORBIDDEN_OR_NOT_FOUND`。
- 409 `REVISION_CONFLICT`／`IDEMPOTENCY_CONFLICT`／`QUOTA_EXCEEDED`／`AMBIGUOUS_ACCOUNT`。
- 422 `EXPIRED`／`NOT_STARTED`／`NEEDS_CONFIRMATION`／`INVALID_TRANSITION`。
- 503 `DATABASE_UNAVAILABLE`：保留表单，可按同 key 重试，不暴露内部 SQL。

cursor 是排序字段加 ID 的不透明编码，绑定筛选 hash；更改筛选从第一页开始，不能让客户端通过 cursor 覆盖 scope。

## 10. 提醒和作业身份

### 10.1 事件与节点

```text
event_key = op:<type>:<object_id>:<cycle_or_grant_key>:<business_date_hash>
delivery_key = <event_key>:<step>  # d7/d3/d1/d0/reset/open/service/snooze:<UTC>
tag = wc-op:<delivery_key>
```

business_date_hash 仅使用截止／服务时点、规则时间窗口和会影响动作的版本，不包含备注和当前用量。因此普通用量变化不反复产生新提醒；截止日修正会产生新事件，同时取消旧作业。

read_steps_json 只记录该事件已读的具体节点，最多 16 个；dismissed_at 屏蔽整个事件，snooze_until 抑制原节点并在该 UTC 时间产生一次 snooze 节点。恢复后按当前状态重新判断，不补发已经过时的全部节点。

### 10.2 用户偏好（增量字段）

```ts
export interface OpportunityReminderConfig {
  enabled: boolean;
  web_push_enabled: boolean;
  time_zone: string;
  local_time: string;
  expiry_days_before: number[];
  activity_days_before: number[];
  claim_days_before: number[];
  task_days_before: number[];
  reset_enabled: boolean;
  booking_enabled: boolean;
}
```

存 `reminder_config.opportunities`，旧 `remind_days_before` 和 quiet_hours 保留。读取深合并 defaults，更新只改目标子树。全局 enabled_channels 不含 web_push 时最终不推送。UI 未支持的 email/webhook 不出现为可用渠道。测试推送调用真实 `/api/push/test`，不能用本地 Notification 成功推断服务器连通。

### 10.3 调度与权限变化

新增 `*/15 * * * *`，原 `0 9 * * *` 保留。`worker/index.ts` 按 event.cron 分派，或 `handleScheduled` 内等价分支；每天 09:00 两个触发都到达时，各分支仅执行自己的任务，作业唯一键防重复。

扫描使用显式 env.DB/now，不用共享全局变量切换身份。分批查询活跃账户和用户，按账户 holder 所属管理员以及 auth_user_id 生成各自的事件，之后套个人偏好。发送前重新判权限；解绑、换卡、注销和更改资格立即取消旧作业。用户角色以服务端规则计算，不能信任旧 users.role 字段与 session 不一致时扩权。

作业租约使用条件 UPDATE RETURNING，单个扫描默认最多 claim 50 项，lease 120 秒。推送调用每订阅超时 10 秒，可配置并发 5；达到本次预算保留队列等下轮，不无限循环。全部设备失败不会记 sent；已 accepted 设备不重试。隐私模式下正文不显示人名、尾号或额度，点击回应用后再鉴权。

纯函数测试覆盖 quiet hours 跨午夜、用户时区、DST 跳时和重复小时：不存在的当地提醒时刻顺延到第一个有效时刻，重复小时只用较早一个 UTC instant。规则按日周期不因为用户修改展示时区而变更。

## 11. 迁移与兼容策略

| 阶段     | 操作                                   | 保护条件                               |
| -------- | -------------------------------------- | -------------------------------------- |
| Expand   | 新增 0013/0014 表及字段，旧字段保留    | 空库和现有数据均可升级，不清表         |
| Shadow   | 定义包装、来源待核实、历史归属 dry-run | 不计入已确认可用，不给用户虚假全额余额 |
| API      | 新命令+查询+兼容适配器                 | 新写只走新流水，旧签名多解时报错       |
| UI       | 新台账、机会、详情、提醒               | 旧页面不会继续调用不受约束的 INSERT    |
| Backfill | 用户核对并分配历史，确认期初           | 按源唯一映射、原始数据保留             |
| P2       | 0016/0017 增加任务／履约               | 不重做 P1 余额、不影响旧账单           |

旧接口至少一个兼容版本：原字段类型不移除，增加 `accounts`、`scope_kind`、`balance_verified` 等字段；数字仅作为授权范围聚合展示，禁止旧客户把产品级数字当成单卡额度。需要账户的新写可加可选 account_id/card_id；多解明确报错。`deleteBenefit/deletePromo` 转归档适配器，避免旧按钮级联删历史。

卡状态、持卡人合并和卡归属变化必须纳入回归：`holders.server.ts.mergeHolders` 如果有新账户依赖先显式阻止并提示迁移方案；本轮不自动重分配权益。这样不会出现旧 merge 忽视新表而误删历史。受限删除返回业务冲突，不能变成静默失败。

代码回退到兼容版本可以继续读旧字段与新流水；直接回退到改造前旧写逻辑是不安全的。发布手册标明最低安全版本；生产故障时优先禁用本模块写入并保留数据，而不是删表或双向回填旧数据。

## 12. 查询、日志与验证

- 主列表按 scope 批量查 accounts、cycles、cards、states，分页和 distinct counts 在同一业务快照完成；不允许每行额外 fetch。
- 历史按 `(account_id,used_on,id)`、事件按 `(entity_kind,entity_id,created_at,id)` 使用索引。
- 导出逐页读取，按扁平 DTO 组 CSV；对 `= + - @` 开头文本进行表格公式转义，保留 UTF-8 BOM 和现有格式。
- 日历最多 92 天，任务最多 3×3 条件，卡集最多 20；JSON 字段各自大小上限在验证器声明。
- 写入日志仅包含 request_id、动作、耗时、错误 code、变更数量；不输出 session、push keys、银行参考号及备注全文。
- 日常对账为只读，不自动覆写流水。指标至少包含超额拒绝、revision 冲突、待归属数量、发送失败及过期作业数量。

实现验证必须包括真实 SQL 约束与 D1 batch 回滚。不能用只匹配 SQL 文本的假数据库证明并发安全。

已查阅的技术依据：

- [D1 batch 事务与失败回滚](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)：多语句事务，任一失败整批中止／回滚。
- [Workers Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)：按 UTC 调度，scheduled handler 根据 cron 表达式分派。
- [本地 Cron 测试](https://developers.cloudflare.com/workers/configuration/cron-triggers/#test-cron-triggers-locally)：实际 endpoint 随 Wrangler/Miniflare 版本核实；应用测试优先直接调用 handler 并注入 clock、数据库及推送替身。
