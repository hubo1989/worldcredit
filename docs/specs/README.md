# WorldCredit Specs

本目录收录已建模但尚未完整实现的能力，以及待实施的产品规格。文档中的“状态”是规划状态，当前实现须以代码和实际验证为准。

## 当前优惠权益实施规格（2026-10-15）

- [信用卡优惠权益：产品 spec](./12-credit-card-benefits-opportunities.md) — 现有问题修复、个人权益台账、可用机会、日历提醒、手动达标任务、领取与预约；包含 24 项验收场景。
- [数据、接口与一致性设计](./12-credit-card-benefits-opportunities-technical.md) — 个人归属、D1 表结构、配额流水、幂等与并发、RPC、迁移兼容、提醒投递。
- [分阶段实施 plan](../plans/2026-10-15-credit-card-benefits-opportunities.md) — 24 项任务、明确文件、依赖顺序、测试、UI 验证和发布边界。

本组文档替代旧 01／02／04／05／06 中与其冲突的优惠权益、提醒设计。旧文档保留历史链接，其中 InsForge/PostgreSQL/RLS、`benefits.card_id` 和“现有 recordPromoUsage API”等描述不适用于当前 Cloudflare D1 实现。

## 历史规格与早期模型（以新规格为准）

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
