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
- 该 worker 仅导出 `async email`，**没有 `fetch` 处理器**，因此对它发 HTTP 请求返回 500 属预期行为，不能当作健康探针；只有 Email Routing 能触发它

验证边界（尚待真实邮件）：部署后 `email_parse_logs` 最新记录仍是 09-14 09:18，即**尚未有新邮件经过修复版**。修复后的归属与幂等行为已由 65 个用例覆盖，但生产端到端仍需下一封真实转发包落库后才能确认；观察方式 `npx wrangler tail worldcredit-email-worker --config email-worker/wrangler.toml`。

## Phase 10：自定义域名下 Google 登录 400 redirect_uri_mismatch ✅（2026-09-15）

### 现象与根因

- `https://app.all-bill.com/login` 点 Google 登录报 `Error 400: redirect_uri_mismatch`
- 根因在 Google 侧：OAuth 客户端只登记了 `https://worldcredit.hubo1989.workers.dev/api/auth/google/callback`（9/11 接 Google 登录时那个域名），自定义域名上线后未登记
- 注意该报错发生在**进入本应用之前**，服务端日志看不到任何线索，因此不能靠应用日志排查

### 代码修复：回调域名固定为 APP_ORIGIN

- 新增 `lib/auth-origin.ts`：`resolveAuthOrigin()` / `googleRedirectUri()`
  - 本机开发（`localhost` / `127.0.0.1` / `*.localhost`）：用请求自身 origin，本地调 Google 不需要生产域名参与
  - 其余情况：用 `APP_ORIGIN`（`wrangler.jsonc` 的 vars，本次设为 `https://app.all-bill.com`）
  - `APP_ORIGIN` 未配置或非法（非 http/https、空值）时退回请求 origin，并留 error/warn 日志，避免漏配一个变量就打挂登录
  - 带路径/尾斜杠的写法一律归一化为 origin（防止出现 `//api/...` 这类又会 mismatch 的地址）
- `start` 与 `callback` 共用同一个 `googleRedirectUri()`：授权请求与换取 token 的 `redirect_uri` 必须逐字符一致，分开写迟早会漂
- `callback` 的所有回跳（成功进 `/dashboard`、各类 `?error=` 失败回跳）统一落在规范域名上；否则从 workers.dev 进来的回调会把 `wc_user` cookie 种在 workers.dev，再跳 `/dashboard` 时反而没有登录态
- `worker/index.ts` 的 `WorkerEnv` 与 `env.d.ts` 补 `APP_ORIGIN` 类型

### 验证

- 本地：`tsc --noEmit` 0 错误、`eslint --max-warnings=0` 通过、vitest **203 passed**（新增 `lib/__tests__/auth-origin.test.ts` 10 例）、`vite build` 成功
- 单测覆盖：自定义域名与 workers.dev 都归一化到 APP_ORIGIN、localhost 回退、未配置/非法值回退、尾斜杠与带路径归一化、绑定优先于 `process.env`、两个路由不得再出现 `url.origin`
- `vite dev` 实测（`--host 127.0.0.1` + `Host` 头覆盖）：`Host: worldcredit.hubo1989.workers.dev` 与 `Host: app.all-bill.com` 均生成 `https://app.all-bill.com/api/auth/google/callback`；`Host: 127.0.0.1` 生成本地回调
- Google 侧探针（对照实验，同一探针在未登记域名上必须复现 mismatch）：`bogus.example.com` mismatch、`app.all-bill.com` **仍 mismatch**、`worldcredit.hubo1989.workers.dev` 正常返回登录页 → 探针有效，且证明 Google Console **尚未**登记自定义域名（该步需人工操作）

### 待人工完成（未做，故 Google 登录在本轮仍不可用）

1. Google Cloud Console → Credentials → 该 OAuth 客户端「已获授权的重定向 URI」新增 `https://app.all-bill.com/api/auth/google/callback`，「已获授权的 JavaScript 来源」补 `https://app.all-bill.com`
2. 若同意屏幕仍是 Testing，仅 Test users 可登录；对外可用需切 In production
3. 换域名/再加域名时需同步改 `wrangler.jsonc` 的 `APP_ORIGIN` 与 Google Console，两处必须一致

### 本轮未验证

- 真实 Google 授权端到端（Console 未登记新回调，见下）

### 部署与线上验证 ✅（2026-09-15）

- `npx vite build && npx wrangler deploy --config dist/server/wrangler.json` 成功
- **线上版本 `da6e002c-ed2a-4118-9a0f-d53f2bd2df23`，部署自分支 `codex/fixed-oauth-origin` 的 commit `c729f29`**
  - 回滚点：改动前的生产版本 `45f99cf0-d326-449d-90f1-356c7ec2c870`（Phase 9 部署）→ `npx wrangler rollback`
  - 注意 `main` 仍是 `277517b`（PR #18 未合），本次是分支预览部署；`c729f29` 之后的提交若只改文档/测试，生产代码内容与分支 HEAD 一致
- 绑定确认：`env.APP_ORIGIN ("https://app.all-bill.com")` 已随部署生效；D1/R2/Images/Assets/Cron 均保留
- 线上冒烟（`https://app.all-bill.com`）：`/login` 200、`/dashboard` 200、`/api/push/public-key` 200、未登录 RPC POST **401**、伪造未签名 cookie 返回 `user:null`（验签仍生效）、错误凭据登录 **401**、`/api/sql-proxy` 与 `/api/db-proxy` 均 **404**（旧桥保持删除）
- OAuth 起始跳转：自定义域名与旧 workers.dev 入口都生成 `redirect_uri=https://app.all-bill.com/api/auth/google/callback`（workers.dev 入口现在也归一化到规范域名）

### ⚠️ 本次部署对 app.all-bill.com 并未修复登录

部署前后，`https://app.all-bill.com/api/auth/google/start` 生成的 `redirect_uri` **完全相同**（都是 `https://app.all-bill.com/api/auth/google/callback`）——因为该路径下 `url.origin` 本来就等于 `APP_ORIGIN`。所以本次部署改变的是**入口无关性**：

- 从 `worldcredit.hubo1989.workers.dev` 进入时，回调不再落到 workers.dev（此前会把 `wc_user` cookie 种在那里，再跳 `/dashboard` 反而没有登录态），而是统一拉到规范域名，即「只需在 Google Console 登记一个回调地址」
- 前面加代理/CDN 导致 `request.url` 变形时，回调地址不再随之漂移

`app.all-bill.com` 恢复登录的唯一前置条件仍是人工在 Google Console 登记 `https://app.all-bill.com/api/auth/google/callback`（部署后探针复测仍为 mismatch=3）。

### Google 登录安全加固：state 校验 + ID token 验签 ✅（2026-09-16）

原实现有两处信任边界缺陷（Phase 10 首次引入时就存在，非后续回归），本次一并修掉：

**1. OAuth `state` 曾是摆设**

- 原实现：`start` 生成 `crypto.randomUUID()` 后直接丢弃，`callback` 从不读取或校验
- 风险：login CSRF / 会话固定。攻击者可先自行走一遍授权拿到 `(code, state)`，再把该回调地址喂给受害者，受害者的会话就变成攻击者的 Google 账号
- 修法（新增 `lib/oauth-state.ts`）：`state` 随下发写进 HttpOnly 签名 cookie（`wc_oauth_state`），且同时作为 **ID token 的 nonce**（start 额外下发 `nonce=state`）
  - 签名而非只靠 HttpOnly：兄弟子域可以给父域种 cookie（cookie tossing），不签名就能被提前固定
  - 10 分钟有效期；校验失败时回写 `Max-Age=0` 清 cookie，使每个 `start` 只能对应一次成功回调
  - 仍不做的：服务端存储。真正的「一次性」由 cookie 失效 + Google 授权码本身单次可用共同保证

**2. ID token 只解码不验签**

- 原实现：`JSON.parse(atob(payloadB64))` —— 签名完全不看。任何能构造自签 JWT 的人都能声明任意 email（**含白名单里的管理员邮箱**）直接登入，等于绕过 Phase 8 全部权限收紧
- 修法（新增 `lib/google-id-token.ts`）：按 Google JWKS（`https://www.googleapis.com/oauth2/v3/certs`）做 RS256 验签，并核对 `iss` / `aud` / `exp` / `iat` / `nonce` / `email_verified`
  - 只接受 `alg=RS256`（放行 `none` 或 HS* 即等于允许自签）
  - `kid` 未命中时强制刷新一次 JWKS（覆盖 Google 轮换密钥）
  - JWKS 缓存挂在 `globalThis`（module 级变量会被 worker 入口与 SSR bundle 各存一份，与 `lib/db/client` 的 `setDb` 同理）；尊重 `Cache-Control: max-age`，JWKS 不可用时退回旧缓存，完全拿不到则**拒绝**而非放行
  - `email_verified !== true` 一律拒绝（未验证邮箱可能是他人地址，拿去建用户等于让攻击者占据该账号）
- 新增 `lib/hmac.ts`（从 `lib/session.ts` 抽出 HMAC 原语，供 state cookie 复用同一 `SESSION_SECRET`）。**session cookie 线格式刻意未动**：现网 cookie 有 7 天有效期，改封装又会把全部用户登出一次
- 新增 `lib/base64url.ts` / `lib/cookies.ts` 供上述模块共享

**3. state cookie 不跨父域 → 非规范入口改为转交**

- state 存 HttpOnly cookie，而 cookie 不跨父域。若从 workers.dev 发起授权，浏览器把 state cookie 存在 workers.dev，回调却固定在 `APP_ORIGIN` → 校验必然失败
- 因此 `start` 现在检测到入口非规范域名时，直接 302 转交到 `APP_ORIGIN` 再发起授权（比继续依赖「Cookie 域 = 回调域」更稳）

**验证**

- 本地：`tsc --noEmit` 0 错误、`eslint --max-warnings=0` 通过、vitest **227 passed**（新增 `oauth-state` 9 例、`google-id-token` 14 例、auth-origin +1 例）、`vite build` 成功
- ID token 用例真的用 RS256 生成密钥对签名：正例用「JWKS 里发布的公钥」签、反例用攻击者自己的密钥签，从而证明拒绝来自验签本身而非字段缺失侥幸。覆盖自签/`alg=none`/未知 kid/换 aud/伪造 iss/过期/超龄 iat/nonce 不符/邮箱未验证/JWKS 不可用/密钥轮换
- 用真实 Google JWKS 验证过 `importKey` 参数（2 个 RS256 `sig` key 均导入成功、垃圾签名返回 false），排除「mock key 结构不真实」的可能
- `vite dev` 实测四条链路：start 下发签名 state cookie 且 `nonce == state`；错 state / 缺 state 均 302 到 `login?error=google_state_invalid` 并清除 cookie；原 state 在失败一次后不能再使用；`Host: workers.dev` 的 start 302 转交 `https://app.all-bill.com/api/auth/google/start`
- 登录页补 `google_state_invalid` / `google_id_token_invalid` 两条中文提示

### 仍存的已知项（本次未修）

- Phase 10 遗留的 `callback` 逻辑（查/建用户、签发 session）覆盖线上主路径，本轮以单测 + dev 链路验证，**尚未在本机真机走一次完整 Google 授权**（Console 已登记，具备条件）

## Phase 11：四项界面反馈（颜色审计、卡片信息层级、手填金额、固定支出）✅（2026-09-16）

### 1. 全站颜色审计（针对「系统管理员权限」卡片提出）

审计发现的问题都是可测量的缺陷，不是审美分歧：

- **P0 暗色世界用亮色 token**：`app/admin/page.tsx` 硬编码 `#030059` / `#636363` 落在 `#181a24` 上，实测 1.06:1 与 2.88:1 —— 标题几乎不可见。同页模块卡与 `StatCard` 也是「暗色世界里放白卡 + 亮色文字」。改为 `text.primary` / `text.secondary` / `background.paper`。
- **P0 状态徽章彩色文字全部不达 AA**：语义本色压在自己 10~14% 的淡底上只有 2.66~4.18:1（`--success` 2.89、`--warning` 2.66、`--danger` 4.16、`--info` 4.49）。新增 `--success-ink/--warning-ink/--danger-ink/--info-ink` 四档文字色，徽章与正文一律下沉到 ink 档。
- **语义色两套来源**：`globals.css` 另存 `#16A34A/#CF2E2E/#2563EB`，与 `lib/theme.ts` / Design.md 的 `#2e7d32/#d32f2f/#0277bd` 不是同一组。已对齐（`--warn` 作为深底琥珀保留，白底警示文字改走 `--warning-ink`）。
- **P1 填充色误用**：`#818cf8`（admin-indigo 的**暗底文字/图标档**）被当按钮填充底，白字仅 2.98:1；11 处改为 `primary.main`（6.29:1）。
- **P1 其他**：`gmail-ledger` 6 处把 legacy 黄 `#FCB900` 当警示文字（白底 1.74:1）；`dashboard` 白卡金额用 `--gold-500`（2.42:1，连 3:1 大字号门槛都不到）改 `--gold-700`；`settings` 管理员卡从 Tailwind indigo-900/800 收敛到声明的 `admin-indigo-deep → main`。
- 新增 `lib/__tests__/color-contrast.test.ts`（17 例）：把「算得出」的对比度固化成断言（含 WCAG 计算函数），并锁住「语义本色压淡底确实不达 AA」这一前提——若哪天淡底变浅使该前提不成立，测试会提醒可以简化。

### 2. 账单卡片信息层级：持卡人/银行优先于卡名

- 原布局把卡产品名放主行（19/24 半粗体），持卡人与银行压成小 chip。同一持卡人在同一家银行常持有多张同名卡（如多张「普卡」），卡名区分度最低却最抢眼。
- 改为：主行 = 持卡人（无持卡人时退化银行）；次行 = 银行 chip +「卡名 ····尾号」。尾号仍与卡名同排且不截断（同款两张卡时尾号是唯一识别信息）。

### 3. 手填账单金额，优先级高于一切导入来源

- 新增 `migrations/d1/0008_bills_amount_override.sql`：`bills.bill_amount_override`。手填值单独存列，**导入永远只写 `bill_amount`**，两者都保留 ⇒ 撤销手填可回落到最新导入值，也不会出现「导入时猜是不是人工填的」这类在某条路径上必失效的判断。
- `lib/utils.ts`：`effectiveBillAmount` / `hasManualBillAmount` / `canManuallySetBillAmount`（账单日不足 5 天可填，与账单页排序同为 `daysUntilNextBilling` 口径）。
- **读边界统一归一化**，避免 20+ 个读取点各自合成时漏掉一处：`bills.server` 映射层归一化，`cards.server` / `holders.server` / `analytics.server` / `worker/cron.ts` 在 SQL 层 `COALESCE(bill_amount_override, bill_amount)`。
- 「生效金额」而不是「原始金额」参与状态判定、剩余应还与还款上限校验（否则屏幕上 800、拒绝理由却按 1200）。
- 新增 `setBillAmountOverride` / `setCardManualBillAmount`（后者在账单尚未生成时先建当期再钉住），RPC 走 `guardBill` / `guardCard`；新增 `components/mobile/ManualBillAmountDialog.tsx`，入口贴在金额旁。
- 新用户 `bill_amount_override` 恒为 NULL，导入行为与之前一致（无迁移风险）。

### 4. 固定支出：手动添加房租、贷款等周期账单

- 新增 `migrations/d1/0009_recurring_payables.sql`：`recurring_payables` + `recurring_payable_payments`。
  - **刻意不复用 `credit_cards`**：`bills.card_id` 是 NOT NULL 外键，房租没有卡；家庭财务审计明确要求「不得为了复用现有表，把房租也伪装成信用卡产品」，否则会污染卡数/额度/免息期等一切口径。
  - 账期按「应付日所在月」固定、不滚动：房租 15 号到期，16 号仍属本月（只是逾期），否则「本月该付没付」会被直接抹掉。
  - 还款按 `(payable_id, period)` 唯一 ⇒ 重复登记天然幂等；`period` 由服务端按当天决定，客户端传账期就等于可以往任意月份记账。
- 新增 `lib/api/payables.server.ts` / `payables.ts` / `payables.shared.ts`（纯标签函数放 `.shared`，避免把 D1 依赖带进浏览器包）、`components/mobile/PayableList.tsx` / `PayableForm.tsx`，账单页独立分节展示，**没有卡片时也能添加**。
- 成员隔离：按 `created_by` 判定（`assertPayableAccess`），`createRecurringPayable` 的 `created_by` 由会话覆盖。
- 本轮只做「每月固定一笔」最小闭环；期表拆分、提前还款重排、押金结算留给审计计划的 W15–W19。

### 验证

- 本地：`tsc --noEmit` 0 错误、`eslint --max-warnings=0` 通过、vitest **284 passed**（新增 color-contrast 17、bill-amount-override 22、recurring-payables 13）、`vite build` 成功
- 迁移在完整 sqlite 链上冒烟：0008/0009 可重复执行；`UNIQUE(payable_id, period)` 与 `CHECK(category IN ...)` 实测生效
- `vite dev` 真实链路（注册→登录→RPC）：
  - 建固定支出时 `created_by` 伪装成 `attacker` → 落库为会话用户（身份绑定生效）
  - 登记付款后 `status=paid`；重复登记返回「本期已登记还款」；**另一账号看不到、也删不掉**（403）
  - 手填 800 → 导入写入 1500 → 读取**仍为 800**（导入落 `bill_amount`、手填落 `override`，两者并存）；撤销手填后回落 1500
  - 新 RPC 未登录 401、未知函数 404（先鉴权再查 registry，避免端点枚举）
- 探针数据与 dev server 已清理

### 本轮未验证

- 生产 D1 尚未执行 0008/0009（未部署）；Google OAuth 加固与本次改动均未上线
- 未做真机视觉回归：颜色改动含 P0 级可读性修复（`/admin` 标题、全部状态徽章），建议部署后实际看一眼

## Phase 12：后台控制台五项反馈 + 合入 main 并部署 ✅（2026-09-16）

### 1. 银行管理增加简称列

- `migrations/d1/0010_bank_short_name.sql`（`banks.short_name`）；列表加「简称」列与编辑框
- INSERT 与 UPDATE 各有一份字段清单，两处都要改；只改一处会「填了不保存」，已加测试锁住

### 2. 修复「按真实内容补全」点了没有变化 ⚠️ 根因不是补全本身

- **补全功能是好的**：本地与 worker 运行时都实测过，招商银行能正确返回 `95555` 与官网
- **真正原因**：一次把 69 家全部串行跑完。每家要调一次模型提名域名 + 最多抓 7 个页面（每个 10s 超时），实测平均 3–11 秒，整轮数分钟 → 请求被中途掐断，前端拿不到结果、库里也没写入
- **生产库佐证**：69 家银行中 `full_name` 缺 68 家、客服电话与官网**缺 69 家（全部）**，说明此前从未有过一次批次真正落库
- **改动**：分批（每次最多 8 家）；按钮标注「本次补 N/M 家」；结果提示剩余家数可继续点击；剩余数用刷新后的新数据计算，不读闭包旧值
- **对照发现**：分批后单家产出仍不稳定 —— 官网可抓时有 `site` 级产出（招行/农行/中行/中信），但民泰 412、建行/交行直接拒连。因此写入仍坚持「只有官网页面直接读到的字段才写」

### 3. 卡产品管理：复选框批量操作（AI 补全 / 启用 / 禁用 / 删除）

- 表头全选（含半选态）+ 每行选择框；选中后出现操作条
- 逐条调用既有单条接口而非新增批量 RPC：单条接口已带全部校验与级联语义（删除会影响关联用户信用卡），批量版容易漏一条变成静默不一致；结束时汇总成败，**部分失败必须报出来**
- 批量 AI 补全**只填充空白字段**，不覆盖人工维护过的值 —— 批量操作最危险的失败模式

### 4. 卡产品管理：按国家筛选

- 与搜索、按银行筛选共同参与过滤；任一变化回到第一页（否则停在空页看着像「没数据」）

### 5. 优惠活动：AI 获取活动

- 新增 `ai.suggestPromosFromWeb`（admin-only）：检索候选并标注依据；官网活动页抓到正文且标题能对上才算「官网」，否则「待确认」；默认只勾选「官网」项
- **只返回候选、不写库**；落库发生在显式「写入勾选」
- **实测限制**：银行活动页多为 JS 渲染（招行 `/promotion` 抽不出正文），且当前模型端点不支持联网检索 → 候选实际以「待确认」为主。据此把 prompt 从「只列有依据的活动」放宽为「列出该行广为人知的常设活动」，并**日期一律置 null**（不允许编造起止日期）。修正前实测返回空数组，修正后稳定返回 8 条
- 字段侧白名单与截断：`discount_type` 只接受四个声明值、日期须匹配 `YYYY-MM-DD` 否则置空、条数与长度上限、URL 只取 origin

### 验证

- 本地：`tsc` 0 错误、`eslint --max-warnings=0`、vitest **306 passed**（新增 admin-console 22 例，锁住「填了不保存」「超时无写入」「批量覆盖人工值」这类静默失效）、`vite build` 成功
- `migrations/d1/0010` 在完整 sqlite 链上冒烟
- `vite dev` 真实链路：三个后台页 200；`suggestPromosFromWeb` 返回 8 条；未登录 401
- 探针数据、临时部署的边缘探针 worker 均已清理；本地管理员密码已还原

## 合入 main 并部署 ✅（2026-09-16）

- PR **#18** 已合并：merge commit **`e1775c5`**（合并前三块共 5 个 commit、55 文件 +2855/−208 更新为含 Phase 12）
- `main` 此前停在 `277517b`（InsForge 架构之后的 D1 主线）；合并后 `main` 重新具备可部署性，且**首次包含 OAuth 加固、移动端四项与后台五项全部改动**
- **生产 D1 迁移已执行**：0008 / 0009 / 0010
  - 注意 `wrangler.jsonc` 的 `migrations_dir` 指向 `migrations/`（InsForge/Postgres 时代的 5 个文件），**不是** `migrations/d1/`；`d1_migrations` 跟踪表为空。因此 D1 迁移历来是 `wrangler d1 execute --remote --file=migrations/d1/00xx.sql` 逐条执行，**不要**用 `d1 migrations apply`
  - 执行后复查：`bills.bill_amount_override`、`recurring_payables`、`recurring_payable_payments`、`banks.short_name` 均已存在，`idx_recurring*` 索引 2 个
  - 两个 `ALTER TABLE` 曾因 API 间歇性 `fetch failed` 未落库，重试后确认成功（表创建与 ALTER 分属不同语句，失败时不会自动回滚）
- **Worker 已部署**：版本 **`8915d81e-62c6-4696-8666-740622ac798c`**（部署自 `main` / `e1775c5`）
  - 回滚点：`e9e16068-36da-455f-b24c-1dc945b4e3b6`（上一版）
  - 绑定确认：`env.APP_ORIGIN (https://app.all-bill.com)`；Cron `0 9 * * *` 保留
- 线上冒烟（`https://app.all-bill.com`）：
  - 页面 `/login` `/dashboard` `/bills` `/settings` `/admin` 及其 banks/card-products/promos/settings 全部 200
  - OAuth start：`redirect_uri=https://app.all-bill.com/api/auth/google/callback`，`nonce==state`
  - 错 state 回调 → `login?error=google_state_invalid`（state 校验生效）
  - 未登录 RPC 401（含新增 payables）、伪造未签名 cookie `user:null`、旧桥 `/api/sql-proxy` 404
- 生产数据现状：banks 69 / card_products 33 / promos 0 / recurring_payables 0 / 手填金额 0 —— schema 就绪，待实际使用产生数据

### 本轮未验证

- 真机视觉与交互回归（颜色 P0 级可读性修复、卡片层级、手填金额入口、固定支出、后台批量操作、AI 获取活动）均只做了接口与渲染冒烟，**未在真实浏览器逐项操作**
- 生产上的「按真实内容补全」在 69 家全量下的实际通过率（分批后需实际点若干轮才能观察）

## Phase 13：银行补全接入权威第三方来源 ✅（2026-09-17）

### 起因

上一轮把「只有官网页面上直接读到的字段才写」当硬规则，结论是「民泰 412、建行/交行拒连 = 补不上」。
用户指出：要的是**可核实的证据**，不是**银行自己的域名** —— 内容可以从其它权威网站获取。这个纠正是对的。

### 实测：各来源到底能拿到什么

| 来源 | 全称 | 官网 | 客服电话 | 备注 |
|---|---|---|---|---|
| 银行官网页面 | ✅ 有（建行/农行/中行等） | ✅ | ✅ 有（招行 95555、中信 95558、邮储 95580） | 民泰 412、建行/交行返回空壳页 |
| Wikidata `P856` | 少 | ✅ 有，含被 412 挡住的民泰 | ❌ 基本没有 | `wbsearchentities` 首条命中经抽查均指向正确法人 |
| 维基百科条目正文 | ✅ 有（「XX银行股份有限公司」） | 少 | ⚠️ **不可信** | 中信条目里是 95032/95034，不是真实客服 95558 |
| 百度百科 | ❌ 反爬 | ❌ | ❌ | 返回 4416 字节拦截页 |

### 改动

- `provenance` 增加 **`thirdparty`** 档（Wikidata / 维基百科条目），与 `site`（官网）、`model`（纯模型记忆）并列；新增 `thirdPartySources` 记录来源 URL 供界面交代依据
- 官网候选顺序改为 **用户已填 > Wikidata > 模型提名**：Wikidata 是可核实可追溯的结构化来源，模型提名只是记忆；先取更可靠的，抓不到页面时也不会把「模型记的域名」当成已验证事实
- 官网抓取失败时保留域名候选，但**按真实来源标注**（thirdparty / model），不冒充官网
- 全称兜底：官网正文没写时取维基条目的注册全称
- **客服电话绝不采信第三方**：实测维基正文里的 95xxx 不是真实客服号，采信会把错号码写进共享目录；电话仍只认官网（`site`）或模型候选（`model`，标为待确认）
- 写入规则从「只认 site」放宽为「**site 或 thirdparty 可写，model 仍不写**」，两者都在复核弹窗里标出来源、由人确认后才落库
- 第三方接口偶发失败/限流会**静默丢字段**（不报错，只是结果里少一项），已加重试一次

### 验证

- 本地：`tsc` 0 错误、`eslint --max-warnings=0`、vitest **320 passed**（新增 `bank-thirdparty` 15 例，含「电话不得标 thirdparty」「第三方不冒充官网」等不变量）、`vite build` 成功
- 真实链路实测（此前明确失败的 8 家）：**8/8 全部补到官方全称**（民泰、建行、交行、中信、民生、邮储、浦发、广发）
  - 此前民泰/建行/交行三家全称完全拿不到，现在分别是「浙江民泰商业银行股份有限公司」「中国建设银行股份有限公司」「交通银行股份有限公司」，来源标 `thirdparty`
  - 官网来源：建行/交行/民生/浦发标 `thirdparty`（不再冒充官网）；邮储/中信/广发仍为 `site`
  - 电话：中信 95558、邮储 95580、广发 95508 为 `site`；建行/交行/民生/浦发只有模型候选并标 `model`
- 重试生效：浦发首次运行因维基限流全称丢过一次，加重试后稳定

## 更新后的下一步


1. **登录态真机回归**：本轮未用真实账号做 Phase 6 式 17 路由 Chrome 爬测；登录走一遍核心页面，并在浏览器授权通知后调用 `POST /api/push/test` 验证端到端推送（cron `0 9 * * *` 定时推送可用 `wrangler tail` 观察）
2. **成员端 UI 收尾**：成员登录后导航/入口仍按 admin 视角渲染（后端已 403 兜底，不会泄露数据）；按角色隐藏 admin 入口、成员首页文案
3. **email-worker 真实邮件回归**：修复版 `87562532` 已部署（见 Phase 9），但尚无真实邮件经过；收到下一封转发包后核对 `email_parse_logs` 的 `skipped` 原因与 `raw_ai_response` 的 `matchSource`，确认「归属不可信不覆盖」与「已还清不被降级」在真实邮件上成立
4. **`lib/api/payments.ts` 客户端/服务端边界**：该文件无对应 `.server.ts`，含仅 Worker 可用的 D1 helper，而消费方 `lib/export.ts` 是浏览器侧。此为存量问题（base 上同样存在），本次未扩大也未修复，仅把还款导出「卡片」列从空值修成有值。待按 RPC 边界重构
5. **数据迁移仍按产品决定跳过**（Phase 4 脚本就绪但未执行）
