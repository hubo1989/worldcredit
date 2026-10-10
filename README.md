# WorldCredit

自托管的个人信用卡 / 贷款账单管理 PWA。把散落在各家银行 App 和邮箱里的账单，收进一个自己控制的服务里：邮件导入账单、还款计划与提醒、免息期推算、多卡多持卡人视图，全部数据留在你自己的 Cloudflare 账号里。

线上示例：[app.all-bill.com](https://app.all-bill.com)

## 为什么自托管

信用卡账单数据敏感——消费习惯、欠款额度、还款记录放第三方 SaaS 等于把财务底牌交出去。这个项目让你在自己的 Cloudflare 账号里跑一套完整的账单管理：

- **数据自主**：D1 数据库 + R2 附件都在你自己的账号下，随时导出、随时销毁
- **邮件自动建档**：绑定 Gmail 后，银行账单邮件自动解析成账单记录，未知银行/卡片自动建档待确认
- **多卡多持卡人**：家庭账户场景，按持卡人/银行分组，多卡共享额度、合并账单的银行有专门区分
- **AI 辅助但可关**：账单识别、银行信息补全走你自己的 OpenAI 兼容 API key，系统设置里随时改
- **移动端体验**：PWA，手机加到主屏幕后和原生 App 差别不大，支持 Web Push 还款提醒

## 架构

```
前端 PWA（React + vinext）      → Cloudflare Workers（静态资源走 Assets）
API（app/api + lib/api RPC）    → 同一个 Worker 内
数据库                          → Cloudflare D1（SQLite）
附件（账单 PDF 等）              → Cloudflare R2
邮件解析                        → 独立 Email Worker（可选用，接收 Gmail 推送）
定时提醒                        → Cron Trigger（每天 09:00 UTC）
认证                            → 自建 PBKDF2 + 签名 Cookie，支持 Google OAuth 登录
AI                              → OpenAI 兼容 API（key 存 D1 system_settings 表，管理页配置）
```

## 自托管步骤

### 1. 准备

- Node.js ≥ 20
- Cloudflare 账号（免费套餐即可）
- `npm install`

### 2. 创建 D1 数据库并跑迁移

```bash
npx wrangler d1 create worldcredit
# 把返回的 database_id 填进 wrangler.jsonc 的 d1_databases[0].database_id

# 依次执行迁移（本地开发去掉 --remote）
npx wrangler d1 execute worldcredit --remote --file migrations/d1/0001_initial_schema.sql
npx wrangler d1 execute worldcredit --remote --file migrations/d1/0002_member_binding.sql
# ... 一直到 0012，按文件名顺序逐个执行
```

### 3. 创建 R2 桶与配置

```bash
npx wrangler r2 bucket create worldcredit-attachments
```

`wrangler.jsonc` 里的绑定名（`DB`、`ATTACHMENTS`、`IMAGES`、`ASSETS`）不要改，代码按绑定名取。

### 4. 配置 secrets

```bash
# 会话签名密钥（必填，随机长字符串）
npx wrangler secret put SESSION_SECRET

# 以下可选，按需配置
npx wrangler secret put GOOGLE_CLIENT_SECRET   # Google 登录，配合 vars 里的 GOOGLE_CLIENT_ID
npx wrangler secret put VAPID_PRIVATE_KEY      # Web Push 还款提醒
```

### 5. 本地开发

```bash
# .dev.vars 里放 SESSION_SECRET 等本地密钥
npm run dev
```

### 6. 构建与部署

```bash
npx vite build
npx wrangler deploy --config dist/server/wrangler.json
```

部署后把你的域名（比如 `https://your-domain.com`）作为 `APP_ORIGIN` secret 配上，OAuth 回调和规范域名跳转都依赖它。

### 7. 初始化

打开站点注册第一个账号，进管理后台（`/admin`）配置 AI API key、导入银行目录，就可以绑邮箱导账单了。

## 主要功能

- 账单页：按持卡人/银行分组，逾期/待还/未出账三段排序，免息期推算
- 邮件导入：Gmail 账单邮件自动解析，未知银行自动建档为待确认记录
- 卡片管理：账单日/还款日/额度覆盖，多卡一账户 vs 单卡单账户
- 银行目录：银行额度模式（每卡独立/多卡共享）、账单模式（单独/合并）区分，信息可按真实内容从官网与权威第三方补全
- 固定支出：房租/贷款类按月应付项，纳入还款提醒
- Web Push 还款提醒 + 每日 Cron 汇总

## License

MIT
