// lib/opportunities/errors.ts — structured, machine-readable failures for the
// opportunity ledger. The wire shape is { code, details, request_id }; the
// Error message stays human-readable so legacy `catch (e) { e.message }` sites
// keep working unchanged.

export type OpportunityErrorCode =
  | 'VALIDATION_FAILED'
  | 'FORBIDDEN_OR_NOT_FOUND'
  | 'CONFLICT'
  | 'AMBIGUOUS_ACCOUNT'
  // Unmet precondition on the object's current state (HTTP 422, §9.1)
  | 'NEEDS_CONFIRMATION'
  | 'INVALID_TRANSITION'
  // Write-path codes (tech spec §7.1 / §9.1)
  | 'REVISION_CONFLICT'
  | 'IDEMPOTENCY_CONFLICT'
  | 'QUOTA_EXCEEDED'
  | 'DATABASE_UNAVAILABLE'

/** HTTP status for each structured code on the RPC surface. */
const CODE_STATUS: Record<OpportunityErrorCode, number> = {
  VALIDATION_FAILED: 400,
  FORBIDDEN_OR_NOT_FOUND: 403,
  CONFLICT: 409,
  AMBIGUOUS_ACCOUNT: 409,
  NEEDS_CONFIRMATION: 422,
  INVALID_TRANSITION: 422,
  REVISION_CONFLICT: 409,
  IDEMPOTENCY_CONFLICT: 409,
  QUOTA_EXCEEDED: 409,
  DATABASE_UNAVAILABLE: 503,
}

export class OpportunityError extends Error {
  readonly code: OpportunityErrorCode
  readonly details: Record<string, unknown>
  readonly status: number

  constructor(code: OpportunityErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message)
    this.name = 'OpportunityError'
    this.code = code
    this.details = details
    this.status = CODE_STATUS[code]
  }
}

/**
 * Uniform denial for scoped objects: “no such object” and “not yours” share
 * one code and one message so callers cannot probe private resources.
 */
export function forbiddenOrNotFound(resource: string): OpportunityError {
  return new OpportunityError(
    'FORBIDDEN_OR_NOT_FOUND',
    '无权访问该资源，或资源不存在',
    { resource },
  )
}

/** Rejects client-supplied ids before they ever reach SQL. */
export function invalidId(value: unknown, field: string): OpportunityError {
  return new OpportunityError('VALIDATION_FAILED', `参数 ${field} 不合法`, { field })
}

/** The client's expected_revision no longer matches the stored revision. */
export function revisionConflict(details: Record<string, unknown>): OpportunityError {
  return new OpportunityError('REVISION_CONFLICT', '数据已被其他操作修改，请刷新后重试', details)
}

/** Same request_key replayed with a different payload (tech spec §7.1). */
export function idempotencyConflict(request_key: string): OpportunityError {
  return new OpportunityError('IDEMPOTENCY_CONFLICT', '该请求键已用于其他参数，请更换请求键重试', {
    request_key,
  })
}

/** Cycle CHECK refused the projected six-dimension totals. */
export function quotaExceeded(details: Record<string, unknown> = {}): OpportunityError {
  return new OpportunityError('QUOTA_EXCEEDED', '本期额度不足，无法完成该操作', details)
}
