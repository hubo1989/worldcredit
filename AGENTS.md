# AGENTS.md — WorldCredit 工程约定

## 架构（2026-10 起，已完全脱离 InsForge）

本项目跑在 **Cloudflare** 上，不是 InsForge/Supabase：

- **运行时**：Cloudflare Workers，入口 `worker/index.ts`，vinext（Next.js App Router 的 Vite 实现）构建
- **数据库**：Cloudflare D1（SQLite）。binding 由 worker 注入，代码经 `lib/db/` 的 `getDb()` 使用；迁移在 `db/migrations/`（`wrangler d1 migrations apply worldcredit --remote`）
- **存储**：R2 桶 `worldcredit-attachments`（账单附件）；图片走 Images binding
- **认证**：自建——PBKDF2 密码 + 邮箱 OTP + Google OAuth（ID token 验证），HMAC 签名 session cookie（`lib/session.ts`，secret 是 Worker 变量 `SESSION_SECRET`）
- **邮件**：独立 `email-worker/` 接 Cloudflare Email Routing（`bills+{userId}@20160325.xyz`），直写 D1
- **定时**：cron `0 9 * * *`（`worker/cron.ts`）——每日账单提醒 + Web Push
- **生产域名**：`https://app.all-bill.com`（Google OAuth 回调登记在这里）

## 关键约定

- 浏览器端**不写 SQL**：组件只调 `lib/api/*.ts` 包装函数，走 `/api/rpc/<module>/<fn>` 命名白名单路由（`lib/api/rpc-client.ts` + `lib/api/registry.ts`）
- UI 用 ObsidianUI 暗色体系：`components/obsidian/` 原语 + `globals.css` 的 `d-*` token（Tailwind v4 `@theme`）。不要再引入 MUI
- 设计源在 `design/openpencil/`：`.op` 文件是唯一真源，token 三方对齐（foundations.json ↔ .op ↔ globals.css），CI 门禁 `verify-batch.sh --source-only` 会拦漂移
- 部署：`npx vinext deploy`（本地构建 + 上传）；密钥用 `wrangler secret put`
- `db/seed*.ts`、`scripts/*.mjs` 里残留的 `@insforge/sdk` 脚本是历史存档，SDK 已从依赖移除，跑不动了——别照着它们写新代码

## 测试与门禁

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint --max-warnings=0
npm test            # vitest run
bash design/openpencil/verify-batch.sh --source-only   # 设计源五项检查
```

CI（`.github/workflows/ci.yml`）：代码质量 + 设计源质量，PR 到 main 时跑。
