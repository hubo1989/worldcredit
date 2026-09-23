# WorldCredit · OpenPencil 重设计 — 交接摘要

> 面向接续对话。读完本文 + `DESIGN.md` + `README.md` 即可继续，
> 无需回溯聊天历史。
>
> 最后更新：2026-09-23

---

## 1. 一句话状态

用 OpenPencil 做 WorldCredit 全站重设计的 **Design-as-Code 骨架已搭完并接入 CI**。
11 个母版目前是**现状复刻稿**（忠实还原线上），**重构方向尚未定义**——
这是下一步的起点，不是遗漏。

---

## 2. 当前位置

```
线上真实页面
    ↓ capture.py 实拍
基线（截图 + DOM）            ← design/openpencil/baseline/
    ↓ 按基线复刻
.op 母版（现状复刻稿）        ← design/openpencil/worldcredit-redesign.op
    ↓ 三道校验守护
CI 门禁                       ← .github/workflows/ci.yml

     ↓ 下一步：定义重构方向
    Candidate 母版（目标设计） ← 尚未开始
    ↓ B0 → B5 分批落地
    app/ 实现
```

**关键认知**：现在整条链路在守护「母版 == 线上」。
所以把母版改成新设计会**被 CI 正确拦下**——这是设计意图，不是 bug。
改母版之前必须先定义「改成什么样」，并把校验目标从「等于现状」调整为
「覆盖现状业务字段、允许结构调整」。

---

## 3. 已完成

| 项 | 内容 |
|---|---|
| 设计源 | 单一 `.op`，8 个 Page，63 个变量，2 个主题轴，15 个屏母版 |
| 设计变量 | `vars/foundations.json`（63 token，与 `lib/theme.ts` 命名对齐） |
| 真实基线 | 12 条路由 × 4 态（default/loading/empty/error）= 48 张截图 + 48 份 DOM |
| 母版 | 11 个，全部按基线复刻并对齐 |
| 三道校验 | 字段对齐 / 几何溢出 / 视觉回归 |
| 验收入口 | `verify-batch.sh`，退出码 0/1/2，产出 `batch-report.json` |
| CI | 2 个 job（设计源 + 代码质量），PR 与 push main 触发 |
| Lint 债务 | 从 686 error 清到 0 |

### 11 个母版

`dashboard` `bills` `bill-detail` `card-detail` `analytics`
`benefits` `gmail-ledger` `settings` `auth`
`admin-dashboard` `admin-crud` `admin-ledger`

---

## 4. 必须知道的架构决策

### 4.1 母版是复刻稿

`check-master-fields.py` 校验「母版 `.op` == 线上 DOM」。
往母版里加新设计会 FAIL，这是预期行为。

### 4.2 `op` 是 macOS 专属，CI 装不了

`op` CLI 是 nanobrew formula，Linux runner 无法安装。

| 检查 | 本地 | CI |
|---|---|---|
| 几何溢出 | `check-overflow.py`（引擎版，能算布局容器） | `check-overflow-portable.py`（纯 JSON，只管绝对定位） |

`verify-batch.sh` 自动回退；CI 用 `WC_FORCE_NO_OPENPENCIL=1` 显式指定。
便携版还有引擎版没有的两项能力：母版名称尺寸校验、同层重叠检测。

### 4.3 前置条件按检查区分

- 字段对齐、几何溢出：只需 OpenPencil MCP 可达（**不需要 app 服务**）
- 视觉回归：需要 `wrangler dev` + 种子数据

`verify-batch.sh --source-only` 可脱离服务运行，CI 用的就是它。

### 4.4 汇率必须冻结

多币种折算依赖外部 `api.exchangerate.fun`，金额会漂移。
`capture.py` 拦截该请求返回固定汇率，否则视觉回归全是假阳性（实测 0.796% 噪声）。

### 4.5 仓库是 private

基线含真实数据（邮箱、持卡人名、卡号尾号、金额）。
private 仓库下可接受，保持基线忠实。**若将来转公开必须先脱敏。**

---

## 5. 入库策略

`design/` 共 25MB，只提交 8.5MB：**提交源与判断产物，忽略可精确重建的产物**。

| 入库 | 理由 |
|---|---|
| `worldcredit-redesign.op` | 唯一设计真源 |
| `vars/` `scripts/` `screens/` `*.md` `verify-batch.sh` | 源与规范 |
| `baseline/dom/`（48 份） | 字段真源，检查脚本依赖 |
| `baseline/approved/`（48 张） | 视觉回归基线，人工判断产物 |
| `baseline/seed/` | 种子数据 |

| 忽略 | 重建方式 |
|---|---|
| `baseline/shots/` | `capture.py` 重新实拍 |
| `baseline/diff/` | 每次比对重新生成 |
| `exports/current/` | `export-all.sh` 从 `.op` 导出 |
| `batch-report.json` `visual-report.json` `index.json` `manifest.json` | 含时间戳，CI 走 artifact |

---

## 6. 踩过的坑（避免重复劳动）

### OpenPencil 平台限制

1. **数值属性不接受变量引用**——`cornerRadius` / `spacing` / 尺寸只能写字面值，
   只有颜色可用 `$token`。
2. **`op delete` 只作用于 active page**——清页前必须 `set_active_page`，
   否则删不掉（无报错）。
3. **`op status` 会误报** `{"running":false}`，但 MCP 实际可达。
   用 `op get_document_info` 探测。
4. **未安装字体会静默回退成衬线**——`Noto Sans SC` / `Manrope` 都不存在，
   统一用系统无衬线栈 + `Inter Tight`（金额）。
5. **QuickJS 报错不指向行号**——脚本写完先跑 `node --check`。
6. **本地图片路径无法渲染**——server 沙箱读不到工作区，编辑要用桌面端或 URL。
7. **server 对工作区只读**——导出必须先写临时目录再拷回。

### 业务语义

8. **`bills.status` 不是真源**——状态由读时 `computeStatus()` 依 `payments`
   与 `due_date` 计算。制造「部分还款」必须插 `payments` 行。
9. **多币种来自 `card_products.currency`**，不是 `bill_items.currency`。
10. **`0` 是合法业务数据**（零额账单），不要用真值判断过滤。

### 设计与对比度

11. **`color.status.warning` (#FCB900) 不能做浅底文字**（1.74:1），
    要用 `gold700` (#8A6D1F)；黄底徽章文字用深蓝。
12. **真实持卡人显示名是「呼博」**，不是「胡波」。

### 工程

13. **视觉回归最怕假阳性**——已做三件事：冻结动画（`reducedMotion` +
    注入 `animation:none`）、等 `document.fonts.ready`、固定渲染参数。
14. **字段检查曾自欺**——早期按脚本文本匹配，注释里的字能骗过检查。
    现在解析 `.op` 产物、定位母版 frame 子树。
15. **`npm ci` 在本机曾因网络崩坏**（registry.npmjs.org 不可达 + ENOTEMPTY）。
    GitHub runner 正常；本机可临时用 npmmirror。

---

## 7. 待办

### 下一步（需要用户决策）

**二选一**：

- **A. 先定 B0 Foundation**：token / 组件 / Shell 规范。
  不依赖页面级设计，且正是重画母版的输入。推荐。
- **B. 先出 Candidate 方向探索**：给 Dashboard 与 Bills 各 2-3 个方向。

### 改母版前的必要准备

- [ ] 定义重构方向（问题、目标、视觉语言）
- [ ] 在 `90 · Comparisons` 建 Current / Candidate / Approved 三栏
- [ ] 拆分校验目标：复刻稿要求「等于现状」，目标稿要求「覆盖业务字段、允许结构调整」
- [ ] **不做第 3 项，Candidate 一出现 CI 就会红**

### 后续批次

`B0` Foundation → `B1` Mobile Core → `B2` Mobile Details →
`B3` Mobile Extended → `B4` Auth/Public → `B5` Admin

每批独立 PR，附导帧、前后截图、影响范围、测试方法、未覆盖状态。

### 已知未覆盖

- 视觉回归截图是 `full_page=False`（仅首屏），首屏外改动不会被捕获
- `login` 的 empty 态等价于 default（无数据请求），实际只有 3 张不同图
- 种子数据只覆盖部分业务分支（多币种/部分还款/逾期/免息期已覆盖）

---

## 8. 新对话开场指令

直接把下面这段发给新对话：

```
继续 WorldCredit 的 OpenPencil 全站重设计。先读这三个文件：
  design/openpencil/HANDOFF.md
  design/openpencil/DESIGN.md
  design/openpencil/README.md

当前状态：11 个母版是现状复刻稿，不是新设计。
改母版前必须先定义重构方向，并调整校验目标
（否则字段对齐脚本会正确拦下新设计）。

下一步我想先做【B0 Foundation / Candidate 方向探索】。
```

### 环境前置

```bash
# OpenPencil（几何与字段检查需要）
op start --file design/openpencil/worldcredit-redesign.op
# 或 headless
op start --headless --file design/openpencil/worldcredit-redesign.op

# app 服务（只有视觉回归需要）
npx wrangler dev --port 8787
bash design/openpencil/baseline/seed/seed.sh
```

### 常用命令

```bash
# 三道检查一次跑完（服务不可达时视觉回归自动跳过）
bash design/openpencil/verify-batch.sh
bash design/openpencil/verify-batch.sh --source-only   # 不需要服务
bash design/openpencil/verify-batch.sh --visual-only

# 重建设计源（幂等，自动落盘）
bash design/openpencil/scripts/build-all.sh

# 导出全部母版
bash design/openpencil/scripts/export-all.sh

# 单独跑某道检查
python3 design/openpencil/baseline/check-master-fields.py     # 字段对齐
python3 design/openpencil/scripts/check-overflow-portable.py  # 几何溢出（便携）
python3 design/openpencil/baseline/visual-diff.py             # 视觉回归

# 批准新的视觉基线（人工确认后）
python3 design/openpencil/baseline/visual-diff.py --update
```

### 文件地图

```
design/openpencil/
├── HANDOFF.md              ← 本文
├── DESIGN.md               设计契约 + 基线对齐记录（含被推翻的假设）
├── README.md               命令、CI、踩坑
├── worldcredit-redesign.op 唯一设计真源
├── verify-batch.sh         批次验收入口
├── vars/                   foundations.json（63 token）/ themes.json
├── scripts/                母版构建脚本 + 几何检查
├── screens/_registry.json  23 条路由 → 母版归属与批次
├── baseline/
│   ├── README.md           基线采集、种子数据、汇率为噪声的记录
│   ├── capture.py          实拍 + 四态拦截 + 汇率冻结
│   ├── check-master-fields.py   字段对齐
│   ├── visual-diff.py      视觉比对
│   ├── seed/               业务分支种子数据
│   ├── dom/                48 份 DOM 快照（入库）
│   └── approved/           48 张视觉基线（入库）
└── exports/                导帧（current 不入库）
```

---

## 9. 完成度自评

| 维度 | 状态 |
|---|---|
| 设计源骨架 | ✅ 完成 |
| 真实基线 | ✅ 12 路由 × 4 态 |
| 母版复刻 | ✅ 11 个，与线上对齐 |
| 校验体系 | ✅ 三道检查 + 统一入口 |
| CI | ✅ 2 job 全绿 |
| **目标设计** | ❌ **未开始（下一步）** |
| **代码落地** | ❌ **未开始** |

**一句话**：骨架与护栏已就位，可以开始真正做设计了。
