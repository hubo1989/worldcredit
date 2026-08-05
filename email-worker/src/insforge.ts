/**
 * Thin InsForge (PostgREST-compatible) REST client for use inside a
 * Cloudflare Worker (plain fetch, no SDK dependency).
 */

export class InsForgeClient {
  private baseUrl: string
  private serviceKey: string

  constructor(baseUrl: string, serviceKey: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.serviceKey = serviceKey
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'apikey': this.serviceKey,
      'Authorization': `Bearer ${this.serviceKey}`,
      ...extra,
    }
  }

  private url(table: string, query?: string): string {
    const base = `${this.baseUrl}/rest/v1/${table}`
    return query ? `${base}?${query}` : base
  }

  /** SELECT – returns parsed JSON array or throws */
  async select<T = Record<string, unknown>>(
    table: string,
    query: string,
    options?: { single?: boolean }
  ): Promise<T[]> {
    const res = await fetch(this.url(table, query), {
      headers: this.headers(
        options?.single ? { 'Accept': 'application/vnd.pgrst.object+json' } : undefined
      ),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`InsForge SELECT ${table} failed (${res.status}): ${text}`)
    }
    const data = await res.json() as T | T[]
    return (options?.single ? [data as T] : data as T[])
  }

  /**
   * UPSERT – uses POST with Prefer: resolution=merge-duplicates.
   * Returns the upserted row(s) with `returning=representation`.
   */
  async upsert<T = Record<string, unknown>>(
    table: string,
    row: Record<string, unknown>
  ): Promise<T[]> {
    const res = await fetch(this.url(table), {
      method: 'POST',
      headers: this.headers({
        'Prefer': 'resolution=merge-duplicates,return=representation',
      }),
      body: JSON.stringify(row),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`InsForge UPSERT ${table} failed (${res.status}): ${text}`)
    }
    return res.json() as Promise<T[]>
  }

  /** INSERT – simple insert, returns representation */
  async insert<T = Record<string, unknown>>(
    table: string,
    row: Record<string, unknown>
  ): Promise<T[]> {
    const res = await fetch(this.url(table), {
      method: 'POST',
      headers: this.headers({ 'Prefer': 'return=representation' }),
      body: JSON.stringify(row),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`InsForge INSERT ${table} failed (${res.status}): ${text}`)
    }
    return res.json() as Promise<T[]>
  }
}
