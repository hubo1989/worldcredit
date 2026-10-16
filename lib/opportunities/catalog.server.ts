// lib/opportunities/catalog.server.ts — read-side helpers over definitions
// and rule versions. Publishing, candidates and legacy wrapping arrive with
// later tasks; accounts/cycles need: load a definition, load its versions and
// resolve WHICH version a nominal cycle window proves (tech spec §4.2).

import { getDb } from '../db/client'
import { validateRuleSnapshot } from './rules'
import { isValidCivilDate, isValidRfc3339Utc } from './dates'
import { OpportunityError, forbiddenOrNotFound, revisionConflict } from './errors'
import { resolveOpportunityScope } from './scope.server'
import type { OpportunityActor, RuleSnapshotV1 } from './types'

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

// ---------------------------------------------------------------------------
// Candidate preview (AI results never auto-enter the catalog)
// ---------------------------------------------------------------------------

export interface OpportunityCandidate {
  name: string
  description: string | null
  quota: number
  period: string
  reset_month: number | null
}

export interface CandidatePreview {
  review_required: true
  card_product_id: string | null
  candidates: OpportunityCandidate[]
}

/**
 * Runs the AI collection for one card product and returns CANDIDATES ONLY —
 * zero database writes. The admin publishes reviewed entries through
 * publishOpportunityVersion with a source (tech spec §10/§11 Shadow phase).
 */
export async function previewOpportunityCandidates(
  actor: OpportunityActor,
  input: { bank_name: string; card_name: string; card_product_id?: string | null },
): Promise<CandidatePreview> {
  if (actor.role !== 'admin') throw forbiddenOrNotFound('candidates')
  if (typeof input.bank_name !== 'string' || typeof input.card_name !== 'string') {
    throw new OpportunityError('VALIDATION_FAILED', '缺少银行或卡名', { field: 'bank_name' })
  }
  const { aiCollectCardBenefits } = await import('../api/ai.server')
  const collected = await aiCollectCardBenefits(input.bank_name, input.card_name)
  return {
    review_required: true,
    card_product_id: input.card_product_id ?? null,
    candidates: (collected ?? []).map((c) => ({
      name: c.name,
      description: c.description ?? null,
      quota: Math.max(0, Number(c.quota) || 0),
      period: c.period ?? 'yearly',
      reset_month: c.reset_month ?? null,
    })),
  }
}

// ---------------------------------------------------------------------------
// publishOpportunityVersion — reviewed versions only
// ---------------------------------------------------------------------------

export interface PublishVersionInput {
  /** Existing definition → next version; null → create a new definition. */
  definition_id?: string | null
  /** private_reward requires visibility='private' (enforced by the 0013 CHECK). */
  kind?: 'benefit' | 'promo' | 'private_reward' | null
  visibility?: 'shared' | 'private' | null
  private_holder_id?: string | null
  rules: RuleSnapshotV1
  effective_from: string
  verification: 'user_confirmed' | 'official_verified'
  source_url?: string | null
  source_excerpt?: string | null
  expected_revision?: number | null
  request_key: string
}

export interface PublishVersionResult {
  definition_id: string
  version_id: string
  version: number
  closed_previous_version_id: string | null
}

/**
 * Publishes a reviewed rule version. Rules of the write path:
 *   - official_verified requires a real http(s) source — a model without a
 *     provenance link can never be marked official (plan Task 13 step 1)
 *   - shared-catalog writes are admin-only; members may only publish PRIVATE
 *     definitions for holders inside their own scope（私人确认不写共享目录）
 *   - a new version closes the previous open one inside the SAME batch; the
 *     0013 immutability/overlap triggers reject conflicting writes wholesale
 */
export async function publishOpportunityVersion(
  actor: OpportunityActor,
  input: PublishVersionInput,
  opts: { now?: string } = {},
): Promise<PublishVersionResult> {
  const now = opts.now ?? new Date().toISOString()
  const db = getDb()

  if (input.verification !== 'user_confirmed' && input.verification !== 'official_verified') {
    throw new OpportunityError('VALIDATION_FAILED', 'verification 只能是 user_confirmed/official_verified', {
      field: 'verification',
    })
  }
  if (input.verification === 'official_verified') {
    const url = input.source_url ?? null
    if (typeof url !== 'string' || !/^https?:\/\//.test(url)) {
      throw new OpportunityError('VALIDATION_FAILED', 'official_verified 必须提供 http(s) 来源链接', {
        field: 'source_url',
      })
    }
  }
  const rules = validateRuleSnapshot(input.rules)
  if (!isValidCivilDate(input.effective_from)) {
    throw new OpportunityError('VALIDATION_FAILED', 'effective_from 不是合法日期', {
      field: 'effective_from',
    })
  }
  if (!isValidRfc3339Utc(now)) {
    throw new OpportunityError('VALIDATION_FAILED', 'now 不是合法 UTC 时间', { field: 'now' })
  }
  if (
    typeof input.request_key !== 'string' ||
    input.request_key.length < 16 ||
    input.request_key.length > 128
  ) {
    throw new OpportunityError('VALIDATION_FAILED', 'request_key 长度须为 16–128', {
      field: 'request_key',
    })
  }

  const statements: D1PreparedStatement[] = []
  let definitionId = input.definition_id ?? null
  let version = 1
  let closedPrevious: string | null = null
  const versionId = `orv_${crypto.randomUUID()}`

  if (definitionId === null) {
    // New definition: only admins shape the shared catalog; a member may
    // create private definitions for holders in their own scope.
    const kind = input.kind ?? 'benefit'
    const visibility = input.visibility ?? 'shared'
    if (visibility === 'shared' && actor.role !== 'admin') {
      throw forbiddenOrNotFound('definition')
    }
    let privateHolderId: string | null = null
    if (visibility === 'private') {
      privateHolderId = input.private_holder_id ?? null
      if (typeof privateHolderId !== 'string') {
        throw new OpportunityError('VALIDATION_FAILED', 'private 定义必须指定持卡人', {
          field: 'private_holder_id',
        })
      }
      const scope = await resolveOpportunityScope(actor)
      if (!scope.includes(privateHolderId)) throw forbiddenOrNotFound('holder')
    }
    definitionId = `odef_${crypto.randomUUID()}`
    statements.push(
      db
        .prepare(
          `INSERT INTO opportunity_definitions (id, kind, visibility, private_holder_id, status, created_by, created_at)
           VALUES (?,?,?,?,'active',?,?)`,
        )
        .bind(definitionId, kind, visibility, privateHolderId, actor.user_id, now),
    )
  } else {
    const def = await db
      .prepare('SELECT id, visibility, status, revision FROM opportunity_definitions WHERE id = ?')
      .bind(definitionId)
      .first<{ id: string; visibility: string; status: string; revision: number }>()
    if (!def) throw forbiddenOrNotFound('definition')
    if (def.visibility === 'shared' && actor.role !== 'admin') {
      throw forbiddenOrNotFound('definition')
    }
    if (def.status !== 'active') {
      throw new OpportunityError('INVALID_TRANSITION', '该定义已归档，不能发布新版本', {
        definition_id: definitionId,
      })
    }
    if (
      input.expected_revision !== undefined &&
      input.expected_revision !== null &&
      input.expected_revision !== def.revision
    ) {
      throw revisionConflict({ expected_revision: input.expected_revision, actual_revision: def.revision })
    }
    const { results: versions } = await db
      .prepare(
        `SELECT id, version, effective_from, effective_until_before FROM opportunity_rule_versions
         WHERE definition_id = ? ORDER BY version DESC LIMIT 1`,
      )
      .bind(definitionId)
      .all<{ id: string; version: number; effective_from: string; effective_until_before: string | null }>()
    const newest = versions[0]
    if (newest) {
      version = newest.version + 1
      if (newest.effective_until_before === null) {
        if (input.effective_from <= newest.effective_from) {
          throw new OpportunityError('VALIDATION_FAILED', '新版本生效日必须晚于当前版本的生效日', {
            field: 'effective_from',
          })
        }
        closedPrevious = newest.id
        // Close the open version; the 0013 guard trigger refuses this when any
        // existing cycle or a sibling version conflicts — whole batch aborts.
        statements.push(
          db
            .prepare(
              `UPDATE opportunity_rule_versions SET effective_until_before = ?
               WHERE id = ? AND effective_until_before IS NULL`,
            )
            .bind(input.effective_from, newest.id),
        )
      } else if (input.effective_from < newest.effective_until_before) {
        throw new OpportunityError('VALIDATION_FAILED', '新版本生效日与已关闭版本重叠', {
          field: 'effective_from',
        })
      }
    }
    statements.push(
      db.prepare('UPDATE opportunity_definitions SET revision = revision + 1 WHERE id = ?').bind(definitionId),
    )
  }

  statements.push(
    db
      .prepare(
        `INSERT INTO opportunity_rule_versions (id, definition_id, version, effective_from, rules_json, verification, source_url, source_excerpt, checked_at, checked_by, published_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        versionId, definitionId, version, input.effective_from, JSON.stringify(rules),
        input.verification, input.source_url ?? null, input.source_excerpt ?? null,
        now, actor.user_id, now,
      ),
  )

  try {
    await db.batch(statements)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('OPPORTUNITY_VERSION_OVERLAP')) {
      throw new OpportunityError('CONFLICT', '版本区间与既有版本重叠，请调整生效日', { definition_id: definitionId ?? undefined })
    }
    if (message.includes('OPPORTUNITY_VERSION_END_CONFLICT')) {
      throw new OpportunityError('CONFLICT', '关闭旧版本会与已生成周期冲突，请先处理未来周期', { definition_id: definitionId ?? undefined })
    }
    if (message.includes('CHECK constraint failed')) {
      throw new OpportunityError('VALIDATION_FAILED', '版本或定义数据不合法', { definition_id: definitionId ?? undefined })
    }
    throw err
  }

  return { definition_id: definitionId, version_id: versionId, version, closed_previous_version_id: closedPrevious }
}

// ---------------------------------------------------------------------------
// archiveOpportunityDefinition — logical archive, history intact
// ---------------------------------------------------------------------------

export async function archiveOpportunityDefinition(
  actor: OpportunityActor,
  input: { definition_id: string; reason: string; expected_revision: number },
): Promise<{ definition_id: string; revision: number }> {
  if (actor.role !== 'admin') throw forbiddenOrNotFound('definition')
  if (typeof input.reason !== 'string' || input.reason.trim().length === 0 || input.reason.length > 500) {
    throw new OpportunityError('VALIDATION_FAILED', '归档必须填写原因（1–500 字）', { field: 'reason' })
  }
  const db = getDb()
  const { results } = await db
    .prepare(
      `UPDATE opportunity_definitions
       SET status = 'archived', terminated_at = ?, termination_reason = ?, revision = revision + 1
       WHERE id = ? AND status = 'active' AND revision = ?
       RETURNING revision`,
    )
    .bind(new Date().toISOString(), input.reason.trim(), input.definition_id, input.expected_revision)
    .all<{ revision: number }>()
  if (results.length === 0) {
    const row = await db
      .prepare('SELECT revision, status FROM opportunity_definitions WHERE id = ?')
      .bind(input.definition_id)
      .first<{ revision: number; status: string }>()
    if (!row) throw forbiddenOrNotFound('definition')
    throw revisionConflict({ expected_revision: input.expected_revision, actual_revision: row.revision, status: row.status })
  }
  return { definition_id: input.definition_id, revision: results[0].revision }
}
