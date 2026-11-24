import { callRpc } from '@/lib/api/rpc-client'
import type { CreditCardWithProduct } from '@/lib/api/cards'
import type { CardProduct } from '@/lib/types'
import type {
  CardAnnualFeeRoiDetail,
  CardCycleSpendEstimate,
  CardProductStructuredRulesDraft,
  ExtendedCardProductPatch,
  ExtendedPromoUsage,
  ExtendedUpdateCardPatch,
  FamilyAnnualFeeRoiBoard,
  PurchaseRecommendationInput,
  RecommendationEngineOutput,
} from './types'

// 客户端 RPC 轻量适配器：契约严格对齐 HUB-175 第 5 节，在 HUB-177 合入前不改动 lib/api/** 与 lib/types.ts。
type RpcFn<Args extends unknown[], Result> = (...args: Args) => Promise<Result>

export function getCardRecommendations(input: PurchaseRecommendationInput) {
  return callRpc<RpcFn<[PurchaseRecommendationInput], RecommendationEngineOutput>>(
    'recommendations',
    'getCardRecommendations',
    input
  )
}

export function getCardAnnualFeeRoi(
  cardId: string,
  opts?: { period_mode?: 'current_cycle' | 'last_12m' | 'year'; year?: number }
) {
  return callRpc<
    RpcFn<
      [string, { period_mode?: 'current_cycle' | 'last_12m' | 'year'; year?: number }?],
      CardAnnualFeeRoiDetail
    >
  >('recommendations', 'getCardAnnualFeeRoi', cardId, opts)
}

export function getFamilyAnnualFeeRoi(filters?: {
  holder_id?: string | null
  period_mode?: 'last_12m' | 'current_cycle' | 'year'
  year?: number
  display_currency?: string
}) {
  return callRpc<
    RpcFn<
      [
        {
          holder_id?: string | null
          period_mode?: 'last_12m' | 'current_cycle' | 'year'
          year?: number
          display_currency?: string
        }?,
      ],
      FamilyAnnualFeeRoiBoard
    >
  >('recommendations', 'getFamilyAnnualFeeRoi', filters)
}

export function getCardCycleSpendEstimate(cardId: string) {
  return callRpc<RpcFn<[string], CardCycleSpendEstimate>>(
    'recommendations',
    'getCardCycleSpendEstimate',
    cardId
  )
}

export function updateOpportunityValuation(input: {
  target_kind: 'account' | 'definition'
  target_id: string
  estimated_unit_value_minor: number | null
  estimated_value_currency: string | null
}) {
  return callRpc<
    RpcFn<
      [
        {
          target_kind: 'account' | 'definition'
          target_id: string
          estimated_unit_value_minor: number | null
          estimated_value_currency: string | null
        },
      ],
      { ok: true; revision: number }
    >
  >('recommendations', 'updateOpportunityValuation', input)
}

export function upsertPromoUsageCashback(input: {
  promo_id: string
  card_id: string
  used_at: string
  cashback_amount: number
  cashback_currency?: string
  note?: string | null
  usage_id?: string
}) {
  return callRpc<
    RpcFn<
      [
        {
          promo_id: string
          card_id: string
          used_at: string
          cashback_amount: number
          cashback_currency?: string
          note?: string | null
          usage_id?: string
        },
      ],
      ExtendedPromoUsage
    >
  >('recommendations', 'upsertPromoUsageCashback', input)
}

export function updateCardAnnualFeeFields(cardId: string, patch: ExtendedUpdateCardPatch) {
  return callRpc<RpcFn<[string, ExtendedUpdateCardPatch], CreditCardWithProduct>>(
    'cards',
    'updateCard',
    cardId,
    patch
  )
}

export function createAdminCardProductWithRules(data: ExtendedCardProductPatch) {
  return callRpc<RpcFn<[ExtendedCardProductPatch], CardProduct>>(
    'admin',
    'createCardProduct',
    data
  )
}

export function updateAdminCardProductWithRules(id: string, data: ExtendedCardProductPatch) {
  return callRpc<RpcFn<[string, ExtendedCardProductPatch], CardProduct>>(
    'admin',
    'updateCardProduct',
    id,
    data
  )
}

export function previewCardProductRules(input: {
  bank_name: string
  card_name: string
  country?: string
  currency?: string
  rewards_summary?: string
  annual_fee_waiver?: string
}) {
  return callRpc<
    RpcFn<
      [
        {
          bank_name: string
          card_name: string
          country?: string
          currency?: string
          rewards_summary?: string
          annual_fee_waiver?: string
        },
      ],
      CardProductStructuredRulesDraft
    >
  >('admin', 'previewCardProductRules', input)
}
