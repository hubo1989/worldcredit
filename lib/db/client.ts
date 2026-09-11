// lib/db/client.ts
// D1 database client. The Worker entry (worker/index.ts) calls setDb(env.DB)
// before vinext handles the request, making the DB available to all API routes
// and server components through getDb().

/// <reference types="@cloudflare/workers-types" />

// The Cloudflare Vite plugin emits the Worker entry (worker/index.ts) and the
// SSR/app-router bundle as separate module graphs, each inlining its own copy
// of this module. A module-level variable would therefore be written by
// setDb() in one graph but read as null in the other. Storing the binding on
// globalThis shares it across every module instance in the same isolate.
const globalRef = globalThis as unknown as { __worldcreditD1?: D1Database | null }

export function getDb(): D1Database {
  const db = globalRef.__worldcreditD1
  if (db) return db
  throw new Error(
    'D1 database not initialized. Ensure worker/index.ts calls setDb(env.DB) before handling requests.'
  )
}

export function setDb(db: D1Database | null) {
  globalRef.__worldcreditD1 = db
}
