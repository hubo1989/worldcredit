// lib/opportunities/types.ts — client-safe enums, actor identity and shared
// value types for the opportunity ledger. Row types live in lib/db/types.ts;
// amounts are always integer minor units (never REAL) per the tech spec.

/** Server-derived caller identity. Never accepted from client payloads. */
export interface OpportunityActor {
  user_id: string
  role: 'admin' | 'member'
}

/**
 * Strips the server-prepended actor from a server impl's signature so client
 * wrappers type only the user-supplied arguments (tech spec §2.1).
 */
export type PublicScopedRpc<F> = F extends (actor: OpportunityActor, ...args: infer A) => infer R
  ? (...args: A) => R
  : never

export type OpportunityDefinitionKind = 'benefit' | 'promo' | 'private_reward'
export type OpportunityVisibility = 'shared' | 'private'
export type OpportunityDefinitionStatus = 'active' | 'archived'

export type OpportunityRuleVerification = 'unverified' | 'user_confirmed' | 'official_verified'

export type OpportunityAccountScopeKind = 'card' | 'holder'
export type OpportunityAccountEligibility = 'unknown' | 'confirmed' | 'ineligible'
export type OpportunityAccountStatus = 'active' | 'archived'

export type OpportunityCycleAllocation = 'regular' | 'grant'
export type OpportunityCycleActivationState = 'active' | 'pending_claim' | 'voided'

export type OpportunityUsageStatus = 'active' | 'voided'

export type OpportunityEventEntityKind = 'account' | 'usage' | 'cycle' | 'task' | 'fulfillment' | 'legacy'

/** The six quota dimensions carried by every ledger event. */
export interface OpportunityEventDeltas {
  delta_opening_count: number
  delta_opening_minor: number
  delta_used_count: number
  delta_used_minor: number
  delta_reserved_count: number
  delta_reserved_minor: number
}

export const ZERO_EVENT_DELTAS: OpportunityEventDeltas = {
  delta_opening_count: 0,
  delta_opening_minor: 0,
  delta_used_count: 0,
  delta_used_minor: 0,
  delta_reserved_count: 0,
  delta_reserved_minor: 0,
}

// ---------------------------------------------------------------------------
// Rule snapshots and cycle windows (tech spec §4). All dates are civil dates
// (YYYY-MM-DD); *_at fields are RFC3339 UTC strings.
// ---------------------------------------------------------------------------

export type RuleCycleKind = 'daily' | 'weekly' | 'monthly' | 'annual' | 'anniversary' | 'one_time'
export type RuleAllocation = 'recurring' | 'claim_gated' | 'grant_only'
export type RuleCategory =
  | 'food'
  | 'shopping'
  | 'transport'
  | 'travel'
  | 'health'
  | 'membership'
  | 'other'

export interface RuleSnapshotV1 {
  schema_version: 1
  title: string
  description: string | null
  category: RuleCategory
  time_zone: string
  bank_id: string | null
  card_product_ids: string[]
  valid_from: string | null
  valid_until_before: string | null
  open_ended: boolean
  /** ISO weekdays: 1=Mon … 7=Sun. null = no restriction. */
  weekdays: number[] | null
  cycle: {
    kind: RuleCycleKind
    anchor_month: number | null
    anchor_day: number | null
    anchor_source: 'issued_on' | 'activated_on' | null
  }
  allocation: RuleAllocation
  count_limit: number | null
  amount_limit_minor: number | null
  currency: string | null
  unit_label: string
  eligibility_text: string | null
  requires_personal_confirmation: boolean
  claim_window: { starts_at: string | null; ends_at: string | null } | null
  booking_window: { opens_at: string | null; closes_at: string | null } | null
  workflow_time_basis: 'fixed' | 'per_cycle'
  booking_consumes: 'reserve_then_use'
  cancellation_rule: 'confirm_with_issuer'
  entry: { website_url: string | null; app_name: string | null; app_path: string | null }
}

/** Nominal civil-date window of one quota cycle. Half-open [start, end_before). */
export interface CycleWindow {
  cycle_key: string
  period_start_on: string
  period_end_before: string | null
  usable_start_on: string
  usable_end_before: string | null
  next_reset_on: string | null
  time_zone: string
}

/** Card dates that anchor anniversary cycles; null when unknown. */
export interface CycleAnchor {
  issued_on: string | null
  activated_on: string | null
}

// P2 manual-task value types (implementations in ./tasks.ts, §8.1)
export type { TaskConditionsV1, ManualProgress } from './tasks'
