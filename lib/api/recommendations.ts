// lib/api/recommendations.ts — client-side RPC wrappers（server: recommendations.server.ts）。
// 浏览器永远只走这些命名 RPC，绝不拼 SQL、不传表名。

import type * as Server from './recommendations.server'
import { callRpc } from './rpc-client'

export function getCardRecommendations(
  ...args: Parameters<typeof Server.getCardRecommendations>
) {
  return callRpc<typeof Server.getCardRecommendations>(
    'recommendations',
    'getCardRecommendations',
    ...args
  )
}

export function getCardAnnualFeeRoi(
  ...args: Parameters<typeof Server.getCardAnnualFeeRoi>
) {
  return callRpc<typeof Server.getCardAnnualFeeRoi>(
    'recommendations',
    'getCardAnnualFeeRoi',
    ...args
  )
}

export function getFamilyAnnualFeeRoi(
  ...args: Parameters<typeof Server.getFamilyAnnualFeeRoi>
) {
  return callRpc<typeof Server.getFamilyAnnualFeeRoi>(
    'recommendations',
    'getFamilyAnnualFeeRoi',
    ...args
  )
}

export function getCardCycleSpendEstimate(
  ...args: Parameters<typeof Server.getCardCycleSpendEstimate>
) {
  return callRpc<typeof Server.getCardCycleSpendEstimate>(
    'recommendations',
    'getCardCycleSpendEstimate',
    ...args
  )
}

export function updateOpportunityValuation(
  ...args: Parameters<typeof Server.updateOpportunityValuation>
) {
  return callRpc<typeof Server.updateOpportunityValuation>(
    'recommendations',
    'updateOpportunityValuation',
    ...args
  )
}

export function upsertPromoUsageCashback(
  ...args: Parameters<typeof Server.upsertPromoUsageCashback>
) {
  return callRpc<typeof Server.upsertPromoUsageCashback>(
    'recommendations',
    'upsertPromoUsageCashback',
    ...args
  )
}
