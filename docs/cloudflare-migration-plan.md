# Cloudflare D1 + Workers + R2 迁移计划

> 日期：2026-09-10 → 2026-09-11
> 分支：`feat/cloudflare-d1-migration`
> 状态：**Phase 1-3、5-6 已完成；Phase 4（数据迁移）按产品决定跳过**

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

## 下一步

1. 拆专用 API 路由替换迁移期桥（`/api/sql-proxy`、`/api/db-proxy`、`lib/client-db.ts`），撤掉任意-SQL 桥的暴露面
2. 设置 Worker Secrets：`npx wrangler secret put VAPID_PRIVATE_KEY`（Web Push 目前是 stub）
3. PWA Service Worker 每次部署后首载可能命中旧一代预缓存，刷新一次恢复
4. 基线 lint 债：dashboard 等页面存在改造前遗留的 unused imports（9 errors），与本迁移无关，择期清理
