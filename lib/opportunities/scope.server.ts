// lib/opportunities/scope.server.ts — actor → holder universe and object-level
// authorization for the opportunity ledger. Scope rules (tech spec §2.2):
//   admin:  card_holders.created_by = actor OR managed_by = actor
//   member: card_holders.auth_user_id = actor
// Accounts, usages, cards and later tasks/fulfillments are all authorized
// through their holder association, in SQL, before any row is returned.
// “Not found” and “not yours” are the same error so private objects cannot
// be probed.

import { getDb } from '../db/client'
import type { OpportunityActor } from './types'
import { forbiddenOrNotFound, invalidId } from './errors'

/** All holder ids the actor may see. Empty array is a valid, load-bearing state. */
export async function resolveOpportunityScope(actor: OpportunityActor): Promise<string[]> {
  const db = getDb()
  const rows =
    actor.role === 'admin'
      ? await db
          .prepare('SELECT id FROM card_holders WHERE created_by = ? OR managed_by = ?')
          .bind(actor.user_id, actor.user_id)
          .all<{ id: string }>()
      : await db
          .prepare('SELECT id FROM card_holders WHERE auth_user_id = ?')
          .bind(actor.user_id)
          .all<{ id: string }>()
  return rows.results.map((r) => r.id)
}

function requireId(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) {
    throw invalidId(value, field)
  }
  return value
}

/** The holder-scope predicate for each role, parameterized on one bind. */
export function holderScopePredicate(actor: OpportunityActor): { sql: string; binds: unknown[] } {
  return actor.role === 'admin'
    ? { sql: '(h.created_by = ? OR h.managed_by = ?)', binds: [actor.user_id, actor.user_id] }
    : { sql: 'h.auth_user_id = ?', binds: [actor.user_id] }
}

async function findScopedHolder(
  sql: string,
  binds: unknown[],
): Promise<Record<string, unknown> | null> {
  const { results } = await getDb()
    .prepare(sql)
    .bind(...binds)
    .all<Record<string, unknown>>()
  return results[0] ?? null
}

export interface ScopedAccount {
  id: string
  definition_id: string
  holder_id: string
  scope_kind: 'card' | 'holder'
  scope_key: string
}

/** Loads the account only when its holder is in the actor's scope. */
export async function assertAccountAccess(
  accountId: unknown,
  actor: OpportunityActor,
): Promise<ScopedAccount> {
  const id = requireId(accountId, 'account_id')
  const scope = holderScopePredicate(actor)
  const row = await findScopedHolder(
    `SELECT a.id, a.definition_id, a.holder_id, a.scope_kind, a.scope_key
     FROM opportunity_accounts a
     JOIN card_holders h ON h.id = a.holder_id
     WHERE a.id = ? AND ${scope.sql}
     LIMIT 1`,
    [id, ...scope.binds],
  )
  if (!row) throw forbiddenOrNotFound('account')
  return row as unknown as ScopedAccount
}

export interface ScopedCard {
  id: string
  holder_id: string
}

/** Loads the card only when its holder is in the actor's scope. */
export async function assertCardAccess(
  cardId: unknown,
  actor: OpportunityActor,
): Promise<ScopedCard> {
  const id = requireId(cardId, 'card_id')
  const scope = holderScopePredicate(actor)
  const row = await findScopedHolder(
    `SELECT c.id, c.holder_id
     FROM credit_cards c
     JOIN card_holders h ON h.id = c.holder_id
     WHERE c.id = ? AND ${scope.sql}
     LIMIT 1`,
    [id, ...scope.binds],
  )
  if (!row) throw forbiddenOrNotFound('card')
  return row as unknown as ScopedCard
}

export interface ScopedUsage {
  id: string
  account_id: string
  cycle_id: string
  card_id: string
  status: 'active' | 'voided'
}

/** Loads the usage via its account's holder scope. */
export async function assertUsageAccess(
  usageId: unknown,
  actor: OpportunityActor,
): Promise<ScopedUsage> {
  const id = requireId(usageId, 'usage_id')
  const scope = holderScopePredicate(actor)
  const row = await findScopedHolder(
    `SELECT u.id, u.account_id, u.cycle_id, u.card_id, u.status
     FROM opportunity_usages u
     JOIN opportunity_accounts a ON a.id = u.account_id
     JOIN card_holders h ON h.id = a.holder_id
     WHERE u.id = ? AND ${scope.sql}
     LIMIT 1`,
    [id, ...scope.binds],
  )
  if (!row) throw forbiddenOrNotFound('usage')
  return row as unknown as ScopedUsage
}
