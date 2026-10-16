# 机会台账发布与迁移手册（WC-BEN-12）

适用范围：权益/机会台账（P0—P2，Task 1—24）。生产操作全部需要**单独授权**；本手册的命令本身不构成授权。

## 0. 最低安全版本与回退原则

- **最低安全回退版本**：任何一个包含 0013—0017 迁移与本文所列兼容层的已部署版本。
  回退到该版本可继续读旧字段与新流水；**直接回退到改造前的旧写逻辑是不安全的**（旧路径绕过账本约束）。
- 故障处置优先级：**关闭本模块写入口与新 Cron**（停用 `*/15` 触发与 opportunities 写 RPC），保留新增表与事件，绝不 DROP 表、绝不把个人余额写回旧全局产品计数。

## 1. 迁移顺序（生产）

```
0013 → 0014 → 0015 → P1 代码 → 0016 → 0017 → P2 代码
```

- 0013—0015 与 P1 代码同批发布；0016/0017 与 P2 代码同批。
- 当前 `migrations/d1/` 目录并非 wrangler 默认 migration ledger 配置（默认 `migrations/`）。
  执行方式二选一，禁止盲目 `wrangler d1 migrations apply`：
  1. 在 wrangler 配置显式声明 `migrations_dir = "migrations/d1"` 后使用 migrations apply；或
  2. 使用逐文件执行流程（与本地 runner 相同口径）：
     ```bash
     for f in migrations/d1/00{13,14,15}*.sql; do
       npx wrangler d1 execute worldcredit --remote --file "$f" --yes
     done
     ```
     0015 为幂等包装（`WHERE NOT EXISTS`），重复执行不增行；0016/0017 为纯 CREATE，重复执行会报“已存在”（安全失败，可跳过）。
- **执行前**：先只读检查迁移记录与备份策略（`npx wrangler d1 export worldcredit --remote` 或等价快照），确认回滚点。
- **执行后**：核对新增表存在、旧行未变（抽样对比 benefits/promos 行数与 ID）、`SELECT * FROM sqlite_master WHERE name LIKE 'opportunity_%'` 与预期一致。

## 2. 兼容层与保留窗口

| 旧接口 | 行为 |
|---|---|
| `recordBenefitUsage` | 兼容适配：唯一账户/卡 → 新账本；多解 `AMBIGUOUS_ACCOUNT`；无账户 `NEEDS_CONFIRMATION`；不再写 benefit_usages |
| `deleteBenefit`/`deletePromo` | 转归档（旧行与历史保留，不级联） |
| `getPromosWithBanks`/`getAllMyBenefits` | 返回形状不变；增量字段 `accounts`/`definition_id`/`balance_verified` 等 |
| RPC 错误 | `{data,error}` 不变，可选 `code/details/request_id`；`.message` 保持可读 |
| `mergeHolders` | 名下有权账本账户 → 业务冲突（先按手册迁移） |

旧接口**至少保留一个兼容版本**；移除任何旧字段前先弃用并保留一个版本。

## 3. 发布步骤

1. **预检（只读）**：迁移记录、备份、`app.all-bill.com` 当前版本可回退。
2. **远程建表**：按 §1 顺序执行 0013—0015（P1 批）。
3. **部署兼容版本**：`npx vinext deploy`；密钥经 `wrangler secret put`（`SESSION_SECRET`、`VAPID_PRIVATE_KEY` 必须已存在）。
4. **核对**：抽样账户/周期/事件行数；`getOpportunityPage`/`getBenefitLedger` 冒烟；旧页面无 500。
5. **启用新 Cron**：wrangler.jsonc 已含 `0 9 * * *` 与 `*/15 * * * *`；部署即生效。观察首轮：
   - `opportunity_notification_jobs` 增长、`status` 分布（pending/leased/sent/partial）；
   - `opportunity_notification_deliveries` 的 accepted/gone 占比；gone 高 → 订阅清理正常。
6. **P2 批**：0016/0017 → 部署 → 任务/领取/预约冒烟（/benefits/tasks 页面 + `recordTaskRewardReceived`）。

## 4. 本地演练（不触生产）

```bash
node scripts/opportunities-local.mjs --persist-to /tmp/wc-opportunities-<唯一标记> --port 3051
npm run typecheck && npm run lint && npm test && npx vinext build
WC_FORCE_NO_OPENPENCIL=1 bash design/openpencil/verify-batch.sh --source-only
```

runner 契约：显式 `--persist-to`（空目录或含 `.wc-opportunities-local` 标记）+ `--port`；顺序应用 `migrations/d1/*.sql` 与幂等 seed（`*.example.test`；管理员登录取自 `lib/admin-emails.ts` 白名单，密码 `verify1234`）；无隐式 remote；SIGINT 只停本脚本进程。

历史归属回填（独立脚本，默认 dry-run）：

```bash
node scripts/opportunities-backfill.mjs --persist-to <dir>          # 汇总
node scripts/opportunities-backfill.mjs --persist-to <dir> --apply  # 写入（仅本地）
```

无归属旧 benefit 使用**不自动归属**；`assignLegacyUsage` RPC 需管理员外部依据 + 理由，一次一源。

## 5. 验证与对账（日常）

- 只读对账：`reconcileOpportunityCycle`（按事件重放六维，报告差异与命令，不自动修复）。
- 指标：超额拒绝、revision 冲突、待归属数量、发送失败与过期作业数量。
- 日志红线：不输出 session、push keys、银行参考号、备注全文。

## 6. 故障处理

| 症状 | 处置 |
|---|---|
| batch 半成品/对账漂移 | 停写入口 → 只读对账定位命令 → 按事件重放差异人工修正（无自动改投影） |
| 推送大面积失败 | 检查 VAPID 与 410 占比；attempt_count 达 4 的 job 自动 failed，不无限重试 |
| 迁移中断 | 0015 可重跑；0013/0014/0016/0017 逐文件幂等性见 §1；从备份恢复前先核对已应用前缀 |
| 需要回退 | 见 §0：关写入口 + 保留数据；不 DROP、不回写旧计数 |
