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
  getOpportunityPage,
  getBenefitLedger,
  getCardOpportunities,
  getOpportunityDetail,
  setOpportunityFollowed,
  getTodayAvailableCount,
} from '../opportunities/queries.server'
