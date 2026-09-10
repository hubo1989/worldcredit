// lib/db/client.ts
// D1 database client. Replaces lib/insforge.ts as the sole database access layer.
// In vinext/Cloudflare Workers, `process.env.DB` is not available at module scope;
// use getDb() inside request handlers / server functions where the binding is injected.

import type { D1Database } from '@cloudflare/workers-types'

let _db: D1Database | null = null

export function setDb(db: D1Database) {
  _db = db
}

export function getDb(): D1Database {
  if (!_db) {
    throw new Error('D1 database not initialized. Call setDb() in your server entry first.')
  }
  return _db
}

// Re-export for convenience so callers can do `import { getDb } from '@/lib/db'`
export { getDb as db }

