# WorldCredit 重设计执行方案（低成本模型分批执行）

> 依据 `HANDOFF.md`、`DESIGN.md`、`README.md`、`screens/_registry.json` 和 2026-09-23 的当前基线。本文是执行提案，不代表设计已获批准或代码已落地。

## 1. 先定目标，不直接重画现状母版

推荐方向：**克制的信用资产驾驶舱**。移动端让用户在第一屏回答「现在有何风险、未来 7 天要还多少、下一步做什么」；账单页让用户按卡定位、筛选、登记还款，并逐级展开历史信息。后台以高密度但可扫读的列表、明确的筛选结果和危险操作确认为主，不照搬移动端大卡片。沿用 navy/blue 品牌与 MUI 的基础色系；金色仅表示临期、红色仅表示逾期/危险，不通过颜色单独表达状态。

这是一套待评审的设计方向，不擅自变更信息架构、业务计算、导航目的地或后端接口。尤其保留持卡人筛选、7/14/30 天切换、总欠款展开、一键结清、固定支出、逐卡历史账单、手工金额、邮件识别失败/部分还款、多币种与汇率缺失提示。高风险操作仍走现有确认与权限路径。

### B1 两屏的具体构图

| 屏 | 首屏优先级 | 次级区与操作 | 不得丢失 |
|---|---|---|---|
| Dashboard | 页头与隐私开关 → 持卡人筛选 → 逾期风险条（无逾期时让位）→ 总待还/未来 7 天 | 7/14/30 天切换、总欠款与未出账单；快捷操作、账户、逾期明细继续向下滚动 | 含逾期口径、金额/币种、单笔与全部还款、四个原快捷入口 |
| Bills | 页头与刷新 → 逾期提醒及确认入口 → 可展开筛选摘要 → 卡片列表 | 每卡主行呈现银行/卡名/尾号/持卡人、状态、待还金额和还款日；次行展开账单日、免息、历史；固定支出保留独立区块 | 按持卡人/银行筛选、未出账单填金额、修改金额、登记还款、历史账单 |

移动稿优先做 390×844，再用 430×932 检查宽屏；小宽度与长中文、超大金额由实现阶段额外验证。后台以 1440×900 为主，另检查较窄桌面宽度。正文用系统中文无衬线栈，金额 `Inter Tight`/tabular-nums；最小触控目标 44，底导航与固定 CTA 留安全区。色值使用现有 token，新增 token 必须同时定义设计源与 `lib/theme.ts` 的对应关系，并检测 WCAG AA。OpenPencil 的数值属性只用与 token 一致的字面值。

## 2. 核心护栏：Current、Candidate、Approved 分轨

当前 11 个母版是 **Current**，现有 `baseline/approved/` 的 48 张图是**应用现状视觉回归基线**，不是目标设计。`90 · Comparisons` 现有三栏只是占位框；`exports/approved/` 才用于存放获批的目标设计导帧。这三类资产不可混名、不可自动互相覆盖。

1. 先建立独立的 Candidate 构建脚本/页面，候选 frame 用明确前缀（例如 `candidate.screen.mobile.dashboard`），保留原 `screen.*` frame 和旧基线原样。将新页面接入 `scripts/build-all.sh` 的清页/重建顺序，确保重复构建不丢候选稿；同一个 `.op` 仍是唯一设计源。不要只在编辑器里手工追加节点。
2. 升级检查前先加最小自测：删 Current 的关键字段必失败；修改 Candidate 布局不能让 Current 校验误报；删 Candidate 的关键业务字段必须失败；重复构建后检查相同。Current 继续走现有 `check-master-fields.py` 的基线一致性检查；Candidate/Approved 改为独立的**字段/动作语义契约**（字段可重排、文案可变化，但标签、状态、操作与去向要覆盖），按精确 frame 标识查节点，不准靠全文件文字搜索或注释通过。不要在契约中硬编码邮箱、姓名、尾号、金额等真实数据。
3. 将候选 frame 纳入便携几何检查及本机引擎检查；目前便携版仅能检查绝对定位，不能凭 CI 通过就宣布布局容器无溢出。在 `90 · Comparisons` 为 Dashboard/Bills 展示 Current / Candidate / Approved 三栏，未审批时 Approved 留空或明确标注“未批准”。Current 可引用现状母版；如需对照真实截图，在本地评审时另开 `baseline/approved/`，不要上传含个人信息的基线到外部工具。
4. 人工评审通过后才把指定 Candidate 标为 Approved 并导出到 `exports/approved/`。应用实现通过浏览器验证后，才能逐路由、逐状态人工批准新的 `baseline/approved/`；绝不为使 CI 变绿直接跑 `visual-diff.py --update`。旧现状基线应可从 Git 历史追溯，报告记录何时、由谁、因何批准。

补充：现有 `check-master-fields.py` 通过“包含子串”找母版，新增 frame 若复用 `screen.*` 命名可能串到错误母版；便携几何也只识别 `screen.*`。在加入 Candidate 时必须同时修正**识别规则**和相应测试。`baseline/README.md` 的采集范围仍写早期的 6×4，更新文档时以已提交的 12×4 资产和注册表为准，避免以旧说明覆盖新事实。

## 3. 批次与每批的完成定义

| 顺序 | 工作包（一个低成本模型任务只做一个小包） | 交付与验收 | 人工决策点 |
|---|---|---|---|
| P0-1 | 给 Current/Candidate/Approved 定精确命名和字段/动作契约格式；先写校验自测 | 正向/负向测试，现有 11 母版 `--source-only` 继续通过 | 确认业务字段表，不以截图文字替代行为 |
| P0-2 | 接入候选页的可重建脚本和双轨检查；只用一个简单样例 frame 试运行 | 两次 build、导帧、`--source-only`、本机引擎无误；Current 不变 | 批准校验机制后才让模型批量画图 |
| B0-1 | 梳理现有 63 token、主题轴、组件与 Shell；修正组件库内不一致的姓名/裸色等示例，仅补必要 token | 一页 Foundation 决策表（旧→新/不变、对比度、用途）、组件状态（default/focus/disabled/error）、Shell 尺寸及安全区 | 确定视觉方向和颜色语义 |
| B0-2 | 各做一张 Dashboard、Bills 的低保真信息层级图，继而各做一张高保真 Candidate | Current/Candidate 并排导帧；关键字段/动作映射；390/430、default/loading/empty/error 与逾期/部分还款例子 | 选定或修订两张代表屏；无批准不开始 B1 实现 |
| B1-1 | Dashboard 展示组件及页面视图替换 | 行为与状态机 characterization tests 先补；保留数据/事件逻辑；浏览器实测 4 态和风险/隐私/还款 | 评审真实运行截图与目标导帧 |
| B1-2 | Bills 展示组件及页面视图替换 | 筛选、逐卡展开、零金额、部分还款、逾期、批量确认等测试；真实操作复核 | 逐路由批准新应用截图 |
| B2 | `/bills/[id]`、`/cards/[id]`、`/holders`、`/holders/[id]`、`/holders/[id]/stats` | 每次只做一个路由；共享 detail 组件先定变体；注册表状态逐个对照 | 一批独立 PR；代表路由有基线，非代表路由要补证据 |
| B3 | `/analytics`、`/benefits`、`/promos`、`/gmail-ledger`、`/settings` | Gmail 先补 characterization tests；缺汇率、识别失败、批量操作/推送拒绝均可验证 | 一批独立 PR，必要时按路由拆 PR |
| B4 | `/`、`/login`、`/register` | OAuth 回调与验证码独立状态；login 先补 characterization tests | 不改认证与回调安全边界 |
| B5 | `/admin`、银行、卡产品、权益、优惠、邮件日志、设置 | 桌面表格、筛选、空/错态与删除确认；角色保护不改 | 后台独立 PR，逐页审阅风险操作 |

注册表共有 23 条路由，但现状有完整 4 态截图的只有 12 条；未覆盖路由按 `screens/_registry.json` 列出状态缺口，不拿“代表母版通过”代替全路由验证。`/ai` 标记为 `IA`，其入口去留需另作信息架构决策，不纳入本轮默认改造。若无显式批准，B0 只交设计规范和 Candidate，绝不主动修改 `app/`。

每批 PR 写清变更、影响、测试、未覆盖状态，走 Review → Merge，不直推 `main`。代码实现批次必须跑 `npm run typecheck`、`npm run lint`、`npm test`、`npx vinext build`；先跑设计源检查，本机运行 OpenPencil 时还要跑引擎几何检查。应用截图验证需先启动 `wrangler dev` 和**本地** seed，确认服务可达、汇率已冻结、console 无错误；仅首屏截图不能证明折叠区/页尾正确，关键交互加整页或滚动截图。不得执行 `seed.sh --remote`。

## 4. 低成本模型的任务协议

每次上下文只给：本文件 + `DESIGN.md` 中有关章节 + **当前路由**的 registry 项、DOM/PNG 基线 + 目标脚本/组件及其直接依赖。不要把 48 张截图、所有页面源码一次性喂给模型；让模型读取指定文件，列出拟修改文件，再动手。设计任务限 1 张屏或 1 个共享组件；实现任务限 1 条路由；校验基础设施可以单独 1 个任务。涉及超过 100 行的源文件，先找对应测试或先加 characterization test；测试缺失要明确记载，不能只声称“视觉无回归”。

每个任务必须以固定格式交付：`修改文件 / 设计或业务字段映射 / 实际运行的命令及退出码 / 导帧或截图路径 / 未覆盖状态与风险`。失败时停止并报告具体错误，不自动放宽阈值、删除字段、更新已批准基线或调整业务口径。低成本模型可以完成结构化编辑和测试；**视觉方向选择、字段是否可删、危险操作、新基线批准**由人审定。

### 可复制任务提示词 A：先做 P0-1（下一步）

```text
在 WorldCredit 仓库执行 design/openpencil/EXECUTION_PLAN.md 的 P0-1。
先读 HANDOFF.md、DESIGN.md 第 1/4/5 节、screens/_registry.json、
baseline/check-master-fields.py、scripts/check-overflow-portable.py 和现有相关测试。
本次只建立 Current/Candidate/Approved 的命名、字段/动作契约方案与最小自测；
不要画新屏，不改 app/，不改 baseline/approved/，不运行 --update。
先列出预期改动文件；测试应覆盖 Current 缺字段失败、Candidate 结构重排仍通过、
Candidate 缺字段或动作失败、两种 frame 不互相借字段。实现检查时精准匹配 frame，
不以个人数据或原文案的子串作为唯一判据。跑 source-only 和新测试，逐项给出退出码。
如果需改变业务字段或现有门禁语义，先提出对照表供人审，不自行放行。
```

### 可复制任务提示词 B：单屏 Candidate（P0 完成并经人审后）

```text
只做 [screen key / route] 的 Candidate 设计，不改现有 Current 母版或 app/。
阅读 EXECUTION_PLAN.md 第 1-3 节、该 route 的 registry states、对应 DOM/PNG 基线、
现状构建脚本和已批准的 B0 token/组件。输出字段/动作映射后，按映射画一个屏和
其最重要的状态变体；使用单一 .op 的可重建脚本，加入 90 Comparisons 的 Candidate 槽。
运行 node --check、两次构建、source-only、本机引擎几何检查、design:refine、导帧。
回报导帧路径、边界状态、缺失字段和实际退出码；不标 Approved，不更新应用截图基线。
```

### 可复制任务提示词 C：单路由实现（Candidate 获批后）

```text
只实现 [route] 已获批的 Candidate，保留原数据获取、事件处理、权限与金额口径。
先读 DESIGN.md 第 5/6 节、该路由现有代码与测试、Approved 导帧、状态契约。
先补关键路径 characterization tests；再仅替换视图层或抽展示组件，不用 codegen
覆盖 app/ 页面。运行 source-only、typecheck、lint、test、build，并在本地 seeded 服务
上验证该路由的 default/loading/empty/error 及 registry 特殊状态和关键操作。
提供前后截图、console 结果、测试输出及未覆盖状态；不要自动执行 visual-diff.py --update。
```

## 5. 当前可验证事实与第一步

2026-09-23 在未启动 OpenPencil 和应用服务的情况下，`WC_FORCE_NO_OPENPENCIL=1 bash design/openpencil/verify-batch.sh --source-only` 返回 **0**：11 个 Current 母版字段通过、15 个屏帧的便携几何检查通过。它不包含布局引擎检查、视觉回归和交互测试。

**建议先交 P0-1 给低成本模型，人工审阅字段/动作契约；随后做 P0-2、B0 两屏方向评审。** 这时才具备安全地启动重设计的条件。
