# 账单编辑能力候选设计（13 号 spec）

日期：2026-11-01。状态：Candidate，尚未实施到 App。对应 `docs/specs/13-bill-editing.md` 的目标设计（§6 编辑矩阵）。

设计源是 `../worldcredit-redesign.op` 的 `16 · Bill Editing` 页，20 张画板均为 440×956pt，dark/light 成对。重建脚本：`../scripts/16-bill-editing.js`。

## 画板清单

| 画板 | 内容 | 契约 |
| --- | --- | --- |
| `candidate.ios.bill-editing` | 编辑表单：身份锁定卡（卡+账期不可改）、金额/最低还款/账单日/到期日四字段（金额带「已手动设定」钉住标）、状态四态选择、高级折叠（账期首末日）、放弃/保存 | `_contract.json` 全字段契约 |
| `candidate.ios.bill-editing-amount` | 手填金额弹窗：导入值（锁定）与手动值对照、优先级提示（不被邮件/Gmail 覆盖）、撤销钉住/保存 | 全字段契约 |
| `candidate.ios.bill-editing-override-warning` | 金额低于已还总额的警示：新金额 1,200 < 已还 1,600，说明后续还款会被触发器拒绝，返回修改/仍要保存 | uncovered（几何检查覆盖） |
| `candidate.ios.bill-editing-status` | 状态编辑弹窗：四态带语义说明（partial 选中态），改前按还款记录重算、允许从结清回退 | uncovered |
| `candidate.ios.bill-editing-payments` | 还款记录管理：应还/已还/剩余汇总、每笔可改可删、删改后自动重算说明 | 全字段契约 |
| `candidate.ios.bill-editing-payment-edit` | 单笔还款编辑：金额输入 + 上下限约束、日期/渠道/备注、改后累计与剩余预览、状态预览、删除 | uncovered |
| `candidate.ios.bill-editing-delete` | 删除账单二次确认：说明 2 笔还款（1,600.00）级联删除、iOS 缓存收敛、不可恢复 | uncovered |
| `candidate.ios.bill-editing-history` | 金额来源历史：生效金额（钉住）+ 钉住/邮件导入/手动录入三条记录、「生效中」标记、撤销即回落导入值 | 全字段契约 |
| `candidate.ios.bill-editing-draft` | 导入草稿编辑：来源与置信度、绑定卡/账月/金额/最低还款/到期日/账单日全可改、确认入账/丢弃 | 全字段契约 |
| `candidate.ios.bill-editing-sheet` | 账单操作面板（详情页入口聚合）：编辑金额日期/改状态/还款记录/来源历史/删除账单五项 | uncovered |

导出目录：`../exports/candidate/bill-editing/`（dark 无后缀、light 带 `-light` 后缀，各 10 张）。

## 设计语义（与 spec 的对应）

- **编辑写 override，不抢导入列**：金额/最低还款/到期日/账单日的编辑一律走 `*_override`，「已手动设定」标记表达钉住态；导入值只读展示（锁图标）。
- **身份不可变**：`UNIQUE(card_id, bill_month)` 表达为身份锁定卡 + 锁文案；换卡 = 删旧建新（入口在右上删除）。
- **状态重算**：状态区说明「改状态前按已还总额重算，已还 ≥ 生效金额即视为结清」，对应 `updateBillStatusChecked`（允许 paid 回退，修掉 BillForm 现状强制 unpaid 的缺陷）。
- **触发器边界**：金额低于已还时弹警示而非让用户撞 `PAYMENT_EXCEEDS_REMAINING` ABORT。
- **还款记录改/删**：对应 `payments.updatePayment/deletePayment` 目标 RPC；改后预览累计/剩余/状态。
- **草稿可编辑**：对应 `billDrafts.updateBillImportDraft` 已支持但未暴露的 `parsed_payload` 表单。
- **删除账单**：对应目标 `deleteBill`（级联 payments + sync_changes）。

mock 口径沿用 15 页（招商 4,800 / 已还 1,600 / 手动钉住 4,720 / 草稿 4,860.50），金额仅为设计示意。

## 校验

`bash design/openpencil/verify-batch.sh --source-only` 全绿：字段对齐、几何溢出（引擎版含 16 页）、Frame 契约（5 屏全字段 + 5 辅助画板 uncovered）、Token 漂移、109 项 Python 回归。契约测试的 OK 集合已收录 5 个新 head。

## 从真源重建

```bash
# 16 页须已存在（op page list 确认），清空后重放：
op design @design/openpencil/scripts/16-bill-editing.js --page <16页ID>
op save_document filePath=design/openpencil/worldcredit-redesign.op
bash design/openpencil/verify-batch.sh --source-only
```

注意：脚本必须以 JSON 节点直插方式运行（`op design @script --page`，不带 `--script` 的 refine 语义）；refine 会把 layout:none 画板重排撑高（见 15 页文档的已知 refine 缺陷）。颜色只走 `$token`，dark 用 obsidian 系、light 用 bg/status 系，与 15 页口径一致。
