// lib/api/opportunities.server.ts — RPC facade for the opportunity ledger.
// Thin by contract: the route prepends the session-derived OpportunityActor
// (registry flag prependActor) and every impl re-authorizes objects through
// lib/opportunities/*.server.ts; this module only aggregates the RPC surface.

export {
  createOpportunityAccount,
  confirmOpportunityEligibility,
  confirmOpeningBalance,
  updateOpportunityCycleWorkflow,
} from '../opportunities/accounts.server'
export {
  recordOpportunityUsage,
  correctOpportunityUsage,
  voidOpportunityUsage,
  getUsageHistory,
} from '../opportunities/usages.server'
export {
  getUnassignedLegacyUsages,
  assignLegacyUsage,
} from '../opportunities/legacy.server'
export {
  previewOpportunityCandidates,
  publishOpportunityVersion,
  archiveOpportunityDefinition,
} from '../opportunities/catalog.server'
export {
  getOpportunityPage,
  getBenefitLedger,
  getCardOpportunities,
  getOpportunityDetail,
  setOpportunityFollowed,
  getTodayAvailableCount,
} from '../opportunities/queries.server'
export { exportOpportunityUsages } from '../opportunities/queries.server'
export {
  getBenefitUsagesByHolder as getLegacyBenefitUsages,
} from './benefitUsages'
export {
  getPromoUsagesByHolder as getLegacyPromoUsages,
} from './promoUsages'
export {
  getOpportunityCalendar,
  getOpportunityReminders,
  updateOpportunityReminderState,
} from '../opportunities/notifications.server'
export {
  saveOpportunityTask,
  updateManualTaskProgress,
  getOpportunityTasks,
} from '../opportunities/tasks.server'
export {
  recordOpportunityClaim,
  recordTaskRewardReceived,
  voidOpportunityClaim,
} from '../opportunities/fulfillments.server'
