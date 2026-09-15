// lib/api/rpc-client.ts
// Browser-side transport for the dedicated RPC API. Every client component
// reaches the database through lib/api/*.ts wrappers, which call named,
// allowlisted server functions via /api/rpc/<module>/<fn>. No raw SQL and no
// generic table access ever leaves the browser.

type AnyFn = (...args: never[]) => unknown

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
  const payload = (await res.json().catch(() => null)) as { data?: unknown; error?: string } | null

  if (!res.ok || !payload || payload.error) {
    const message = payload?.error || `RPC ${module}.${fn} failed (${res.status})`
    throw new Error(message)
  }
  return payload.data as Awaited<ReturnType<F>>
}
