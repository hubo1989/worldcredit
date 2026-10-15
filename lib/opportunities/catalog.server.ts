// lib/opportunities/catalog.server.ts — read-side helpers over definitions
// and rule versions. Publishing, candidates and legacy wrapping arrive with
// later tasks; accounts/cycles need: load a definition, load its versions and
// resolve WHICH version a nominal cycle window proves (tech spec §4.2).

import { getDb } from '../db/client'
import { validateRuleSnapshot } from './rules'
import type { RuleSnapshotV1 } from './types'

export interface DefinitionRow {
  id: string
  kind: 'benefit' | 'promo' | 'private_reward'
  visibility: 'shared' | 'private'
  private_holder_id: string | null
  status: 'active' | 'archived'
  terminated_at: string | null
}

export interface RuleVersionRow {
  id: string
  definition_id: string
  version: number
  effective_from: string
  rules_json: string
}

export async function getDefinition(definitionId: string): Promise<DefinitionRow | null> {
  return (
    await getDb()
      .prepare(
        `SELECT id, kind, visibility, private_holder_id, status, terminated_at
         FROM opportunity_definitions WHERE id = ?`,
      )
      .bind(definitionId)
      .first<DefinitionRow>()
  )
}

/** All published versions of a definition, effective_from ascending. */
export async function listRuleVersions(definitionId: string): Promise<RuleVersionRow[]> {
  const { results } = await getDb()
    .prepare(
      `SELECT id, definition_id, version, effective_from, rules_json
       FROM opportunity_rule_versions WHERE definition_id = ?
       ORDER BY effective_from ASC, version ASC`,
    )
    .bind(definitionId)
    .all<RuleVersionRow>()
  return results
}

/** Parses + validates one stored rules_json snapshot. */
export function parseRules(rulesJson: string): RuleSnapshotV1 {
  return validateRuleSnapshot(JSON.parse(rulesJson))
}

export interface CycleVersionResolution {
  version_id: string
  rules: RuleSnapshotV1
  /**
   * The date the cycle may trust this version from: the nominal start when a
   * version already covers it, else the earliest version effective inside the
   * window (mid-cycle first materialization, §4.2).
   */
  version_as_of_on: string
}

/**
 * Picks the rule version a nominal cycle window can prove:
 *   1. the latest version already effective at period_start_on, else
 *   2. the earliest version effective INSIDE the window (mid-cycle first
 *      materialization; usable_start is clipped later by the account service)
 *   3. null when nothing covers the window.
 * Never re-picks a newer version when an older one covers the nominal start.
 */
export function pickCycleVersion(
  versions: ReadonlyArray<Pick<RuleVersionRow, 'id' | 'effective_from' | 'rules_json'>>,
  period_start_on: string,
  period_end_before: string | null,
): CycleVersionResolution | null {
  const covering = versions.filter((v) => v.effective_from <= period_start_on)
  const chosen =
    covering.length > 0
      ? covering[covering.length - 1]
      : versions.find(
          (v) => v.effective_from > period_start_on && (period_end_before === null || v.effective_from < period_end_before),
        )
  if (!chosen) return null
  return {
    version_id: chosen.id,
    rules: parseRules(chosen.rules_json),
    version_as_of_on: covering.length > 0 ? period_start_on : chosen.effective_from,
  }
}

/** The newest published version regardless of dates (card-product checks). */
export function newestRuleVersion(versions: readonly RuleVersionRow[]): RuleVersionRow | null {
  return versions.length ? versions[versions.length - 1] : null
}
