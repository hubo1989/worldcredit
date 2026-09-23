# 基线取证 (Baseline Capture)

母版定稿前的**约束基线**：把现有线上页面的真实字段、真实密度、真实状态记录下来，
避免母版凭想象设计。

覆盖范围是 6 条**定义母版**的路由，不是全部 23 个路由：

| route key | 路径 | 视口 | 归属母版 |
|---|---|---|---|
| `dashboard` | `/dashboard` | 390×844 | mobile-dashboard |
| `bills` | `/bills` | 390×844 | aggregated-list |
| `card-detail` | `/cards/{card_id}` | 390×844 | detail |
| `analytics` | `/analytics` | 390×844 | analytics |
| `login` | `/login` | 390×844 | auth |
| `admin-banks` | `/admin/banks` | 1440×900 | admin-crud |

每个路由采四态：`default` / `loading` / `empty` / `error`，共 24 份截图 + 24 份 DOM 记录。

## 跑之前

1. **启动本地服务**（持久运行的会话里，别用 `&` 后台启动，容易被回收）：

   ```bash
   npx wrangler dev --port 8787
   ```

2. `.dev.vars` 里必须有 `SESSION_SECRET`（至少 16 字符）。脚本用它本地签发
   `wc_user` cookie，**不需要走 Google OAuth**。

3. Python 侧依赖：

   ```bash
   python3 -m pip install playwright
   python3 -m playwright install chromium
   ```

## 跑

```bash
python3 design/openpencil/baseline/capture.py                    # 全部 24 份
python3 design/openpencil/baseline/capture.py --only dashboard    # 单路由
python3 design/openpencil/baseline/capture.py --states default    # 单状态
python3 design/openpencil/baseline/capture.py --base-url http://127.0.0.1:8787
```

产出：

```
baseline/
├── index.json              本次运行的清单与统计
├── shots/<route>/<state>.png
└── dom/<route>/<state>.json
```

DOM 记录含：全部可见文本、输入控件、按钮、标题、RPC 调用清单、console 错误、
以及骨架屏 / alert / dialog 数量标记。

## 四态是怎么造出来的

**不改应用代码**，统一在 `/api/rpc/**` 层拦截：

| 状态 | 做法 |
|---|---|
| `default` | 不拦截，走真实数据 |
| `loading` | 请求悬挂不响应，页面停在骨架屏 |
| `empty` | 取真实响应 → **按结构清空内容**（列表→`[]`，数字→`0`，字典递归，字符串/布尔保留） |
| `error` | 返回 500 + `baseline-forced-error` |

两个关键坑，都在实跑时暴露过：

- **不能按函数名猜返回形状。** `bills/getCardsWithBillsSummary` 名字含 `summary`，
  但返回的是数组。早先版本把含 `summary` 的都当成 `{}`，页面解构崩溃，
  产出的是「缺陷态」而非「空态」。
- **配置类必须原样穿透。** `preferences/getUserPreferences` 返回 `null` 时页面读
  `display_config` 直接崩。清空配置不是空态，是制造 bug。所以
  `preferences` / `session` / `theme` / `settings` / `config` 一律放行。

`login` 没有 RPC，四态由表单交互产生：填充 → 点「登录系统」→ 观察提交中 / 凭据错误。
真实接口对错误凭据返回 401 `{"error":"邮箱不存在"}`，所以 error 态走的是真实服务端错误路径。

## 已知限制

- `card-detail` 的 card id 用 `wrangler d1 execute --local` 从本地 D1 直查，
  不走 RPC：本地 `card_holders.auth_user_id` 为 null 时，成员作用域会让
  `getCardsBasicByHolders` 返回空数组。D1 直查读同一份数据，不受会话作用域影响。
- 本地 D1 数据量很小（1 holder / 27 cards / 1 bill），
  所以 `default` 态的多币种、部分还款、逾期等分支**没有真实数据覆盖**。
  这些分支要在母版定稿前用种子数据补齐，或标记为「待专项取证」。
- 截图是 `full_page=False`（仅首屏），因为母版关注的是首屏信息架构。
  需要整页证据时把 `capture.py` 里的 `full_page` 改为 `True`。
- `login` 的 `empty` 与 `default` 截图相同：登录页没有数据请求，
  不存在「数据为空」这个维度。`empty` 在此路由等价于初始态，
  真实差异只落在 `loading`（提交中）与 `error`（凭据错误）两态。
- `error` 态的差异（错误条 + 重试）通常在首屏之下，脚本会把注入的错误文案
  滚入视口后再截图，否则 error 与 empty 看起来会一样。

## 实跑结论（2026-09-22）

首次全量跑通时暴露了 3 个「看起来对、实际错」的坑，已全部修掉：

1. **会话身份必须绑定真实 user id。** 用占位 UUID 签发 cookie 时，
   `/bills` 与 `/dashboard` 的查询 `ch.created_by = ? OR ch.auth_user_id = ?`
   匹配不到任何数据，`default` 态静默退化成空态。
   现在从 D1 自动挑选有数据归属的用户，`bills` 的 `default` 文本量从 12 涨到 117。
2. **空态不能按函数名猜返回形状**（详见上文两个坑）。
3. **错误态证据要主动滚入视口**，否则截图与空态无法区分。

最终 `default` 态文本量：`bills` 117、`admin-banks` 45、`dashboard` 43、
`card-detail` 30、`analytics` 26、`login` 13。

## 与设计源的关系

基线是**只读参照**，不是第二份真源：

- 截图与 DOM 落在 `baseline/`，不导入 `.op` 作为可编辑节点。
  导入的节点会带大量硬编码尺寸与颜色，污染设计系统。
- 需要放进画布做并排评审时，走 `90 · Comparisons` 的槽位，
  只作为位图背景。

---

## 种子数据（业务分支覆盖）

本地 D1 默认数据量不足以覆盖真实业务分支，`seed/` 补齐它们。

```bash
bash design/openpencil/baseline/seed/seed.sh          # 本地
bash design/openpencil/baseline/seed/seed.sh --remote # 远程（谨慎）
```

覆盖的分支：

| 分支 | 制造方式 | 依赖的字段 |
|---|---|---|
| 多币种折算 | `card_products.currency` = USD / HKD / CNY | 币种来自**卡产品**，不是 bill_items |
| 部分还款 | 账单 25000 + 还款 10000 | `computeStatus` 依据 paidAmount |
| 逾期 | `due_date` = 今天 −14 天，无还款 | `daysUntil < 0` |
| 免息期 | `due_date` = 今天 +18 / +45 天 | `interest_free_days_left` |
| 固定还款日 | `payment_due_type='fixed'` | `calculateCardGracePeriod` |
| 手动设定金额 | `bill_amount_override` = 8000（导入值 12000） | 读边界用生效金额 |
| 已结清 | 全额还款 | 历史明细折叠 |
| 分类占比 / 趋势 | `bill_items` 多条消费 | analytics |

关键约束（写种子前必须知道）：

- **`bills.status` 不是真源。** 它只是初始值，真正生效的是读时计算的
  `computeStatus()`（依据 `paid_amount` 与 `due_date`）。要制造「部分还款」
  必须插 `payments` 行，改 `status` 字段没用。
- **日期用 SQLite 相对时间生成**（`date('now','-14 days')`），
  保证脚本任何时候跑都成立，不会像硬编码日期那样过期。
- **追加式 + 幂等**：固定 id + `INSERT OR REPLACE`，不 UPDATE / DELETE 任何现有行。
- 种子数据的外观分支**排在现有卡片之后**（按 due_date 升序），
  所以首屏可能仍以逾期卡为主。需要看多币种卡片时用筛选或滚动。

种子自检输出示例：

```
currencies=3 seededBills=5 seededPayments=2
```

## 视觉回归

把已批准的基线当作 approval baseline，比对当前实现。

```bash
# 一次性：人工确认后批准基线
python3 design/openpencil/baseline/visual-diff.py --update

# 批次验收（重拍 + 比对，CI 入口）
bash design/openpencil/baseline/verify.sh

# 只比部分路由 / 状态
bash design/openpencil/baseline/verify.sh --only dashboard bills
bash design/openpencil/baseline/verify.sh --states default error
```

目录分工：

```
approved/   已批准基线（真源，仅在人工确认后更新）
shots/      本次实拍（每次 verify 覆盖）
diff/       差异叠加图（差异处标红，便于定位）
visual-report.json  机器可读报告
```

判定与退出码：差异像素占比 > 0.5% 判为 fail，退出码 1（CI 失败）；
缺少基线返回 2；全部通过返回 0。容差 12 用来滤掉抗锯齿噪声。

用 `--threshold` 调整灵敏度——文案类改动调高，纯结构改动调低。

### 确定性保障

视觉回归最怕假阳性。已做的三件事：

1. **冻结动画**：context 用 `reducedMotion="reduce"`（项目 `globals.css`
   已支持 `prefers-reduced-motion`），截图前再注入一次
   `animation:none / transition:none` 覆盖 shimmer。
2. **等字体就绪**：截图前 `await document.fonts.ready`，避免 webfont 闪现。
3. **固定渲染参数**：`deviceScaleFactor=2`、`colorScheme=light`、
   `locale=zh-CN`、`timezone=Asia/Shanghai`，记录在 `index.json.deterministic`。

实测同一页面连拍两次，8/8 图片 SHA256 完全一致。

### 自检记录

用受控注入验证过工具确实能检出差异：

- 把 dashboard 的 Hero 区改成红色 → 检出 **18.688%**（246051 / 1316640 px），
  退出码 1，差异图正确高亮该区域。还原后回到 24/24 pass。

### 已知限制

- 截图是 `full_page=False`（仅首屏）。母版关注首屏信息架构，
  但**首屏外的改动不会被回归捕获**。需要时改 `capture.py` 的 `full_page`。
- `login` 的四态里 `empty` 等价于 `default`（无数据请求），
  实际只有 3 张不同图，属预期而非缺陷。
- 视觉回归只保证「没变」或「变了并已确认」，不判断改得好不好。
  视觉正确性仍需人工看 `diff/` 与 `approved/`。
