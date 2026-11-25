// lib/api/registry.ts — server-only allowlist of the RPC API surface.
// A client request /api/rpc/<module>/<fn> only executes if a matching entry
// exists here. Identity always comes from the HMAC-signed wc_user session
// cookie:
//   - bindUser: positional arg index replaced with the session user id
//   - bindField: field inside an object arg overwritten with the session user id
//   - admin: requires role === 'admin'
//   - memberGuard: runs for members before the impl (validates/rewrites args;
//     must fail closed via MemberScopeError)
//   - memberFilter: response filter applied to member results

import * as adminServer from './admin.server'
import * as accountsServer from './accounts.server'
import * as aiServer from './ai.server'
import * as analyticsServer from './analytics.server'
import * as attachmentsServer from './attachments.server'
import * as banksServer from './banks.server'
import * as benefitsServer from './benefits.server'
import * as billDraftsServer from './billDrafts.server'
import * as billItemsServer from './billItems.server'
import * as billsServer from './bills.server'
import * as cardsServer from './cards.server'
import * as dashboardServer from './dashboard.server'
import * as devicesServer from './devices.server'
import * as emailBillsServer from './emailBills.server'
import * as exportsServer from './exports.server'
import * as gmailServer from './gmail.server'
import * as gmailLedgerServer from './gmail-ledger.server'
import * as holdersServer from './holders.server'
import * as installmentsServer from './installments.server'
import * as notificationsServer from './notifications.server'
import * as payablesServer from './payables.server'
// payments.ts 直接持有 db 访问（历史文件无 .server 拆分），registry 是
// server-only 模块，导入即并入服务端 bundle，符合现有约定。
import * as paymentsServer from './payments'
import * as preferencesServer from './preferences.server'
import * as passwordVaultServer from './passwordVault.server'
import * as promosServer from './promos.server'
import * as recommendationsServer from './recommendations.server'
import * as opportunitiesServer from './opportunities.server'
import { getTodayAvailableCount } from '../opportunities/queries.server'
import * as pushServer from './push.server'
import * as remindersServer from './reminders.server'
import * as syncGmailServer from './sync-gmail.server'
import {
  applyAnalyticsScope,
  assertAccountAccess,
  assertBenefitAccess,
  assertBillAccess,
  assertBillListAccess,
  assertCardAccess,
  assertDraftAccess,
  assertInstallmentAccess,
  assertHolderAccess,
  assertHolderIdsAccess,
  assertLedgerAccess,
  assertRecordAccess,
  assertPayableAccess,
  filterCardsByHolder,
  filterHolders,
  guardFamilyExport,
  guardRecommendationScope,
  MemberScopeError,
  type MemberContext,
} from './member-scope'

export interface RpcEntry {
  impl: unknown
  admin?: boolean
  bindUser?: number
  bindField?: { arg: number; field: string }
  memberGuard?: (args: unknown[], ctx: MemberContext) => Promise<void>
  memberFilter?: (data: unknown, ctx: MemberContext) => unknown
  /**
   * Entries for the opportunity ledger: the route prepends the session-derived
   * OpportunityActor as impl argument 0. Client args shift by one; an entry
   * must never bind client input at position 0 (contract-tested). Impl
   * re-authorizes objects via lib/opportunities/scope.server.ts for both
   * roles — the flag alone is not an authorization.
   */
  prependActor?: boolean
}

type Guard = NonNullable<RpcEntry['memberGuard']>

// Shorthand guards keeping the table below readable.
const guardHolder = (index: number): Guard => async (args, ctx) => assertHolderAccess(args[index], ctx)
const guardCard = (index: number): Guard => async (args, ctx) => assertCardAccess(args[index], ctx)
const guardBill = (index: number): Guard => async (args, ctx) => assertBillAccess(args[index], ctx)
const guardObjField =
  (index: number, field: string, check: (value: unknown, ctx: MemberContext) => Promise<void>): Guard =>
  async (args, ctx) => {
    const obj = args[index] as Record<string, unknown> | undefined | null
    if (!obj || typeof obj !== 'object') throw new MemberScopeError('参数缺少必需对象')
    await check(obj[field], ctx)
  }

// Gmail-ledger reads: members are scoped to the rows they ingested
// (created_by = their user id); admins keep the unscoped view. Two shapes need
// covering — getGmailLedgerEntries takes an options object, the other two take
// the owner id directly.
const scopeLedgerOptions = (index: number): Guard => async (args, ctx) => {
  const current = args[index]
  const base = current && typeof current === 'object' && !Array.isArray(current)
    ? (current as Record<string, unknown>)
    : {}
  args[index] = { ...base, createdBy: ctx.userId }
}
const scopeLedgerUserArg = (index: number): Guard => async (args, ctx) => {
  args[index] = ctx.userId
}

export const RPC_REGISTRY: Record<string, Record<string, RpcEntry>> = {
  admin: {
    getAdminBanks: { impl: adminServer.getAdminBanks, admin: true },
    createBank: { impl: adminServer.createBank, admin: true },
    updateBank: { impl: adminServer.updateBank, admin: true },
    deleteBank: { impl: adminServer.deleteBank, admin: true },
    getAdminCardProducts: { impl: adminServer.getAdminCardProducts, admin: true },
    createCardProduct: { impl: adminServer.createCardProduct, admin: true },
    updateCardProduct: { impl: adminServer.updateCardProduct, admin: true },
    deleteCardProduct: { impl: adminServer.deleteCardProduct, admin: true },
    getAdminPromos: { impl: adminServer.getAdminPromos, admin: true },
    createPromo: { impl: adminServer.createPromo, admin: true },
    updatePromo: { impl: adminServer.updatePromo, admin: true },
    deletePromo: { impl: adminServer.deletePromo, admin: true },
    getAdminBenefits: { impl: adminServer.getAdminBenefits, admin: true },
    createBenefit: { impl: adminServer.createBenefit, admin: true },
    updateBenefit: { impl: adminServer.updateBenefit, admin: true },
    deleteBenefit: { impl: adminServer.deleteBenefit, admin: true },
    getSystemSettings: { impl: adminServer.getSystemSettings, admin: true },
    updateSystemSettings: { impl: adminServer.updateSystemSettings, admin: true },
    getEmailParseLogs: { impl: adminServer.getEmailParseLogs, admin: true },
    getEmailParseLogHolders: { impl: adminServer.getEmailParseLogHolders, admin: true },
    discardEmailParseLog: { impl: adminServer.discardEmailParseLog, admin: true },
    createCardFromEmailParseLog: { impl: adminServer.createCardFromEmailParseLog, admin: true },
    // 方向 4：AI 生成卡产品结构化规则草稿（只预览，写库由 updateCardProduct 人工确认）
    previewCardProductRules: { impl: aiServer.aiPreviewCardProductRules, admin: true },
  },
  ai: {
    aiComplete: { impl: aiServer.aiComplete },
    // 后台「按真实内容补全」：抓官网页面为证。只写 /tmp 无关，会读外网但绝不写库
    // （写库由调用方在界面上确认后走 admin.updateBank）。仅管理员可用。
    enrichBankFromWeb: { impl: aiServer.enrichBankFromWeb, admin: true },
    suggestPromosFromWeb: { impl: aiServer.suggestPromosFromWeb, admin: true },
  },
  accounts: {
    getCreditAccounts: { impl: accountsServer.getCreditAccounts, bindUser: 0 },
    getCreditAccountDetail: {
      impl: accountsServer.getCreditAccountDetail,
      memberGuard: async (args, ctx) => assertAccountAccess(args[0], ctx),
    },
    mergeCardsIntoAccount: {
      impl: accountsServer.mergeCardsIntoAccount,
      memberGuard: async (args, ctx) => {
        await assertAccountAccess(args[0], ctx);
        const cardIds = args[1] as string[];
        if (Array.isArray(cardIds)) {
          for (const cid of cardIds) {
            await assertCardAccess(cid, ctx);
          }
        }
      },
    },
    splitCardFromAccount: {
      impl: accountsServer.splitCardFromAccount,
      memberGuard: async (args, ctx) => assertCardAccess(args[0], ctx),
    },
    updateCreditAccount: {
      impl: accountsServer.updateCreditAccount,
      memberGuard: async (args, ctx) => assertAccountAccess(args[0], ctx),
    },
  },
  analytics: {
    getAnalyticsSummary: { impl: analyticsServer.getAnalyticsSummary, memberGuard: (args, ctx) => applyAnalyticsScope(args[0], ctx) },
    getMonthlyDebtTrend: { impl: analyticsServer.getMonthlyDebtTrend, memberGuard: (args, ctx) => applyAnalyticsScope(args[0], ctx) },
    getCategoryBreakdown: { impl: analyticsServer.getCategoryBreakdown, memberGuard: (args, ctx) => applyAnalyticsScope(args[0], ctx) },
    getCategoryBreakdownReport: { impl: analyticsServer.getCategoryBreakdownReport, memberGuard: (args, ctx) => applyAnalyticsScope(args[0], ctx) },
    getCategoryDrilldownItems: { impl: analyticsServer.getCategoryDrilldownItems, memberGuard: (args, ctx) => applyAnalyticsScope(args[0], ctx) },
    // 现金流预测：第 2 个参数由 bindUser 注入会话用户 id（固定支出隐私过滤依赖它）。
    getCashflowForecast: {
      impl: analyticsServer.getCashflowForecast,
      bindUser: 1,
      memberGuard: (args, ctx) => applyAnalyticsScope(args[0], ctx),
    },
    getAnalyticsByHolder: { impl: analyticsServer.getAnalyticsByHolder, memberGuard: guardHolder(0) },
  },
  installments: {
    getInstallmentPlans: {
      impl: installmentsServer.getInstallmentPlans,
      // 允许不传筛选（服务端默认 {}），但仍必须把成员锁在自己的持卡人上。
      memberGuard: async (args, ctx) => {
        if (args[0] === undefined || args[0] === null) args[0] = {}
        await applyAnalyticsScope(args[0], ctx)
      },
    },
    createInstallmentPlan: {
      impl: installmentsServer.createInstallmentPlan,
      memberGuard: guardObjField(0, 'card_id', assertCardAccess),
    },
    updateInstallmentPlan: {
      impl: installmentsServer.updateInstallmentPlan,
      memberGuard: async (args, ctx) => assertInstallmentAccess(args[0], ctx),
    },
    advanceInstallmentPeriod: {
      impl: installmentsServer.advanceInstallmentPeriod,
      memberGuard: async (args, ctx) => assertInstallmentAccess(args[0], ctx),
    },
    settleInstallmentEarly: {
      impl: installmentsServer.settleInstallmentEarly,
      memberGuard: async (args, ctx) => assertInstallmentAccess(args[0], ctx),
    },
    deleteInstallmentPlan: {
      impl: installmentsServer.deleteInstallmentPlan,
      memberGuard: async (args, ctx) => assertInstallmentAccess(args[0], ctx),
    },
    getInstallmentSchedule: {
      impl: installmentsServer.getInstallmentSchedule,
      memberGuard: async (args, ctx) => assertInstallmentAccess(args[0], ctx),
    },
  },
  exports: {
    // 全家庭报表导出：第 2 个参数由 bindUser 注入会话用户 id。
    exportFamilyCsvRows: {
      impl: exportsServer.exportFamilyCsvRows,
      bindUser: 1,
      memberGuard: async (args, ctx) => guardFamilyExport(args[0], ctx),
    },
    getStatementReport: {
      impl: exportsServer.getStatementReport,
      bindUser: 1,
      memberGuard: async (args, ctx) => guardFamilyExport(args[0], ctx),
    },
  },
  attachments: {
    getAttachments: {
      impl: attachmentsServer.getAttachments,
      memberGuard: async (args, ctx) => assertRecordAccess(args[0], args[1], ctx),
    },
    deleteRecordAttachment: {
      impl: attachmentsServer.deleteRecordAttachment,
      memberGuard: async (args, ctx) => {
        const obj = args[0] as Record<string, unknown> | undefined | null
        if (!obj || typeof obj !== 'object') throw new MemberScopeError('参数缺少附件信息')
        await assertRecordAccess(obj.record_type, obj.record_id, ctx)
      },
    },
  },
  benefits: {
    getAllMyBenefits: { impl: benefitsServer.getAllMyBenefits, bindUser: 0 },
    recordBenefitUsage: { impl: benefitsServer.recordBenefitUsage, prependActor: true, memberGuard: guardObjField(0, "benefit_id", assertBenefitAccess) },
    autoEnrichCardBenefits: { impl: benefitsServer.autoEnrichCardBenefits, admin: true },
    createBenefit: { impl: benefitsServer.createBenefit, admin: true },
    updateBenefit: { impl: benefitsServer.updateBenefit, admin: true },
    deleteBenefit: { impl: benefitsServer.deleteBenefit, admin: true },
  },
  billDrafts: {
    // HUB-156（HUB-154 §3.3）：统一账单导入草稿箱。
    // 约定：bindUser 的位置 = impl 收到 userId 的参数位；客户端永远不传 userId。
    createBillImportDraft: { impl: billDraftsServer.createBillImportDraft, bindField: { arg: 0, field: "created_by" }, memberGuard: guardObjField(0, "card_id", async (cardId, ctx) => { if (cardId) await assertCardAccess(cardId, ctx) }) },
    importAndParseBill: {
      impl: billDraftsServer.importAndParseBill,
      // 附件二进制走 /api/attachments/upload，RPC 只收 attachment_ids + 元数据。
      bindField: { arg: 0, field: 'user_id' },
      memberGuard: async (args, ctx) => {
        const input = args[0] as { card_id?: string | null; holder_id?: string | null } | undefined
        if (!input || typeof input !== 'object') throw new MemberScopeError('参数缺少必需对象')
        if (input.card_id) await assertCardAccess(input.card_id, ctx)
        if (input.holder_id) assertHolderAccess(input.holder_id, ctx)
      },
    },
    unlockEncryptedDraft: {
      impl: billDraftsServer.unlockEncryptedDraft,
      bindUser: 2,
      memberGuard: async (args, ctx) => {
        await assertDraftAccess(args[0], ctx)
        const input = args[1] as { vault_holder_id?: string | null } | undefined
        if (input?.vault_holder_id) assertHolderAccess(input.vault_holder_id, ctx)
      },
    },
    retryParseDraft: {
      impl: billDraftsServer.retryParseDraft,
      bindUser: 2,
      memberGuard: (args, ctx) => assertDraftAccess(args[0], ctx),
    },
    getBillImportDrafts: { impl: billDraftsServer.getBillImportDrafts, bindUser: 0 },
    getBillImportDraftById: {
      impl: billDraftsServer.getBillImportDraftById,
      bindUser: 1,
      memberGuard: (args, ctx) => assertDraftAccess(args[0], ctx),
    },
    confirmBillImportDraft: {
      impl: billDraftsServer.confirmBillImportDraft,
      bindUser: 2,
      memberGuard: async (args, ctx) => {
        await assertDraftAccess(args[0], ctx)
        // 快捷建卡：成员只能把新卡挂到自己名下的持卡人
        const opts = args[1] as { quick_create_card?: { holder_id?: string } } | undefined
        const quickHolder = opts?.quick_create_card?.holder_id
        if (quickHolder) assertHolderAccess(quickHolder, ctx)
      },
    },
    discardBillImportDraft: {
      impl: billDraftsServer.discardBillImportDraft,
      bindUser: 1,
      memberGuard: (args, ctx) => assertDraftAccess(args[0], ctx),
    },
    batchDiscardBillDrafts: {
      impl: billDraftsServer.batchDiscardBillDrafts,
      bindUser: 1,
      memberGuard: async (args, ctx) => {
        const ids = args[0]
        if (!Array.isArray(ids)) throw new MemberScopeError('参数必须是草稿 ID 数组')
        // 逐条 fail-closed：数组里混进一条他人草稿即整体 403。
        for (const id of ids) await assertDraftAccess(id, ctx)
      },
    },
    updateBillImportDraft: {
      impl: billDraftsServer.updateBillImportDraft,
      bindUser: 2,
      memberGuard: async (args, ctx) => {
        // member 只能把草稿改绑到自己有权的卡/持卡人
        await assertDraftAccess(args[0], ctx)
        const updates = args[1] as { card_id?: string; holder_id?: string | null } | undefined
        if (updates?.card_id) await assertCardAccess(updates.card_id, ctx)
        if (updates?.holder_id) assertHolderAccess(updates.holder_id, ctx)
      },
    },
  },
  passwordVault: {
    // 月结单密码本（HUB-154 §3.3(2)）：bindUser 的位置按实际入参位数放置，
    // 不能照抄契约表里的 `bindUser: 0`——那会把入参对象整个替换成 userId。
    listPasswordRules: { impl: passwordVaultServer.listPasswordRules, bindUser: 0 },
    createPasswordRule: {
      impl: passwordVaultServer.createPasswordRule,
      bindField: { arg: 0, field: 'user_id' },
      memberGuard: guardObjField(0, 'holder_id', async (holderId, ctx) => {
        if (holderId) assertHolderAccess(holderId, ctx)
      }),
    },
    updatePasswordRule: {
      impl: passwordVaultServer.updatePasswordRule,
      bindUser: 2,
      memberGuard: async (args, ctx) => {
        const input = args[1] as { holder_id?: string | null } | undefined
        if (input?.holder_id) assertHolderAccess(input.holder_id, ctx)
      },
    },
    deletePasswordRule: { impl: passwordVaultServer.deletePasswordRule, bindUser: 1 },
  },
  gmail: {
    // 兼容红线：getGmailConnection / GET /api/gmail/status 的 6 字段结构不变。
    getGmailConnection: { impl: gmailServer.getGmailConnection, bindUser: 0 },
    syncGmailNow: { impl: gmailServer.syncGmailNow, bindUser: 0 },
    disconnectGmail: { impl: gmailServer.disconnectGmail, bindUser: 0 },
    // 多邮箱（HUB-154 §3.3(3)）。bindUser 指向「最后一个参数」，
    // 客户端的 (connectionId, patch) 两个入参保持原位。
    getGmailConnections: { impl: gmailServer.getGmailConnections, bindUser: 0 },
    updateGmailConnection: {
      impl: gmailServer.updateGmailConnection,
      bindUser: 2,
      memberGuard: async (args, ctx) => {
        // 非本人 connection 由 impl 内部判定并抛 MemberScopeError(403)；
        // 这里只拦「成员把邮箱映射到他人持卡人」。
        const patch = args[1] as { default_holder_id?: string | null } | undefined
        if (patch?.default_holder_id) assertHolderAccess(patch.default_holder_id, ctx)
      },
    },
    syncGmailConnection: {
      impl: gmailServer.syncGmailConnection,
      bindUser: 1,
      // 单邮箱同步的归属校验在 impl 内完成（loadOwnedConnection）。
    },
    disconnectGmailConnection: {
      impl: gmailServer.disconnectGmailConnection,
      bindUser: 1,
    },
  },
  billItems: {
    getBillItems: { impl: billItemsServer.getBillItems, memberGuard: guardBill(0) },
    createBillItem: { impl: billItemsServer.createBillItem, bindField: { arg: 0, field: 'user_id' }, memberGuard: guardObjField(0, 'bill_id', assertBillAccess) },
    updateBillItem: { impl: billItemsServer.updateBillItem, bindField: { arg: 1, field: 'user_id' }, memberGuard: (args, ctx) => billItemsServer.assertBillItemAccess(args[0], ctx) },
    deleteBillItem: { impl: billItemsServer.deleteBillItem, memberGuard: (args, ctx) => billItemsServer.assertBillItemAccess(args[0], ctx) },
    batchImportBillItems: { impl: billItemsServer.batchImportBillItems, bindField: { arg: 0, field: 'user_id' }, memberGuard: guardObjField(0, 'bill_id', assertBillAccess) },
    clearBillItems: { impl: billItemsServer.clearBillItems, memberGuard: guardBill(0) },
    getMerchantCategoryRules: { impl: billItemsServer.getMerchantCategoryRules, bindUser: 0 },
  },

  bills: {
    getBillDashboardItems: { impl: billsServer.getBillDashboardItems, bindUser: 1 },
    getCardsWithBillsSummary: { impl: billsServer.getCardsWithBillsSummary, bindUser: 0 },
    getBillDetail: { impl: billsServer.getBillDetail, memberGuard: guardBill(0) },
    getUnpaidBills: { impl: billsServer.getUnpaidBills, memberGuard: async (args, ctx) => { args[1] = ctx.holderIds } },
    getPaymentTotal: { impl: billsServer.getPaymentTotal, memberGuard: guardBill(0) },
    getBillByCardMonth: { impl: billsServer.getBillByCardMonth, memberGuard: guardCard(0) },
    getBillsByHolder: { impl: billsServer.getBillsByHolder, memberGuard: guardHolder(0) },
    createBill: { impl: billsServer.createBill, bindField: { arg: 0, field: "created_by" }, memberGuard: guardObjField(0, "card_id", assertCardAccess) },
    updateBill: { impl: billsServer.updateBill, memberGuard: guardBill(0) },
    updateBillStatus: { impl: billsServer.updateBillStatus, memberGuard: guardBill(0) },
    setBillAmountOverride: { impl: billsServer.setBillAmountOverride, memberGuard: guardBill(0) },
    setCardManualBillAmount: { impl: billsServer.setCardManualBillAmount, memberGuard: guardCard(0) },
    createPayment: { impl: billsServer.createPayment, memberGuard: guardObjField(0, "bill_id", assertBillAccess) },
    recordPayment: { impl: billsServer.recordPayment, memberGuard: guardObjField(0, "bill_id", assertBillAccess) },
    markBillAsPaid: { impl: billsServer.markBillAsPaid, memberGuard: guardBill(0) },
    markAllOverdueBillsAsPaid: { impl: billsServer.markAllOverdueBillsAsPaid, bindUser: 0, memberGuard: (args, ctx) => assertBillListAccess(args[1], ctx) },
    updateBillFields: { impl: billsServer.updateBillFields, memberGuard: guardBill(0) },
    clearOverride: { impl: billsServer.clearOverride, memberGuard: guardBill(0) },
    updateBillStatusChecked: {
      impl: (billId: string) => billsServer.updateBillStatusChecked(billId),
      memberGuard: guardBill(0),
    },
    deleteBill: { impl: billsServer.deleteBill, admin: true },
    supplementMissingBill: {
      impl: billsServer.supplementMissingBill,
      bindField: { arg: 0, field: 'user_id' },
      memberGuard: guardObjField(0, 'card_id', assertCardAccess),
    },
  },
  payments: {
    // 还款记录编辑（spec 13 §6.1/§6.2）：成员经 payment -> bill -> card -> holder
    // 归属链校验；更新/删除后 impl 内部重算所属账单状态。
    updatePayment: { impl: paymentsServer.updatePayment, memberGuard: (args, ctx) => paymentsServer.assertPaymentAccess(args[0], ctx) },
    deletePayment: { impl: paymentsServer.deletePayment, memberGuard: (args, ctx) => paymentsServer.assertPaymentAccess(args[0], ctx) },
  },
  cards: {
    getCardsByHolder: { impl: cardsServer.getCardsByHolder, memberGuard: guardHolder(0) },
    getCardHolders: { impl: cardsServer.getCardHolders, memberFilter: (data, ctx) => filterHolders(data as { id: string }[], ctx) },
    getCardProducts: { impl: cardsServer.getCardProducts },
    getAllCardsWithProduct: { impl: cardsServer.getAllCardsWithProduct, memberFilter: (data, ctx) => filterCardsByHolder(data as { holder_id?: string }[], ctx) },
    getCardsBasicByHolders: { impl: cardsServer.getCardsBasicByHolders, memberGuard: async (args, ctx) => assertHolderIdsAccess(args[0], ctx) },
    getCardDetail: { impl: cardsServer.getCardDetail, prependActor: true, memberGuard: guardCard(0) },
    createCard: { impl: cardsServer.createCard, memberGuard: guardObjField(0, "holder_id", async (holderId, ctx) => assertHolderAccess(holderId, ctx)) },
    updateCard: { impl: cardsServer.updateCard, memberGuard: guardCard(0) },
    updateCardHolder: { impl: cardsServer.updateCardHolder, bindUser: 0 },
    getDueDateReasonReport: { impl: cardsServer.getDueDateReasonReport, bindUser: 0 },
  },
  // 方向 4（HUB-177）：消费前 Top 3 推荐 + 单卡/全家庭年费 ROI。
  // 成员侧由 guardRecommendationScope 拦截 'all' / 他人 holder_id（403）；
  // 单卡入口沿用 guardCard，绝不让成员读到他人卡片的 ROI 明细。
  recommendations: {
    getCardRecommendations: {
      impl: recommendationsServer.getCardRecommendations,
      prependActor: true,
      memberGuard: (args, ctx) => guardRecommendationScope(args, ctx),
    },
    getCardAnnualFeeRoi: {
      impl: recommendationsServer.getCardAnnualFeeRoi,
      prependActor: true,
      memberGuard: guardCard(0),
    },
    getFamilyAnnualFeeRoi: {
      impl: recommendationsServer.getFamilyAnnualFeeRoi,
      prependActor: true,
      memberGuard: (args, ctx) => guardRecommendationScope(args, ctx),
    },
    getCardCycleSpendEstimate: {
      impl: recommendationsServer.getCardCycleSpendEstimate,
      prependActor: true,
      memberGuard: guardCard(0),
    },
    updateOpportunityValuation: {
      impl: recommendationsServer.updateOpportunityValuation,
      prependActor: true,
    },
    upsertPromoUsageCashback: {
      impl: recommendationsServer.upsertPromoUsageCashback,
      prependActor: true,
      memberGuard: guardObjField(0, 'card_id', assertCardAccess),
    },
  },
  dashboard: {
    getOpportunityTodayCount: { impl: getTodayAvailableCount, prependActor: true },
    getDashboardStats: { impl: dashboardServer.getDashboardStats, admin: true },
    getUserActivity: { impl: dashboardServer.getUserActivity, admin: true },
    getCardProductStats: { impl: dashboardServer.getCardProductStats, admin: true },
    getPromoList: { impl: dashboardServer.getPromoList, admin: true },
    getBenefitStats: { impl: dashboardServer.getBenefitStats, admin: true },
  },
  emailBills: {
    syncEmailBillToAccount: { impl: emailBillsServer.syncEmailBillToAccount, admin: true },
  },
  'gmail-ledger': {
    getGmailLedgerEntries: { impl: gmailLedgerServer.getGmailLedgerEntries, memberGuard: scopeLedgerOptions(0) },
    getGmailLedgerSummary: { impl: gmailLedgerServer.getGmailLedgerSummary, memberGuard: scopeLedgerUserArg(0) },
    // 已封板：impl 直接抛 409 CONFLICT，只保留条目让旧客户端拿到可读错误（AC-09）。
    markPayment: { impl: gmailLedgerServer.markPayment, memberGuard: (args, ctx) => assertLedgerAccess(args[0], ctx) },
    updateLedgerAmount: { impl: gmailLedgerServer.updateLedgerAmount, memberGuard: (args, ctx) => assertLedgerAccess(args[0], ctx) },
    getGmailLedgerBanks: { impl: gmailLedgerServer.getGmailLedgerBanks, memberGuard: scopeLedgerUserArg(0) },
    migrateLegacyLedgerToDrafts: { impl: gmailLedgerServer.migrateLegacyLedgerToDrafts, bindUser: 0 },
  },
  banks: {
    getBankNames: { impl: banksServer.getBankNames },
    getBanks: { impl: banksServer.getBanks },
  },
  holders: {
    getHolders: { impl: holdersServer.getHolders, bindUser: 0 },
    getHolder: { impl: holdersServer.getHolder, memberGuard: guardHolder(0) },
    getHolderStatsPageData: { impl: holdersServer.getHolderStatsPageData, memberGuard: guardHolder(0) },
    getHolderCardCounts: { impl: holdersServer.getHolderCardCounts, memberGuard: async (args, ctx) => assertHolderIdsAccess(args[0], ctx) },
    createHolder: { impl: holdersServer.createHolder, bindField: { arg: 0, field: "created_by" } },
    updateHolder: { impl: holdersServer.updateHolder, admin: true },
    // 成员自助维护本人持卡人别名：归属在 impl 内按 auth_user_id / created_by 判定。
    updateMyHolderAliases: {
      impl: holdersServer.updateMyHolderAliases,
      bindUser: 2,
      memberGuard: guardHolder(0),
    },
    mergeHolders: { impl: holdersServer.mergeHolders, admin: true },
  },
  preferences: {
    getUserPreferences: { impl: preferencesServer.getUserPreferences, bindUser: 0 },
    updateUserPreferences: { impl: preferencesServer.updateUserPreferences, bindUser: 0 },
    // import_config 与 display_config / reminder_config 物理隔离（HUB-154 §2.2）。
    getUserImportPreferences: { impl: preferencesServer.getUserImportPreferences, bindUser: 0 },
    updateUserImportPreferences: {
      impl: preferencesServer.updateUserImportPreferences,
      bindUser: 0,
    },
  },
  notifications: {
    getNotifications: { impl: notificationsServer.getNotifications, bindUser: 0 },
    getUnreadNotificationCount: { impl: notificationsServer.getUnreadNotificationCount, bindUser: 0 },
    markNotificationRead: { impl: notificationsServer.markNotificationRead, bindUser: 0 },
    markAllNotificationsRead: { impl: notificationsServer.markAllNotificationsRead, bindUser: 0 },
    deleteNotification: { impl: notificationsServer.deleteNotification, bindUser: 0 },
    deleteAllNotifications: { impl: notificationsServer.deleteAllNotifications, bindUser: 0 },
  },
  promos: {
    getPromosWithBanks: { impl: promosServer.getPromosWithBanks, bindUser: 0 },
    createUserPromo: { impl: promosServer.createUserPromo, admin: true },
  },
  payables: {
    // 周期应付（房租/贷款）：一律绑定会话用户，成员只能碰自己创建的记录。
    getRecurringPayables: { impl: payablesServer.getRecurringPayables, bindUser: 0 },
    getPayableCustomCategories: { impl: payablesServer.getPayableCustomCategories, bindUser: 0 },
    savePayableCustomCategory: { impl: payablesServer.savePayableCustomCategory, bindUser: 0 },
    createRecurringPayable: {
      impl: payablesServer.createRecurringPayable,
      bindField: { arg: 0, field: 'created_by' },
      memberGuard: guardObjField(0, 'holder_id', async (holderId, ctx) => {
        if (holderId) await assertHolderAccess(holderId, ctx)
      }),
    },
    updateRecurringPayable: { impl: payablesServer.updateRecurringPayable, memberGuard: (args, ctx) => assertPayableAccess(args[0], ctx) },
    deleteRecurringPayable: { impl: payablesServer.deleteRecurringPayable, memberGuard: (args, ctx) => assertPayableAccess(args[0], ctx) },
    payRecurringPayable: { impl: payablesServer.payRecurringPayable, memberGuard: (args, ctx) => assertPayableAccess(args[0], ctx) },
    getPayablePayments: { impl: payablesServer.getPayablePayments, memberGuard: (args, ctx) => assertPayableAccess(args[0], ctx) },
  },
  opportunities: {
    // Session actor is prepended by the route; each impl re-authorizes via
    // lib/opportunities/scope.server.ts for both roles (tech spec §2.1/§2.2).
    createOpportunityAccount: { impl: opportunitiesServer.createOpportunityAccount, prependActor: true },
    confirmOpportunityEligibility: { impl: opportunitiesServer.confirmOpportunityEligibility, prependActor: true },
    confirmOpeningBalance: { impl: opportunitiesServer.confirmOpeningBalance, prependActor: true },
    updateOpportunityCycleWorkflow: { impl: opportunitiesServer.updateOpportunityCycleWorkflow, prependActor: true },
    recordOpportunityUsage: { impl: opportunitiesServer.recordOpportunityUsage, prependActor: true },
    correctOpportunityUsage: { impl: opportunitiesServer.correctOpportunityUsage, prependActor: true },
    voidOpportunityUsage: { impl: opportunitiesServer.voidOpportunityUsage, prependActor: true },
    getUsageHistory: { impl: opportunitiesServer.getUsageHistory, prependActor: true },
    getUnassignedLegacyUsages: { impl: opportunitiesServer.getUnassignedLegacyUsages, prependActor: true, admin: true },
    assignLegacyUsage: { impl: opportunitiesServer.assignLegacyUsage, prependActor: true, admin: true },
    getOpportunityPage: { impl: opportunitiesServer.getOpportunityPage, prependActor: true },
    getBenefitLedger: { impl: opportunitiesServer.getBenefitLedger, prependActor: true },
    getCardOpportunities: { impl: opportunitiesServer.getCardOpportunities, prependActor: true },
    getOpportunityDetail: { impl: opportunitiesServer.getOpportunityDetail, prependActor: true },
    setOpportunityFollowed: { impl: opportunitiesServer.setOpportunityFollowed, prependActor: true },
    getTodayAvailableCount: { impl: opportunitiesServer.getTodayAvailableCount, prependActor: true },
    previewOpportunityCandidates: { impl: opportunitiesServer.previewOpportunityCandidates, prependActor: true, admin: true },
    publishOpportunityVersion: { impl: opportunitiesServer.publishOpportunityVersion, prependActor: true },
    archiveOpportunityDefinition: { impl: opportunitiesServer.archiveOpportunityDefinition, prependActor: true, admin: true },
    exportOpportunityUsages: { impl: opportunitiesServer.exportOpportunityUsages, prependActor: true },
    getLegacyBenefitUsages: { impl: opportunitiesServer.getLegacyBenefitUsages, prependActor: true },
    getLegacyPromoUsages: { impl: opportunitiesServer.getLegacyPromoUsages, prependActor: true },
    getOpportunityCalendar: { impl: opportunitiesServer.getOpportunityCalendar, prependActor: true },
    getOpportunityReminders: { impl: opportunitiesServer.getOpportunityReminders, prependActor: true },
    updateOpportunityReminderState: { impl: opportunitiesServer.updateOpportunityReminderState, prependActor: true },
    getOpportunityTasks: { impl: opportunitiesServer.getOpportunityTasks, prependActor: true },
    saveOpportunityTask: { impl: opportunitiesServer.saveOpportunityTask, prependActor: true },
    updateManualTaskProgress: { impl: opportunitiesServer.updateManualTaskProgress, prependActor: true },
    recordOpportunityClaim: { impl: opportunitiesServer.recordOpportunityClaim, prependActor: true },
    recordTaskRewardReceived: { impl: opportunitiesServer.recordTaskRewardReceived, prependActor: true },
    voidOpportunityClaim: { impl: opportunitiesServer.voidOpportunityClaim, prependActor: true },
    recordOpportunityBooking: { impl: opportunitiesServer.recordOpportunityBooking, prependActor: true },
    completeOpportunityBooking: { impl: opportunitiesServer.completeOpportunityBooking, prependActor: true },
    cancelOpportunityBooking: { impl: opportunitiesServer.cancelOpportunityBooking, prependActor: true },
  },
  devices: {
    registerToken: { impl: devicesServer.registerDeviceToken, bindUser: 1 },
    unregisterToken: { impl: devicesServer.unregisterDeviceToken, bindUser: 1 },
  },
  push: {
    subscribePush: { impl: pushServer.subscribePush, bindUser: 1 },
  },
  reminders: {
    getDueBillsForReminders: { impl: remindersServer.getDueBillsForReminders, bindUser: 0 },
    getSentReminderKeys: { impl: remindersServer.getSentReminderKeys, memberGuard: async (args, ctx) => { const ids = args[0]; if (Array.isArray(ids)) { for (const id of ids) await assertBillAccess(id, ctx) } } },
    recordBillReminder: { impl: remindersServer.recordBillReminder, memberGuard: guardBill(0) },
    getActiveLoanCards: { impl: remindersServer.getActiveLoanCards, memberFilter: (data, ctx) => filterCardsByHolder(data as { holder_id?: string }[], ctx) },
    hasLoanReminderLog: { impl: remindersServer.hasLoanReminderLog, memberGuard: guardCard(0) },
    recordLoanReminder: { impl: remindersServer.recordLoanReminder, memberGuard: guardCard(0) },
  },
  'sync-gmail': {
    syncGmailLedgerToCardsAndBills: { impl: syncGmailServer.syncGmailLedgerToCardsAndBills, bindUser: 0 },
  },
}
