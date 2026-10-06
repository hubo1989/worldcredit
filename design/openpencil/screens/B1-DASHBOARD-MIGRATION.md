# B1 Dashboard 视图层迁移执行清单（方向 D 暗色 · ObsidianUI/Tailwind）

> 状态：**待执行**。逻辑层已抽取（lib/dashboard-metrics.ts + 8 项 characterization 测试全绿）。
> 本文件是机械化执行图纸：绑定已勘察，照单实施即可。

## 已就绪

- Tailwind v4（@tailwindcss/vite，无 preflight）+ `d-*` 暗色 token（app/globals.css @theme）
- StatusBars 组件 vendored（components/obsidian/）+ cn 工具
- 逻辑抽取：computeMetrics / formatMoney / billCurrency / countCardsByHolder 可独立测试

## 新板块数据接线

| 板块 | 数据 | 来源 |
|---|---|---|
| 当天需还款 | `visibleBills.filter(b => b.days_until_due === 0)` | 现有 bills 数据推导，无需新 API |
| 今日优惠统计+入口 | promos 概要（数量+入口） | **需新接**：复用 /promos 路由的数据源；最小实现=入口卡片+数量，数据接不上先出「查看优惠」入口 |

## 区块 → 绑定映射（重写 return JSX 时逐条对照）

1. 页头：头像+「概览/呼博」+ `btn / toggle amount visibility`（`togglePrivacyMode`，44×44，`privacyOn` 切 eye/eye-off）
2. 居中大余额：`metrics.totalPending`（formatMoney + displayCurrency）+ kv `含逾期`/`未来 {futureRange} 天` + privacy blur（`blurClass`）+ 汇率缺失提示（`unconvertedCurrencies`）
3. 逾期风险条：`metrics.overdueBills.length > 0` 条件渲染 + `setPayAllOpen(true)`
4. 当天需还款：上表数据 + 每行 44px CTA
5. 今日优惠：上表
6. 持卡人筛选 pills：`holderPills` + `holderFilter/setHolderFilter`（键盘可达保留）
7. 指标 2×2：已逾期/未来待还(range tabs `FUTURE_RANGES`)/总欠款(`debtExpanded` 展开：分期/贷款暂未接入占位 + 普通未还)/未出账单
8. 账户 chips：`holders` + `cardsByHolder` + `totalCardCount`
9. 金刚区：`quickActions`（记一笔=`setQuickSheetOpen(true)`，其余 router.push）
10. 逾期明细：`metrics.overdueBills` 行（`markBillAsPaid(bill.id, amount)`）+ `handlePayAllOverdue`
11. 保留不动：PayAllDialog（MUI，后续换）、Toast、QuickActionSheet、WcSkeleton(loading)

## 执行步骤

1. page.tsx：`return (` 主返回段整体替换为暗色 D 结构（ above 映射），Dialog/Toast/Sheet 保留
2. MUI import 清理（仅保留仍在用的 Dialog 系）
3. `vinext build` + wrangler dev + seed 实测：default / loading / empty / error + 隐私模糊 + 还款流
4. 前后截图对比入 PR

## 已知边界

- vinext dev 新路由不自动发现（加路由后先 `vinext build`）——框架限制
- dev 根路由 `/` 500 为存量问题（A/B 已验证与迁移无关，基线同样复现）
- 暗色字面值调色板待方向批准后 token 化进漂移门禁
