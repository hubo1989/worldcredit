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
