# 机会台账验证记录（Task 23）

日期：2026-10-16 · 分支：`hubo1989/promotion` · HEAD：见 git log
验证环境：真实 SQLite（`node:sqlite` 迁移全量应用）+ 隔离本地 dev 服务（`scripts/opportunities-local.mjs`）

## 结论

P0/P1/P2 范围内 700 项测试全部通过；门禁 typecheck / lint（--max-warnings=0）/ 构建 / 设计源五项检查通过。
**未执行远程 D1 迁移、未做生产推送**；浏览器截图因自动化实例被并行会话占用而未完成（见 BLOCKED）。

## 自动化证据

| 类别 | 文件 | 覆盖 |
|---|---|---|
| Schema | `opportunity-schema.test.ts` | 0013 约束/触发器/不可变事件 |
| 迁移兼容 | `opportunity-legacy.test.ts` | 0015 包装幂等、归属一次性、opening 转分类守恒 |
| 查询 | `opportunity-queries.test.ts` | A01/A02/A03/A06/A11、cursor 绑定筛选 |
| 可用性 | `opportunity-availability.test.ts` | 状态矩阵全分支 |
| 使用 | `opportunity-usages.test.ts` | A04/A05/A08/A09 |
| 并发 | `opportunity-concurrency.test.ts` | barrier 竞态×7（含预约双完成） |
| 目录 | `opportunity-catalog.test.ts` | 复核发布、版本关闭、未来周期冲突回滚 |
| 导出 | `opportunity-export.test.ts` | 扁平 DTO、CSV 公式转义、BOM |
| 提醒 | `opportunity-reminders.test.ts` `opportunity-calendar.test.ts` | DST gap/fold、quiet hours、状态机、92 天 |
| Cron/推送 | `opportunity-cron.test.ts` `opportunity-push.test.ts` | 去重、租约、部分失败只补发失败设备、410 清理 |
| 任务 | `opportunity-task-rules.test.ts` `opportunity-tasks.test.ts` | 3×3 边界、绝对快照、模板不覆写快照 |
| 履约 | `opportunity-claims-grants.test.ts` `opportunity-bookings.test.ts` | 业务键唯一、三分支取消、linked-usage 触发器 |
| 端到端 | `opportunity-end-to-end.test.ts` | 目录→账户→核对→使用→更正→撤销→任务→奖励→预约→三分支取消；全程 reconcile 无漂移、foreign_key_check 空 |

命令与结果：
- `npm test` → **700/700 passed**（2026-10-16）
- `npm run typecheck`、`npm run lint`（max-warnings=0）→ 通过
- `npx vinext build` → 完成
- `bash design/openpencil/verify-batch.sh --source-only` → 五项 PASS

## 隔离服务实测（Task 12/16）

`node scripts/opportunities-local.mjs --persist-to /tmp/wc-verify-* --port 3051/3053`：
- PBKDF2 登录 + HMAC 会话 + 白名单角色派生 ✓
- 台账/日历/提醒/首页计数页面 200 ✓；getOpportunityPage/Calendar/Reminders、记录→历史(审计链)→撤销→余额回滚、关注、忽略/恢复、成员隔离与越权拒绝 ✓
- 兼容登记：无账户 NEEDS_CONFIRMATION → 建账户 → 新账本写入、旧表 0 新增 ✓

## 验收项（A01—A24）

PASS：A01 A02 A03 A04 A05 A06 A08 A09 A10 A11 A13 A14 A16 A17 A18 A19 A20 A21 A22 A23（自动化覆盖，见上表）。
部分验证：A07（金额型余额矩阵自动化；真实金额权益 UI 未在浏览器截图）、A12（组件测试 + RPC 实测；截图缺）、A15（quiet hours/DST 自动化；设备推送未发）、A24（迁移演练本地通过；远程未执行）。
未通过：无。
BLOCKED：360/390/768/1280 视觉截图与键盘焦点走查——chrome-devtools 自动化配置文件被并行会话占用；待实例释放后补 `design/openpencil/baseline/capture.py` 基线与人工走查。

## 已知边界

- 期初核对总额超过 count_limit 会被 DDL CHECK 拒（QUOTA_EXCEEDED）——超用历史走待核对/legacy-only 周期，不塞入限额周期。
- 远程 D1 迁移、生产 Cron、真实 Web Push：**未执行**，按发布手册单独授权（Task 24）。
