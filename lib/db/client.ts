// lib/db/client.ts
// D1 database client. The Worker entry (worker/index.ts) calls setDb(env.DB)
// before vinext handles the request, making the DB available to all API routes
// and server components through getDb().

/// <reference types="@cloudflare/workers-types" />

let _db: D1Database | null = null

export function getDb(): D1Database {
  if (_db) return _db
  throw new Error(
    'D1 database not initialized. Ensure worker/index.ts calls setDb(env.DB) before handling requests.'
  )
}

export function setDb(db: D1Database | null) {
  _db = db
}
