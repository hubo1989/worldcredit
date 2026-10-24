# iOS 首页与 Web 功能对齐实施计划

**目标：** 保持 SwiftUI 原生卡片、排版、Tab 导航，对齐 Web 已登录首页内容与业务口径。

**架构：** 账单统计/筛选/还款使用本地同步数据；展示偏好、汇率、优惠数量及权益待办通过认证 API 获取并按用户隔离缓存。未原生实现的录入、优惠、权益、邮箱业务以同站受限 WKWebView 衔接，非持久化存储与 Secure/HttpOnly cookie，禁止 token 放 URL。无需生产迁移或部署，除必要 Web 快捷入口参数支持外不改 Web 业务。

**技术：** SwiftUI、WorldCreditCore/GRDB、URLSession、WebKit、现有 RPC 白名单。

## 1. 本地指标与还款

- 新增 Core DashboardMetrics/FX 模型和计算，旧 Summary 接口保持 Watch 兼容。
- 全部持卡人（包括无活跃卡者）、卡数、总待还、逾期、未来7/14/30天、今日账单、普通未还。
- 按币种分组折算；缺汇率排除该币种并显示提示。保留额度指标并对齐折算。
- 一键逾期还款确认，对筛选中的每笔实际剩余金额用现有离线服务/outbox登记。
- 先测试混币、缺汇率、日期边界、筛选、批量付款再实现。

## 2. 首页辅助 API

- 独立服务调用 preferences/dashboard/opportunities RPC；辅助失败不阻断本地账单。
- 汇率沿用 Web endpoint/6小时TTL/4秒timeout；过期不当新数据，缓存按userId。
- 非持久WKWebView使用现有wc_user/Bearer共享session；仅固定HTTPS同站URL带认证，拒绝任意URL。
- 测试报文、失败、缓存过期、账号隔离及异常数据。

## 3. 原生界面

- 首页：头像/隐私、总待还及小计、逾期CTA、持卡人筛选、2×2指标、今日需还、优惠数量/权益待办、账户卡数、快捷入口。
- 保留额度与近期列表。总欠款展开及未出账单未接入提示与Web一致。
- 共享Tab选择；每个入口具有实际动作。隐私覆盖所有首页金额，筛选影响指标和CTA。
- 原生还款sheet及批量确认；未原生业务用受限Web页面，关闭后同步刷新。

## 4. 验证与交付

- Swift测试、TS类型/lint/测试/构建、四target模拟器构建。
- 既有四UI流程及新首页筛选/区间/隐私/还款/入口验证，截图和SQLite/outbox回读。
- 视觉优先glmv-caption，独立Swift/安全审查后修复问题。
- 本轮不提交、推送或部署；保留可审查diff并记录未验证范围。
