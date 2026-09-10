// lib/db/client.ts
// D1 database client. Replaces lib/insforge.ts as the sole database access layer.
// Uses `cloudflare:workers` to access bindings (env.DB) from any server-side code
// in vinext/Cloudflare Workers. Tests should call setDb() to inject a mock.

/// <reference types="@cloudflare/workers-types" />

let _db: D1Database | null = null

export function getDb(): D1Database {
  if (_db) return _db
  // eval-based require bypasses bundler static analysis of "cloudflare:workers",
  // which only exists in the Workers runtime and breaks browser/client builds.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dynamicRequire: (m: string) => any = eval('typeof require !== "undefined" ? require : null')
  if (dynamicRequire) {
    try {
      const mod = dynamicRequire('cloudflare' + ':workers') as { env: { DB?: D1Database } }
      if (mod?.env?.DB) {
        _db = mod.env.DB
        return _db
      }
    } catch {
      // Not in Workers runtime
    }
  }
  throw new Error('D1 database not available. Must run in Cloudflare Workers runtime or call setDb().')
}

/** For tests: inject a mock D1Database (or null to reset). */
export function setDb(db: D1Database | null) {
  _db = db
}
