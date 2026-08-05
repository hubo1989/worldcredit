# WorldCredit Specs

本目录收录当前已建模但界面未完整闭环的能力，以及路线图中待实现能力的产品规格。

## 已建模但界面不完整

- [信用卡权益管理](./01-benefits-management.md)
- [优惠使用记录](./02-promo-usage-recording.md)
- [持卡人邮箱自动绑定成员账号](./03-member-email-binding.md)

## 路线图规划

- [应用内提醒中心](./04-reminder-center.md)
- [PWA 与系统通知](./05-pwa-system-notifications.md)
- [优惠与权益筛选优先级](./06-opportunity-filtering.md)
- [用卡建议引擎](./07-card-recommendation-engine.md)
- [粘贴账单文本批量录入](./08-bill-text-bulk-import.md)
- [智能识别导入账单草稿](./09-intelligent-bill-import.md)
- [消费与负债分析](./10-consumption-debt-analytics.md)
- [报表与导出](./11-report-export.md)

## 通用原则

- 管理员 `admin` 可以维护家庭基础数据；成员 `member` 只能查看自己的数据并记录自助动作。
- 所有权限必须由 RLS 或后端策略兜底，前端隐藏入口只作为体验优化。
- 新功能优先复用现有表结构、`lib/api/*` 封装和移动端页面模式。
- 金额、日期、币种和跨月边界必须有明确校验。
- 涉及识别、推荐、通知的功能必须保留可解释信息，避免黑盒结果直接污染正式数据。
