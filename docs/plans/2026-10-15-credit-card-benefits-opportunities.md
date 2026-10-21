# 信用卡优惠权益台账与机会管理 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修正现有优惠权益数据与交互问题，分两批交付个人／家庭权益台账、可用机会、权益日历提醒，以及手动达标任务和领取／预约管理。

**Architecture:** 在保留 `benefits/promos` 目录及旧 RPC 兼容层的基础上，新增规则版本、持卡人账户、配额批次和不可变事件流水。React 页面只调用命名 RPC；服务端用统一 scope、周期、余额和可用性函数，D1 batch 与数据库约束保证记录、更正、撤销和预约不重复扣减。P2 复用 P1 的账户和账本。

**Tech Stack:** Cloudflare Workers、D1/SQLite、vinext App Router、React 19、TypeScript、date-fns 4、Intl、Vitest 4、Node 22 内置 SQLite、ObsidianUI/Tailwind v4、OpenPencil `.op`、现有 Web Push。

---

## 0. 使用方式与授权边界

- 产品真源：[WC-BEN-12 spec](../specs/12-credit-card-benefits-opportunities.md)。数据／接口／DDL 真源：[技术附录](../specs/12-credit-card-benefits-opportunities-technical.md)。遇到规则冲突先修文档，不在页面里另写一套。
- `superpowers:executing-plans` 是技能模板中的名称；本宿主实际列出的技能名是 `executing-plans`，调用时使用实际名称。UI 实施按 `openpencil-design`，调试按 `systematic-debugging`，完成前按 `verification-before-completion`。本 plan 只规划，不执行以上工作。
- 当前工作区是 `/Volumes/external/worktrees/worldcredit/promotion`，分支 `hubo1989/promotion`。从该 worktree 执行，不切回原始仓库，不覆盖别人改动，不用共享裸 stash。
- 用户本次授权是编写 spec+plan。实施、安装依赖、启动服务、提交、推送、远程迁移、部署按实施时的授权执行。下述验证命令是目标，**不是本次已运行结果**。
- 不自动 commit。完成一个任务后记录检查点及 `git diff --stat`；若用户授权提交，再按本文的 Conventional Commit 建议名分批提交列明文件。不要 `git add .`。
- 当前运行时是 Workers+D1，不能照旧商用化 plan、`db/schema.sql` 或 PostgreSQL/RLS 迁移实现。实际新增迁移在 `migrations/d1/`，基线已有 0001—0012。
- 全部任务完成才是本轮范围完成；P1 和 P2 各自有可独立审查的里程碑。不得把“页面已出现入口”当完整能力。

## 1. 里程碑与依赖

| 里程碑 | 任务  | 交付结果                                                  | 依赖 |
| ------ | ----- | --------------------------------------------------------- | ---- |
| M0     | 1—3   | 可复现测试基础、P0 真实性／权限止血、设计契约             | 无   |
| M1     | 4—10  | D1 核心、actor scope、周期、账户、原子流水及旧数据兼容    | M0   |
| M2     | 11—16 | 新台账、可用机会、卡片详情、来源复核、日历与提醒，P1 验收 | M1   |
| M3     | 17—22 | 手动任务、发放确认、领取、预约与配额结算，P2 验收         | M2   |
| M4     | 23—24 | 迁移演练、全链路回归、交付和发布手册                      | M3   |

执行顺序严格为 **1 → 2 → 3 → 4 → 5 → 6 → 8 → 7 → 9 → 14（先完成 DDL 和纯函数）→ 10 → 11 → 12 → 13 → 14（接查询与个人状态）→ 15 → … → 24**。Task 8 是账户写入的通用基础，必须先完成再进入 Task 7；Task 8 不依赖账户服务，只依赖 Task 4 真实 schema 和固定样本。0014 结构先于0015应用，Task14余下查询不反向依赖 Task10。

单任务按多个 2—5 分钟动作推进：先写具体失败例 → 运行确认失败原因 → 实现一个切片 → 运行目标测试 → 更新检查点。任务 9、15、20 的一致性测试不可省成字符串匹配。

## 2. 通用测试和本地运行约定

### 2.1 测试命令

```bash
npm run typecheck
npm run lint
npm test
npx vinext build
bash design/openpencil/verify-batch.sh --source-only
```

目标测试用 `npm test -- lib/__tests__/具体文件.test.ts`。测试匹配只覆盖 `lib/__tests__/**/*.test.ts`，辅助代码不能命名 `.test.ts`。不反复运行整个 suite 代替定位失败；某任务目标测试和必要门禁通过后进入下个任务，最终统一跑完整门禁。

### 2.2 真实 SQLite 与 D1 分工

已确认本机 Node v22.22.3 可用 `node:sqlite`。新增测试 helper 使用 `DatabaseSync(':memory:')`，应用真实迁移，不模拟 SQL 的含义；D1 adapter 的 `.batch()` 以 SQLite 事务执行并实际回滚。JSON/外键/CHECK/触发器用真 SQL 测。

Node 测试证明规则和事务，不替代 Workers 环境；迁移、两个并发 RPC、Cron 分派另在一次性 Wrangler 本地库验证。不得拿“fake db 返回预设 rows”证明额度并发安全。

### 2.3 隔离本地环境

所有业务运行验证使用新建的任务专有持久化目录，例如 `/tmp/wc-opportunities-<唯一标记>/`，不读写共享 `.wrangler/state`、生产 D1 或真实账户。seed 用测试邮箱 `*.example.test`、虚拟银行／卡、临时 session secret，无外发动作。server 禁止向真实 push endpoint 发送，测试投递使用可注入替身；真实推送仅在用户授权设备上测试。

Task 24 的 `scripts/opportunities-local.mjs` 和本轮独立 seed 必须在 **Task 12 首次真实 UI 验证前**创建其 local runner 部分；Task 24 的发布手册与生产边界仍在最后完善。脚本负责依次应用 `migrations/d1/*.sql` 到显式 `--persist-to` 目录，再执行本轮独立 seed；默认 local，不支持隐式 remote。不得调用已有全站 seed 覆盖现场。

---

## Task 1：建立行为测试底座与固定样本

**Files**

- Create: `lib/__tests__/helpers/sqlite-d1.ts`
- Create: `lib/__tests__/helpers/opportunity-fixtures.ts`
- Create: `lib/__tests__/opportunity-test-db.test.ts`
- Modify: `vitest.config.ts`（仅在实际 alias 解析失败时增加 `@` 映射）

**步骤**

1. 写一个真实外键失败和 batch 回滚测试，先确认缺 helper 时 FAIL；不要用“调用次数正确”作为事务断言。
2. 实现 helper：`DatabaseSync` → `.prepare().bind().all()/first()/run()` 与 `.batch()`；全部参数绑定，`.run()` 返回真实 meta.changes；transaction catch 后 rollback 并重新抛异常。
3. 按序读取 `migrations/d1`，开启 `PRAGMA foreign_keys=ON`。测试禁止全局共享同一个 database，每例创建／关闭实例。
4. seed 明确三位用户：管理员 A、成员 A、另一管理员 B；两个 holder 持同产品、同 holder 第二张卡、贷款卡、冻结卡、不同币种卡、无卡成员。全部是虚构数据。
5. 运行 `npm test -- lib/__tests__/opportunity-test-db.test.ts`，预期空库迁移、外键拒绝、batch 中断、复位全部 PASS。

可直接作为第一条失败测试：

```ts
it("第二条 SQL 失败时回滚整批第一条", async () => {
  const db = createSqliteD1();
  db.exec("CREATE TABLE checks (id TEXT PRIMARY KEY, n INTEGER CHECK(n>=0))");
  await expect(
    db.batch([
      db.prepare("INSERT INTO checks VALUES (?,?)").bind("first", 1),
      db.prepare("INSERT INTO checks VALUES (?,?)").bind("second", -1),
    ]),
  ).rejects.toThrow();
  expect(db.raw.prepare("SELECT COUNT(*) AS n FROM checks").get()).toEqual({ n: 0 });
  db.close();
});
```

**检查点**：测试 helper 执行真实 SQL，无新生产依赖。提交建议 `test(opportunities): add sqlite fixtures and atomicity harness`。

## Task 2：P0 活动真实性、权限和操作反馈止血

**Files**

- Modify: `app/(mobile)/promos/page.tsx`
- Modify: `app/(mobile)/benefits/page.tsx`
- Modify: `components/mobile/BenefitEditDialog.tsx`
- Modify: `lib/api/promos.server.ts`
- Modify: `lib/api/benefits.server.ts`
- Modify: `lib/api/member-scope.ts`
- Modify: `lib/api/registry.ts`
- Modify: `app/(mobile)/dashboard/page.tsx`
- Modify: `components/obsidian/DashboardView.tsx`
- Test: `lib/__tests__/opportunity-existing-regressions.test.ts`
- Test: `lib/__tests__/member-scope.test.ts`
- Test: `lib/__tests__/rpc-registry.test.ts`

**步骤**

1. 用 Task 1 数据复现：目录有银行但用户无卡；expired/disabled/future 活动仍返回；同产品两成员被 `LIMIT 1` 误拒；下月 usage 污染本月。
2. 增量绑定 `getPromosWithBanks` 的 session user，只从该用户可访问 holder 的 active `credit` 卡计算 userBanks，活动按启停／日期初筛。保留旧返回形状，后续 Task 11 改统一 DTO。
3. 删除运行时 `POPULAR_PROMOS` 合并；没有真实活动时展示空态。移除虚假的“已关注”和“一键享用”成功反馈，P1 关注 API 完成前只保留明确“查看参与方式”说明。
4. 产品匹配尚不能证明资格时不显示“我已持卡可享”；首页临时改“查看优惠”，Task 11 再恢复可信数量。
5. `assertBenefitAccess` 改 SQL 先加可访问 holder 条件，禁止非限定 `LIMIT 1`；用 scoped SQL 和实际记录验证。
6. 权益页从 `getAllCardsWithProduct` 返回的真实卡列表选择目标产品；有卡无权益也能选择，成员不见 admin-only 维护按钮；加载失败显式呈现错误和重试。
7. 旧登记接口暂加有效期、日期和 quota 保护，明确“兼容写路径”，Task 10 整体转入新账本；中间提交不宣称解决全产品计数归属。
8. 运行 3 个目标测试文件。预期上述复现由 FAIL 转 PASS，旧 RPC 返回字段仍兼容。

**检查点**：数据真实性先止血，不能为了暂时有内容再加示例。提交建议 `fix(opportunities): remove misleading activities and scope existing views`。

## Task 3：P1/P2 屏幕、状态和设计源契约

**Files**

- Modify: `design/openpencil/scripts/12-mobile-extended.js`
- Modify: `design/openpencil/scripts/11-mobile-details.js`
- Modify: `design/openpencil/scripts/30-admin.js`
- Modify: `design/openpencil/worldcredit-redesign.op`
- Modify: `design/openpencil/screens/_registry.json`
- Modify: `design/openpencil/screens/_contract.json`
- Modify: `design/openpencil/DESIGN.md`（仅新增本轮行为契约，不改旧账单规则）
- Test: `design/openpencil/tests/test_opportunities_contract.py`

**步骤**

1. 读取 `openpencil-design`，核对当前 MCP/CLI 是否连通。当前会话 MCP 曾 ECONNREFUSED，实施时真实探测；失败则保留设计任务 BLOCKED，继续独立后端任务，不能声称视觉源已同步。
2. 在 registry 登记 `/benefits`、`/promos`、`/benefits/calendar`、`/benefits/tasks` 和卡详情机会区；补 loading/empty/error/needs-confirmation/usage-history/correction/conflict，以及 P2 claim/booking/pending-settlement。
3. 根据 spec 第 5—9 节先设计字段和动作，再在 `.op` Candidate 制作 360/390 主屏、共享账户、金额／次数、未知余额和历史纠错弹层。
4. 检查语义没有误导：普通领取≠新增额度，预约≠已使用，关注≠已报名，手动达标≠银行确认。
5. 修改重建脚本并重建本批受影响帧，候选与 Current/approved 分离；仅评审通过的画面进入批准基线。
6. 执行 `python3 -m unittest discover -s design/openpencil/tests -p 'test_opportunities_contract.py'` 和 source-only 门禁，预期字段、行为、token 无漂移。

**检查点**：设计任务只动本轮相关母版，MUI／`lib/theme.ts` 旧描述不能当实现依据。提交建议 `docs(design): define opportunity ledger and calendar states`。

## Task 4：核心迁移、行类型和事件约束

**Files**

- Create: `migrations/d1/0013_opportunity_accounts_ledger.sql`
- Create: `lib/opportunities/types.ts`
- Modify: `lib/db/types.ts`
- Modify: `lib/types.ts`（增量导出，不移除旧字段）
- Test: `lib/__tests__/opportunity-schema.test.ts`

**步骤**

1. 从技术附录第 6.1 节复制核心 DDL，补齐同章列明的不可变、版本定义一致、私人 holder 及已用归属保护触发器。
2. 先写 schema 测试：两个 holder 不能复用同一卡关联；同卡同定义不能双重 active 绑定；0 额度合法；null 无限额；不同定义版本不能绑定；事件不可 UPDATE/DELETE。
3. 运行目标测试，确认数据库约束未实现前 FAIL，而非只有 import FAIL。
4. 实现触发器及 TypeScript row 类型，金额采用整数 minor units。不要重用旧 REAL 保存新权益金额。
5. 验证所有旧迁移和 0013 从空库应用成功；带旧数据升级后旧行和 ID 不变，`PRAGMA foreign_key_check` 为空。
6. 运行 `npm test -- lib/__tests__/opportunity-schema.test.ts`、`npm run typecheck`。预期全部 PASS。

**检查点**：没有运行远程迁移，无硬删除和重建旧业务表。提交建议 `feat(opportunities): add scoped accounts and immutable ledger schema`。

## Task 5：actor 注入、错误码和管理员／成员 scope

**Files**

- Modify: `lib/api/registry.ts`
- Modify: `app/api/rpc/[module]/[fn]/route.ts`
- Modify: `lib/api/rpc-client.ts`
- Create: `lib/opportunities/scope.server.ts`
- Create: `lib/opportunities/errors.ts`
- Test: `lib/__tests__/opportunity-scope.test.ts`
- Test: `lib/__tests__/rpc-registry.test.ts`

**步骤**

1. 写行为测试：伪造 body.actor/user_id 不生效；admin A 不能操作 admin B 私有账户；member A 只看绑定 holder；没有 holder 返回空态。
2. 为 registry 增 `prependActor`，按技术附录第 2 节的固定顺序从 session 组 actor；旧 bind/guard 参数位置不变。
3. 实现 scope SQL 和 `assertAccount/Card/Usage/Task/Fulfillment` 对象授权；实际卡与账户的关系必须验证。P2 断言先不暴露未建表 API。
4. 实现增量 `{code,details,request_id}` 错误及客户端 RpcError；旧 catch `.message` 仍正确。
5. 限制 registry entry 不允许同时把 actor 当客户端可传字段绑定；契约测试必须调用真实 scope，不能只检查属性存在。
6. 运行 `npm test -- lib/__tests__/opportunity-scope.test.ts lib/__tests__/rpc-registry.test.ts`。预期跨用户读写、计数、对象猜测全部拒绝且不泄漏内容。

**检查点**：这是本轮个人数据的新边界，不扩大其他模块管理员权限。提交建议 `feat(opportunities): enforce actor scope for all private operations`。

## Task 6：日期、时区、规则验证和统一周期

**Files**

- Create: `lib/opportunities/dates.ts`
- Create: `lib/opportunities/rules.ts`
- Test: `lib/__tests__/opportunity-dates.test.ts`
- Test: `lib/__tests__/opportunity-rules.test.ts`
- Modify: `lib/api/benefits.server.ts`（引用统一周期，去掉旧重复计算）
- Modify: `lib/api/cards.server.ts`（引用统一周期）

**步骤**

1. 写自然日／周／月、指定月日年度、核卡周年、单次周期的输入输出表；冻结日期和时区。加入非法 2026-02-30、非法 IANA zone、空锚点、未来日期。
2. 先运行目标测试 FAIL，再实现 civil date 校验和半开窗口，按源锚点每期重算，禁止连续 setMonth。
3. `RuleSnapshotV1` 验证 quota 0/null/负数、币种小数位、日期上界、open_ended、weekday、领取／预约窗口、所有长度和枚举。
4. 将旧 monthly/yearly/one_time 转为规范规则的适配器，默认遗留来源未核实；列表和卡详情使用同一 `getCycleWindow` 过滤上、下界。
5. 测试北京时间午夜对纽约前一天；DST 时间选择在 Task 14 细化，不能依赖主机 locale。
6. 执行两个目标文件和现有 `due-distance/recurring-payables` 回归，预期不修改账单工具语义。

关键测试形态：

```ts
it("2 月 29 日周年在非闰年收拢，后续闰年恢复源锚点", () => {
  const rules = annualRules({ anchor_source: "issued_on" });
  const anchor = { issued_on: "2024-02-29", activated_on: null };
  expect(getCycleWindow(rules, "2027-02-28", anchor).period_start_on).toBe("2027-02-28");
  expect(getCycleWindow(rules, "2028-02-29", anchor).period_start_on).toBe("2028-02-29");
});
```

**检查点**：输入 now 可注入，列表／详情同一计算，无时区隐式行为。提交建议 `feat(opportunities): unify local-date periods and rule validation`。

## Task 7：账户、关联卡、周期和期初核对

**依赖：Task 8 必须先完成。**

**Files**

- Create: `lib/opportunities/accounts.server.ts`
- Create: `lib/opportunities/catalog.server.ts`
- Create: `lib/api/opportunities.server.ts`
- Create: `lib/api/opportunities.ts`
- Modify: `lib/api/cards.server.ts`
- Modify: `components/mobile/CardForm.tsx`
- Test: `lib/__tests__/opportunity-accounts.test.ts`

**步骤**

1. 写独立卡、同 holder 共享、多 holder 错误绑定、同卡重复绑定、并发 materialize 同周期的测试。
2. 从 Task 4 表建立账户，要求实际卡符合定义；scope_key 由服务端计算 `card:<id>` 或 `holder:<id>`。
3. 周期按需创建：优先按名义 period_start 选已有版本；月中／年中首次建模无旧版本时，按技术附录的 `version_as_of_on` 选择首个可证版本，并截取 usable_start，不能等下期或倒造过去资格。重复创建命中唯一约束后读取同一行；grant-only 不建 regular 周期。
4. 增 `issued_on/activated_on` 卡读写及表单，旧调用不传不改；不知道时保持 null。
5. 期初核对保存 opening 差值、opening_as_of_on，不与 actual used 混合；有未归属历史时 verified=false。补归属时若明确已包含，原子 opening→used 转分类不再扣，覆盖范围不明不能猜。加入月中首期和先核对后归属的测试。
6. 实现 `updateOpportunityCycleWorkflow`：per_cycle 规则为每批次录入真实 claim/booking 绝对窗口，记事件并更新提醒版本；缺失保持待补充，不重复套首月日期。
7. 使用已完成的 Task 8 命令服务执行首次账户创建和期初核对，不能临时直写后遗留第二条路径。
8. 运行账户测试，预期 A01/A02/A07/A10 的初始化和周期部分通过。

**检查点**：额度共享由显式账户决定，不从 banks.quota_mode 推断。提交建议 `feat(opportunities): initialize personal accounts and verified cycles`。

## Task 8：实现幂等命令与原子事件写入服务

**Files**

- Create: `lib/opportunities/writes.server.ts`
- Create: `lib/opportunities/hash.ts`
- Test: `lib/__tests__/opportunity-write-engine.test.ts`

**步骤**

1. 写失败测试：相同 key 同输入两次只写一组事件；同 key 改金额报冲突；第二条事件超额时 command/第一条事件/投影全部回滚。
2. canonical 输入固定白名单字段和顺序，SHA-256；不 hash 客户端提供的余额。command 的原始成功 result_json 在 commit 前写好。
3. 实现一次 D1 batch：command → write_checks → events → projections → result → 删除 checks；不要把 batch 包装成忽略 error 的 helper。
4. write_checks 用 CHECK 让“不满足”成为数据库错误，测试 UPDATE 0 行不被误判成功；所有 change revision 的操作均有批内断言。
5. 实现错误分类，失败后只允许读已提交的原 command 作为重试结果；无权用户不能拿别人 key 查结果。
6. 对账函数按事件重放六维值，对不上返回具体 diff，不能自动改投影。
7. 运行目标测试并执行 `PRAGMA foreign_key_check`。预期无残留半成品。

**检查点**：D1 官方 batch 回滚语义已确认；本地 SQL PASS 后 Task 24 仍需 Workers 实测。提交建议 `feat(opportunities): add idempotent atomic command engine`。

## Task 9：使用、撤销、更正与并发测试

**Files**

- Create: `lib/opportunities/usages.server.ts`
- Modify: `lib/api/opportunities.ts`
- Modify: `lib/api/opportunities.server.ts`
- Modify: `lib/api/registry.ts`
- Test: `lib/__tests__/opportunity-usages.test.ts`
- Test: `lib/__tests__/opportunity-concurrency.test.ts`

**步骤**

1. 写 A04/A05/A08/A09：最后一次额度竞争、重复提交、跨周期更正失败回滚、二次撤销不二次返还。
2. Record 校验实际卡、active 状态或真实历史补记条件、资格、verified、有效期、当天上界、币种和数值；使用事件+usage 同批写入。
3. Correct 需要 expected_revision 和 reason；一次 batch 原周期反冲→目标周期扣减→usage revision 更新，错误不部分成功。
4. Void 需要 active→voided CAS；关联旧周期仅返还旧周期数值，不能给本期增加。
5. 用两次请求在“前读完成、入 batch 前”设置 barrier，确保两个请求读到同一状态；预期一个成功、另一个数据库约束或 revision 冲突，执行 `reconcile` 无差异。
6. 添加备注更正六维 delta 为 0、未来日期被拒、过期权益不能今天用但可有证据补记过去、无权限拒绝测试。
7. 运行两个目标文件，预期原问题可复现的红灯变绿；不编写仅检测 SQL 关键字的替代测试。

**检查点**：无 `catch {}`、无先写记录后修余额、无 hard delete。提交建议 `feat(opportunities): support audited usage corrections and reversals`。

## Task 10：历史归属、来源 backfill 与旧 API 适配

**Files**

- Create: `migrations/d1/0015_opportunity_legacy_catalog.sql`
- Create: `lib/opportunities/legacy.server.ts`
- Create: `scripts/opportunities-backfill.mjs`
- Modify: `lib/api/benefits.server.ts`
- Modify: `lib/api/promos.server.ts`
- Modify: `lib/api/admin.server.ts`
- Modify: `lib/api/holders.server.ts`（合并持卡人的新依赖保护）
- Test: `lib/__tests__/opportunity-legacy.test.ts`

**步骤**

1. 写 legacy benefit 无 card、promo 有有效 card／card 已删除／归属不明、重复迁移、多解旧写入、旧删除级联的用例。
2. 0015 包装旧目录，version 的 verification=unverified；旧目录没有可靠维护人时定义 `created_by=NULL` 并保留 legacy 源 ID，不伪造 migration actor，不创建用户。新建定义仍强制真实 session actor；未知历史规则生效日从本次迁移日开始待复核，不猜过去资格。
3. `opportunities-backfill.mjs` 默认只打印 dry-run 汇总，必须显式 local persist 路径和执行参数才写；不默认 remote。源行和 link 同 batch 保证一次映射。
4. 全部无归属旧 benefit 使用保留，不自动猜归属；管理员分配界面数据只在管理范围可证明时开放。先核对3次后归属其中1次的例子必须仍总耗用3；included_in_opening 明确时同batch opening−1/used+1，link记录抵扣量；不足或不明先核对。
5. `recordBenefitUsage` 兼容适配：唯一账户/卡可调用新服务；多解返回 `AMBIGUOUS_ACCOUNT`。新写入不再插旧表，避免双算。
6. 旧读保留原类型字段，增加账户明细和 scope；旧 deleteBenefit/deletePromo 转归档。受账户依赖的 holder merge / card 归属调整返回业务冲突而非级联删除。
7. 运行 legacy 测试及 `rpc-registry`；预期重复 backfill 不增记录，旧返回字段仍在，归属没有信息泄漏。

**检查点**：要保留 1 个兼容版本及最低安全回退版本。提交建议 `feat(opportunities): migrate legacy records without guessing ownership`。

## Task 11：统一查询、可用性、筛选和首页计数

**Files**

- Create: `lib/opportunities/availability.ts`
- Create: `lib/opportunities/queries.server.ts`
- Modify: `lib/api/opportunities.ts`
- Modify: `lib/api/opportunities.server.ts`
- Modify: `lib/api/registry.ts`
- Modify: `lib/api/cards.server.ts`
- Modify: `lib/api/promos.server.ts`
- Modify: `lib/api/dashboard.server.ts`
- Test: `lib/__tests__/opportunity-availability.test.ts`
- Test: `lib/__tests__/opportunity-queries.test.ts`

**步骤**

1. 先写状态矩阵：来源未知、资格未知、日期无截止且非 open_ended、已冻结、非有效 weekday、部分 reserved、grant-only 未到账；全部明确可用/动作/原因。
2. 实现纯函数状态优先级，和 spec 第 6 节同序，不能靠标题关键词判场景或卡产品名字判银行。
3. 批量读账户、关联卡、当期 Cycle、用户 states，scope 在 SQL 中；同 holder 多卡共享只生成一个 Opportunity。
4. 实现筛选参数、稳定排序、分页和同 scope counts，cursor 绑定 filters；limit 默认30最多100，q 长度限制。
5. 卡详情、首页数量和两页列表共用查询；当天可用数不含待领取/待确认/任务，数值失败显示“暂无法获取”，不回退目录总数。
6. 最少验证 A01/A02/A03/A06/A11，及第一页 counts 不随分页错变。
7. 运行两个目标文件，typecheck。预期 getCardOpportunities 与 getOpportunityPage 对同卡相同条件输出一致。

**检查点**：不用新算法在页面重新判断机会状态。提交建议 `feat(opportunities): unify scoped availability and opportunity counts`。

## Task 12：P1 台账、机会列表、详情和使用历史 UI

**Files**

- Modify: `app/(mobile)/benefits/page.tsx`
- Modify: `app/(mobile)/promos/page.tsx`
- Modify: `app/(mobile)/cards/[id]/page.tsx`
- Modify: `app/(mobile)/dashboard/page.tsx`
- Modify: `components/obsidian/DashboardView.tsx`
- Create: `components/opportunities/OpportunityFilters.tsx`
- Create: `components/opportunities/OpportunityRow.tsx`
- Create: `components/opportunities/BenefitLedgerView.tsx`
- Create: `components/opportunities/UsageHistory.tsx`
- Create: `components/opportunities/UsageEditor.tsx`
- Create: `components/opportunities/AccountSetupDialog.tsx`
- Create: `lib/opportunities/view-model.ts`
- Test: `lib/__tests__/opportunity-view-model.test.ts`

**步骤**

1. 从 Task 3 批准帧实现，只引用 Obsidian 原语和 d-\* token，操作逻辑用新 RPC。旧 BenefitForm/UsageDialog 合适字段可复用，避免两份不同校验。
2. 实现 URL query 恢复、本人/管理范围筛选、shared 账户一次展示、金额/次数/null/unknown 文案。
3. 完成初始化、记录、历史、纠正、撤销、期初核对和冲突重载；错误保留输入，不重复生成 retry key。
4. 关注状态走 `setOpportunityFollowed`，服务成功后才提示，打开银行入口不改变关注或领取状态。
5. 卡详情最多3项同 DTO；首页使用可信 count；不增加顶层底部导航项。
6. view-model 测试校验余额单位、过期状态、按钮动作和 shared 计数；不能靠快照长字符串证明流程。
7. 运行目标测试/typecheck/lint；在隔离服务执行 UI 验证清单 A01/A02/A08/A11/A12，截图 360/390/768/1280 和错误/空态。

**检查点**：UI 验证需真实网络请求和数据库变化，不仅弹框成功。提交建议 `feat(opportunities): build personal ledger and actionable lists`。

## Task 13：目录来源复核与可用导出／统计

**Files**

- Modify: `lib/api/ai.server.ts`
- Modify: `lib/api/admin.server.ts`
- Modify: `app/admin/promos/page.tsx`
- Modify: `app/admin/benefits/page.tsx`
- Modify: `lib/api/benefitUsages.ts`
- Modify: `lib/api/promoUsages.ts`
- Modify: `lib/api/analytics.server.ts`
- Modify: `lib/export.ts`
- Modify: `lib/api/opportunities.ts`
- Modify: `lib/api/opportunities.server.ts`
- Test: `lib/__tests__/opportunity-catalog.test.ts`
- Test: `lib/__tests__/opportunity-export.test.ts`
- Test: `lib/__tests__/admin-console.test.ts`

**步骤**

1. 写候选不写库、模型无来源不能标 official_verified、同款规则新版本保留旧周期、归档不删历史用例。
2. 将 `autoEnrichCardBenefits` 走候选门面并明确 REVIEW_REQUIRED；前端改调用 preview→publish，删除靠标题片段自动“官网已核实”的认定。
3. 仅复核确认的规则发布版本，来源字段落库，私人确认不写共享目录；抓取失败清晰报错，不吞异常生成假依据。
4. 将 benefitUsages/promoUsages 改 RPC 包装，导出用统一扁平 DTO，用户范围、卡、周期和状态条件真实生效。
5. 权益使用分析聚合真实账户+Cycle，未知或待归属单列，不返回固定空数组；已用、预约占用和取消损耗分开。
6. CSV 对用户文本公式前缀转义，表头带原币种/单位，使用量与撤销历史不误双算。
7. 运行目录、导出和已有 admin-console 测试。预期无数据库导入进入客户端 bundle，导出记录与页面一致。

**检查点**：只修本模块统计，消费分类和 bill_items 自动化不扩入本任务。提交建议 `feat(opportunities): persist source review and scoped usage exports`。

## Task 14：提醒 schema、事件、日历和个人处理状态

**Files**

- Create: `migrations/d1/0014_opportunity_reminders.sql`
- Create: `lib/opportunities/reminders.ts`
- Create: `lib/opportunities/notifications.server.ts`
- Modify: `lib/types.ts`
- Modify: `lib/api/preferences.shared.ts`
- Modify: `lib/api/preferences.server.ts`
- Modify: `lib/api/opportunities.ts`
- Modify: `lib/api/opportunities.server.ts`
- Modify: `lib/api/registry.ts`
- Test: `lib/__tests__/opportunity-reminders.test.ts`
- Test: `lib/__tests__/opportunity-calendar.test.ts`

**步骤**

1. 应用 0014 DDL，测试 user+event 状态隔离、job key 唯一和 status 枚举。
2. 纯函数从账户/规则/配额生出日历事件，明确静态 claim/booking 日期可在 P1 使用，P2 状态未接入前不伪造领取。
3. 实现 event_key/delivery_key、阈值节点、read steps、dismiss、snooze、restore；延后越过截止拒绝，改备注不重建事件。
4. 为 reminder_config 增 opportunities 子树，深合并默认，保留旧字段；不改变现有账单提醒时间语义。
5. 测日期跨用户时区、quiet hours 跨午夜、DST gap/fold；不存在当地时刻顺延、重复小时只一次。
6. 实现 92 天日历范围校验、按用户范围筛选、未核实数据只进待核对，不进催用 push。
7. 运行两个目标测试及 schema/preferences 回归；预期 A14/A16 纯函数部分通过。

**检查点**：日历内容不依赖有没有推送订阅。提交建议 `feat(opportunities): add calendar events and personal reminder state`。

## Task 15：权益 Cron、投递作业、幂等和重试

**Files**

- Create: `worker/opportunity-cron.ts`
- Modify: `worker/index.ts`
- Modify: `worker/cron.ts`（仅调度隔离所需改动）
- Modify: `wrangler.jsonc`
- Modify: `lib/opportunities/notifications.server.ts`
- Modify: `public/sw.js`
- Test: `lib/__tests__/opportunity-cron.test.ts`
- Test: `lib/__tests__/opportunity-push.test.ts`

**步骤**

1. 写 Cron 分派测试：`*/15` 只权益；`0 9` 只既有账单；同一节点两次扫描只有一个 job，余额改变、解绑或忽略后不发送。
2. 以显式 DB/clock 运行 scanner，新增十五分钟 Cron，旧日扫保持原 schedule。不要以 setInterval 或浏览器打开页面作为后台调度。
3. 条件 UPDATE RETURNING claim lease，单轮50项；sender 注入替身，按订阅记录 accepted/failed/gone。send 结果为0不能记成功。
4. 发送前重新查 scope、资格、余额和 states；quiet hours 顺延、到期取消、失败退避按 spec；无订阅仅应用内保留。
5. payload 加稳定 tag、受限 deep link 和隐私配置；SW 点击后导航到应用再鉴权。不要向任意入参 URL 导航。
6. 测多设备部分失败只重发失败设备、404/410清理、租约超时、并发扫描、推送成功后崩溃重复窗口；明确 at-least-once 的边界。
7. 运行 Cron/push 目标测试；在 Wrangler 本地直接调用 handler 或受支持 scheduled 测试路径验证完整分派，不发送真实消息。

**检查点**：日志用“提交推送服务”，不把设备收到视为可验证事实。提交建议 `feat(opportunities): schedule deduplicated opportunity notifications`。

## Task 16：日历、提醒 UI 与 P1 验收

**Files**

- Create: `app/(mobile)/benefits/calendar/page.tsx`
- Create: `components/opportunities/OpportunityCalendarView.tsx`
- Create: `components/opportunities/ReminderList.tsx`
- Create: `components/opportunities/ReminderStateDialog.tsx`
- Modify: `components/settings/ReminderPreferencesCard.tsx`
- Modify: `app/(mobile)/benefits/page.tsx`
- Modify: `app/(mobile)/promos/page.tsx`
- Modify: `app/(mobile)/dashboard/page.tsx`
- Modify: `components/obsidian/DashboardView.tsx`
- Modify: `design/openpencil/baseline/capture.py`（补路由／状态，不改业务）

**步骤**

1. 实现按日列表和月历切换、事件类型/时区/持卡人标识；snooze 控件显示确切时间和超期错误。
2. 首页以少量最紧急待办展示，完整内容进入日历／提醒列表；不改变账单风险排序。
3. 提醒设置新增权益分类、时区、时间、节点、Web Push 开关；实际连接测试使用 `/api/push/test`，没有权限时给设备引导。
4. 本地双用户真实验证：管理员忽略不影响成员；延后刷新持久；机会已使用后催用提醒消失；P1 静态领取提醒仅支持忽略/延后，领取后自动解除留给 P2；没有订阅日历仍可用。
5. 运行完整 P1 unit+typecheck/lint/build、source-only 门禁、相关屏幕视觉验证，截图含长文本和错误态。
6. 对照 spec A01—A17、A24 逐条登记证据路径和未验证项。有一致性／权限失败时不能发布 P1。

**P1 出口**：台账、机会、使用纠错、来源、日历与后台提醒能实际工作；任务和完整领取预约仍标 P2，不能假按钮。提交建议 `feat(opportunities): deliver opportunity calendar and reminder controls`。

## Task 17：手动任务 schema、条件及发放日期纯函数

**Files**

- Create: `migrations/d1/0016_opportunity_manual_tasks.sql`
- Create: `lib/opportunities/tasks.ts`
- Modify: `lib/opportunities/types.ts`
- Modify: `lib/db/types.ts`
- Test: `lib/__tests__/opportunity-task-rules.test.ts`

**步骤**

1. 写最多3组OR×每组3指标、金额/笔数/确认项、币种/0值/非法负数、统计周期和发放窗口测试。
2. 实现 TaskConditionsV1 校验和 evaluateTask，输出每组缺口与 satisfied，不用 LLM 判定，不从金额反推笔数。
3. 发放日期按周期结束后次月 X—Y 日生成，月末收拢，含开始和不含结束日期一致。
4. 应用0016，current_cycle快照不可被模板编辑覆写；task.cards 确定属于同一holder。
5. 运行目标测试和 schema，预期 A18/A19 的规则部分通过。

示例测试：

```ts
it("满足任选一组即手动达标", () => {
  const rules = spendRules({ count: 5, per_txn_min_minor: 38_800, amount_minor: 300_000 });
  const result = evaluateTask(rules, {
    as_of_on: "2026-10-15",
    metric_values: { qualifying_count: 3, qualifying_amount: 300_000 },
    note: null,
  });
  expect(result.satisfied).toBe(true);
  expect(result.groups[0].gaps.qualifying_count).toBe(2);
});
```

**检查点**：明确用户手工确认，不代表自动核验消费。提交建议 `feat(opportunities): model manual spend tasks and reward windows`。

## Task 18：任务服务、绝对进度和审计

**Files**

- Create: `lib/opportunities/tasks.server.ts`
- Modify: `lib/api/opportunities.ts`
- Modify: `lib/api/opportunities.server.ts`
- Modify: `lib/api/registry.ts`
- Test: `lib/__tests__/opportunity-tasks.test.ts`

**步骤**

1. 写创建任务、本人多卡验证、重复 key、进度下调、revision冲突、下期归零、截止仍未达标用例。
2. 采用完整 progress snapshot 替换，事件保存 before/after；不做累计加法接口。
3. 达标状态和奖励状态分开计算；到发放窗口只生成提醒，不创建配额。活动归档不删已发生周期。
4. 编辑模板只用于新周期，当前progress保留其rules_snapshot；原币种金额不自动折算。
5. 运行任务测试，检查 actor和SQL scope；预期 A18/A19/A20，不改 bill_items/createBill。

**检查点**：任务数据能跨刷新恢复，退款后下调可审计。提交建议 `feat(opportunities): persist audited manual task progress`。

## Task 19：领取／到账 schema 与业务唯一性

**Files**

- Create: `migrations/d1/0017_opportunity_fulfillments.sql`
- Create: `lib/opportunities/fulfillments.server.ts`
- Modify: `lib/opportunities/catalog.server.ts`
- Modify: `lib/opportunities/accounts.server.ts`
- Modify: `lib/api/opportunities.ts`
- Modify: `lib/api/opportunities.server.ts`
- Modify: `lib/api/registry.ts`
- Test: `lib/__tests__/opportunity-claims-grants.test.ts`

**步骤**

1. 写普通领取不增加配额、任务奖励重复key和不同key各一次、grant-only没有regular cycle、无模板私人奖励不泄露、年费减免／礼品不建账户和额度的用例。
2. 应用0017并加 holder/account/cycle/task/card 一致性触发器，不能只检查几个外键存在。
3. 普通claim写fulfillment+激活已有Cycle；reward_kind=quota 同batch创建配额和grant，non_quota 只记 task_result；两类共用 reward:<task_cycle>:<reward_key> 唯一来源，不靠切换类型重复记录。
4. 私人券持有holder唯一，来源标用户手动到账；到预计日期绝不自动发放。
5. 撤销领取有已用/预留依赖时报业务冲突；无依赖可整体反冲；奖励被银行追回需显式结果，不猜测。
6. 运行目标测试，预期 A20/A21/A23；事务失败不留半份奖励。

**检查点**：领取、奖励到账与真实银行动作边界清楚。提交建议 `feat(opportunities): track claims and unique reward grants`。

## Task 20：预约占用、使用转换和取消结算

**Files**

- Modify: `lib/opportunities/fulfillments.server.ts`
- Modify: `lib/opportunities/usages.server.ts`
- Modify: `lib/opportunities/writes.server.ts`
- Modify: `lib/api/opportunities.ts`
- Modify: `lib/api/opportunities.server.ts`
- Modify: `lib/api/registry.ts`
- Test: `lib/__tests__/opportunity-bookings.test.ts`
- Test: `lib/__tests__/opportunity-concurrency.test.ts`

**步骤**

1. 写 A22 三种取消结算、预约→使用不再扣、重复完成、跨Cycle改期目标不足回滚、服务时间越界、到期不自动已使用用例。
2. 记录confirmed预约由同一事件服务增加reserved；draft不产生额度事件。
3. complete通过expected_revision CAS，reserved−q/a和used+q/a、usage、fulfillment同一batch，保持历史关系。
4. cancel必须显式 settlement=returned/charged/unknown；unknown保留reserved并标pending_settlement，returned只释放原Cycle，不让已过期额度复活。
5. correct实现跨日期/卡/配额原子处理；保护 used 和 cancelled 状态不非法跃迁。预约产生的usage拒绝通用correct/void，统一履约纠正同batch暂存中间状态、反冲usage、同步fulfillment和提醒；增加直接SQL改usage触发失败及服务原子成功两种测试。
6. 并发使用与预约抢最后额度、两次complete相同revision必须只有一次成功，reconcile无差异。
7. 运行 bookings/concurrency tests；本地D1实测配额触发器和batch。

**检查点**：取消应用记录不触发外部取消请求，服务正文不承诺银行退款。提交建议 `feat(opportunities): reserve and settle booked benefits atomically`。

## Task 21：任务、领取、预约 UI

**Files**

- Create: `app/(mobile)/benefits/tasks/page.tsx`
- Create: `components/opportunities/TaskList.tsx`
- Create: `components/opportunities/TaskEditor.tsx`
- Create: `components/opportunities/ManualProgressEditor.tsx`
- Create: `components/opportunities/ClaimDialog.tsx`
- Create: `components/opportunities/BookingEditor.tsx`
- Create: `components/opportunities/BookingSettlementDialog.tsx`
- Modify: `components/opportunities/OpportunityRow.tsx`
- Modify: `components/opportunities/BenefitLedgerView.tsx`
- Modify: `app/(mobile)/cards/[id]/page.tsx`
- Modify: `app/(mobile)/benefits/page.tsx`

**步骤**

1. 从Task3批准帧实现任务列表/条件编辑/进度绝对快照，显示“手动确认”及统计截至日期。
2. 显示每组缺口、预计发放窗口、奖励待确认，OR关系可读，不把达标当已到账。
3. 领取分普通激活、实际奖励到账，日期和有效期必须明确；已有数据预填但不能默认猜银行券截止。
4. 预约编辑服务时间/时区/地点，明确“已在银行或服务商预约后记录”；取消结算三选必须主动选择，不默认退回。
5. 错误、并发冲突、重复提交、已到期、未知结算、跨批次余额不足均有反馈，保留输入。
6. 实际操作 verify：任务进度降回未达标→补进度→记录到账→新增配额→预约→使用或取消，数据库和UI余额逐步吻合。
7. typecheck/lint及相关测试，360/390/768/1280截图，键盘和焦点可用。

**检查点**：银行APP入口只是指引，不自动改状态。提交建议 `feat(opportunities): build manual task and fulfillment workflows`。

## Task 22：P2 日历、提醒和统计联动

**Files**

- Modify: `lib/opportunities/reminders.ts`
- Modify: `lib/opportunities/notifications.server.ts`
- Modify: `lib/opportunities/queries.server.ts`
- Modify: `components/opportunities/OpportunityCalendarView.tsx`
- Modify: `components/opportunities/ReminderList.tsx`
- Modify: `lib/api/analytics.server.ts`
- Modify: `lib/export.ts`
- Test: `lib/__tests__/opportunity-task-reminders.test.ts`
- Test: `lib/__tests__/opportunity-export.test.ts`

**步骤**

1. 日历新增任务截止、预计发放窗口及实际预约；缺日期标待补充，不生成猜测事件。
2. scanner按任务手动达标/奖励到账/预约结算状态取消或产生对应提醒。到服务时间不能自动complete。
3. 已到账后进度因退款下降显示需复核，不删除配额；提醒用“核对资格”而非“重新领取”。
4. 统计和导出区分claimed/booked/used/cancelled/pending_settlement、手动达标和发放事实；不把reserved计入已享用。
5. 运行task-reminders/export以及已有Cron测试，预期P1节点不被新状态破坏。

**检查点**：P2所有动作与同一提醒业务版本对应。提交建议 `feat(opportunities): connect task and booking reminders`。

## Task 23：完整行为覆盖与异常演练

**Files**

- Create: `lib/__tests__/opportunity-end-to-end.test.ts`
- Create: `docs/audits/2026-10-15-opportunities-validation.md`
- Modify: `lib/__tests__/opportunity-concurrency.test.ts`
- Modify: `design/openpencil/tests/test_opportunities_contract.py`

**步骤**

1. 按spec A01—A24逐条写可执行或可手动核验的证据入口，记录具体seed、clock、actor、预期变化。
2. 端到端使用真实SQLite数据：目录版本→个人账户→期初确认→记录→更正→撤销→手动任务→奖励→预约→取消三分支；末尾reconcile和foreign_key_check均无差异。
3. 演练解绑、冻结、注销、管理员越界、定义归档、规则提前终止、持卡人合并受阻、旧API多解、重复backfill、更新UI但旧请求重试。
4. 模拟数据库中断、batch第二条失败、push超时、部分设备失败、租约过期和服务重启，不吞异常、不把失败写sent。
5. 跑完整 `typecheck/lint/test/build` 和source-only；UI变更完成360/390/768/1280及各主要弹层流程验证。保留截图/日志到本轮专属证据目录，不覆盖共享基线。
6. audit文档必须区分PASS/FAIL/BLOCKED/未覆盖，写实际命令输出摘要和证据路径；通过测试数量以本次结果为准。

**检查点**：任何权限、原子性、迁移丢失或用量不一致问题未解决都阻止完成声明。提交建议 `test(opportunities): verify ledger and fulfillment boundaries`。

## Task 24：本地迁移、发布手册、兼容及最终交付

**Files**

- Create: `scripts/opportunities-local.mjs`
- Create: `scripts/opportunities-seed.sql`
- Create: `docs/runbooks/opportunities-release.md`
- Modify: `README.md`（仅实际完成后补功能和迁移说明）
- Modify: `docs/specs/README.md`
- Modify: `docs/audits/2026-10-15-opportunities-validation.md`

**步骤**

1. local runner接受显式 `--persist-to` 和 `--port`，检查空目录或本任务标记；顺序应用实际迁移，追加幂等测试seed；无remote默认、无已有目录清空。
2. 用本机可用Wrangler运行隔离D1和服务，确认端口空闲后启动；只停止本任务进程。计划不要求安装新包。
3. 本地真实RPC用签名测试session验证admin/member/private-boundary，实际并发最后额度、反冲batch回滚、新Cron分派和重试；禁止访问生产数据。
4. 发布手册写明迁移顺序0013→0014→0015→P1代码→0016→0017→P2代码、最低安全版本、旧API保留窗口、历史核对步骤及失败恢复。若实际序号变化同步全部引用。
5. 明确生产执行单独获授权：先只读检查迁移记录和备份策略，再远程新增表，部署兼容版本，核对范围和样本，最后启用新Cron/写入口。不能只靠旧wrangler migrations apply，因为当前目录并非已确认的默认migration ledger配置；使用经验证的逐文件执行流程或明确配置后再执行。
6. 回退优先关闭本模块写入口与新Cron，保留新增表和事件；绝不DROP或把个人余额写回旧全局产品计数。
7. 更新完成状态、README及spec入口；报告实际结果、未验证的生产推送/远程迁移、剩余债务。没有用户提交授权则保持工作树供审阅。

本地目标命令（Task24实现后可用）：

```bash
node scripts/opportunities-local.mjs --persist-to /tmp/wc-opportunities-unique --port 3051
npm run typecheck
npm run lint
npm test
npx vinext build
WC_FORCE_NO_OPENPENCIL=1 bash design/openpencil/verify-batch.sh --source-only
```

服务启动流程必须按实际 Wrangler CLI 能力验证 `--persist-to/--port` 和构建产物路径，不能把此示例当已验证命令。视觉取证沿用现有capture.py并显式指定base URL；新增业务流程用宿主已可用浏览器能力验证，不以截图代替状态断言。

**最终出口**：P0/P1/P2范围全部可工作，M4证据齐全；未做的银行自动操作、自动消费进度、最佳卡推荐和价值估值继续留在范围外。提交建议 `docs(opportunities): add release and migration runbook`。

---

## 3. 需求—任务—验收追踪

| 需求                           | 主要任务          | 验收                         |
| ------------------------------ | ----------------- | ---------------------------- |
| 活动真实性、持卡匹配、真实关注 | 2、11—13          | A11、A13                     |
| 个人／同持卡人共享账户         | 4、5、7、11、12   | A01—A03                      |
| 周期余额、重置日、金额／次数   | 6—9、11、12       | A04—A09                      |
| 历史归属与兼容                 | 10、13、24        | A10、A24                     |
| 日历、忽略、延后、quiet hours  | 14—16             | A14—A17                      |
| 手动达标、缺口、预计发放       | 17、18、21、22    | A18—A20、A23                 |
| 领取、奖励发放、预约和结算     | 19—22             | A21—A23                      |
| 来源、导出、成员隔离           | 5、10、13、23     | A03、A13、A24                |
| 设计源与UI真实验证             | 3、12、16、21、23 | 第12节体验要求及各里程碑证据 |

## 4. 停止与调整条件

- 需要依赖未安装工具、OpenPencil不可达、CLI参数不支持：记录真实阻塞，继续独立任务；不安装或启动常驻服务碰运气。
- 旧数据没有归属证据：保持待核对，不能自动认领让测试通过。
- 为支持新表必须更改 holder merge 等既有业务：只加明确保护或兼容，完整重构另列任务，不顺手改全站权限。
- 用户改变范围：同步spec/技术附录/追踪表后再继续实现，避免plan和代码各自漂移。
- 任何生产、外部发送、提交和部署都遵循当时授权；文档中的命令本身不授予执行权限。
