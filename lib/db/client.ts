// lib/db/client.ts
// D1 database client. Replaces lib/insforge.ts as the sole database access layer.
// Uses `cloudflare:workers` to access bindings (env.DB) from any server-side code
// in vinext/Cloudflare Workers. Tests should call setDb() to inject a mock.

/// <reference types="@cloudflare/workers-types" />

let _db: D1Database | null = null

export function getDb(): D1Database {
  if (_db) return _db
  // cloudflare:workers is only available in Workers runtime.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod = require('cloudflare:workers') as { env: { DB?: D1Database } }
  const db = mod.env.DB
  if (!db) {
    throw new Error('D1 binding "DB" not found. Check wrangler.jsonc d1_databases.')
  }
  _db = db
  return db
}

/** For tests: inject a mock D1Database (or null to reset). */
export function setDb(db: D1Database | null) {
  _db = db
}
