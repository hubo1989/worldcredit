// lib/api/rpc-client.ts
// Browser-side transport for the dedicated RPC API. Every client component
// reaches the database through lib/api/*.ts wrappers, which call named,
// allowlisted server functions via /api/rpc/<module>/<fn>. No raw SQL and no
// generic table access ever leaves the browser.

type AnyFn = (...args: never[]) => unknown

/**
 * Structured RPC failure. Extends Error so legacy `catch (e) { e.message }`
 * sites keep working; new code reads code/details/request_id when present.
 */
export class RpcError extends Error {
  readonly code?: string
  readonly details?: unknown
  readonly request_id?: string

  constructor(message: string, code?: string, details?: unknown, requestId?: string) {
    super(message)
    this.name = 'RpcError'
    this.code = code
    this.details = details
    this.request_id = requestId
  }
}

export async function callRpc<F extends AnyFn>(
  module: string,
  fn: string,
  ...args: Parameters<F>
): Promise<Awaited<ReturnType<F>>> {
  const res = await fetch(`/api/rpc/${module}/${fn}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ args }),
    credentials: 'same-origin',
  })

  // Invalid JSON bodies resolve to null and are treated as transport failures.
  const payload = (await res.json().catch(() => null)) as {
    data?: unknown
    error?: string
    code?: string
    details?: unknown
    request_id?: string
  } | null

  if (!res.ok || !payload || payload.error) {
    const message = payload?.error || `RPC ${module}.${fn} failed (${res.status})`
    if (payload?.code || payload?.details || payload?.request_id) {
      throw new RpcError(message, payload?.code, payload?.details, payload?.request_id)
    }
    throw new Error(message)
  }
  return payload.data as Awaited<ReturnType<F>>
}
