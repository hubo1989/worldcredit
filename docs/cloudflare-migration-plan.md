# Cloudflare D1 + Workers + R2 迁移计划

> 日期：2026-09-10 → 2026-09-11
> 分支：`feat/cloudflare-d1-migration`
> 状态：**Phase 1-5 已完成**

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

### Phase 4：数据迁移脚本 ✅
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
- ⚠️ 尚未部署到 Cloudflare（需要跑 `npx wrangler deploy`）

## 下一步

1. 运行 `npm run db:export` 从 InsForge 导出真实数据
2. 运行 `npm run db:import && npx wrangler d1 execute worldcredit --remote --file=data/import.sql`
3. 设置 Worker Secrets：`npx wrangler secret put VAPID_PRIVATE_KEY`
4. 部署：`npx vite build && npx wrangler deploy`
5. 冒烟测试：登录、添加卡片、创建账单、还款、权益核销
