# iPhone / Apple Watch 本地构建与推送联调

工程配置以 `ios/project.yml` 为准。此前会话提到的 `task-list.md` 和
`app-offline-sync-architecture.md` 不在当前仓库；本页记录可从代码核实的配置和待验证边界。

## 本地构建

需要 Xcode 27.1、iOS / watchOS 27 SDK 与 XcodeGen。当前 `WorldCreditCore`
仍通过 `../GRDB` 引用未入库的本地依赖；新检出仓库需要先准备
`ios/Packages/GRDB`。本次使用的 GRDB commit 为
`0d8cf958b4b66a0473ec6e6986eb9da462171da9`。这项依赖尚未改成可自动解析的远程包。

在项目根目录运行：

```sh
xcodegen generate --spec ios/project.yml
swift test --package-path ios/Packages/WorldCreditCore
xcodebuild -project ios/WorldCredit.xcodeproj -scheme WorldCredit \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath /tmp/worldcredit-derived \
  SYMROOT=/tmp/worldcredit-derived/Build/Products \
  OBJROOT=/tmp/worldcredit-derived/Build/Intermediates.noindex \
  CODE_SIGNING_ALLOWED=NO
```

iPhone target 嵌入主屏幕 Widget 与 Watch App；Watch App 再嵌入表盘 Widget。
四个 target 均声明 `group.com.chunfenshijie.worldcredit`，供各设备上的 App 与本机 Widget
共享快照。iPhone 与 Watch 之间的数据仍由 WatchConnectivity 传输，App Group
不会在两台设备之间共享文件。

iPhone Info.plist 声明 `remote-notification` 后台模式及 Face ID 用途。
APNs entitlement 在 Debug 使用 `development`，Release 使用 `production`。
这些声明不代表开发者后台或 provisioning profile 已经配置成功。

## Apple 签名配置

在自己的 Apple Developer Team 中确认以下 Bundle ID，四个 target 都加入同一个
App Group；iPhone App 另外开启 Push Notifications：

| Target | Bundle ID |
| --- | --- |
| iPhone | `com.chunfenshijie.worldcredit` |
| iPhone Widget | `com.chunfenshijie.worldcredit.widgets` |
| Watch | `com.chunfenshijie.worldcredit.watch` |
| Watch Widget | `com.chunfenshijie.worldcredit.watch.widgets` |

在 Xcode 的 Signing & Capabilities 选择自己的 Team，更新 provisioning profiles。
Watch 的 `WKCompanionAppBundleIdentifier` 必须与 iPhone Bundle ID 一致。
若这些标识已被其他 Team 占用，需统一修改工程、快照 App Group 常量和推送 topic。

## Worker 推送配置

主 Worker 与独立的 `email-worker` 是两个部署，环境变量和 secrets 不会自动共用。
每个需要发送 APNs 的 Worker 分别配置：

| 名称 | 值与存储方式 |
| --- | --- |
| `APNS_KEY_P8` | Apple APNs `.p8` 私钥，作为 Worker secret 保存 |
| `APNS_KEY_ID` | 对应 Key ID，作为 Worker secret 保存 |
| `APNS_TEAM_ID` | 对应 Team ID，作为 Worker secret 保存 |
| `APNS_BUNDLE_ID` | `com.chunfenshijie.worldcredit`，默认也是这个值 |
| `APNS_ENVIRONMENT` | 只有字面量 `production` 走 `api.push.apple.com`；其余任何值（含 `development`、`sandbox`）都走 `api.sandbox.push.apple.com` |

`APNS_ENVIRONMENT` 必须与 App 的 `aps-environment` 签名环境一致：Debug 侧载包是
`development`，对应 sandbox 通道；TestFlight / App Store 包是 `production`，必须同步
改成 `production`，否则推送打不进设备。AuthKey 一个密钥对 sandbox / production 通用，
不用分两张证书。

不要把私钥写入仓库、日志或聊天。当前设备表没有区分 APNs 环境，单个部署应使用
同一种签名环境的设备 token；切换环境后重新登录注册。不能把生产和开发 token
混用到同一条发送通道。

邮件 Worker 在账单成功入库后以 `ctx.waitUntil` 排队静默同步通知；普通邮件和
转发包都覆盖。未配置 APNs、未写入账单或保留已有账单时不发送。推送失败会记录日志，
不回滚已入库账单。客户端收到静默推送后拉取数据、重新安排本地提醒并更新 Watch 快照。
系统可能延迟或不交付静默推送，打开 App 时仍会主动同步。

首次登录会请求系统注册并补报已缓存 token。退出先捕获旧登录凭证，再异步注销服务端
token，同时停止系统远程通知注册。离线时服务端注销可能失败，错误会记录，设备 token
保留至下次登录重新登记归属；退出时不额外保存登录凭证用于后台重试。

## 验证边界与真机验收

### 可重复的离线 UI 回归

```sh
ios/scripts/test-ui.sh
```

脚本默认创建临时 iPhone 18 Pro 模拟器，完成后只清理自己创建的设备。
日志与 `results.xcresult` 保存在输出的独立临时目录；构建使用模拟器 ad-hoc 签名，
不使用 Apple Team 或真机签名。可用以下变量指定运行现场：

- `WC_UI_DEVICE_ID`：指定已有模拟器，脚本不删除该设备。
- `WC_UI_ARTIFACT_DIR`：结果目录，已有同名 result bundle 时拒绝覆盖。
- `WC_UI_DERIVED_DATA_DIR`：可选复用本任务的构建缓存。
- `WC_UI_SIM_RUNTIME`：默认 `com.apple.CoreSimulator.SimRuntime.iOS-27-0`。

`WorldCreditUITests` 通过真实按钮和表单覆盖四页浏览、全额还款、账单金额调整、卡片编辑
及重启持久化。测试拒绝系统通知权限，并记录本地数据库、待提交队列和共享快照。
仅 Debug 的 `--ui-testing` 模式读取 `WORLDCREDIT_UI_TEST_ID`，每个用例使用独立 SQLite；
测试网络从构造时阻断，也不注册 APNs、不向 Watch 外发。它验证离线交互和本机快照，
不能替代 App 与真实服务器、WatchConnectivity 或 APNs 的实网联调。

运行期间，每个场景在 App Documents 的 `UITests/<UUID>/` 保存 `ui-test-metadata.json`、
SQLite 及快照副本；共享快照仍写入真实 App Group，副本供逐场景回读。通知被拒时授权值为 `1`。
默认设备清理会一并删除这些运行数据；需留存数据库时用 `WC_UI_DEVICE_ID` 指定测试设备，
结束后先导出数据。XCTest 截图、断言与日志始终保留在结果目录。

### 同步修复的部署前提

`0020_offline_sync_backfill.sql` 给同步功能启用前的既有数据补 upsert 日志，不修改业务行，
并可安全重跑。已于 2026-10-22 执行远程迁移，见下文记录。新客户端永久拒绝后会持久化
`reconcile` 回源目标，直到成功恢复服务器权威数据才清除。
旧服务端不返回回源实体时客户端保留恢复队列并重试，不把缺失响应当成功。

仍有待提交操作时，客户端暂停拉取远端数据，避免覆盖尚未被服务器接受的本地编辑；队列清空后
恢复正常拉取。已支持表的解码失败会回滚本页并保留游标，成功的空响应也更新同步确认时间。

### 真机与实网

本地单测用模拟的 APNs HTTP 响应验证签名、投递参数、失效 token 清理、邮件入库后的
异步调度与错误隔离，不能证明 Cloudflare 到 APNs 的真实传输成功。模拟器构建也不能
证明真机签名、生物识别、后台唤醒或 Watch 实际配对成功。

真机联调依次核实：

1. 使用有效签名安装 iPhone 与 Watch App，登录后设备 token 成功写入服务端。
2. 收到新账单邮件后确认 D1 已入库、APNs 返回 200；不在日志中输出私钥和完整 token。
3. App 进入后台时接收静默推送，确认本地账单、本地提醒及 Watch 快照都更新。
4. 断网登记还款，恢复网络后只生成一笔服务端还款记录；Watch 和 Widget 随后刷新。
5. 断网跨天查看还款倒计时与到期提醒，验证 Face ID 成功、失败、取消及冷启动锁定。
6. 退出登录后确认停止接收远程通知，再登录可重新注册。

这些真机与实网项目未经本轮验证；代码通过本地检查后仍不能标记为全部完成。

## 2026-10-22 本地检查记录

- 主工程：类型检查、ESLint、68 个文件 / 809 项 Vitest 和设计源五项检查通过。
- 邮件 Worker：97 项测试、源码和测试的类型检查通过。
- Swift Package：34 项测试通过，包括设备凭证、共享同步周期、真实 D1 行解码、
  未提交编辑保护、永久拒绝回源、空响应时间更新和分页游标保护。
- 独立 iPhone 18 Pro / iOS 27.0 模拟器：4 条 UI 测试全部通过，含真实点击、重启持久化
  与拒绝通知权限；最终运行约 194 秒，导出 12 张截图。
- 独立 SQLite 与快照回读：全额还款后待还 `5430.00`，只有一条还款 outbox，快照移除
  已还账单；金额调整后总待还 `18800.50`；卡片额度 `65000`、覆盖账单日 `7` 均持久化，
  快照同步反映修改。四个场景均确认通知授权值 `1` 和实际 App Group 容器。
- iPhone、Watch 和两个 Widget 构建与打包通过；GRDB 仍有 `Any` / `Sendable` 依赖告警。
  未使用 Apple Team 做真机签名、未运行实际 Watch 配对，也未向 APNs 实际投递。
- 视觉核验：修正卡片底部日期和金额挤压，本地检查最终截图。GLM-V 因 429 余额不足
  不可用，按本机规则使用本地图片能力核验；未充值、未重试。

最终运行产物位于 `/tmp/worldcredit-ui-p4-final/`：

- `results.xcresult`：完整 XCTest 结果。
- `screenshots/`：12 张具名截图。
- `database-evidence.json`：独立回读断言结果。
- `ui-data/`：四场景 SQLite 一致性备份、快照副本和元数据。

主工程、邮件和 Swift 日志分别位于 `/tmp/worldcredit-final-*.log`、
`/tmp/worldcredit-final-email-tests.log` 和 `/tmp/worldcredit-swift-integrity-full.log`。
临时文件可被系统清理；本页保留验证范围和结果，不把这些本地检查视为线上验证。

## 2026-10-22 真机签名、远程迁移与 APNs 配置记录

### Bundle ID 改名

`com.worldcredit.app` 已被其他团队注册，Xcode 自动注册 App ID 时返回
`cannot be registered to your development team because it is not available`。
按既定命名风格统一改为 `com.chunfenshijie.worldcredit`，四个 target 一并改：
Widget 为 `.widgets`，Watch 为 `.watch`，表盘 Widget 为 `.watch.widgets`。
App Group 改为 `group.com.chunfenshijie.worldcredit`，Keychain service 与
APNs topic 默认值同步。共改 12 个文件，回归全绿：Swift 34 项、Vitest 809 项、
email-worker 97 项，typecheck 与 ESLint 通过。

### 真机签名与安装

`project.yml` 全局 `settings.base` 写入 `DEVELOPMENT_TEAM: 27LU47J28S` 与
`CODE_SIGN_STYLE: Automatic`。用 `-allowProvisioningUpdates` 构建后，Xcode 自动
注册四个 App ID 并签发 iOS Team Provisioning Profile，安装到 iPhone 16 Pro Max
（UDID `00008140-00021C8A2E40801C`，iOS 27.0.1）。

签名核验：`TeamIdentifier=27LU47J28S`、`application-identifier` 为
`27LU47J28S.com.chunfenshijie.worldcredit`、`aps-environment=development`、
App Group 正确，描述文件含本机 UDID。证书 CN 显示 `(4B8FUZVCHN)` 是误导，
其 `organizationalUnitName=27LU47J28S`、`organizationName` 为公司主体，归属无误。

### 远程迁移

发现两套迁移树并存：`migrations/` 顶层 5 个 `2026*.sql` 是 InsForge/Postgres 残留
（`gen_random_uuid()`、`CREATE OR REPLACE FUNCTION`），语法不兼容 D1；真正的 D1 树
在 `migrations/d1/`（0001–0020）。wrangler 默认读 `migrations/`，已在 `wrangler.jsonc`
的 D1 binding 上设 `migrations_dir: "migrations/d1"` 堵住误读。

远程 `d1_migrations` 原为空，schema 当初由 `execute` 铺设未走记账。先逐列核对
0001–0018 的 15 项指纹（`bills.bill_amount_override`、`banks.quota_mode`、
`credit_cards.issued_on`、`recurring_payables.bank_account`、
`opportunity_fulfillments_guard_insert` 等）全部命中，补记 18 条账，再经正规机制
应用 0019 与 0020。落库验证：同步三表已建、36 个 `trg_*` 触发器、
`sync_changes` 回填 307 行（bills 91、payments 81、credit_cards 46、banks 40…），
`d1_migrations` 记账 20 条。

### 部署

`worldcredit` 与 `worldcredit-email-worker` 均已部署。线上 `POST /api/sync/pull`
返回 `{"error":"未登录"}` 401，确认路由已生效。邮件 Worker 根路径 500 属预期：
它只导出 `email(...)`，无 `fetch` handler，仅由 Email Routing 触发。

两个部署陷阱：`wrangler deploy` 在 `email-worker/` 内会解析到父目录的
`wrangler.jsonc` 而误部署主 Worker，必须显式 `--config wrangler.toml`；
`npx vinext deploy` 会把根 `package.json` 的 `type` 翻成 `module`，部署后需改回
`commonjs` 再提交。

### APNs

Token-based 认证，无需单独申请 APNs 证书。Push Notifications 能力随自动签名已开，
描述文件内 `aps-environment=development`。App Store Connect 生成 AuthKey
（Key ID `C9QG6Q5T26`，Team ID `27LU47J28S`），`.p8` 只可下载一次。
五个 secret 已分别写入两个 Worker：`APNS_KEY_P8`、`APNS_KEY_ID`、`APNS_TEAM_ID`、
`APNS_BUNDLE_ID`、`APNS_ENVIRONMENT=development`。私钥仅存 Worker secret，不入仓库、
日志或聊天。

实网鉴权冒烟：用该 `.p8` 签 ES256 JWT 打 `api.sandbox.push.apple.com`，假 token
返回 **HTTP/2 400 `BadDeviceToken`**。这证明 JWT 鉴权、topic 与 Key ID / Team ID
全部正确（凭证错会返回 `403 InvalidProviderToken` 或 `BadTopic`），同时说明尚未
使用真实设备 token 完成投递。

### 仍未验证

- 真实设备 token 注册与 APNs 200 投递：需手机解锁后登录 App。
- Watch 实机安装与 WatchConnectivity：当前仅有 Watch 模拟器，无实机配对。
- 静默推送后台刷新、断网还款幂等、Face ID 全分支：见上文「真机联调依次核实」
  第 2–6 条，均未执行。
- 代码未提交。
