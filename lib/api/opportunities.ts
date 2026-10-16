// lib/api/opportunities.ts — client-side RPC wrappers for the opportunity
// ledger. Components import these typed helpers (never raw fetch/SQL); the
// session actor is injected server-side, so client args start at position 0
// of the public signature (PublicScopedRpc strips the actor).

import { callRpc } from './rpc-client'
import type { PublicScopedRpc } from '../opportunities/types'
import type * as Server from './opportunities.server'

type Public<F> = PublicScopedRpc<F>

export function createOpportunityAccount(
  input: Parameters<Public<typeof Server.createOpportunityAccount>>[0],
) {
  return callRpc<Public<typeof Server.createOpportunityAccount>>(
    'opportunities',
    'createOpportunityAccount',
    input,
  )
}

export function confirmOpportunityEligibility(
  input: Parameters<Public<typeof Server.confirmOpportunityEligibility>>[0],
) {
  return callRpc<Public<typeof Server.confirmOpportunityEligibility>>(
    'opportunities',
    'confirmOpportunityEligibility',
    input,
  )
}

export function confirmOpeningBalance(
  input: Parameters<Public<typeof Server.confirmOpeningBalance>>[0],
) {
  return callRpc<Public<typeof Server.confirmOpeningBalance>>(
    'opportunities',
    'confirmOpeningBalance',
    input,
  )
}

export function updateOpportunityCycleWorkflow(
  input: Parameters<Public<typeof Server.updateOpportunityCycleWorkflow>>[0],
) {
  return callRpc<Public<typeof Server.updateOpportunityCycleWorkflow>>(
    'opportunities',
    'updateOpportunityCycleWorkflow',
    input,
  )
}

export function recordOpportunityUsage(
  input: Parameters<Public<typeof Server.recordOpportunityUsage>>[0],
) {
  return callRpc<Public<typeof Server.recordOpportunityUsage>>(
    'opportunities',
    'recordOpportunityUsage',
    input,
  )
}

export function correctOpportunityUsage(
  input: Parameters<Public<typeof Server.correctOpportunityUsage>>[0],
) {
  return callRpc<Public<typeof Server.correctOpportunityUsage>>(
    'opportunities',
    'correctOpportunityUsage',
    input,
  )
}

export function voidOpportunityUsage(
  input: Parameters<Public<typeof Server.voidOpportunityUsage>>[0],
) {
  return callRpc<Public<typeof Server.voidOpportunityUsage>>(
    'opportunities',
    'voidOpportunityUsage',
    input,
  )
}

export function getUsageHistory(input: Parameters<Public<typeof Server.getUsageHistory>>[0]) {
  return callRpc<Public<typeof Server.getUsageHistory>>(
    'opportunities',
    'getUsageHistory',
    input,
  )
}

export function getUnassignedLegacyUsages(
  input: Parameters<Public<typeof Server.getUnassignedLegacyUsages>>[0],
) {
  return callRpc<Public<typeof Server.getUnassignedLegacyUsages>>(
    'opportunities',
    'getUnassignedLegacyUsages',
    input,
  )
}

export function assignLegacyUsage(
  input: Parameters<Public<typeof Server.assignLegacyUsage>>[0],
) {
  return callRpc<Public<typeof Server.assignLegacyUsage>>(
    'opportunities',
    'assignLegacyUsage',
    input,
  )
}

export function getOpportunityPage(
  input: Parameters<Public<typeof Server.getOpportunityPage>>[0],
) {
  return callRpc<Public<typeof Server.getOpportunityPage>>(
    'opportunities',
    'getOpportunityPage',
    input,
  )
}

export function getBenefitLedger(
  input: Parameters<Public<typeof Server.getBenefitLedger>>[0],
) {
  return callRpc<Public<typeof Server.getBenefitLedger>>(
    'opportunities',
    'getBenefitLedger',
    input,
  )
}

export function getCardOpportunities(
  ...args: Parameters<Public<typeof Server.getCardOpportunities>>
) {
  return callRpc<Public<typeof Server.getCardOpportunities>>(
    'opportunities',
    'getCardOpportunities',
    ...args,
  )
}

export function getOpportunityDetail(
  input: Parameters<Public<typeof Server.getOpportunityDetail>>[0],
) {
  return callRpc<Public<typeof Server.getOpportunityDetail>>(
    'opportunities',
    'getOpportunityDetail',
    input,
  )
}

export function setOpportunityFollowed(
  input: Parameters<Public<typeof Server.setOpportunityFollowed>>[0],
) {
  return callRpc<Public<typeof Server.setOpportunityFollowed>>(
    'opportunities',
    'setOpportunityFollowed',
    input,
  )
}

export function previewOpportunityCandidates(
  input: Parameters<Public<typeof Server.previewOpportunityCandidates>>[0],
) {
  return callRpc<Public<typeof Server.previewOpportunityCandidates>>(
    'opportunities',
    'previewOpportunityCandidates',
    input,
  )
}

export function publishOpportunityVersion(
  input: Parameters<Public<typeof Server.publishOpportunityVersion>>[0],
) {
  return callRpc<Public<typeof Server.publishOpportunityVersion>>(
    'opportunities',
    'publishOpportunityVersion',
    input,
  )
}

export function archiveOpportunityDefinition(
  input: Parameters<Public<typeof Server.archiveOpportunityDefinition>>[0],
) {
  return callRpc<Public<typeof Server.archiveOpportunityDefinition>>(
    'opportunities',
    'archiveOpportunityDefinition',
    input,
  )
}

export function exportOpportunityUsages(
  input: Parameters<Public<typeof Server.exportOpportunityUsages>>[0],
) {
  return callRpc<Public<typeof Server.exportOpportunityUsages>>(
    'opportunities',
    'exportOpportunityUsages',
    input,
  )
}

export function getLegacyBenefitUsages(
  ...args: Parameters<Public<typeof Server.getLegacyBenefitUsages>>
) {
  return callRpc<Public<typeof Server.getLegacyBenefitUsages>>(
    'opportunities',
    'getLegacyBenefitUsages',
    ...args,
  )
}

export function getLegacyPromoUsages(
  ...args: Parameters<Public<typeof Server.getLegacyPromoUsages>>
) {
  return callRpc<Public<typeof Server.getLegacyPromoUsages>>(
    'opportunities',
    'getLegacyPromoUsages',
    ...args,
  )
}
