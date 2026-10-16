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
import * as aiServer from './ai.server'
import * as analyticsServer from './analytics.server'
import * as attachmentsServer from './attachments.server'
import * as benefitsServer from './benefits.server'
import * as billDraftsServer from './billDrafts.server'
import * as billsServer from './bills.server'
import * as cardsServer from './cards.server'
import * as dashboardServer from './dashboard.server'
import * as emailBillsServer from './emailBills.server'
import * as gmailLedgerServer from './gmail-ledger.server'
import * as holdersServer from './holders.server'
import * as payablesServer from './payables.server'
import * as preferencesServer from './preferences.server'
import * as promosServer from './promos.server'
import * as opportunitiesServer from './opportunities.server'
import { getTodayAvailableCount } from '../opportunities/queries.server'
import * as pushServer from './push.server'
import * as remindersServer from './reminders.server'
import * as syncGmailServer from './sync-gmail.server'
import {
  applyAnalyticsScope,
  assertBenefitAccess,
  assertBillAccess,
  assertBillListAccess,
  assertCardAccess,
  assertDraftAccess,
  assertHolderAccess,
  assertHolderIdsAccess,
  assertLedgerAccess,
  assertRecordAccess,
  assertPayableAccess,
  filterCardsByHolder,
  filterHolders,
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
  },
  ai: {
    aiComplete: { impl: aiServer.aiComplete },
    // 后台「按真实内容补全」：抓官网页面为证。只写 /tmp 无关，会读外网但绝不写库
    // （写库由调用方在界面上确认后走 admin.updateBank）。仅管理员可用。
    enrichBankFromWeb: { impl: aiServer.enrichBankFromWeb, admin: true },
    suggestPromosFromWeb: { impl: aiServer.suggestPromosFromWeb, admin: true },
  },
  analytics: {
    getAnalyticsSummary: { impl: analyticsServer.getAnalyticsSummary, memberGuard: (args, ctx) => applyAnalyticsScope(args[0], ctx) },
    getMonthlyDebtTrend: { impl: analyticsServer.getMonthlyDebtTrend, memberGuard: (args, ctx) => applyAnalyticsScope(args[0], ctx) },
    getCategoryBreakdown: { impl: analyticsServer.getCategoryBreakdown, memberGuard: (args, ctx) => applyAnalyticsScope(args[0], ctx) },
    getAnalyticsByHolder: { impl: analyticsServer.getAnalyticsByHolder, memberGuard: guardHolder(0) },
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
    createBillImportDraft: { impl: billDraftsServer.createBillImportDraft, bindField: { arg: 0, field: "created_by" }, memberGuard: guardObjField(0, "card_id", async (cardId, ctx) => { if (cardId) await assertCardAccess(cardId, ctx) }) },
    confirmBillImportDraft: { impl: billDraftsServer.confirmBillImportDraft, memberGuard: (args, ctx) => assertDraftAccess(args[0], ctx) },
    discardBillImportDraft: { impl: billDraftsServer.discardBillImportDraft, memberGuard: (args, ctx) => assertDraftAccess(args[0], ctx) },
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
    markBillAsPaid: { impl: billsServer.markBillAsPaid, memberGuard: guardBill(0) },
    markAllOverdueBillsAsPaid: { impl: billsServer.markAllOverdueBillsAsPaid, bindUser: 0, memberGuard: (args, ctx) => assertBillListAccess(args[1], ctx) },
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
    markPayment: { impl: gmailLedgerServer.markPayment, memberGuard: (args, ctx) => assertLedgerAccess(args[0], ctx) },
    updateLedgerAmount: { impl: gmailLedgerServer.updateLedgerAmount, memberGuard: (args, ctx) => assertLedgerAccess(args[0], ctx) },
    getGmailLedgerBanks: { impl: gmailLedgerServer.getGmailLedgerBanks, memberGuard: scopeLedgerUserArg(0) },
  },
  holders: {
    getHolders: { impl: holdersServer.getHolders, bindUser: 0 },
    getHolder: { impl: holdersServer.getHolder, memberGuard: guardHolder(0) },
    getHolderStatsPageData: { impl: holdersServer.getHolderStatsPageData, memberGuard: guardHolder(0) },
    getHolderCardCounts: { impl: holdersServer.getHolderCardCounts, memberGuard: async (args, ctx) => assertHolderIdsAccess(args[0], ctx) },
    createHolder: { impl: holdersServer.createHolder, bindField: { arg: 0, field: "created_by" }, admin: true },
    updateHolder: { impl: holdersServer.updateHolder, admin: true },
    mergeHolders: { impl: holdersServer.mergeHolders, admin: true },
  },
  preferences: {
    getUserPreferences: { impl: preferencesServer.getUserPreferences, bindUser: 0 },
    updateUserPreferences: { impl: preferencesServer.updateUserPreferences, bindUser: 0 },
  },
  promos: {
    getPromosWithBanks: { impl: promosServer.getPromosWithBanks, bindUser: 0 },
    createUserPromo: { impl: promosServer.createUserPromo, admin: true },
  },
  payables: {
    // 周期应付（房租/贷款）：一律绑定会话用户，成员只能碰自己创建的记录。
    getRecurringPayables: { impl: payablesServer.getRecurringPayables, bindUser: 0 },
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
