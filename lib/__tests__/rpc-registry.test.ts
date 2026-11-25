// Guards the dedicated RPC API contract:
// 1. every client rpc call must have an allowlisted registry entry
// 2. the migration-era bridges stay deleted

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { RPC_REGISTRY } from "../api/registry";

const ROOT = join(__dirname, "../..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "node_modules" || name === ".server.ts") continue;
      walk(full, out);
    } else if (/\.tsx?$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

const RPC_CALL_RE = /callRpc<typeof [A-Za-z0-9_.]+>\(\s*'([a-z-]+)'\s*,\s*'([A-Za-z0-9]+)'/g;

function collectClientRpcCalls(): Array<{ file: string; module: string; fn: string }> {
  const files = [...walk(join(ROOT, "lib/api")), join(ROOT, "lib/reminders.ts")];
  const calls: Array<{ file: string; module: string; fn: string }> = [];
  for (const file of files) {
    if (file.endsWith(".server.ts")) continue;
    const src = readFileSync(file, "utf8");
    let m: RegExpExecArray | null;
    while ((m = RPC_CALL_RE.exec(src))) {
      calls.push({ file, module: m[1], fn: m[2] });
    }
  }
  return calls;
}

describe("RPC registry contract", () => {
  it("has an allowlist entry for every client rpc call", () => {
    const calls = collectClientRpcCalls();
    expect(calls.length).toBeGreaterThan(50);
    for (const { file, module, fn } of calls) {
      const entry = RPC_REGISTRY[module]?.[fn];
      expect(
        entry,
        `${file} calls ${module}.${fn} which is missing from RPC_REGISTRY`,
      ).toBeTruthy();
    }
  });

  it("never passes raw SQL or table names through the RPC surface", () => {
    const calls = collectClientRpcCalls();
    for (const { fn } of calls) {
      expect(fn).not.toMatch(/sql|query|execute|table|proxy/i);
    }
  });

  it("keeps the migration-era bridges deleted", () => {
    expect(existsSync(join(ROOT, "lib/client-db.ts"))).toBe(false);
    expect(existsSync(join(ROOT, "app/api/sql-proxy"))).toBe(false);
    expect(existsSync(join(ROOT, "app/api/db-proxy"))).toBe(false);
    const helpers = readFileSync(join(ROOT, "lib/db/helpers.ts"), "utf8");
    expect(helpers).not.toContain("sql-proxy");
    expect(helpers).not.toContain("proxySql");
  });

  it("derives user identity server-side for user-scoped queries", () => {
    // User-scoped list/read functions must never trust a client-provided userId.
    for (const [moduleName, mod] of Object.entries(RPC_REGISTRY)) {
      for (const [fn, entry] of Object.entries(mod)) {
        if (
          /^(getHolders|getUserPreferences|updateUserPreferences|getAllMyBenefits|getCardsWithBillsSummary|getBillDashboardItems|markAllOverdueBillsAsPaid|syncGmailLedgerToCardsAndBills|getDueBillsForReminders|subscribePush)$/.test(
            fn,
          )
        ) {
          expect(
            entry.bindUser !== undefined || entry.bindField !== undefined,
            `${moduleName}.${fn} must bind the session user`,
          ).toBe(true);
        }
      }
    }
  });

  // Permission model (post-downshift):
  //   - everyday operations (recording a bill, editing one's own card, ...) are
  //     reachable by members but constrained by an ownership guard;
  //   - the operations surface (bank/card-product catalogue, system settings,
  //     site-wide stats, identity management) stays admin-only.
  // The two lists below are the contract; entries must appear in exactly one.
  const MEMBER_SCOPED: Array<[string, string]> = [
    ["cards", "createCard"],
    ["cards", "updateCard"],
    ["bills", "createBill"],
    ["bills", "updateBill"],
    ["bills", "updateBillStatus"],
    ["billDrafts", "confirmBillImportDraft"],
    ["billDrafts", "importAndParseBill"],
    ["billDrafts", "unlockEncryptedDraft"],
    ["billDrafts", "retryParseDraft"],
    ["billDrafts", "updateBillImportDraft"],
    ["billDrafts", "discardBillImportDraft"],
    ["billDrafts", "batchDiscardBillDrafts"],
    ["passwordVault", "createPasswordRule"],
    ["passwordVault", "updatePasswordRule"],
    ["holders", "updateMyHolderAliases"],
    ["gmail", "updateGmailConnection"],
    ["gmail-ledger", "getGmailLedgerEntries"],
    ["gmail-ledger", "getGmailLedgerSummary"],
    ["gmail-ledger", "markPayment"],
    ["gmail-ledger", "updateLedgerAmount"],
    ["gmail-ledger", "getGmailLedgerBanks"],
    ["sync-gmail", "syncGmailLedgerToCardsAndBills"],
    ["holders", "createHolder"],
    // 方向 4：消费前推荐与年费 ROI 必须绑定本人持卡人范围
    ["recommendations", "getCardRecommendations"],
    ["recommendations", "getFamilyAnnualFeeRoi"],
    ["recommendations", "getCardAnnualFeeRoi"],
  ];

  const ADMIN_ONLY: Array<[string, string]> = [
    ["holders", "updateHolder"],
    ["holders", "mergeHolders"],
    ["promos", "createUserPromo"],
    ["emailBills", "syncEmailBillToAccount"],
    ["admin", "getSystemSettings"],
    ["admin", "updateSystemSettings"],
    ["dashboard", "getDashboardStats"],
    ["benefits", "createBenefit"],
    ["benefits", "updateBenefit"],
    ["benefits", "deleteBenefit"],
    ["benefits", "autoEnrichCardBenefits"],
    // 方向 4：卡产品结构化规则 AI 草稿会调用外部模型，仅管理员可用
    ["admin", "previewCardProductRules"],
  ];

  it("lets members perform everyday writes, each behind an ownership guard", () => {
    for (const [moduleName, fn] of MEMBER_SCOPED) {
      const entry = RPC_REGISTRY[moduleName]?.[fn];
      expect(entry, moduleName + "." + fn + " is missing from RPC_REGISTRY").toBeTruthy();
      expect(entry.admin, moduleName + "." + fn + " must not require admin").not.toBe(true);
      const guarded =
        entry.memberGuard !== undefined ||
        entry.memberFilter !== undefined ||
        entry.bindUser !== undefined ||
        entry.bindField !== undefined;
      expect(guarded, moduleName + "." + fn + " must carry an ownership guard").toBe(true);
    }
  });

  it("keeps the operations surface admin-only", () => {
    for (const [moduleName, fn] of ADMIN_ONLY) {
      expect(
        RPC_REGISTRY[moduleName]?.[fn]?.admin,
        moduleName + "." + fn + " must require admin",
      ).toBe(true);
    }
  });

  it("requires every RPC to declare its permission posture explicitly", () => {
    // A function with no admin flag and no guard/filter/binding is callable by
    // any signed-in member against unscoped data, so each such entry must be
    // justified here rather than overlooked.
    const SANCTIONED_UNGUARDED = new Set([
      "ai.aiComplete",
      "cards.getCardProducts",
      // 公开只读银行目录：无用户数据、无写操作，成员选归属银行时需要
      "banks.getBankNames",
      "banks.getBanks",
    ]);
    for (const [moduleName, mod] of Object.entries(RPC_REGISTRY)) {
      for (const [fn, entry] of Object.entries(mod)) {
        if (entry.admin) continue;
        const guarded =
          entry.memberGuard !== undefined ||
          entry.memberFilter !== undefined ||
          entry.bindUser !== undefined ||
          entry.bindField !== undefined ||
          // opportunity-ledger entries: the route injects the session actor and
          // the impl authorizes objects via scope.server for BOTH roles.
          entry.prependActor !== undefined;
        if (!guarded) {
          const key = moduleName + "." + fn;
          expect(
            SANCTIONED_UNGUARDED.has(key),
            key +
              " has no admin flag and no ownership guard; add one or justify it in SANCTIONED_UNGUARDED",
          ).toBe(true);
        }
      }
    }
  });

  it("lets members record their own repayments and benefit usage via guards (plan.md D2)", () => {
    expect(RPC_REGISTRY.bills.createPayment.memberGuard).toBeDefined();
    expect(RPC_REGISTRY.bills.markBillAsPaid.memberGuard).toBeDefined();
    expect(RPC_REGISTRY.benefits.recordBenefitUsage.memberGuard).toBeDefined();
  });

  it("exposes the gmail connection surface, always session-bound", () => {
    // Gmail 连接是用户私产：状态/同步/断开全部 bindUser，不接受客户端传入 userId。
    expect(RPC_REGISTRY.gmail.getGmailConnection.bindUser).toBe(0);
    expect(RPC_REGISTRY.gmail.syncGmailNow.bindUser).toBe(0);
    expect(RPC_REGISTRY.gmail.disconnectGmail.bindUser).toBe(0);
  });

  it("registers draft list and card rebinding for the email-import flow", () => {
    expect(RPC_REGISTRY.billDrafts.getBillImportDrafts.bindUser).toBe(0);
    expect(RPC_REGISTRY.billDrafts.updateBillImportDraft.memberGuard).toBeDefined();
  });

  it("never lets an entry bind client args into the server-prepended actor slot", () => {
    // With prependActor the impl's parameter 0 is the session actor; client
    // argument positions shift by one. An entry that also binds position 0
    // (bindUser or bindField.arg === 0) would let a client payload overwrite
    // the actor, so it is structurally forbidden.
    for (const [moduleName, mod] of Object.entries(RPC_REGISTRY)) {
      for (const [fn, entry] of Object.entries(mod)) {
        if (!entry.prependActor) continue;
        expect(
          entry.bindUser,
          `${moduleName}.${fn} combines prependActor with bindUser at position 0`,
        ).not.toBe(0);
        expect(
          entry.bindField?.arg,
          `${moduleName}.${fn} combines prependActor with bindField at position 0`,
        ).not.toBe(0);
      }
    }
  });

  it("keeps route handlers thin and stores RPC dispatch in lib", () => {
    const route = readFileSync(join(ROOT, "app/api/rpc/[module]/[fn]/route.ts"), "utf8");
    expect(existsSync(join(ROOT, "lib/api/rpc-dispatch.ts"))).toBe(true);
    expect(route).toMatch(/from ['"]@\/lib\/api\/rpc-dispatch['"]/);
    expect(route).not.toContain("export async function dispatchRpc");
    expect(route).not.toContain("export function bindEntryArgs");
    expect(route).not.toContain("export interface RpcDispatchResult");
    const pushRoute = readFileSync(join(ROOT, "app/api/sync/push/route.ts"), "utf8");
    expect(pushRoute).toMatch(/from ['"]@\/lib\/api\/rpc-dispatch['"]/);
  });


  // ─── HUB-156（方向1 / HUB-154 §3.3）新增面 ────────────────────────────────
  describe("HUB-156 统一账单导入与多邮箱", () => {
    it("importAndParseBill 以 bindField 覆盖 user_id，绝不信任客户端传入", () => {
      const entry = RPC_REGISTRY.billDrafts.importAndParseBill;
      expect(entry.bindField).toEqual({ arg: 0, field: "user_id" });
      expect(entry.memberGuard).toBeDefined();
    });

    it("草稿读写按参数位绑定会话用户（客户端永远不传 userId）", () => {
      expect(RPC_REGISTRY.billDrafts.getBillImportDrafts.bindUser).toBe(0);
      expect(RPC_REGISTRY.billDrafts.getBillImportDraftById.bindUser).toBe(1);
      expect(RPC_REGISTRY.billDrafts.updateBillImportDraft.bindUser).toBe(2);
      expect(RPC_REGISTRY.billDrafts.confirmBillImportDraft.bindUser).toBe(2);
      expect(RPC_REGISTRY.billDrafts.unlockEncryptedDraft.bindUser).toBe(2);
      expect(RPC_REGISTRY.billDrafts.retryParseDraft.bindUser).toBe(2);
      expect(RPC_REGISTRY.billDrafts.discardBillImportDraft.bindUser).toBe(1);
      expect(RPC_REGISTRY.billDrafts.batchDiscardBillDrafts.bindUser).toBe(1);
    });

    it("每个草稿入口都带归属守卫（越权 403，AC-12）", () => {
      for (const fn of [
        "importAndParseBill",
        "unlockEncryptedDraft",
        "retryParseDraft",
        "getBillImportDraftById",
        "updateBillImportDraft",
        "confirmBillImportDraft",
        "discardBillImportDraft",
        "batchDiscardBillDrafts",
      ]) {
        expect(
          RPC_REGISTRY.billDrafts[fn]?.memberGuard,
          `billDrafts.${fn} 缺少 memberGuard`,
        ).toBeDefined();
      }
    });

    it("密码本 RPC 不暴露密文：全部会话绑定 + 归属守卫", () => {
      expect(RPC_REGISTRY.passwordVault.listPasswordRules.bindUser).toBe(0);
      expect(RPC_REGISTRY.passwordVault.createPasswordRule.bindField).toEqual({
        arg: 0,
        field: "user_id",
      });
      expect(RPC_REGISTRY.passwordVault.createPasswordRule.memberGuard).toBeDefined();
      expect(RPC_REGISTRY.passwordVault.updatePasswordRule.bindUser).toBe(2);
      expect(RPC_REGISTRY.passwordVault.deletePasswordRule.bindUser).toBe(1);
    });

    it("多 Gmail 连接面全部会话绑定（AC-05）", () => {
      expect(RPC_REGISTRY.gmail.getGmailConnections.bindUser).toBe(0);
      expect(RPC_REGISTRY.gmail.updateGmailConnection.bindUser).toBe(2);
      expect(RPC_REGISTRY.gmail.syncGmailConnection.bindUser).toBe(1);
      expect(RPC_REGISTRY.gmail.disconnectGmailConnection.bindUser).toBe(1);
    });

    it("旧邮箱账本写入口保留条目但已封板（AC-09）", () => {
      expect(RPC_REGISTRY["gmail-ledger"].markPayment).toBeDefined();
      expect(RPC_REGISTRY["gmail-ledger"].updateLedgerAmount).toBeDefined();
      expect(RPC_REGISTRY["gmail-ledger"].migrateLegacyLedgerToDrafts.bindUser).toBe(0);
    });

    it("import_config 独立偏好入口会话绑定", () => {
      expect(RPC_REGISTRY.preferences.getUserImportPreferences.bindUser).toBe(0);
      expect(RPC_REGISTRY.preferences.updateUserImportPreferences.bindUser).toBe(0);
    });

    it("成员自助别名入口绑定会话用户并带持卡人守卫", () => {
      const entry = RPC_REGISTRY.holders.updateMyHolderAliases;
      expect(entry.bindUser).toBe(2);
      expect(entry.memberGuard).toBeDefined();
    });
  });
});
