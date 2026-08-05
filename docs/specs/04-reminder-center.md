# Spec: 应用内提醒中心

**状态**: 路线图规划  
**日期**: 2026-04-29  
**相关模块**: 首页、账单、权益、优惠、年费规则

## 目标

在首页提供统一提醒中心，聚合还款临近、已逾期、优惠即将到期、权益即将到期和年费条件待关注事项。用户打开应用后应先看到最需要处理的风险和机会。

## 用户故事

作为用户，我希望首页展示最紧急的还款提醒，以便避免逾期。

作为用户，我希望看到即将过期的优惠和权益，以便优先使用。

作为管理员，我希望按成员、卡片、提醒类型查看全家提醒，以便安排家庭信用卡事项。

作为成员，我希望只看到和自己相关的提醒，以便不被其他人的数据干扰。

作为用户，我希望可以把提醒标记为已读或忽略，以便首页只保留仍需处理的事项。

## 提醒类型

MVP 包含：

- 还款临近：未还清账单距 `due_date` 小于等于 3 天。
- 已逾期：未还清账单 `due_date` 早于今天。
- 优惠即将到期：优惠 `end_date` 小于等于 7 天。
- 权益即将到期：权益 `expiry_date` 小于等于 30 天。
- 年费关注：卡片存在 `annual_fee > 0` 且 `annual_fee_waiver` 非空，但暂无自动判断是否达标。

## 功能需求

### 首页提醒流

首页 `DashboardSummary` 和 `UpcomingBills` 之后增加提醒流：

- 按严重程度排序：已逾期、今天截止、3 天内还款、7 天内优惠、30 天内权益、年费关注。
- 每条提醒展示类型、关联成员、银行、卡片、金额或到期日、建议动作。
- 点击提醒跳转到对应详情页。

### 筛选与聚合

提醒中心支持：

- 按成员筛选。
- 按卡片筛选。
- 按提醒类型筛选。
- 按状态筛选：未读、已读、已忽略。

### 状态管理

用户可对提醒执行：

- 标记已读。
- 忽略。
- 恢复忽略。

如果不建提醒表，已读/忽略状态需要本地或数据库状态表。MVP 建议增加 `reminder_states` 表保存用户级状态。

## 数据设计

建议新增表：

```sql
CREATE TABLE reminder_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reminder_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('read', 'dismissed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, reminder_key)
);
```

`reminder_key` 由提醒类型和业务对象组成，例如：

- `bill_due:{bill_id}`
- `bill_overdue:{bill_id}`
- `promo_expiring:{promo_id}`
- `benefit_expiring:{benefit_id}`
- `annual_fee:{card_id}:{year}`

提醒内容可以实时计算，不必第一版持久化。

## 权限

- 管理员看到自己管理的全家提醒。
- 成员只看到自己的提醒。
- 提醒状态按当前登录用户隔离，同一提醒管理员已读不影响成员。

## 边界情况

- 已还清账单不再产生还款提醒。
- 优惠没有结束日期不产生过期提醒。
- 权益没有到期日不产生过期提醒。
- 被忽略的提醒如果业务状态变化，需要重新出现。例如账单金额或截止日变化。
- 今天截止的账单应比 3 天内截止更高优先级。

## 验收标准

- 首页能展示至少 5 类提醒。
- 点击提醒能进入对应账单、卡片或优惠页面。
- 管理员和成员看到的提醒范围符合权限。
- 已读和忽略状态刷新页面后仍保留。
- 已还清账单的还款提醒自动消失。
