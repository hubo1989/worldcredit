# WorldCredit · OpenPencil Design-as-Code

单一 `.op` 设计源 + 可重建脚本 + 屏幕注册表。所有设计资产随代码走 Git。

## 权威文件

| 文件 | 作用 |
|------|------|
| `worldcredit-redesign.op` | 唯一的可视化设计源，按 Page 分区 |
| `DESIGN.md` | 设计契约：token 口径、组件清单、各屏业务约束 |
| `vars/foundations.json` | 设计变量（token 真源），与 `lib/theme.ts` 命名对齐 |
| `vars/themes.json` | 主题轴（`mode` / `surface`） |
| `screens/_registry.json` | `screen key → route → 状态覆盖` 注册表 |
| `scripts/*.js` | 重建脚本，`op design @scripts/x.js` 幂等重放 |
| `codegen-plan.json` | Codegen 分块计划（只用于展示组件，不覆盖页面逻辑） |
| `exports/current/` | Current 母版导帧，用于评审 |
| `exports/candidate/` | Candidate 候选稿导帧，与 Current 隔离 |
| `exports/comparisons/` | 对比板页面导帧 |
| `exports/approved/` | 已确认的母版导帧，作为实现基线 |

## 约定

- 单一 `.op` 是**唯一真源**；`Vars`/`Components`/`Screens` 由脚本重建，不手工在画布上叠加不可复现的节点。
- 设计变量先于页面。变量命名与代码 token 1:1 对应，禁止在页面里写裸色值。
- 组件先于页面。页面通过 `ref` 实例化组件，禁止复制粘贴卡片再逐个微调。
- 图标统一 `icon_font` + Lucide 名称，不使用 emoji，不使用未 refine 的 `path`。
- 每个母版必须挂在 `90 · Comparisons` 与 `exports/approved` 各一份。
- 业务语义（状态机、权限、金额口径）写在 `DESIGN.md`，不写进图形。

## 常用命令

```bash
# 启动（桌面编辑器 / 无头 / 浏览器）
op start --file design/openpencil/worldcredit-redesign.op
op start --headless --file design/openpencil/worldcredit-redesign.op

# 重建
op design @design/openpencil/scripts/01-foundations.js
op design @design/openpencil/scripts/02-components.js
op design @design/openpencil/scripts/10-mobile-core.js

# 校验与导帧
op design:lint
bash design/openpencil/scripts/export-all.sh
# 隔离导出（例如测试）
OPENPENCIL_EXPORT_ROOT="$(mktemp -d)" bash design/openpencil/scripts/export-all.sh
```

## 边界

- 不在 `design/` 存放业务逻辑、API 或 mock 数据结构的第二份真源。
- 不把 OpenPencil 生成的整页 React 覆盖到 `app/`；Codegen 只产出展示组件，进入 `components/` 前人工映射。
- `dashboard`、`bills`、`gmail-ledger`、`login` 的视图层改造必须保留原状态机。

## 批次验收入口

三道检查一次跑完：

```bash
bash design/openpencil/verify-batch.sh                  # 全部
bash design/openpencil/verify-batch.sh --source-only    # 只查设计与母版（不需要服务）
bash design/openpencil/verify-batch.sh --visual-only    # 只查视觉回归
bash design/openpencil/verify-batch.sh --only dashboard bills
bash design/openpencil/verify-batch.sh --threshold 0.01
```

| # | 检查 | 脚本 | 校验对象 |
|---|------|------|----------|
| 1 | 字段对齐 | `baseline/check-master-fields.py` | `.op` 母版产物 vs 真实基线 DOM |
| 2 | 几何溢出 | `scripts/check-overflow.py` | `.op` 布局是否越出视口 |
| 3 | 视觉回归 | `baseline/capture.py` + `visual-diff.py` | 实拍 `app/` 产物 vs 已批准基线 |

退出码：`0` 通过 / `1` 有失败 / `2` 前置条件缺失。机器可读报告落在
`design/openpencil/batch-report.json`。

前置条件按检查区分，**服务不可达不会阻断前两项**：

- 字段对齐、几何溢出：OpenPencil MCP 可达（桌面端或 headless 在跑）
- 视觉回归：本地服务 `http://127.0.0.1:8787` + 种子数据

`--source-only` 在 CI 里可以脱离服务运行，只守护设计源质量。

### 三个踩过的坑

**`op status` 不可靠。** 它返回 `{"running":false}` 时 MCP 其实可达，
入口因此改用 `op get_document_info` 探测。

**字段检查曾自欺。** 早期版本按**脚本源码文本**匹配，注释里的「逾期明细」
满足了检查——删掉真实节点后依然 PASS。现在改为解析 `.op` 产物、
定位到具体母版 frame 子树收集文本节点。验证方式也相应调整：
只改脚本不重建应仍 PASS，重建后才 FAIL。

**汇率让截图不可复现。** 多币种折算依赖外部 `api.exchangerate.fun`，
金额会随汇率漂移，实测导致 dashboard 差异 0.796%（纯噪声）。
`capture.py` 现在拦截该外部请求并返回固定汇率，写入
`index.json.deterministic.fxFrozen`。冻结后同页连拍两次 SHA256 完全一致。

### 失败路径验证

三条路径都用受控注入验证过会正确拦截：

| 注入方式 | 结果 |
|---|---|
| 删除母版的「逾期明细」节点并重建 | 字段对齐 FAIL exit 1，定位到缺失元素 |
| 把权限页按钮内距改成 200px | 几何溢出 FAIL exit 1，检出 119px / 234px 越界 |
| 修改已批准基线的 Hero 区域 | 视觉回归 FAIL exit 1，检出 18.688% |

## CI（PR 门禁）

`.github/workflows/ci.yml` 有两个 job，都在 PR 与 push 到 `main` 时跑：

| Job | 内容 |
|---|---|
| `design-source` | `verify-batch.sh --source-only`：字段对齐 + 几何溢出 |
| `code-quality` | `typecheck` / `lint` / `test` / `vinext build` |

设计源 job 会把 `batch-report.json` 作为 artifact 上传（保留 14 天）。

### 为什么 CI 用便携版几何检查

`op` CLI 是 **macOS 专属的 nanobrew formula**，Linux runner 装不了，
`check-overflow.py`（引擎版）依赖它计算布局，因此不能进 CI。

`check-overflow-portable.py` 直接解析 `.op` JSON，可在任意平台运行：

| 能力 | 引擎版 | 便携版 |
|---|---|---|
| 绝对定位节点越界 | ✅ | ✅ |
| 母版名称声明尺寸 vs 实际 | — | ✅ |
| 同层绝对定位节点重叠 | — | ✅ |
| `layout: horizontal\|vertical` 容器内的子节点越界 | ✅ | ❌（坐标不落盘） |

`verify-batch.sh` 在探测到 OpenPencil 时用引擎版，否则自动回退便携版，
并在汇总里标明用的是哪个。CI 通过 `WC_FORCE_NO_OPENPENCIL=1` 显式指定，
避免 runner 上 PATH 差异导致行为不一致。

### 便携版首次运行就抓到真实缺陷

`screen.mobile.bill-detail` 的 `content` 高度漏减了底部导航高度：

```
content: y=104 .. 772
sticky cta: y=708 .. 780     ← 重叠 64px
```

后果是「还款记录」卡片被底部按钮遮住一截。引擎版当时没报，因为它只检查
`x + width` 横向越界，不检查同层重叠；便携版补上了这类校验。已修复。

### CI 接入时顺带清掉的历史 lint 债务

仓库此前 `npm run lint` 有 **686 个错误**，直接接入会让所有 PR 变红。
构成：

| 数量 | 来源 | 处理 |
|---|---|---|
| 683 | `design/openpencil/**`（OpenPencil 沙箱脚本用了注入的 `I`，且含死代码） | 在 eslint config 中只声明沙箱全局 `I`，并清掉 5 处真死代码 |
| 2 | `email-worker/__tests__/zero-bill.test.ts` 常量二元表达式 | 改为参数化断言，语义不变 |
| 1 | `email-worker/src/index.ts` 未使用的 `normalizeCardTail` | 删除（`bills.ts` 里有在用的同名实现） |

现在 `npm run lint` 为 0 error。注意设计脚本**没有**被整目录忽略——
只声明了注明的沙箱全局，其余规则照常生效。
