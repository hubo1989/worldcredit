// lib/__tests__/helpers/sqlite-d1.ts — real-SQLite D1 test harness.
//
// The opportunity suite asserts against `node:sqlite` (DatabaseSync) with the
// checked-in D1 migrations applied, so JSON/CHECK/FK/trigger behaviour and
// `.batch()` rollback semantics are exercised by the database itself — never
// re-stated as fake rows in JS. Shape mirrors D1Database/D1PreparedStatement:
// prepare().bind().all()/first()/run() and an implicit-transaction batch().

/// <reference types="@cloudflare/workers-types" />

import { DatabaseSync, type StatementSync } from 'node:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export const SQLITE_D1_MIGRATIONS_DIR = join(__dirname, '../../../migrations/d1')

type BindParam = null | number | string

function toBindParams(params: unknown[]): BindParam[] {
  return params.map((p) => {
    if (p === null || typeof p === 'number' || typeof p === 'string') return p
    // D1 rejects booleans/undefined/objects at bind time; mirror that so the
    // tests surface the same class of bug before deploy.
    throw new Error(`sqlite-d1: unsupported bind parameter ${typeof p} (${String(p)})`)
  })
}

class SqliteD1Statement implements D1PreparedStatement {
  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
    private readonly params: unknown[] = [],
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    return new SqliteD1Statement(this.db, this.sql, values)
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return { results: this.statement().all(...toBindParams(this.params)) as T[], success: true, meta: this.emptyMeta() }
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.statement().get(...toBindParams(this.params)) as T) ?? null
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const meta = this.statement().run(...toBindParams(this.params)) as {
      changes: number | bigint
      lastInsertRowid: number | bigint
    }
    return {
      results: [],
      success: true,
      meta: {
        changes: Number(meta.changes),
        last_row_id: Number(meta.lastInsertRowid),
        duration: 0,
        rows_read: 0,
        rows_written: 0,
        size_after: 0,
        changed_db: Number(meta.changes) > 0,
      },
    }
  }

  async raw<T = unknown>(): Promise<[string[], ...T[]]> {
    const columns = this.columnNames()
    const rows = this.statement().all(...toBindParams(this.params)) as Record<string, unknown>[]
    return [columns, ...(rows.map((row) => columns.map((c) => row[c])) as T[])]
  }

  private columnNames(): string[] {
    return this.db
      .prepare(this.sql)
      .columns()
      .map((c) => c.name)
  }

  private statement(): StatementSync {
    return this.db.prepare(this.sql)
  }

  private emptyMeta() {
    return {
      changes: 0,
      last_row_id: 0,
      duration: 0,
      rows_read: 0,
      rows_written: 0,
      size_after: 0,
      changed_db: false,
    }
  }
}

/**
 * Structurally compatible with the D1Database subset the app uses
 * (prepare/bind/all/first/run/batch) plus test-only `exec`/`raw`/`close`.
 * Not declared `implements D1Database` because D1's `exec`/`raw` signatures
 * differ; cast with `as unknown as D1Database` when injecting via setDb().
 */
export class SqliteD1 {
  /** Raw handle for test-side assertions (COUNT, PRAGMA, sqlite_master). */
  readonly raw: DatabaseSync
  private batchDepth = 0

  constructor(path = ':memory:') {
    this.raw = new DatabaseSync(path)
    this.raw.exec('PRAGMA foreign_keys = ON')
  }

  prepare(sql: string): D1PreparedStatement {
    return new SqliteD1Statement(this.raw, sql)
  }

  async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    if (this.batchDepth > 0) throw new Error('sqlite-d1: nested batch is not supported (same as D1)')
    this.batchDepth++
    this.raw.exec('BEGIN')
    try {
      const results: D1Result<T>[] = []
      for (const statement of statements) {
        results.push(await statement.run<T>())
      }
      this.raw.exec('COMMIT')
      return results
    } catch (err) {
      this.raw.exec('ROLLBACK')
      throw err
    } finally {
      this.batchDepth--
    }
  }

  /** D1 exec(): unparameterized multi-statement SQL (used by migrations). */
  exec(sql: string): void {
    this.raw.exec(sql)
  }

  close(): void {
    this.raw.close()
  }
}

/** Apply every checked-in D1 migration in filename order. */
export function applyD1Migrations(db: SqliteD1, dir = SQLITE_D1_MIGRATIONS_DIR): void {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
  for (const file of files) {
    db.exec(readFileSync(join(dir, file), 'utf8'))
  }
}

/** Fresh in-memory database with all migrations applied. One per test. */
export function createOpportunityDb(): SqliteD1 {
  const db = createSqliteD1()
  applyD1Migrations(db)
  return db
}

/**
 * Re-executes the idempotent 0015 catalog wrap. Tests seed fixture benefits
 * AFTER migrations ran (matching a live database where the catalog predates
 * 0015), so the wrap must run again once rows exist — exactly what a real
 * deployment gets from applying 0015 over populated tables.
 */
export function wrapLegacyCatalog(db: SqliteD1): void {
  db.exec(readFileSync(join(SQLITE_D1_MIGRATIONS_DIR, '0015_opportunity_legacy_catalog.sql'), 'utf8'))
}

/** Bare harness without migrations, for harness-level contract tests. */
export function createSqliteD1(): SqliteD1 {
  return new SqliteD1()
}
