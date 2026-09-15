# Cloudflare D1 + Workers + R2 迁移计划

> 日期：2026-09-10 → 2026-09-11
> 分支：`feat/cloudflare-d1-migration`
> 状态：**Phase 1-3、5-8 已完成；Phase 4（数据迁移）按产品决定跳过**

## 架构

```
前端 PWA → Cloudflare Pages / Workers (vinext)
API → Cloudflare Workers (app/api routes + lib/api)
数据库 → D1 (worldcredit, ID: 6ce5f678-e5bb-46cc-88d7-a316f1a209cb)
附件 → R2 (worldcredit-attachments)
邮件解析 → Email Worker (worldcredit-email-worker, D1 binding)
定时提醒 → Cron Trigger (0 9 * * * UTC), worker/cron.ts
认证 → 自建 PBKDF2 + /api/auth 路由
AI → 直连 OpenAI API (key 存 system_settings 表)
```

## 完成清单

### Phase 1：基础设施 ✅
- D1 数据库 `worldcredit` 已创建
- R2 bucket `worldcredit-attachments` 已创建
- `wrangler.jsonc` 配置 DB、ATTACHMENTS、IMAGES、ASSETS 绑定
- `migrations/d1/0001_initial_schema.sql`：22 张表（SQLite），本地验证通过
- `lib/db/client.ts`：`cloudflare:workers` env.DB，eval-based require 绕过浏览器构建
- `lib/db/helpers.ts`：query/queryOne/execute/batch/uuid/now/today
- `lib/db/types.ts`：SQLite 行类型
- Auth API 路由：login/register/logout/session，PBKDF2 哈希

### Phase 2：数据层替换 ✅
- 15 个 `lib/api/*.ts` 全部从 `insforge.database` 迁到 D1 参数化查询 + JOIN
- `lib/auth.tsx` 改调 `/api/auth` 路由
- `lib/api/attachments.ts` 改用 R2 直写
- `lib/api/ai-assistant.ts` + `ai.ts` 改为直连 OpenAI API
- 9 个客户端组件改用 `lib/client-db.ts` 桥接 `/api/db-proxy`
- `lib/insforge.ts` 和 `@insforge/sdk` 已删除

### Phase 3：提醒 & 邮件 Worker ✅
- `email-worker/` 从 InsForge REST 改为 D1 binding 直连
- `worker/cron.ts`：定时扫描到期账单，查 push_subscriptions，发 Web Push（stub），写 notification_history
- `wrangler.jsonc` 添加 Cron Trigger `0 9 * * *`（UTC 9:00 = 北京时间 17:00）
- `worker/index.ts` 导出 fetch + scheduled

### Phase 4：数据迁移脚本 ⏭️ 跳过（2026-09-11 产品决定不迁移历史数据）
- `scripts/export-insforge.mjs`：从 InsForge Postgres REST 导出全部 22 张表为 JSON
- `scripts/import-to-d1.mjs`：读取 JSON，生成 SQLite INSERT，写入 `data/import.sql`
- `npm run db:export` / `npm run db:import`
- ⚠️ 尚未执行（需要先跑 db:export 拿到真实数据，再 db:import 到 D1）

### Phase 5：清理 & 部署 ✅
- `@insforge/sdk` 从 package.json 移除
- `lib/insforge.ts` 删除
- `vite.config.mjs` 移除 InsForge 环境变量
- `npm test` 改为 `vitest run`，`npm run typecheck` 新增
- `tsc --noEmit` 0 错误，`vitest run` 21 tests passed，`vite build` 成功
- 已部署到 Cloudflare Workers（`npx wrangler deploy --config dist/server/wrangler.json`）

### Phase 6：运行时修复 & 全站验证 ✅（2026-09-11）

线上登录/首屏暴露的三层问题，均已修复并部署验证：

- 服务端绑定丢失：worker 入口与 SSR bundle 各内联一份 `lib/db/client`，`setDb` 写的模块状态 API 路由读不到 → 改存 `globalThis`（b226a3f）
- 客户端桥缺失：16 个 `use client` 页面直接 import 服务端 `lib/api/*`，浏览器里 `getDb` 必抛 → `lib/db/helpers` 双模式，浏览器侧语句转发到新增 `/api/sql-proxy`（需 wc_user cookie，禁 users/sqlite_ 表）（a37ce4d）
- PostgREST 残留语法：`card_holders!inner`、嵌套 `card:credit_cards(...)`、`payments(amount)` 等 SQLite 无法表达 → 拆成普通查询客户端组装；promos 错表查询修正（3a06c6e）
- `/api/db-proxy` 加固：`__in/__neq/__gte/__lte` 过滤算子，insert/update/delete 列名与 order-by 标识符校验（3a06c6e、c320eb0）
- 验证方式：真实 Chrome 登录后爬测全部 17 个路由，控制台 0 错误；还款登记端到端走通（INSERT/UPDATE/重查）后清理种子数据

## Phase 7：撤桥、真实 Web Push、SW 修复、lint 清零 ✅（2026-09-11）

### 专用 RPC API 替换迁移期桥 ✅

- `lib/api/*.ts` 拆成两层：`*.server.ts`（D1 实现，仅服务端）+ `*.ts`（浏览器 RPC 包装，函数签名与原来一致，页面几乎零改动）
- 新增 `/api/rpc/[module]/[fn]` 单入口调度 + `lib/api/registry.ts` 显式 allowlist（每函数声明 bindUser / bindField / admin）
- 身份固定从 wc_user 会话 cookie 解析，客户端传入的 userId/created_by 一律被服务端覆盖；admin 接口要求 role=admin
- 新增服务端聚合函数替代 clientDb 手工拼装：getCardDetail、getBillDetail、getUnpaidBills、getPaymentTotal、getBillByCardMonth、getHolderCardCounts、getCardsBasicByHolders、getAllCardsWithProduct、getPromosWithBanks、createUserPromo、subscribePush、reminders.* 等
- 附件改走专用路由：`POST /api/attachments/upload`（FormData→R2）与 `GET/DELETE /api/attachments/[id]`（R2 流式读取；此前浏览器直连路径实际不可用）
- `lib/reminders.ts` 改为纯客户端调度器，D1 读写全部经 reminders.server RPC
- 删除 `/api/sql-proxy`、`/api/db-proxy`、`lib/client-db.ts`；`lib/db/helpers` 移除浏览器转发分支
- `lib/__tests__/rpc-registry.test.ts` 锁定契约：客户端每个 rpc 调用必须在 allowlist 内、桥文件保持删除、用户态函数必须绑定会话身份

### Web Push 从 stub 到真实推送 ✅

- `worker/cron.ts` 用 `web-push`（nodejs_compat）+ VAPID 真实发送，payload 含 title/body/url；404/410 自动清理失效订阅
- 公钥作为 var（`VAPID_PUBLIC_KEY`、`VAPID_SUBJECT`）随 wrangler.jsonc 部署；私钥已 `wrangler secret put VAPID_PRIVATE_KEY`；本地开发用 gitignored `.dev.vars`
- 新增 `GET /api/push/public-key`（运行时下发公钥，替换从未配置过的 `VITE_VAPID_PUBLIC_KEY` 构建期变量）与 `POST /api/push/test`（登录用户自助测试推送）
- PushPermission 订阅经 `push.subscribePush` RPC upsert（endpoint 唯一约束）

### PWA 旧缓存首载修复 ✅

- `public/sw.js` 增加 `cleanupOutdatedCaches()`，部署后自动清除旧一代预缓存
- MobileShell 监听 `controllerchange`，新 SW 接管时一次性自动刷新页面（修复部署后首载命中旧缓存需手动刷新的问题）

### 基线 lint 债清零 ✅

- 实际基线不是 9 errors，而是 276 problems（172 errors + 104 warnings，含 no-undef 配置噪音与 30+ 文件的 unused imports/any）
- eslint 配置：TS 文件补 globals、sw.js 补 serviceworker globals、排除 next-env.d.ts/env.d.ts 与一次性脚本（scripts/docs/db/import_bills.mjs）
- 移除全部 unused imports/死变量，88 处 no-explicit-any 换成真实类型，empty catch 注释化，删除 insforge/ 残留目录
- `npm run lint`（--max-warnings=0）、`npm run typecheck`、`npm test`（25 tests）全部通过
- 顺带修复 admin 优惠/权益页读取不存在的 `row.card_products` 字段错配（改读 RPC 实际返回的 product_bank_name/product_card_name）

### 验证

- 本地：typecheck 0 错误、vitest 25 passed、vite build 成功（SW 18 个预缓存条目）
- 线上：`npx wrangler deploy` 版本 ca45a4c8（https://worldcredit.hubo1989.workers.dev）
- 冒烟：/api/push/public-key 200 且公钥正确；/api/rpc 未登录 401；伪造 member cookie 访问 admin RPC 403；伪造用户 cookie 正常走通 getHolders 200（身份绑定生效）；/api/sql-proxy 与 /api/db-proxy 均 404；非 allowlist 函数 404；线上 sw.js 已含 cleanupOutdatedCaches

## 下一步（真实剩余项）⚠️ 已被 Phase 8 / Phase 9 取代，保留作历史记录

1. **登录态真机回归**：本轮未用真实账号做 Phase 6 式 17 路由 Chrome 爬测；登录走一遍核心页面，并在浏览器授权通知后调用 `POST /api/push/test` 验证端到端推送（cron 0 9 * * * UTC 定时推送可用 `wrangler tail` 观察）
2. **email-worker 回归**：worldcredit-email-worker 本轮未回归，若 Gmail 解析仍在用需单独验证
3. **数据迁移仍按产品决定跳过**（Phase 4 脚本就绪但未执行）

## Phase 8：签名 Session 与家庭成员权限（plan.md 阶段 0 / D1 / D2）✅（2026-09-11）

### wc_user HMAC 签名 session ✅（关闭原"下一步"第 2 项）

- 新增 `lib/session.ts`：cookie 值为 `base64url(JSON payload).base64url(HMAC-SHA256)`，带 7 天 exp；签名密钥 `SESSION_SECRET` 走 worker env（本地 `.dev.vars`，生产 `wrangler secret put`），不落入 `system_settings`（getSystemSettings 会把整表返回给前端）
- `login` / `register` / `google callback` 统一签发签名 cookie；`session`、`/api/rpc`、`/api/push/test`、`/api/attachments/*` 统一经 `readSession` 验签；未签名旧 cookie 一律 401（全部登录态需重新登录一次）
- `register` 改为首个注册用户 admin、之后注册一律 member（否则开放注册即管理员）
- 单测锁定：`lib/__tests__/session.test.ts`（round-trip / 篡改拒绝 / 旧格式拒绝 / 过期拒绝）

### D1 家庭成员账号与权限 ✅

- 迁移 `migrations/d1/0002_member_binding.sql`：`card_holders.auth_user_id TEXT REFERENCES users(id)` + 部分索引（本地与远端 D1 均已执行）
- 绑定方式：持卡人档案填成员邮箱 → 服务端按 `lower(email)` 匹配 `users` 自动写 `auth_user_id`（createHolder/updateHolder 同步，清空邮箱即解绑）；HolderForm 增加邮箱字段，HolderCard 增加编辑入口与"已绑定成员账号"标识
- 数据范围：所有按 `ch.created_by = ?` 过滤的查询改为 `(ch.created_by = ? OR ch.auth_user_id = ?)`（getBillDashboardItems、getCardsWithBillsSummary、getAllMyBenefits、getDueBillsForReminders、getHolders）；admin 传自己 id 走 created_by，成员传自己 id 走 auth_user_id，同一条查询路径
- 隔离守卫：`lib/api/member-scope.ts` + registry 每函数声明 `memberGuard` / `memberFilter`（holder/card/bill/benefit/附件/邮箱来源/导入草稿逐参数校验；analytics 强制 holder_id 归一；getUnpaidBills/getActiveLoanCards 按成员 holder 过滤），守卫失败统一 403
- 成员基础资料写操作全部 admin-only：createCard/updateCard、createBill/updateBill/updateBillStatus、confirmBillImportDraft、createHolder/updateHolder/mergeHolders、createUserPromo、gmail-ledger 全部、syncGmail/syncEmailBill

### D2 成员自助记录 ✅

- 成员可记录自己的还款：`createPayment` / `markBillAsPaid` 按账单归属守卫（自己卡片的账单 200，他人的 403）；`markAllOverdueBillsAsPaid` 逐单校验
- 成员可记录自己的权益使用：`recordBenefitUsage` 校验权益所属卡产品在自己名下
- 优惠使用记录（createUserPromo）当前写全局 promos 表（无归属列），按 D2"不破坏基础数据"原则暂收 admin；待 C 阶段引入 per-user 优惠使用模型后放开

### 验证

- 本地：typecheck 0 错误、eslint --max-warnings=0 通过、vitest 31 passed（新增 session 4 例 + registry 权限矩阵 2 例）、vite build 成功
- 本地 E2E（wrangler dev + curl）：注册首用户 admin / 次用户 member；admin 建持卡人并绑成员邮箱（伪造 created_by 被服务端覆盖）；成员 getHolders 只见自己的档案；成员读他人/不存在 holder 403；成员 getDashboardStats / createCard 403；成员 getUnpaidBills 只见自己的账单；成员对自己账单 createPayment 200、对他人账单 403；analytics 自动归一到成员 holder；改 payload 的伪造 cookie 与未签名旧 cookie 均 401
- 线上：迁移 0002 已执行（23 表）；`SESSION_SECRET` 已配置；`wrangler deploy` 版本 `ea7dc2f4-4c5a-484f-a7e3-32a5c2bfdeb7`；冒烟 /api/push/public-key 200、未登录 RPC 401、旧格式 cookie session 返回 user:null（验签生效）、登录路由 401 正常

## Phase 9：卡片详情可编辑、覆盖生效修复、D1 主线合入 main ✅（2026-09-15）

### 卡片详情可编辑（PR #7） ✅

- 迁移 `migrations/d1/0006_credit_cards_overrides.sql`：`credit_cards.name_override TEXT` + `annual_fee_override REAL`，沿用既有 `override_billing_day` / `override_due_*` 的卡级覆盖模式
- `lib/utils.ts` 新增 `getEffectiveCardName` / `getEffectiveAnnualFee`；卡片详情页新增编辑弹窗（卡片名称/总额度/账单日/还款日/年费），被覆盖字段显示「已自定义」徽标
- 优先级：名称 `name_override` > `card_products.card_name`；账单日 `billing_day`（编辑时清空 `override_billing_day`）；还款日 `override_due_*` > 产品默认；年费 `annual_fee_override` > 产品默认；额度本就是卡级 `credit_limit`
- 权限：`updateCard` 维持 `admin: true`（`rpc-registry.test.ts` D2 契约锁定）

### 覆盖生效范围修复（PR #7 第二个 commit） ✅

初审发现 helper 接上了但部分读取路径的 SQL 没带 override 列，于是静默回落卡产品默认值：

- `getBillDetail` 此前**一个 override 列都没 select**，账单详情页的卡名与还款日恒为产品默认；已补齐与其余四个 loader 相同的 5 列
- `worker/cron.ts`（真正在跑的每日 Web Push）只读 `cp.card_name`，改过卡名仍推原名；改为优先 `cc.name_override`
- `reminders.server.ts` 两条提醒查询（还款 + 贷款）漏 `name_override`；消费端改为优先取用
- `payments.ts` 从未产出顶层 `card_name`，导致还款导出 CSV 的「卡片」列**恒为空**；已按同一优先级拼出
- `lib/notifications.ts` 的 `runDailyNotificationScan` 从扁平结果读嵌套对象（D1 helper 不支持嵌套 select），该读取恒为 undefined；已改为扁平列（该模块当前无调用方，仅消除潜在崩溃）
- analytics 卡片筛选、`BillForm` 选卡器改用生效卡名；卡片详情页年费输入补数值校验
- 新增 `lib/__tests__/card-override-coverage.test.ts`：逐 loader 断言 override 列以 SELECT 别名被选中；已用修复前的 `getBillDetail` 验证该测试会失败

### email-worker 归属与幂等修复 ✅

- **归属不可信时不再覆盖既有账单**：`resolveHolder` 认不出人时回落默认持卡人，叠加按 `(card_id, bill_month)` 无条件 UPDATE，会让名册外的人以默认持卡人名义改写他同月账单。现在只有 To 头/正文称呼的显式命中算可信，回落且该月已有账单时保留原值并写明原因
- **重复投递不再把已还清账单打回未还款**：UPDATE 不再无条件写 `status='unpaid'`，保留既有 `paid`/`partial`/`overdue`（直发路径同步修正）
- **自动建卡按银行名匹配产品**：此前取 `card_products` 第一行且 `credit_limit` 硬编码 0，美国卡会被标成 CNY；改为按 AI 已解析出的银行名匹配（精确优先、币种一致优先），匹配不到就跳过并提示人工补卡
- MIME/RFC 2047：解码失败改为原样保留；附件判定以 `Content-Disposition` 为主；缺收尾分隔符时保留已定位部件；`.eml` 后缀补内容校验、通用名附件走内容嗅探
- 新增 `email-worker/__tests__/`（4 文件 65 用例，自包含无外部 fixture）。此前该目录完全在 CI 之外，而 `mime.ts` 是约 590 行纯函数解析器，原断言只跑在未入库的 `/tmp` harness 里

### D1 主线合入 main 并部署 ✅

合入顺序（`main` 此前停在 `a4b7418`，2026-09-07，仍是 InsForge 架构）：

1. PR #7 `feat/card-detail-editing` → `feat/cloudflare-d1-migration`，merge commit `9bd6c3e`
2. PR #8 `feat/cloudflare-d1-migration` → `main`，merge commit `30ede08`（66 commit / 171 文件 / +15923 −6341）
3. 远端 D1 执行 0006
4. `npx wrangler deploy --config dist/server/wrangler.json`

合入后 `main` 重新具备可部署性：`app/api/`（allowlisted RPC）、`worker/`（cron + Web Push）与签名 session 均由本次进入 main。

### 验证

- 本地：typecheck 0 错误、`eslint --max-warnings=0` 通过、vitest **80 passed**（新增 card-override-coverage 13 例）、`vite build` 成功（PWA 18 precache entries）
- email-worker：`tsc --noEmit`（src + tests）通过、`eslint src __tests__ --max-warnings=0` 通过、`npm test` **65 passed**
- 远端 D1 迁移状态逐条核实：0002 `auth_user_id` ✅、0003 `bill_email_sources` 已删 ✅、0004/0005 gmail_ledger 列 ✅、**0006 此前缺失（`name_override` / `annual_fee_override` 均不存在）→ 本次已执行并复查两列存在**
- 生产 secrets：`SESSION_SECRET`、`GOOGLE_CLIENT_SECRET`、`VAPID_PRIVATE_KEY` 均已配置
- 线上部署版本 `45f99cf0-d326-449d-90f1-356c7ec2c870`（部署前为 `4a573242-4c9f-4984-a098-2a2c8dd71c8d`，可作回滚目标）；资源哈希与本地构建产物一致（`index-D5Ee33zM.js`）
- 线上冒烟：`/` 200；`/api/push/public-key` 200 且公钥正确；未登录 RPC **401**；`/api/sql-proxy` **404**（旧桥保持删除）；`/login` 200；错误凭据 `/api/auth/login` 401；未登录 session 返回 `user:null`；**伪造未签名 cookie 返回 `user:null`（验签生效）**

### 注意

- `wc_user` 改为 HMAC 签名后，旧未签名 cookie 一律 401，**本次部署使全部登录态失效一次，所有用户需重新登录**
- `email-worker` 是独立 worker（`email-worker/wrangler.toml`），先于主 worker 单独部署，见下方「email-worker 部署」

### email-worker 部署 ✅

`worldcredit-email-worker` 并非未启用：Email Routing 在 `20160325.xyz` 已开启，catch-all 规则指向该 worker，`bill@20160325.xyz` 另有一条指向 `aipopot-mail` 的规则。它一直在收信，线上跑的是**修复前**的版本，所以「启用」实际是用修复版替换它。

- 部署前线上版本 `5dad3de0`（2026-09-14 09:06）→ 部署后 `87562532-268e-454e-9606-18e8627d9dac`（2026-09-15 03:01 UTC，version number 7）；回滚目标 `5dad3de0`
- `./node_modules/.bin/wrangler deploy --config wrangler.toml`（该目录自带 wrangler 3.114，与主仓库的 4.x 不同），Total Upload 40.77 KiB / gzip 11.64 KiB
- 部署产物校验：dry-run 打包字节数与线上上传一致；产物内含 `keepPaidStatus`（4 次）、`pickCardProductForBank`（3 次）、`preserved`（2 次），而修复前版本这两处均为 0 次——确认跑的是修复后代码
- 部署未改动路由绑定：catch-all 仍指向 `worldcredit-email-worker`

部署前置条件已核实：

- `system_settings` 的 `ai_api_key` / `ai_base_url` / `ai_model` 三项均已配置（缺 key 时每封邮件会直接失败）
- D1 binding 指向同一个 `worldcredit` 库（`6ce5f678-…`），因此本次 0006 迁移对它同样生效
- `TextDecoder('gbk')` 可用性：该 worker 的 `compatibility_date` 是 `2024-01-01`（主 worker 为 `2026-03-20`），CJK 解码有对应的 compatibility flag。已在本机 workerd 实测：`gbk` / `gb2312` / `gb18030` 在 `2024-01-01` 与 `2026-03-20` 下均正确解出「张改菊女士」，不构成阻塞
- 该 worker 上残留的 `INSFORGE_SERVICE_KEY` secret 无影响：`Env` 只声明了 `DB`

验证边界（尚待真实邮件）：部署后 `email_parse_logs` 最新记录仍是 09-14 09:18，即**尚未有新邮件经过修复版**。修复后的归属与幂等行为已由 65 个用例覆盖，但生产端到端仍需下一封真实转发包落库后才能确认；观察方式 `npx wrangler tail worldcredit-email-worker --config email-worker/wrangler.toml`。

## 更新后的下一步

1. **登录态真机回归**：本轮未用真实账号做 Phase 6 式 17 路由 Chrome 爬测；登录走一遍核心页面，并在浏览器授权通知后调用 `POST /api/push/test` 验证端到端推送（cron `0 9 * * *` 定时推送可用 `wrangler tail` 观察）
2. **成员端 UI 收尾**：成员登录后导航/入口仍按 admin 视角渲染（后端已 403 兜底，不会泄露数据）；按角色隐藏 admin 入口、成员首页文案
3. **email-worker 真实邮件回归**：修复版 `87562532` 已部署（见 Phase 9），但尚无真实邮件经过；收到下一封转发包后核对 `email_parse_logs` 的 `skipped` 原因与 `raw_ai_response` 的 `matchSource`，确认「归属不可信不覆盖」与「已还清不被降级」在真实邮件上成立
4. **`lib/api/payments.ts` 客户端/服务端边界**：该文件无对应 `.server.ts`，含仅 Worker 可用的 D1 helper，而消费方 `lib/export.ts` 是浏览器侧。此为存量问题（base 上同样存在），本次未扩大也未修复，仅把还款导出「卡片」列从空值修成有值。待按 RPC 边界重构
5. **数据迁移仍按产品决定跳过**（Phase 4 脚本就绪但未执行）
