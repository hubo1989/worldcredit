# B0-1 Foundation 决策表（B0 第一步，只读审计产物）

> 状态：**已批准并执行（2026-09-29，见第 8 节执行记录）**。本文是只读审计 + 决策依据；第二步改动见第 8 节（未动 app/）。
> 批准后由第二步把结论写进 `scripts/0X-*.js` 并重建 `.op`（本仓 `.op` 是生成物，
> 手工改动会被 `build-all.sh` 的清页重建抹掉，见第 5 节）。
> 审计日期：2026-09-28。依据：`vars/foundations.json`、`worldcredit-redesign.op`、
> `app/globals.css`、`lib/theme.ts`、`scripts/*.js`、`baseline/dom/*`。

## 0. 一句话结论

token 层已经和实现对齐（前两轮做完），**但组件库和 Shell 还停留在复刻态**，
存在三类问题：徽章有两套互相矛盾的画法、12 种裸色值绕过了 token、
Shell 尺寸与 token 声明值不符。这三类正是画 Candidate 之前必须先定的东西。

---

## 1. Token 决策表（63 → 67）

总量 67 = 32 color + 30 number + 5 string。相对最初的 63，**新增 4 个、修改 5 个**。

### 1.1 已修改（5 个，前两轮完成，需你追认）

| token | 旧值 | 新值 | 改了哪一侧 | 实测对比度 | 判定 |
|---|---|---|---|---|---|
| `color.status.success` | `#16A34A` | `#2E7D32` | 设计源同步 app | 白字 5.13 | 通过 |
| `color.status.danger` | `#CF2E2E` | `#D32F2F` | 设计源同步 app | 白字 4.98 | 通过 |
| `color.text.primary` | `#333333` | `#0A1F44` | 统一到 .phone 体系 | 白底 16.25 | 通过 |
| `color.text.secondary` | `#636363` | `#5B6478` | 统一到 .phone 体系 | 白底 5.93 | 通过 |
| `color.text.disabled` | `#999999` | `#A0A8B8` | 统一到 .phone 体系 | 白底 2.39 | 禁用态，WCAG 豁免 |

### 1.2 已新增（4 个）

| token | 值 | 用途 | 实测对比度 |
|---|---|---|---|
| `color.status.successInk` | `#1B5E20` | 浅底淡底上的成功文字 | on 12% 绿底 6.69 |
| `color.status.warningInk` | `#92400E` | 浅底上的警示文字 | 替代 gold700 作通用警示 |
| `color.status.dangerInk` | `#B71C1C` | 浅底淡底上的危险文字 | on 12% 红底 5.48 |
| `color.status.infoInk` | `#01579B` | 浅底淡底上的信息文字 | on 10% 蓝底 6.30 |

存在理由：语义**本色压自己 10~14% 淡底全部不达 AA**（实测 success 4.36 / danger 4.16 / info 4.09 / warning 1.63）。
所以「淡底 + 文字」必须用 ink 档；本色只用于填充、描边、大字号。
该前提由 `scripts/check-token-drift.py` 的 `documentedFailures` 守护，前提失效会报错提醒。

### 1.3 未变更（58 个，不需动作）

| 分组 | 数量 | token |
|---|---|---|
| brand | 5 | navy800 / navy600 / blue400 / gold500 / gold700 |
| runtime | 3 | primary / primaryDark / secondary |
| bg | 6 | canvas / surface / subtle / admin.canvas / admin.surface / admin.panel |
| border | 3 | default / input / onDark |
| status 其余 | 6 | warning / info / successDark / dangerDark + 语义色本体 |
| font | 12 | family 3 / size 4 / weight 3 / lineHeight 2 |
| space / radius | 11 | space.0~6 / radius.card / input / pill / sheet |
| layout / motion / shadow | 8 | layout 7 / motion 2 / shadow 2（详见第 3 节） |

---

## 2. 组件库现状审计（最重要的一节）

### 2.1 同一状态存在两套互相矛盾的徽章画法

这是本次审计最值得先解决的问题。组件母版和页面屏对同一个状态用了**两种画法**，
而且**不达 AA 的那套正是页面在用的那套**：

| 位置 | 画法 | 逾期徽章实测 | 判定 |
|---|---|---|---|
| `01 · Components` 组件母版 | 实底 + 对比文字（白字或深蓝字） | 白字 on `#D32F2F` = 4.98 | 通过 |
| 页面屏（dashboard / bills / gmail-ledger） | 淡底 + 本色文字 | `#CF2E2E` on `#FEE2E2` = 4.21 | **不达 AA** |

同类问题（页面侧）：

| 状态 | 页面画法 | 对比度 | 判定 |
|---|---|---|---|
| 逾期 | `#CF2E2E` on `#FEE2E2` | 4.21 | 不达 AA |
| 部分还款 | `#8A6D1F` on `#FEF3C7` | 4.40 | 不达 AA |
| 待还款 | `#1565C0` on `#DBEAFE` | 4.71 | 通过 |
| 未出账单 | `#166534` on `#DCFCE7` | 6.49 | 通过 |

而组件母版的实底画法**六种徽章全部通过**（最低 4.80）。

> **需你决定**：统一到哪一种？
> 建议**统一到「淡底 + ink 档文字」**，理由有三：
> (1) app 已实现这一套（`components/mobile/WcBadge.tsx` 用 `color-mix` 淡底 + `danger-ink` 等），
> 实底画法反而不符合线上；(2) 淡底更克制，同屏多个徽章不抢注意力；
> (3) 组件母版当前用旧色值（`#CF2E2E` 一类），统一时正好一起更新。
> 若采纳，第二步要改 `02-components.js` 的 Badge 组 + 6 个屏脚本里的 status 徽章。

### 2.2 裸色值：12 种 / 232 处绕过 token

页面与组件里共 232 处直接写死色值，页面里本该用 token。逐条对照 app 侧：

| 裸色 | 次数 | app 侧对应 | 实测对比度 | 处置建议 |
|---|---|---|---|---|
| `#9CA3AF` | 149 | adminDarkTheme text.secondary | 暗底 6.82 | 新增 token `color.text.adminMuted` |
| `#E8EDF5` | 24 | 无 | 1.18（是底色） | 新增 token `color.bg.skeleton` |
| `#818CF8` | 16 | admin primary.light | 暗底 5.81 | 新增 token `color.runtime.adminAccent` |
| `#4F46E5` | 10 | admin primary.main | 白字 6.29 | 新增 token `color.runtime.adminPrimary` |
| `#FEE2E2` | 8 | danger 淡底 | 是底色 | 用 `color.status.danger` 派生，或新增 `dangerSoft` |
| `#FEF3C7` | 5 | warning 淡底 | 是底色 | 同上 |
| `#DBEAFE` | 5 | info 淡底 | 是底色 | 同上 |
| `#166534` | 5 | 无（比 successInk 更深） | 6.49 | 建议并入 `successInk` |
| `#FEF2F2` | 4 | 无 | 是底色 | 同 dangerSoft |
| `#DCFCE7` | 3 | 无 | 是底色 | 同 successSoft |
| `#FF9B9B` | 2 | 无 | 深底 8.06 | 新增 token `color.status.dangerOnDark` |
| `#FFFBEB` | 1 | 无 | 是底色 | 同 warningSoft |

> **需你决定**：这些「淡底」是新增独立 token（如 `dangerSoft`），
> 还是规定「淡底一律由本色用 `color-mix` 派生、不进 token」？
> 建议后者——app 已经是这个做法（`WcBadge.tsx` 的 `tint()` 函数），
> 但它要求 OpenPencil 能表达透明度叠加；**当前 OpenPencil 数值属性不接受变量引用**，
> 透明度叠加能否落进 `.op` 需要第二步先做一个最小验证（见第 5 节风险）。
> 若不可行，退路是新增 `dangerSoft/successSoft/warningSoft/infoSoft` 四个 token。

### 2.3 示例数据用了错误的持卡人姓名

| 文件 | 行 | 现值 | 应为 |
|---|---|---|---|
| `scripts/02-components.js` | 117 | 持卡人 胡波 | 呼博 |
| `scripts/02-components.js` | 137 | 默认持卡人 胡波 | 呼博 |
| `scripts/03-review-board.js` | 40 | 持卡人 胡波 | 呼博 |

依据：真实基线 5 个屏（dashboard / bills / bill-detail / card-detail / gmail-ledger）
的 DOM 全部是「呼博」，无一处「胡波」。`HANDOFF.md` 第 6 节已把这个坑记为已知错误，
但组件库和 review board 当时漏改了。

### 2.4 状态覆盖缺口

当前组件库声明的状态：

| 组件 | 已覆盖 | 缺失 |
|---|---|---|
| Button | 主要 / 强调 / 次要 / 文字 / 危险 / 禁用 | **hover、pressed、focus 态没有实体**（仅文字描述提到 focus-visible 2px 外描边） |
| Input | default / focus / error | **disabled** |
| Status Badge | 6 种（含 AI / 邮件来源） | 画法与页面不一致（见 2.1） |
| States | 加载 / 空态 / 错误 | 完整 |
| Metric Card | 3 种（正常 / 临期 / 逾期） | 「未出账单」零额态 |

`EXECUTION_PLAN.md` 第 3 节 B0-1 要求「组件状态（default/focus/disabled/error）」；
对照上表，**Button 的 hover/pressed/focus 与 Input 的 disabled 是明确缺口**。

---

## 3. Shell 尺寸与安全区

### 3.1 实测值与 token 声明不符（3 处）

| 项 | token 声明 | `.op` 实测 | 差 |
|---|---|---|---|
| 状态栏 | `layout.navbar.height` = 56 | 48 | -8 |
| 页面头 | （无 token） | 64（dashboard）/ 60（bills） | 两屏不一致 |
| 底部导航 | `layout.bottomnav.height` = 56 | 64 | +8 |
| 触控最小 | `layout.touch.min` = 44 | 脚本里未见引用 | token 未被使用 |

也就是说 `layout.navbar.height` 这个 token 既不对应状态栏（48）也不对应页面头（64），
**当前没有任何一处按 token 值渲染**。页面头 64 vs 60 也是两屏不一致。

### 3.2 安全区（Home Indicator）未建模

iPhone 刘海屏底部安全区约 34px。当前 `bottom nav` 直接贴底（y = h - 64），
**没有为安全区预留高度**。`EXECUTION_PLAN.md` 第 1 节要求「底导航与固定 CTA 留安全区」，
但 token 里没有任何 safe-area 变量。

> **需你决定**：是否新增 `layout.safearea.bottom` = 34 并把底导航改为 56 + 34？
> 若采纳，「底导航 56」正好对上现有 token，同时也解释了为什么实测是 64（56 + 8 内距）。

### 3.3 其他 token 与实现不一致（非颜色，前几轮未覆盖）

| 项 | 设计源 | app | 差异 |
|---|---|---|---|
| 字体族 body | system-ui | `Noto Sans SC`（.op）/ 系统栈（css） | 三源不同 |
| 字体族 mono | ui-monospace | JetBrains Mono（.op） | 不同 |
| 字号 | display 22 / title 15 / body 13.5 / caption 11 | `--type-title-size 22` / `--type-section-size 19` / `--type-body-size 14.5` | 缺 section 19、body 值不同、无 caption |
| 间距 | space.5 = 24 | `--sp-5 = 20px` | 不同；app 另有 `--sp-8 32` / `--sp-10 40` |

> 这些属于「间距/字号/字体族漂移」，当前 `check-token-drift.py` **未覆盖**（只覆盖颜色）。
> 要不要扩到这些维度，见第 5 节。

## 4. Foundations 页自身缺口

`01-foundations.js` 只列出 27 个颜色 token，**遗漏 5 个**：

1. `color.border.onDark`（rgba，非 hex）
2~5. 本轮新增的 4 个 `status.*Ink` —— **新增了 token 但没进 Foundations 展示页**

另外 Foundations 页的标题写「63 token」，实际已是 67，文案过期。

---

## 5. 第二步待批准的改动清单（写进 scripts/*.js）

按依赖顺序，全部改设计源，**不动 `app/`**：

| # | 改动 | 文件 | 风险 |
|---|---|---|---|
| 1 | 组件母版徽章改为与 app 一致的「淡底 + ink 文字」 | `02-components.js` | 低 |
| 2 | 6 个屏脚本里的 status 徽章改用 ink 档 + 新色值 | `10/11/12-mobile-core/details/extended` | 中（会触发视觉回归） |
| 3 | 修正 3 处「胡波」→「呼博」 | `02-components.js`、`03-review-board.js` | 低 |
| 4 | 补 Button 的 hover / pressed / focus 与 Input 的 disabled 实体 | `02-components.js` | 低 |
| 5 | 裸色值 232 处改走 token（先决定 2.2 的方案 A 还是 B） | 全部脚本 | 中 |
| 6 | 新增 admin / skeleton / safearea 等缺失 token | `vars/foundations.json` + `.op` | 中 |
| 7 | 修正 Shell 尺寸：页面头统一、底导航 + 安全区 | `10-mobile-core.js` | 中 |
| 8 | Foundations 页补 5 个遗漏 token + 更新「63→67」文案 | `01-foundations.js` | 低 |
| 9 | 同步 design 侧 font.family / font.size / space 与 app 对齐（若批准 3.3） | `vars/foundations.json` + `.op` | 中 |

**执行约束**：改完必须跑 `bash design/openpencil/scripts/build-all.sh` 重建（
`.op` 是生成物，手工编辑会被清页抹掉），然后跑全部 5 道设计源门禁 + 重新导帧。

---

## 6. 需你决策的 5 件事

| # | 问题 | 我的建议 |
|---|---|---|
| 1 | 徽章统一到「实底 + 对比文字」还是「淡底 + ink 文字」？ | 淡底 + ink（与 app 一致） |
| 2 | 淡底用 token（`dangerSoft` 等）还是 `color-mix` 派生？ | 先验证 OpenPencil 能否做透明度叠加，不行再退回 token |
| 3 | 是否补底部安全区 token（34px）？ | 补；同时把底导航归位为 56 + 34 |
| 4 | 是否把 token 漂移检查从颜色扩到间距/字号/字体族？ | 扩；第 3.3 节的 4 处不一致目前无人守护 |
| 5 | 组件库示例数据是否统一用「呼博」？ | 是（真实基线唯一值） |

---

## 7. 本轮未覆盖 / 已知风险

- **未验证 OpenPencil 是否支持透明度叠加**（`color-mix` 类效果）。这直接决定决策 2 的可行性；
  第二步应先做一个最小 frame 验证，不能假定可行。
- 本文只审计**颜色 + 尺寸/字体**；动效、图标体系、阴影细节未纳入。
- 组件状态缺口（2.4）只审计了「有没有画」，**未审计键盘可达性、焦点顺序、ARIA**——
  这些属于 `app/` 实现，设计源无法表达，需实机验证。
- 视觉回归基线（`baseline/approved/`）因前一轮改了 `text.*` 渲染色，
  `login` / 落地页 / `register` / `settings` 已与当前代码不一致，**本次未重新批准**。
  改完组件与 Shell 后需要一并人工重新采集。

---

## 8. 执行记录（2026-09-29）

**审批**：Hubert 批准第 6 节全部 5 项决策（均按本文建议执行），并追认第 1.1/1.2 节
的 5 个已改 token 与 4 个 ink token。

**决策 2 最小验证结果**（headless 实测，导 PNG 像素采样）：

| 写法 | 数据层 | 渲染层 | 结论 |
|---|---|---|---|
| `rgba(211,47,47,0.12)` | 拒绝（fill_hex 校验报错） | - | 不可用 |
| fill stop `opacity: 0.12` | 静默丢弃（回读只剩本色） | 渲染成实底色 | **不可用且最危险** |
| 8 位 hex `#rrggbbaa` | 完整保留 | 可渲染，但 alpha 被按约 `a^2.2` 处理（12% 直觉写法实际约 1%） | 依赖未文档化行为，不采用 |

按批准的退路执行：新增 `successSoft/warningSoft/dangerSoft/infoSoft/goldSoft`
五个 token，字面值 = tint(本色, app 同比例)，与 `check-token-drift.py` 的 tint()
公式一致；其中部分还款/AI 徽章文字改用 `warningInk`/navy（gold700 压 18% 金底
实测 4.39/4.22 不达 AA，设计源先行达标，app 侧修正另行走 app 任务）。

**已落地改动**（全部只改设计源，未动 app/）：

- `vars/foundations.json`：63→81 token（新增 soft/admin/skeleton/dangerOnDark/
  adminFaint/statusbar/safearea/section；navbar.height 56→64、space.5 24→20、
  body 13.5→14.5、三个字体族对齐 css 栈）。
- `02/03/10/11/12/20/30` 脚本：12 类裸色值全部改走 token；3 处「胡波」→「呼博」；
  组件徽章与页面 statusPill 统一「淡底 + ink」；Button 补 hover/pressed/focus
  实体；Input 补 disabled；底导航归位 56+34（safe area 实体）；bills 页头 60→64。
- `check-token-drift.py` + `_token-map.json`：漂移检查扩展到数值/字符串维度
  （无白名单，漂移直接失败），新增 5 条设计源 soft 对比度断言。
