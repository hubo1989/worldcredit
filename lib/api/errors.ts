// Explicit business failures on the named RPC surface. Unknown/database errors
// deliberately remain ordinary Errors and retain retryable HTTP 500 handling.
type RpcDomainErrorCode = 'VALIDATION_FAILED' | 'NOT_FOUND' | 'CONFLICT'

const CODE_STATUS: Record<RpcDomainErrorCode, number> = {
  VALIDATION_FAILED: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
}

export class RpcDomainError extends Error {
  readonly status: number

  constructor(
    readonly code: RpcDomainErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = 'RpcDomainError'
    this.status = CODE_STATUS[code]
  }
}
