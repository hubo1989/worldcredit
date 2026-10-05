# 设计源 ↔ 实现 token 漂移（QA 补充，P0-1 延伸）

 > 状态：**全部 5 条漂移已清零**（2026-09-24）。23 个 token 映射三源一致，`knownDrift` 为空。
 > 起因：2026-09-23 UX 审查发现「设计源语义色落后于实现」，且当时**没有任何门禁能发现**。

## 0. 修复记录

| 项 | 动作 |
|---|---|
| `color.status.success` | 设计源 `#16A34A` → `#2E7D32`（同步 app） |
| `color.status.danger` | 设计源 `#CF2E2E` → `#D32F2F`（同步 app） |
| 新增 `*Ink` 档 | `successInk #1B5E20` / `warningInk #92400E` / `dangerInk #B71C1C` / `infoInk #01579B`（设计源此前没有 ink 概念，app 已有） |
| 同步 `.op` | `worldcredit-redesign.op` 内嵌变量由 foundations.json 注册，已一并更新（严格字母序，节点数不变 2185） |
| 文档 | DESIGN.md 第 2 节补语义色与 ink 档说明 |
| `text.primary/secondary/disabled` | **统一到 .phone 体系**（第 2 批，2026-09-24）：设计源与 `theme.ts` 由 `#333333/#636363/#999999` 改为 `#0A1F44/#5B6478/#A0A8B8`，与 `globals.css` 单一来源一致。**此批动了 app 目录**（`lib/theme.ts`、components/ThemeRegistry.tsx）与根 `Design.md` |

因此 `knownDrift` 从 5 条降到 3 条；仍留存的 3 条是**语义分歧**（见第 2 节），
不是「谁落后」，需要产品决策而非机械同步。

> 覆盖面扩大：检查器现已把 `.op` 内嵌变量纳入比对（第 4 个源）。
> 只改 foundations.json 而不同步 .op 会立刻报 `source-drift`，反之报 `source-missing`。

## 1. 问题

设计源 vars/foundations.json、app/globals.css、lib/theme.ts 各存一套语义色。
历史上一度三方不同，导致同一句「逾期」在徽章与主题里渲染成两种红。

现有门禁的盲区：

| 检查 | 覆盖 |
|---|---|
| baseline/check-master-fields.py | 只比文案，不碰颜色 |
| scripts/check-overflow-portable.py | 只看几何 |
| lib/__tests__/color-contrast.test.ts | 只在 app 内部自洽，**不比对设计源** |

## 2. 实测漂移（2026-09-24 全部清零，只读四源解析）

| id | 设计源 | globals.css | theme.ts | 判断 |
|---|---|---|---|---|
| status.success | ~~#16A34A~~ → #2E7D32 | #2e7d32 | #2e7d32 | **已修复**（设计源同步 app） |
| status.danger | ~~#CF2E2E~~ → #D32F2F | #d32f2f | #d32f2f | **已修复** |
| `text.primary` | ~~#333333~~ → **#0A1F44** | #0A1F44 | ~~#333333~~ → **#0A1F44** | **已修复**（统一到 .phone 体系） |
| `text.secondary` | ~~#636363~~ → **#5B6478** | #5B6478 | ~~#636363~~ → **#5B6478** | **已修复** |
| `text.disabled` | ~~#999999~~ → **#A0A8B8** | #A0A8B8 | ~~#999999~~ → **#A0A8B8** | **已修复**（禁用态，WCAG 豁免） |

已对齐（无需动作）：navy800 / navy600 / blue400 / gold500 / gold700 /
runtime.primary / runtime.primaryDark / runtime.secondary / bg.canvas /
bg.surface / bg.subtle / text.onDark / status.warning / status.info。

> 注：审查过程中我曾把 runtime.primaryDark 误判为漂移（误以为 theme 两处都取 primary）。
> 脚本实测证明它已对齐，--report 可直接核对。

### 与实现交叉验证

用像素实测比对线上基线与 .op 导帧，确认方向：

| 颜色 | baseline/approved/bills/default.png | .op 导帧 |
|---|---|---|
| #CF2E2E（设计源旧红） | 0 px | 17,360 px |
| #d32f2f（app 现值） | 14,120 px | 0 px |
| #B71C1C（app danger-ink） | 4,765 px | 0 px |

结论：**是设计源落后于实现，不是 app 缺陷**。修复方向是把设计源同步为
#d32f2f / #ed6c02 / #2e7d32 / #0277bd 并补 ink 档，而不是改 app。

### 对比度（本脚本实算，与 app color-contrast.test.ts 同源）

| 组合 | 对比度 | 结论 |
|---|---|---|
| --danger-ink #B71C1C on 12% 淡底 | 5.48 | 达标 |
| --success-ink #1B5E20 on 12% 淡底 | 6.69 | 达标 |
| --info-ink #01579B on 10% 淡底 | 6.45 | 达标 |
| 本色 --danger on 自己 12% 淡底 | 4.16 | 不达标（故需 ink 档） |
| 本色 --success on 自己 12% 淡底 | 4.36 | 不达标（故需 ink 档） |

最后两行是**故意保留的失败前提**：documentedFailures 断言它们「确实不达标」，
一旦哪天淡底变浅使本色可用，脚本会失败并提示可以简化 ink 方案。

## 3. 判定模型

design / css / theme 三个源最多各取一个声明值，取值不全相同即「漂移」。

| 情形 | 结果 |
|---|---|
| 三方一致 | 通过 |
| 漂移且已登记，登记值与实测完全一致 | 通过（打印 known-drift） |
| 漂移但未登记 | **失败** new-drift |
| 已登记但实测值与登记值不符 | **失败** drift-changed（防止白名单写宽） |
| 已登记但三源实际已对齐 | **失败** stale-known-drift（防止白名单腐化） |
| 对比度低于阈值 | **失败** contrast-fail |
| 文档化前提不再成立 | **失败** documented-premise-broken |

因此白名单**不能掩盖回归**：任何一侧再改一次颜色都会立刻暴露。

## 4. 文件

| 文件 | 作用 |
|---|---|
| screens/_token-map.json | 映射表：19 个 token 对应关系 + 5 条登记漂移 + 3 项对比度 + 2 项文档化前提 |
| scripts/check-token-drift.py | 便携检查器（stdlib，不依赖 op） |
| tests/test_token_drift.py | 32 个自测 |
| screens/TOKEN_DRIFT.md | 本文 |

## 5. 自测覆盖

| 场景 | 断言 |
|---|---|
| 三方一致 | 通过 |
| 两方不同（design 旧色 vs app 新色） | new-drift 失败 |
| 大小写不同 | 不算漂移 |
| 漂移值被改写 | drift-changed 失败 |
| 登记项其实已对齐 | stale-known-drift 失败 |
| 对比度不足 | contrast-fail 失败 |
| 无法解析前景或底色 | contrast-unresolved 失败 |
| 文档化前提被推翻 | documented-premise-broken 失败 |
| 重复 id / 未知 token / 无 app 侧来源 | 退出码 2 |
| designOnly 冗余或漏登记 | 退出码 2 |
| CSS 只解析首个 :root | admin 暗色块不污染亮色世界 |
| 对比度数学 | 黑/白=21、同色=1、#818cf8/白=2.98（与 app 测试一致） |
| 真实仓库 | 三方一致或漂移均已登记，退出码 0 |

## 6. 待人工决策

1. 五条登记漂移的定性：status.success / status.danger 是**设计源待修**；
   text.primary / text.secondary / text.disabled 是**语义分歧**（css 与 theme 指的不是同一个东西），
   需要决定统一为一个值，还是给设计源补独立 token。
2. 是否把本检查接入 verify-batch.sh 成设计源第 3 道检查（会改变 CI 内容）。
3. 是否同时把 ink 档补进 foundations.json（设计源目前完全没有 ink 概念）。
4. 修复顺序：先同步设计源到 app，还是先统一 globals.css 与 theme.ts 的文本色语义。

## 7. 未覆盖

- 不校验 app 目录里散落的字面色值；只比对三个 token 源。
- 不校验间距 / 圆角 / 字号 / 字重的漂移（font.size.* / space.* / radius.* 尚未纳入映射）。
- 暗色世界的漂移未纳入（adminDarkTheme 与 color.bg.admin.* 已解析但未做映射比对）。

### 2026-10-05 决策（Hubert）

- 漂移检查已接入 verify-batch（第 4 道设计源检查），CI 已绿——本条已落地。
- 历史登记的 5 条漂移已在 token 统一轮**全部修齐**，knownDrift 现为空（零容忍政策：漂移一律失败，不设白名单）。
- documentedFailures（ink 档前提）继续由检查器单独守护，前提失效即报错。
