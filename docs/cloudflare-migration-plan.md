# Cloudflare D1 + Workers + R2 迁移计划

> 日期：2026-09-10
> 决策：抛弃 InsForge（Postgres + Auth + Storage），全部迁到 Cloudflare 免费层。
> 分支：`feat/cloudflare-d1-migration`

## 已完成

- D1 数据库 `worldcredit` 已创建（ID: `6ce5f678-e5bb-46cc-88d7-a316f1a209cb`）
- R2 bucket `worldcredit-attachments` 已创建
- `wrangler.jsonc` 已配置 DB 和 ATTACHMENTS 绑定
- `migrations/d1/0001_initial_schema.sql` 已写好并在本地 SQLite 验证通过（21 张表）
- `lib/db/` 目录已建好（client.ts / types.ts）

## 迁移范围（34 个文件引用 insforge）

| 层 | 现状 | 目标 | 影响文件 |
|---|---|---|---|
| DB 客户端 | `lib/insforge.ts` (@insforge/sdk) | `lib/db/client.ts` (D1) | 全部 15 个 lib/api 文件 |
| 认证 | InsForge Auth（邮箱+OAuth） | 自建：Worker 端 JWT + bcrypt 或 WebAuthn | lib/auth.tsx + Worker 新增 /api/auth 路由 |
| 数据库 schema | Postgres + RLS | SQLite（D1），无 RLS，权限在应用层 | db/schema.sql → migrations/d1/ |
| 附件存储 | InsForge Storage | R2（已建 bucket） | lib/api/attachments.ts |
| 邮件 Worker | email-worker 调 InsForge API | email-worker 直连 D1（通过 binding） | email-worker/src/ |
| 推送/通知 | InsForge + Web Push | Worker Cron + Web Push（VAPID 已有） | lib/notifications.ts, worker/cron.ts |
| AI 调用 | InsForge AI 模块 | 直连 OpenAI API（key 存 Worker Secret） | lib/api/ai*.ts |
| 部署 | vinext + Cloudflare Worker | 不变（已在 Cloudflare 上） | 无需改 |

## 认证方案（简化，单管理员 + 少量成员）

- 登录：邮箱 + 密码，Worker 端用 PBKDF2 哈希（Workers 无 bcrypt 原生支持）
- 会话：JWT（HttpOnly cookie），签名密钥存 Worker Secret
- OAuth Google：如需要后续加，P0 不做
- 权限：管理员全权；成员只能看自己 holder 关联的数据（应用层过滤）

## 执行顺序

### Phase 1：基础设施（1-2 天）
- [x] D1 + R2 创建，wrangler 配置
- [x] schema 迁移文件
- [ ] 用户表 + auth worker 路由（注册/登录/session）
- [ ] lib/db/client.ts 在 server 端正确初始化（vinext + D1 binding）

### Phase 2：数据层替换（3-5 天）
- [ ] lib/api/*.ts 逐文件把 `insforge.database` 替换为 `getDb().prepare()`
- [ ] lib/auth.tsx 改调自建 /api/auth
- [ ] 附件上传/下载改 R2
- [ ] email-worker 改 D1 binding

### Phase 3：提醒 & 定时（1-2 天）
- [ ] Worker Cron Trigger 扫描到期账单
- [ ] Web Push 发送（VAPID key 已有）
- [ ] reminder_logs 去重

### Phase 4：数据迁移（1 天）
- [ ] 从 InsForge Postgres 导出 JSON
- [ ] 转换为 SQLite INSERT
- [ ] 导入 D1
- [ ] 验证行数和关键字段

### Phase 5：清理 & 部署（1 天）
- [ ] 删除 @insforge/sdk 依赖
- [ ] 删除 lib/insforge.ts
- [ ] typecheck + build + lint 通过
- [ ] 部署到 Cloudflare Workers
- [ ] 冒烟测试

## 注意事项

- D1 是 SQLite，无 `gen_random_uuid()` → 用 `crypto.randomUUID()`
- 无 RLS → 单管理员模型下不需要；如果做多家庭再考虑
- `TIMESTAMPTZ` → `TEXT` (ISO 8601)；`NUMERIC` → `REAL`；`JSONB` → `TEXT`
- `auth.uid()` 不存在 → session 中取 userId
- D1 batch() 可用于事务性多写操作
