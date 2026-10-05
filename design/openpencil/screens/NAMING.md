# Current / Candidate / Approved 命名与字段·动作契约（P0-1）

> 状态：**提案，待人工批准**。本文件只定义命名与校验契约，不含任何目标视觉设计。
> 批准前不得接入 `verify-batch.sh`、不得标 Approved、不得据此改 `app/`。

## 1. 角色与命名规则

三类资产在同一 `.op` 内以 **frame 名前缀**区分，前缀即角色，禁止混名：

| 角色 | 前缀 | 含义 | 当前是否已存在 |
|---|---|---|---|
| Current | `screen.` | 现状复刻母版，校验目标是「覆盖线上结构元素」 | 15 个 frame |
| Candidate | `candidate.` | 目标设计候选稿，可多稿并列 | 0 个 |
| Approved | `approved.` | 人工批准、作为实现基线的目标稿 | 0 个 |

frame 名完整形态：

```
<role-prefix><surface>.<key>[ · <variant>] · <W>×<H>
```

- 示例：`screen.mobile.dashboard · 390×844`、`candidate.mobile.dashboard · 390×844`、
  `screen.auth.login · error · 390×844`。
- `variant` 用于同一屏的状态变体（`error` / `empty` / `420×932` 之外的尺寸仍写 `W×H`）。
- 尺寸段 `W×H` 必填，`check-overflow-portable.py` 会校验声明尺寸与实际尺寸一致。

### Frame 身份（identity）与精确匹配

身份 = 四元组 `(role, key, variant, W×H)`，其中 `key` 是**去掉尺寸与 variant 后的完整头部**
（例如 `screen.mobile.dashboard`）。条款如下：

1. **契约只按 `key` 的完整字符串相等匹配**，不做子串 / 前缀 / 模糊匹配。
2. `candidate.mobile.dashboard-extra`、`screen.mobile.dashboard2` 属于**不同 key**，
   不被 `screen.mobile.dashboard` 的契约覆盖。
3. 字段/动作判据只在**该 frame 自身的子树**内收集，同页相邻母版互不借字段。
4. 同一 `(role, key, variant, W×H)` 出现两次即 `duplicate-frame` 失败。

> 已知风险（P0-2 处理）：现有 `baseline/check-master-fields.py` 用 `needle in name` 找母版，
> 一旦新增 `screen.*` 命名的 frame 就可能串到错误母版；`check-overflow-portable.py`
> 只识别 `screen.*`，不认 `candidate.*` / `approved.*`。本文件先把精确匹配规则定死并自测，
> **不改**那两个脚本的语义，改造列入第 6 节待确认项。

## 2. 契约文件 `_contract.json`

```jsonc
{
  "version": 1,
  "reviewStatus": "proposed",
  "rolePrefix": { "current": "screen.", "candidate": "candidate.", "approved": "approved." },
  "defaults": { "applyTo": ["current", "candidate", "approved"], "requiredRoles": ["current"] },
  "screens": [
    {
      "id": "mobile.dashboard",
      "key": "screen.mobile.dashboard",
      "registryKey": "screen.mobile.dashboard",
      "fields": [
        { "id": "hero.pending", "kind": "field",
          "markers": [ { "node": "hero / total pending" } ],
          "allMarkers": [ { "label": ["总待还款", "待还总额"] } ] }
      ],
      "actions": [
        { "id": "action.repay_all", "kind": "action",
          "markers": [ { "node": "btn / 一键全部还款" } ] }
      ]
    }
  ]
}
```

语义：

- `key` 写 Current 全名；其它角色的期望 key = 前缀替换（`screen.` → `candidate.` / `approved.`）。
- `applyTo`：哪些角色要按本契约校验；`requiredRoles`：哪些角色**必须存在**该 frame
  （缺则 `missing-frame` 失败）。默认只有 `current` 必须存在，
  这样 Candidate 还未开画时契约不会误报。
- `fields` / `actions` 是**同一套业务语义**，三个角色共用：Candidate 换布局、改文案都不豁免，
  但不能凭文案子串放行。

## 3. 判据分级（为什么不能只比字面）

每个 requirement 由 marker 组成，判定：`markers` 命中数 ≥ `minMarkers`（默认 1）**且** `allMarkers` 全部命中。

**锚点强度分级**（脚本会按最强锚点给每个 requirement 归类，弱到 `text` 的会单独报给人审）：

| 强度 | marker | 匹配对象 | 说明 |
|---|---|---|---|
| 最强 | `node` | 结构节点名 | 归一化后**完全相等** |
| 强 | `nodePrefix` + `min` | 结构节点名前缀 | 「至少 N 个卡片/胶囊/tab」 |
| 强 | `textNode` + `min` | 文本节点内容 | **整节点相等**（非子串），可带同义词数组 |
| 中 | `within` + 上述任一 | 具名容器 | 把搜索收紧到该节点子树；容器缺失即失败 |
| 弱 | `label` | 拼接后的可见文案 | 归一化后子串命中；仅作辅助 |
| 弱 | `pattern` | 拼接后的可见文案 | 正则，用于「存在 N 笔…」这类结构可变文案 |

硬约束：

- **action 类 requirement 必须至少有一个结构锚点**（`node` / `nodePrefix` / `textNode`），
  纯文案不算「动作存在」，避免删掉按钮却靠残留文字通过。
- 契约内的具体金额一律用 `pattern` 表达（如 `[¥￥]|[A-Za-z]{2}\\$`），不写数值。
- 只靠 `label` / `pattern` 的 requirement 属最弱环节，脚本在 `INFO` 行与
  `--json` 的 `weakRequirements` 里显式列出，供人审决定是否补结构锚点。
  当前 Dashboard/Bills 契约已无纯文案项（全部落在具名节点或具名容器内）。
- 契约内不得出现个人数据或具体金额：脚本在加载契约时机械拒绝邮箱、`尾号`、
  4 位以上连续数字、货币符号紧跟数字的串，以及已知姓名 / 邮箱本地串。
  表达「金额字段存在」时用 `pattern`（如 `[¥￥]|[A-Za-z]{2}\$`），不写具体数值。
- 归一化 = 去掉全部空白（含全角空格），因此母版 `7天` 与线上被样式拆开的 `7` + `天` 等价。

## 3.1 自测覆盖（`design/openpencil/tests/test_frame_contract.py`）

| 场景 | 断言 |
|---|---|
| Current 缺字段 | 删 `metric / 未出账单` → `metric.unbilled` 失败 |
| 残留文案不能救缺失字段 | 删节点但把 `未出账单` 留在别处 → 仍失败 |
| Candidate 结构重排 | 子树 children 全倒序 + 换同义文案 → 通过 |
| Candidate 缺字段 | 删 `overdue header` → `overdue.section` 失败 |
| Candidate 缺动作 | 删 `btn / 一键全部还款` → `action.repay_all` 失败 |
| 动作只剩文字 | 删按钮留文案 → 仍失败（结构锚点） |
| textNode 必须整节点相等 | `查看全部` 改成 `查看全部逾期账单` → 失败 |
| 两种 frame 不互借字段 | 只删 current / 只删 candidate、同页相邻母版，各自仍失败 |
| 同一 head 多变体 | 430 变体缺字段 → 失败（契约与尺寸无关） |
| frame 名精确匹配 | `...dashboard2` / `candidate....dashboard-extra` / Comparisons 外壳 → 均不算覆盖 |
| 重复身份 | 同 head 同尺寸出现两次 → `duplicate-frame` |
| 未声明 frame | 出现 `approved.*` 但契约未覆盖 → `undeclared-frame` |
| 契约卫生 | 邮箱 / `尾号` / 长数字 / 具体金额 → 退出码 2；`pattern` 表达金额合法 |
| 注册表一致性 | 伪 `registryKey` → `registry-mismatch` |
| 真实集成 | 真实 `.op` + 真实契约 → 退出码 0 |

## 4. 对照表：与现有门禁的关系（供人审）

| 维度 | 现有 `check-master-fields.py` | 新增 `check-frame-contract.py` | 是否改变现有语义 |
|---|---|---|---|
| 被检查对象 | `.op` 产物，11 个 Current 母版 | `.op` 产物，`_contract.json` 声明的 frame | 否（新增独立脚本） |
| frame 定位 | `needle in frame_name`（子串） | `key` 完整字符串相等 | 否 |
| 判据 | 人工归纳的结构元素子串（含数据无关文案） | 结构锚点为主 + 文案同义词/正则为辅 | 否 |
| 个人数据 | 清单里含 `hubo1989@gmail.com`、`呼博` 等真实数据 | 机械禁止，违规即退出码 2 | 否 |
| 角色 | 只认 `screen.*` | 认 `current/candidate/approved` 三前缀 | 否 |
| 接入位置 | `verify-batch.sh` 检查 1，CI `design-source` | **未接入**，仅本地可跑 | 否 |
| 退出码 | 0 / 1 / 2 | 0 / 1 / 2（同约定） | 否 |

结论：本批次**不改变任何现有门禁语义**，只在旁边加一套候选期契约与自测。
是否把新检查接入 `verify-batch.sh` / CI、是否扩展便携几何检查识别 `candidate.*`、
是否把 `check-master-fields.py` 的子串匹配改成精确匹配 → 见第 6 节，由人决策。

## 5. 字段 / 动作契约对照表（Dashboard · Bills）

以下是从**当前 Current 母版实读**得到的映射，`field` = 信息必须覆盖，`action` = 操作入口必须存在。
请逐行确认：可删 / 可并入 / 需新增同义词 / 是否属于业务口径。

### `screen.mobile.dashboard`

| id | 类型 | 结构锚点 | 允许文案 | 备注 |
|---|---|---|---|---|
| `hero.pending` | field | `hero / total pending` | 总待还款 / 待还总额 | Hero 主金额标签 |
| `hero.incl_overdue` | field | `kv / 含逾期` | 含逾期 | 逾期口径必须可见 |
| `hero.next7` | field | `kv / 未来 7 天` | 未来 7 天 | 7 天口径 |
| `metric.overdue` | field | `metric / 已逾期` | 已逾期 | |
| `metric.future` | field | `metric / 未来待还` | 未来待还 | |
| `metric.total_debt` | field | `metric / 总欠款` | 总欠款 | 可折叠 |
| `metric.unbilled` | field | `metric / 未出账单` | 未出账单 | |
| `metric.unbilled_copy` | field | `within: metric / 未出账单` | 暂无数据 / 邮件解析待接入 | 空态文案，允许改写 |
| `range.tabs` | field | `tab / 7天` + `14天` + `30天`（all） | — | 三个 tab 必须齐全 |
| `holder.filters` | field | `holder filters` + `within: holder filters` 的 `pill /` ≥2 | — | 持卡人筛选不可丢 |
| `account.section` | field | `account header` | 账户 | |
| `quick.actions` | field | `quick actions` + `quick /` ≥4 | — | 四个金刚位 |
| `overdue.section` | field | `overdue header` | 逾期明细 | 无逾期时可让位 |
| `bill.amount_label` | field | `within: overdue bill row` | 待还金额 / 当前待还金额 | 逾期行金额标签 |
| `money.format` | field | pattern | — | 金额与币种可见 |
| `bottom_nav` | field | `tab / 首页`+`账单`+`我的`（all） | — | |
| `action.repay_all` | action | `btn / 一键全部还款` | 一键全部还款 | 危险批量操作 |
| `action.repay_single` | action | `btn / 全额结清` | 全额结清 / 全额还款 | 单笔结清 |
| `action.view_all_overdue` | action | `textNode`（整节点相等） | 查看全部 | 是文本链接，故用整节点相等而非子串 |
| `action.quick_record` | action | `quick / 记一笔` | 记一笔 | |
| `action.nav_bills` | action | `tab / 账单` | 账单 | 底部导航去向 |

### `screen.mobile.bills`

| id | 类型 | 结构锚点 | 允许文案 | 备注 |
|---|---|---|---|---|
| `header.title` | field | — | 卡片与账单 | |
| `header.refresh` | field | `btn / refresh` | — | 刷新入口 |
| `banner.overdue` | field | `overdue banner` + pattern `存在\d+笔历史逾期账单未结清` | — | N 可变，故用正则 |
| `filter.trigger` | field | `filter trigger` | 筛选 | |
| `filter.dimensions` | field | `filter bar` | 按持卡人 / 逾期优先 | 维度摘要 |
| `payables.section` | field | `payables header` | 固定支出 | |
| `payables.empty` | field | `payables empty` | — | 空态区块 |
| `bill.cards` | field | `bill card /` ≥1 | — | 逐卡平铺 |
| `bill.status_nodes` | field | `status /` ≥4 | — | 四种状态结构覆盖 |
| `bill.status_labels` | field | `textNode` ≥4 | 逾期 / 部分还款 / 待还款 / 未出账单 | 状态语义齐全 |
| `bill.amount_label` | field | `textNode` | 当前待还金额 / 待还金额 | |
| `bill.amount_override` | field | `textNode` | 修改金额 | 手工金额分支 |
| `bill.date_block` | field | `date block` | 账单日 + 本期还款日 | 两个都要 |
| `bill.history` | field | `history toggle` | 历史账单明细 | 可展开历史 |
| `bill.unbilled_amount` | field | `textNode` | 填写金额 | 未出账单分支 |
| `money.format` | field | pattern | — | 多币种可见 |
| `bottom_nav` | field | `tab / 首页`+`账单`+`我的`（all） | — | |
| `action.repay_all` | action | `btn / 一键还清` | 一键还清 / 一键全部还清 | 危险批量 |
| `action.filter_open` | action | `filter trigger` | — | |
| `action.add_payable` | action | `btn / 添加` | 添加 / 新增 | |
| `action.register_payment` | action | `btn / 登记还款` ≥1 | 登记还款 | 每卡入口 |
| `action.amount_override` | action | `textNode`（整节点相等） | 修改金额 | 是文本触发，故用整节点相等 |
| `action.unbilled_amount` | action | `textNode`（整节点相等） | 填写金额 | 同上 |
| `action.nav_home` | action | `tab / 首页` | 首页 | |

未覆盖：其余 13 个 Current frame（`bill-detail` `card-detail` `analytics` `benefits`
`gmail-ledger` `settings` `auth` `admin-*`）尚未写契约，属有意缩范围，不视为通过。

## 6. 待人工决策（不在本批次自行放行）

1. 第 5 节对照表中标「可删 / 可并入」的字段口径。
2. 是否把 `check-frame-contract.py` 接入 `verify-batch.sh` 成第 3 道设计源检查（会改变 CI 内容）。
3. 是否把 `check-overflow-portable.py` 的识别从 `screen.*` 扩到 `candidate.*` / `approved.*`。
4. 是否把 `check-master-fields.py` 的子串匹配改为精确 key 匹配（会改变现有 FAIL 判定面）。
5. 是否把 `_contract.json` 覆盖到剩余 13 个 frame，以及 Candidate/Approved 的 `requiredRoles` 何时收紧。
6. token 漂移（设计源 ↔ `globals.css` ↔ `theme.ts`）：是否接入门禁，以及 5 条已登记漂移如何定性。详见 `screens/TOKEN_DRIFT.md`。

## 7. 本轮未覆盖的风险

- 便携几何检查仍只覆盖 `screen.*`；Candidate 帧出现后其绝对定位越界**不会**被现有 CI 发现。
- 契约只校验「字段/动作在不在」，不校验视觉层级、状态机、金额口径与交互行为。
- 视觉回归基线（`baseline/approved/` 48 张）是应用现状，与 Candidate 无对应关系，
  在没有 `exports/approved/` 导帧前，Candidate 没有任何像素级门禁。
- `429×932` 等宽屏变体、超长中文与超大金额仍靠人工与后续实现阶段验证。
- 设计源与运行时 token 的漂移已由 `scripts/check-token-drift.py` 覆盖（见 `TOKEN_DRIFT.md`），但间距 / 圆角 / 字号 / 字重与暗色世界仍未纳入。

## 8. B0-2 采纳的补充约定（2026-10-05，随候选样例批次）

- `candidate.<surface>.<key>` 的 surface 可扩展为 `state` / `wireframe`：
  状态样例（loading / empty / error）与低保真层级图用**独立 head**
  （如 `candidate.state.dashboard-loading`、`candidate.wireframe.dashboard`），
  登记进 `_contract.json` 的 `uncovered`——几何/命名检查覆盖，字段契约豁免。
  原因：字段契约要求同 head 所有变体满足全部锚点，与"骨架/空态天然缺字段"冲突。
- `· <variant> · W×H` 的 variant 语法仍保留给**满足完整契约的状态无关变体**
  （如 430 宽屏默认态）。
- 状态样例转正（进入 B1 实现契约）时，应升格为独立 screens 条目或带状态维度的
  契约扩展，不应长期停留在 uncovered。

### 2026-10-05 决策（Hubert）

1. 第 5 节对照表：**全部字段/动作保留**，无可删 / 可并入项。
2. `check-frame-contract.py` 已接入 verify-batch（第 3 道设计源检查），CI 已绿——本条已落地。
3. 几何检查已扩到 `candidate.*`（P0-2）；`approved.*` 待首批批准帧出现时一行正则补上。
4. `check-master-fields.py` 子串匹配已改精确 head 匹配（诱饵帧判别实验：旧算法被串到 exit 1，新算法 11/11 exit 0）。
5. 契约覆盖：认可「随批次补」节奏；requiredRoles 收紧采用屏级覆盖机制（checker 已支持），dashboard 的 candidate 待 Bills 候选落地后一并激活（避免 bills 因缺帧误报）。
