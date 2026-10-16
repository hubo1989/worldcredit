// lib/opportunities/tasks.ts — manual spend task rules (tech spec §8.1):
// TaskConditionsV1 validation, evaluateTask (max(0, target − progress), OR
// across groups, AND within a group — no LLM, never inferring counts from
// amounts) and reward-window date math (month-end clamped, half-open).

import { OpportunityError } from './errors'
import { addMonthsClamped, isValidCivilDate } from './dates'

export interface TaskConditionsV1 {
  schema_version: 1
  currency: string
  groups: Array<{
    id: string
    metrics: Array<
      | { id: string; kind: 'amount'; target_minor: number }
      | { id: string; kind: 'count'; target_count: number; per_txn_min_minor: number | null }
      | { id: string; kind: 'check'; label: string }
    >
  }>
  eligible_spend_notes: string | null
}

export interface ManualProgress {
  as_of_on: string
  metric_values: Record<string, number | boolean>
  note: string | null
}

const MAX_GROUPS = 3
const MAX_METRICS_PER_GROUP = 3
const MAX_CARD_IDS = 20

function fail(field: string, message: string): never {
  throw new OpportunityError('VALIDATION_FAILED', message, { field })
}

/** Full structural validation of TaskConditionsV1 (spec §8.1 bounds). */
export function validateTaskConditions(input: unknown): TaskConditionsV1 {
  if (typeof input !== 'object' || input === null) fail('rules', '任务条件必须是对象')
  const raw = input as Record<string, unknown>
  if (raw.schema_version !== 1) fail('rules.schema_version', 'schema_version 必须是 1')
  if (typeof raw.currency !== 'string' || !/^[A-Z]{3}$/.test(raw.currency)) {
    fail('rules.currency', 'currency 必须是三字母代码')
  }
  if (!Array.isArray(raw.groups) || raw.groups.length === 0) fail('rules.groups', '至少一组条件')
  if (raw.groups.length > MAX_GROUPS) fail('rules.groups', `最多 ${MAX_GROUPS} 组（OR）`)

  const metricIds = new Set<string>()
  const groups = raw.groups.map((group: unknown, gi: number) => {
    if (typeof group !== 'object' || group === null) fail(`rules.groups.${gi}`, '组必须是对象')
    const g = group as Record<string, unknown>
    if (typeof g.id !== 'string' || g.id.length === 0) fail(`rules.groups.${gi}.id`, '组缺少 id')
    if (!Array.isArray(g.metrics) || g.metrics.length === 0) fail(`rules.groups.${gi}.metrics`, '组内至少一个指标')
    if (g.metrics.length > MAX_METRICS_PER_GROUP) {
      fail(`rules.groups.${gi}.metrics`, `每组最多 ${MAX_METRICS_PER_GROUP} 个指标`)
    }
    const metrics = g.metrics.map((metric: unknown, mi: number) => {
      if (typeof metric !== 'object' || metric === null) fail(`rules.groups.${gi}.metrics.${mi}`, '指标必须是对象')
      const m = metric as Record<string, unknown>
      if (typeof m.id !== 'string' || m.id.length === 0) fail(`rules.groups.${gi}.metrics.${mi}.id`, '指标缺少 id')
      if (metricIds.has(m.id)) fail(`rules.groups.${gi}.metrics.${mi}.id`, `指标 id 重复: ${String(m.id)}`)
      metricIds.add(m.id)
      if (m.kind === 'amount') {
        if (!Number.isInteger(m.target_minor) || (m.target_minor as number) < 0) {
          fail(`rules.groups.${gi}.metrics.${mi}.target_minor`, '金额目标必须是非负整数（最小货币单位）')
        }
        return { id: m.id as string, kind: 'amount' as const, target_minor: m.target_minor as number }
      }
      if (m.kind === 'count') {
        if (!Number.isInteger(m.target_count) || (m.target_count as number) < 0) {
          fail(`rules.groups.${gi}.metrics.${mi}.target_count`, '笔数目标必须是非负整数')
        }
        if (
          m.per_txn_min_minor !== null &&
          m.per_txn_min_minor !== undefined &&
          (!Number.isInteger(m.per_txn_min_minor) || (m.per_txn_min_minor as number) < 0)
        ) {
          fail(`rules.groups.${gi}.metrics.${mi}.per_txn_min_minor`, '单笔门槛必须是非负整数或 null')
        }
        return {
          id: m.id as string,
          kind: 'count' as const,
          target_count: m.target_count as number,
          per_txn_min_minor: (m.per_txn_min_minor ?? null) as number | null,
        }
      }
      if (m.kind === 'check') {
        if (typeof m.label !== 'string' || m.label.length === 0 || m.label.length > 40) {
          fail(`rules.groups.${gi}.metrics.${mi}.label`, '确认项 label 必须是 1–40 字')
        }
        return { id: m.id as string, kind: 'check' as const, label: m.label }
      }
      fail(`rules.groups.${gi}.metrics.${mi}.kind`, 'kind 必须是 amount/count/check')
    })
    return { id: g.id as string, metrics }
  })

  if (
    raw.eligible_spend_notes !== null &&
    raw.eligible_spend_notes !== undefined &&
    typeof raw.eligible_spend_notes !== 'string'
  ) {
    fail('rules.eligible_spend_notes', '说明必须是字符串或 null')
  }
  return {
    schema_version: 1,
    currency: raw.currency,
    groups,
    eligible_spend_notes: (raw.eligible_spend_notes ?? null) as string | null,
  }
}

/** Bounded explicit card-id set (spec §8.1: ≤20, membership re-checked in SQL). */
export function validateCardIdSet(input: unknown): string[] {
  if (!Array.isArray(input) || input.length === 0) fail('card_ids', '关联卡不能为空')
  if (input.length > MAX_CARD_IDS) fail('card_ids', `最多 ${MAX_CARD_IDS} 张卡`)
  const ids = input.map((id) => {
    if (typeof id !== 'string' || id.length === 0 || id.length > 64) fail('card_ids', '卡 ID 不合法')
    return id
  })
  return [...new Set(ids)]
}

export interface EvaluatedMetric {
  id: string
  kind: 'amount' | 'count' | 'check'
  satisfied: boolean
  /** max(0, target − progress) for numeric metrics; null for checks. */
  gap: number | null
}

export interface EvaluatedGroup {
  id: string
  satisfied: boolean
  metrics: EvaluatedMetric[]
  gaps: Record<string, number>
}

export interface TaskEvaluation {
  satisfied: boolean
  groups: EvaluatedGroup[]
}

/**
 * Evaluates manual progress against the conditions: each numeric metric's gap
 * is max(0, target − progress); a group is satisfied when ALL its metrics are
 * (AND), the task when ANY group is (OR). Booleans satisfy checks directly.
 */
export function evaluateTask(rules: TaskConditionsV1, progress: ManualProgress): TaskEvaluation {
  if (!isValidCivilDate(progress.as_of_on)) {
    fail('progress.as_of_on', '统计截至日期不合法')
  }
  const values = progress.metric_values ?? {}
  const groups: EvaluatedGroup[] = rules.groups.map((group) => {
    const metrics: EvaluatedMetric[] = group.metrics.map((metric) => {
      const value = values[metric.id]
      if (metric.kind === 'check') {
        return { id: metric.id, kind: metric.kind, satisfied: value === true, gap: null }
      }
      // A fresh cycle has no entries: missing numeric metrics read as 0
      // progress; explicit values must be finite non-negative numbers.
      if (value === undefined) {
        const target = metric.kind === 'amount' ? metric.target_minor : metric.target_count
        return { id: metric.id, kind: metric.kind, satisfied: target === 0, gap: target }
      }
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        fail(`progress.metric_values.${metric.id}`, '进度值必须是非负数值')
      }
      const target =
        metric.kind === 'amount' ? metric.target_minor : metric.target_count
      const gap = Math.max(0, target - value)
      return { id: metric.id, kind: metric.kind, satisfied: gap === 0, gap }
    })
    const gaps: Record<string, number> = {}
    for (const metric of metrics) {
      if (metric.gap !== null) gaps[metric.id] = metric.gap
    }
    return { id: group.id, satisfied: metrics.every((m) => m.satisfied), metrics, gaps }
  })
  return { satisfied: groups.some((g) => g.satisfied), groups }
}

/**
 * Reward window (spec §8.1): X–Y 日 of the month the period ends in
 * (period_end_before is the first day after the period, so an October period
 * ending 11-01 pays in November). X ≤ Y; both clamp to month-end; the window
 * is half-open [X, dayAfter(Y)) — “含开始、不含结束” everywhere.
 */
export function rewardWindow(
  periodEndBefore: string,
  fromDay: number,
  untilDay: number | null,
): { expected_from_on: string; expected_until_before: string | null } {
  if (!isValidCivilDate(periodEndBefore)) fail('period_end_before', '周期结束日期不合法')
  for (const day of [fromDay, untilDay]) {
    if (day !== null && (!Number.isInteger(day) || day < 1 || day > 31)) {
      fail('reward_window', '发放窗口日必须是 1–31')
    }
  }
  if (untilDay !== null && untilDay < fromDay) fail('reward_window', '窗口结束日不能早于开始日')

  const [y, m] = periodEndBefore.split('-').map(Number)
  const monthLen = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const from = `${periodEndBefore.slice(0, 8)}${String(Math.min(fromDay, monthLen)).padStart(2, '0')}`
  if (untilDay === null) return { expected_from_on: from, expected_until_before: null }

  const clampedUntil = Math.min(untilDay, monthLen)
  const untilDate = new Date(Date.UTC(y, m - 1, clampedUntil + 1)) // exclusive end
  const untilBefore = `${untilDate.getUTCFullYear()}-${String(untilDate.getUTCMonth() + 1).padStart(2, '0')}-${String(untilDate.getUTCDate()).padStart(2, '0')}`
  return { expected_from_on: from, expected_until_before: untilBefore }
}

/** Parses a stored task-cycles rules/reward snapshot (validated on read). */
export function parseTaskConditions(json: string): TaskConditionsV1 {
  return validateTaskConditions(JSON.parse(json))
}
