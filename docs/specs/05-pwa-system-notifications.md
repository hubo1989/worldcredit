# Spec: PWA 与系统通知

**状态**: 路线图规划  
**日期**: 2026-04-29  
**相关模块**: PWA、提醒中心、后台任务

## 目标

在应用内提醒中心稳定后，增加浏览器/PWA 系统通知，让用户不打开应用也能收到关键还款和逾期提醒。第一版只推送还款临近和已逾期，降低误报和打扰。

## 用户故事

作为用户，我希望开启通知权限后收到还款提醒，以便避免忘记还款。

作为用户，我希望设置通知偏好，以便控制是否接收临近还款、逾期提醒和提醒时间。

作为成员，我希望只收到自己的账单通知，以便不会看到其他家庭成员的隐私信息。

作为管理员，我希望收到全家关键账单风险通知，以便统一管理家庭还款。

## 范围

MVP 包含：

- 浏览器通知权限引导。
- 用户级通知偏好。
- 每日定时扫描未还清账单。
- 还款临近通知。
- 逾期通知。
- 通知去重。
- 通知历史记录。

不包含：

- 优惠、权益、年费通知。
- 短信、邮件、微信通知。
- 复杂免打扰时间段。
- 多设备推送订阅管理后台。

## 功能需求

### 权限引导

当用户首次进入提醒中心或首页时：

- 如果浏览器支持通知，展示“开启还款提醒”入口。
- 用户点击后触发浏览器通知授权。
- 用户拒绝后不反复弹窗，只在设置页保留入口。

### 通知偏好

用户可以设置：

- 是否开启还款临近通知。
- 是否开启逾期通知。
- 还款提前提醒天数，默认 3 天。
- 每日通知时间，默认 09:00。

### 定时任务

每日任务执行：

1. 找出启用通知的用户。
2. 按角色计算该用户可访问账单。
3. 找出未还清、临近或逾期账单。
4. 根据通知历史去重。
5. 发送系统通知。
6. 写入通知历史。

### 通知内容

通知标题应简洁：

- `3 天后还款：招商银行 经典白金卡`
- `已逾期：中信银行 账单 ¥3,200.00`

通知正文包含：

- 持卡人。
- 截止日期。
- 待还金额。
- 点击后打开账单详情。

## 数据设计

建议新增：

```sql
CREATE TABLE notification_preferences (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  bill_due_enabled BOOLEAN NOT NULL DEFAULT true,
  overdue_enabled BOOLEAN NOT NULL DEFAULT true,
  due_days_before INT NOT NULL DEFAULT 3,
  notify_time TEXT NOT NULL DEFAULT '09:00',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE notification_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notification_key TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
  error TEXT,
  UNIQUE(user_id, notification_key)
);
```

如果需要 Web Push，还需保存 push subscription。

## 权限与隐私

- 通知内容不得泄露其他成员数据。
- 成员通知只包含自己的账单。
- 管理员通知可包含全家账单，但点击后仍走正常权限校验。
- 通知历史只对对应用户可见。

## 边界情况

- 浏览器不支持通知时展示不可用状态。
- 用户拒绝系统权限时不再自动请求。
- 账单已还清后不再发送通知。
- 同一账单同一提醒类型每天最多发送一次。
- 逾期通知可每日发送，但需要可关闭。
- 时区按用户所在地或系统默认时区处理，第一版可使用服务器配置时区。

## 验收标准

- 用户可开启/关闭通知偏好。
- 定时任务能生成还款临近和逾期通知。
- 同一提醒不会重复轰炸。
- 成员不会收到其他持卡人的通知。
- 点击通知可以打开对应账单详情。
