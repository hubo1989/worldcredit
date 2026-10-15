# WorldCredit · Design Contract (OpenPencil)

本文件是设计与实现的**契约**。图形在 `.op`，行为在这里，代码在 `app/` 与 `components/`。

## 1. 真源与边界

| 内容 | 真源 |
|------|------|
| 视觉变量 | `vars/foundations.json` → `op vars` |
| 主题轴 | `vars/themes.json`（`mode` / `surface`） |
| 组件与页面 | `worldcredit-redesign.op` |
| 屏幕清单与路由 | `screens/_registry.json` |
| 运行时 token | `lib/theme.ts` |
| 业务行为 | 现有 `app/` / `lib/api/`，不在设计中复制 |

设计变量名与 `lib/theme.ts` 保持一一对应；页面内不出现裸色值。

## 2. Token 约定

色彩分三层：**品牌层**（navy / gold）、**运行层**（当前 MUI primary 系）、**语义层**（success / warning / danger / info）。

已知约束：

- `color.status.warning` (#FCB900) **不得作为浅底上的文字色**，需用 `color.brand.gold700` (#8A6D1F)。
- 黄底 / 金底徽章的文字用 `color.brand.navy800`，不要用白色。
- 深色后台底为 `#0F1117`，面板 `#181A24`，边框 `rgba(255,255,255,0.08)`。
- 语义本色压在自己 10~14% 的淡底上不达 AA（实测 danger 4.16、success 4.36），
  文字一律下沉到 `*Ink` 档：`successInk` `#1B5E20`、`warningInk` `#92400E`、
  `dangerInk` `#B71C1C`、`infoInk` `#01579B`。本色只用于填充、描边与大字号。

> 2026-09-23：设计源曾与实现漂移（旧值 `#16A34A` / `#CF2E2E`，app 已替换为
> `#2E7D32` / `#D32F2F`）。已同步，并补上 app 已有的 `*Ink` 档。
> 漂移与映射由 `scripts/check-token-drift.py` 守护，详见 `screens/TOKEN_DRIFT.md`。

字体：正文用系统无衬线栈；金额用 `Inter Tight` 并启用 `tabular-nums`。不引用未安装字体，避免渲染回退。

数值属性（圆角、间距、尺寸）在 OpenPencil 中**不接受变量引用**，脚本内写字面值，但必须与 token 数值一致。

## 3. 屏幕母版

| 母版 | 代表路由 | 复用页面 |
|------|----------|----------|
| `mobile-dashboard` | `/dashboard` | 首页 |
| `aggregated-list` | `/bills` | 账单列表、分组筛选类列表 |
| `detail` | `/cards/[id]` | `/bills/[id]`、`/holders/[id]` |
| `analytics` | `/analytics` | `/holders/[id]/stats` |
| `catalog` | `/benefits` | `/promos`、`/holders` |
| `ledger` | `/gmail-ledger` | 批处理工作台（独立变体） |
| `auth` | `/login` | `/register` |
| `admin-dashboard` | `/admin` | 后台概览 |
| `admin-crud` | `/admin/banks` | 卡产品、权益、优惠管理 |
| `admin-ledger` | `/admin/email-logs` | 邮件日志 |

## 4. 每个母版的验收清单

信息层级、字段完整性、危险操作二次确认、loading / empty / error 三态、长中文截断、金额对齐、移动端安全区、弹层层级、业务口径一致性。

详细清单见 `.op` 的 `01 · Components → Review Board` 与 `90 · Comparisons → review checklist`。

## 5. 不可回归的业务语义

重设计**只改视图层**，以下保持原实现：

- `MobileShell`：鉴权、Service Worker、提醒、推送。
- `AdminShell`：角色与权限保护。
- 账单状态机：待还 / 部分还款 / 已逾期 / 已还清，以及排序与分组口径。
- 金额与币种：多币种（**来源是 `card_products.currency`，不是 bill_items**）、汇率缺失提示、`formatCNY` 语义。
- 还款、批量操作、邮件同步与识别失败处理路径。
- `0` 是合法业务数据（零额账单），不得用真值判断过滤。

## 6. 代码落地规则

- Codegen 只产出展示组件，先落到临时目录，人工映射进 `components/mobile|admin|auth/`，**不覆盖 `app/` 页面**。
- 页面改造采用「保留数据与事件逻辑，只替换 View Layer」。
- `dashboard`、`bills`、`gmail-ledger`、`login` 在改造前需先补 characterization test。

## 7. 批次

`B0` Foundation（token / 组件 / Shell）→ `B1` Mobile Core → `B2` Mobile Details → `B3` Mobile Extended → `B4` Auth/Public → `B5` Admin。

每批独立 PR，附对应导帧、前后截图、影响范围、测试方法与未覆盖状态。

## 8. 命令

```bash
# 重建全部设计（幂等）
bash design/openpencil/scripts/build-all.sh

# 按 Current / Candidate / Comparisons 角色分目录导出
bash design/openpencil/scripts/export-all.sh
# 可设置 OPENPENCIL_EXPORT_ROOT 将导出定向到隔离目录

# 校验
op design:lint
```

`op` 需要 OpenPencil 在运行（`op start --file ...` 或 headless）。OpenPencil server 对工作区只读，导出脚本会先写临时目录再拷回仓库；Current、Candidate、Comparisons 分别写入 `exports/current`、`exports/candidate`、`exports/comparisons`，不清理既有 PNG。可用 `OPENPENCIL_EXPORT_ROOT` 指定隔离根目录。
## 9. 基线对齐（2026-09-22）

Dashboard 与 Bills 母版已按真实基线重画，依据
`design/openpencil/baseline/dom/{dashboard,bills}/default.json`。
第一版母版是推演稿，结构假设与线上差异很大；以下是**被基线推翻**的假设，
保留在此以防回退：

| 母版 | 推演稿（错） | 真实基线（对） |
|---|---|---|
| Dashboard 页头 | 铃铛 + 设置两个图标按钮 | 单个头像 pill（显示姓氏） |
| Dashboard 副标题 | 「本月 3 张卡待还」 | 「管控信用卡资产与还款日程」 |
| Dashboard 首屏 | 直接进总欠款 Hero | 先有持卡人筛选 pills（全部 / 呼） |
| Dashboard Hero | 「总欠款」+ 本月应还/临期/逾期 | 「总待还款」+ **含逾期 / 未来 7 天** |
| Dashboard 指标 | 4 格等权：本月应还/已还/可用额度/积分 | 2×2：已逾期 / 未来待还（**含 7·14·30 天 tab**）/ 总欠款（**可折叠**）/ 未出账单 |
| Dashboard 账户区 | 无 | 「账户」+ 卡片计数 pill + 持卡人 pill |
| Dashboard 金刚区 | 记一笔 / 同步邮件 / 我的卡 / 优惠券 | 记一笔 / 优惠 / 权益 / **邮箱账单** |
| Dashboard 底部 | 直接结束 | **逾期明细** + 一键全部还款 + 查看全部 + 账单行 |
| Bills 页头 | 「账单」+ 搜索 + 日历 | 「卡片与账单」+ 刷新按钮 |
| Bills 结构 | 月份切换 + 维度分段 + 汇总条 + **蓝色持卡人分组头** | 逾期横幅 + 筛选条 + **逐卡平铺（无分组头）** |
| Bills 逾期处理 | 无 | 顶部横幅「存在 N 笔历史逾期账单未结清」+ 一键还清 |
| Bills 固定支出 | 无 | **独立区块**（标题 + 添加 + 空态文案） |
| Bills 卡片字段 | 银行/尾号/金额/状态/账单日/还款日/免息 | 追加 **持卡人、银行徽章、卡名、历史账单明细折叠** |
| Bills 金额 | 固定展示 | 支持**修改金额**（手动设定分支） |
| Bills 未出账单 | 无独立形态 | 独立形态：**填写金额** + 下期还款约 + 今日刷卡免息 N 天 |
| 持卡人显示名 | 胡波 | **呼博**（真实数据） |
| 多币种 | 假设来自 bill_items | 来自 **card_products.currency**，卡片显示 HK$ / US$ |

### 仍然成立的设计系统约束

重画没有推翻 token 层，以下继续有效：

- 色彩分层（品牌 / 运行 / 语义）与 `vars/foundations.json` 不变。
- 金额用 `Inter Tight` + tabular 对齐。
- 底部导航 56+ 安全区、触控 ≥44、Dialog 走 Portal。
- `color.status.warning` 不得作浅底文字，需用 `gold700`。

### 第二轮：其余 9 个母版（2026-09-22 续）

首轮只对齐了 Dashboard 与 Bills。第二轮补齐其余母版，同样先补基线再重画
（新增 `bill-detail` / `benefits` / `gmail-ledger` / `settings` /
`admin-dashboard` / `admin-email-logs` 六条基线路由）。

被基线推翻的假设（第二轮）：

| 母版 | 推演稿（错） | 真实基线（对） |
|---|---|---|
| 账单详情 | 复用信用卡详情的卡面 + 额度三格 | **独立四格**：应还 / 最低 / 已还 / 剩余；账单周期 / 日期信息 / 数据来源 / 还款记录 |
| 权益页 | 权益目录卡 + 使用进度 | **空态优先**：标题 + 副标题 + AI 搜集权益 / 手动添加 + 一键 AI 自动搜集 |
| 邮箱流水 | 同步状态条 + 待确认/已入账/识别失败 | 全部/未还/部分/已清 **四统计** + 账单总额/待还金额 + tabs + **单行三操作**（标记还款 / 全额已还 / 部分还款 / 详情） |
| 设置（我） | 账户 / 通知 / 偏好三组设置列表 | **「我的」页**：账号 + 管理员卡（进入后台）+ 六项功能入口（家庭管理 / 优惠活动 / 我的权益 / 邮箱账单导入 / 提醒偏好 / 设置）+ 退出登录 |
| 分析 | 时间范围切换 + 趋势柱 + 分类 | 追加 **持卡人筛选**、**风险提示**、**金额已折算为 CNY**、4 项 KPI（账单总额/待还/已还/额度使用率） |
| 后台侧栏 | 6 项导航 | **7 项** + 底部用户 + **返回前台 App** 按钮 |
| 后台概览 | KPI + 趋势图 + 活动流 | 4 紧凑统计卡 + **核心管理模块** 4 入口 + **信用卡产品目录表**（银行/卡片/币种/年费/年费减免/开卡数） |
| 后台银行 | 全部/已启用/已停用 筛选 | **按国家筛选** + **按真实内容补全 (8/67)**；国家列格式 `CN - 中国` |
| 后台邮件日志 | 无独立母版 | 时间/发件人/主题/状态/说明 五列表 + 状态筛选 → 独立 `admin-ledger` 母版 |

新增的第三道检查是**几何溢出**：`scripts/check-overflow.py`。
起因是 `benefits` 页头在 390 宽下塞两个按钮，右侧被裁掉——肉眼可见，
但字段检查和视觉回归都发现不了。该脚本读 OpenPencil 的 layout 快照，
校验 x + width 是否越界，已用受控注入验证（检出 119px / 234px 越界）。

### 重画后的验证方式

母版与基线的对照不是一次性的，用两层检查：

1. **字段完整性**：脚本内文案与 `baseline/dom/*/default.json` 的关键字段清单比对。
2. **视觉回归**：`baseline/verify.sh` 监控实现是否漂移；
   母版改动本身不进回归（回归对象是 `app/` 产物）。

## 10. 权益台账与机会管理（B5 · 2026-10-15，WC-BEN-12）

新增候选帧批次（`scripts/14-opportunity-candidates.js`，页 `13 · Candidates`）：

- `candidate.opportunities.ledger`（390/430）：我的权益台账。
- `candidate.opportunities.list`：我的可用机会。
- `candidate.opportunities.calendar`：权益日历（按日列表优先）。
- `candidate.opportunities.tasks`：消费达标任务（P2，手动进度）。
- `candidate.opportunities.sheet.shared-account` / `.sheet.usage-correction`：共享账户、历史纠错弹层。
- `candidate.opportunities.state.*` × 9：loading / empty / error / needs-confirmation /
  usage-history / conflict / claim / booking / pending-settlement。

### 行为契约（实现与文案必须遵守）

语义红线——以下等式不得混淆，按钮与提示只描述真实效果：

1. **普通领取 ≠ 新增额度**：动作文案用「记录已领取」，不写「领取成功即到账」。
2. **预约 ≠ 已使用**：「记录预约」标注“已在银行或服务商预约后记录”，确认后占用额度。
3. **关注 ≠ 已报名**：关注只影响收藏与个人提醒；禁止「一键享用」「已为您关注」类反馈。
4. **手动达标 ≠ 银行确认**：任务进度标注“手动确认”，发放窗口用“预计”，到账必须显式记录。
5. **未知余额 ≠ 0**：待核对余额显示「余额待核对」，不展示成 0 已用 / 全额可用；无限额显示「次数不限」，不写成 0。
6. **共享账户不随卡数叠加**：按任一关联卡筛选时同一余额池，不复制累加。
7. **跨周期更正原子**：目标周期不足整次失败并提示，原记录保持有效；预约产生的记录走「预约／履约纠正」。
8. **缺日期不猜测**：领取／预约窗口缺具体日期进入「待补充」，不生成猜测事件。

### 状态与文案红线（contract 测试强制）

`tests/test_opportunities_contract.py` 在候选帧文本中扫描禁用词：
「一键享用」「已关注」「我已持卡可享」「已报名」「立即到账」「领取成功」。
新增此类文案会在评审前被测试拦下。
