// lib/api/registry.ts — server-only allowlist of the RPC API surface.
// A client request /api/rpc/<module>/<fn> only executes if a matching entry
// exists here. Identity is always taken from the wc_user session cookie:
//   - bindUser: positional arg index replaced with the session user id
//   - bindField: field inside an object arg overwritten with the session user id
//   - admin: requires role === 'admin'

import * as adminServer from './admin.server'
import * as aiServer from './ai.server'
import * as analyticsServer from './analytics.server'
import * as attachmentsServer from './attachments.server'
import * as benefitsServer from './benefits.server'
import * as billEmailsServer from './bill-emails.server'
import * as billDraftsServer from './billDrafts.server'
import * as billsServer from './bills.server'
import * as cardsServer from './cards.server'
import * as dashboardServer from './dashboard.server'
import * as emailBillsServer from './emailBills.server'
import * as gmailLedgerServer from './gmail-ledger.server'
import * as holdersServer from './holders.server'
import * as preferencesServer from './preferences.server'
import * as promosServer from './promos.server'
import * as pushServer from './push.server'
import * as remindersServer from './reminders.server'
import * as syncGmailServer from './sync-gmail.server'

export interface RpcEntry {
  impl: unknown
  admin?: boolean
  bindUser?: number
  bindField?: { arg: number; field: string }
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
  },
  ai: {
    aiComplete: { impl: aiServer.aiComplete },
  },
  analytics: {
    getAnalyticsSummary: { impl: analyticsServer.getAnalyticsSummary },
    getMonthlyDebtTrend: { impl: analyticsServer.getMonthlyDebtTrend },
    getCategoryBreakdown: { impl: analyticsServer.getCategoryBreakdown },
    getAnalyticsByHolder: { impl: analyticsServer.getAnalyticsByHolder },
  },
  attachments: {
    getAttachments: { impl: attachmentsServer.getAttachments },
    deleteRecordAttachment: { impl: attachmentsServer.deleteRecordAttachment },
  },
  benefits: {
    getAllMyBenefits: { impl: benefitsServer.getAllMyBenefits, bindUser: 0 },
    recordBenefitUsage: { impl: benefitsServer.recordBenefitUsage },
    autoEnrichCardBenefits: { impl: benefitsServer.autoEnrichCardBenefits, admin: true },
    createBenefit: { impl: benefitsServer.createBenefit, admin: true },
    updateBenefit: { impl: benefitsServer.updateBenefit, admin: true },
    deleteBenefit: { impl: benefitsServer.deleteBenefit, admin: true },
  },
  'bill-emails': {
    getBillEmailSources: { impl: billEmailsServer.getBillEmailSources, bindUser: 0 },
    addBillEmailSource: { impl: billEmailsServer.addBillEmailSource, bindUser: 0 },
    setBillEmailSourceActive: { impl: billEmailsServer.setBillEmailSourceActive },
    deleteBillEmailSource: { impl: billEmailsServer.deleteBillEmailSource },
  },
  billDrafts: {
    createBillImportDraft: { impl: billDraftsServer.createBillImportDraft, bindField: { arg: 0, field: 'created_by' } },
    confirmBillImportDraft: { impl: billDraftsServer.confirmBillImportDraft },
    discardBillImportDraft: { impl: billDraftsServer.discardBillImportDraft },
  },
  bills: {
    getBillDashboardItems: { impl: billsServer.getBillDashboardItems, bindUser: 1 },
    getCardsWithBillsSummary: { impl: billsServer.getCardsWithBillsSummary, bindUser: 0 },
    getBillDetail: { impl: billsServer.getBillDetail },
    getUnpaidBills: { impl: billsServer.getUnpaidBills },
    getPaymentTotal: { impl: billsServer.getPaymentTotal },
    getBillByCardMonth: { impl: billsServer.getBillByCardMonth },
    getBillsByHolder: { impl: billsServer.getBillsByHolder },
    createBill: { impl: billsServer.createBill, bindField: { arg: 0, field: 'created_by' } },
    updateBill: { impl: billsServer.updateBill },
    updateBillStatus: { impl: billsServer.updateBillStatus },
    createPayment: { impl: billsServer.createPayment },
    markBillAsPaid: { impl: billsServer.markBillAsPaid },
    markAllOverdueBillsAsPaid: { impl: billsServer.markAllOverdueBillsAsPaid, bindUser: 0 },
  },
  cards: {
    getCardsByHolder: { impl: cardsServer.getCardsByHolder },
    getCardHolders: { impl: cardsServer.getCardHolders },
    getCardProducts: { impl: cardsServer.getCardProducts },
    getAllCardsWithProduct: { impl: cardsServer.getAllCardsWithProduct },
    getCardsBasicByHolders: { impl: cardsServer.getCardsBasicByHolders },
    getCardDetail: { impl: cardsServer.getCardDetail },
    createCard: { impl: cardsServer.createCard },
    updateCard: { impl: cardsServer.updateCard },
  },
  dashboard: {
    getDashboardStats: { impl: dashboardServer.getDashboardStats, admin: true },
    getUserActivity: { impl: dashboardServer.getUserActivity, admin: true },
    getCardProductStats: { impl: dashboardServer.getCardProductStats, admin: true },
    getPromoList: { impl: dashboardServer.getPromoList, admin: true },
    getBenefitStats: { impl: dashboardServer.getBenefitStats, admin: true },
  },
  emailBills: {
    syncEmailBillToAccount: { impl: emailBillsServer.syncEmailBillToAccount },
  },
  'gmail-ledger': {
    getGmailLedgerEntries: { impl: gmailLedgerServer.getGmailLedgerEntries },
    getGmailLedgerSummary: { impl: gmailLedgerServer.getGmailLedgerSummary },
    markPayment: { impl: gmailLedgerServer.markPayment },
    getGmailLedgerBanks: { impl: gmailLedgerServer.getGmailLedgerBanks },
  },
  holders: {
    getHolders: { impl: holdersServer.getHolders, bindUser: 0 },
    getHolder: { impl: holdersServer.getHolder },
    getHolderStatsPageData: { impl: holdersServer.getHolderStatsPageData },
    getHolderCardCounts: { impl: holdersServer.getHolderCardCounts },
    createHolder: { impl: holdersServer.createHolder, bindField: { arg: 0, field: 'created_by' } },
    mergeHolders: { impl: holdersServer.mergeHolders },
  },
  preferences: {
    getUserPreferences: { impl: preferencesServer.getUserPreferences, bindUser: 0 },
    updateUserPreferences: { impl: preferencesServer.updateUserPreferences, bindUser: 0 },
  },
  promos: {
    getPromosWithBanks: { impl: promosServer.getPromosWithBanks },
    createUserPromo: { impl: promosServer.createUserPromo },
  },
  push: {
    subscribePush: { impl: pushServer.subscribePush, bindUser: 1 },
  },
  reminders: {
    getDueBillsForReminders: { impl: remindersServer.getDueBillsForReminders, bindUser: 0 },
    getSentReminderKeys: { impl: remindersServer.getSentReminderKeys },
    recordBillReminder: { impl: remindersServer.recordBillReminder },
    getActiveLoanCards: { impl: remindersServer.getActiveLoanCards },
    hasLoanReminderLog: { impl: remindersServer.hasLoanReminderLog },
    recordLoanReminder: { impl: remindersServer.recordLoanReminder },
  },
  'sync-gmail': {
    syncGmailLedgerToCardsAndBills: { impl: syncGmailServer.syncGmailLedgerToCardsAndBills, bindUser: 0 },
  },
}
