// lib/client-db.ts
// TEMPORARY client-side database bridge that calls /api/db-proxy.
// TODO(replace): Refactor client components to use dedicated API routes and remove this bridge.
/* eslint-disable @typescript-eslint/no-explicit-any */

interface ProxyFilter {
  [key: string]: unknown
}

interface DbResponse<T = any> {
  data: T | null
  error: { message: string; code?: string } | null
}

class ClientQuery {
  private table: string
  private filters: ProxyFilter = {}
  private _limit?: number
  private _order?: { column: string; ascending: boolean }
  private _columns = '*'

  constructor(table: string) {
    this.table = table
  }

  select(columns = '*'): ClientQuery {
    this._columns = columns
    return this
  }

  eq(column: string, value: unknown): ClientQuery {
    this.filters[column] = value
    return this
  }

  neq(column: string, value: unknown): ClientQuery {
    this.filters[`${column}__neq`] = value
    return this
  }

  in(column: string, values: unknown[]): ClientQuery {
    // db-proxy 会把 __in 后缀翻译成 IN 查询，空数组按恒假处理
    this.filters[column + '__in'] = values
    return this
  }

  gte(column: string, value: unknown): ClientQuery {
    this.filters[`${column}__gte`] = value
    return this
  }

  lte(column: string, value: unknown): ClientQuery {
    this.filters[`${column}__lte`] = value
    return this
  }

  order(column: string, opts?: { ascending?: boolean }): ClientQuery {
    this._order = { column, ascending: opts?.ascending ?? true }
    return this
  }

  limit(n: number): ClientQuery {
    this._limit = n
    return this
  }

  async execute(): Promise<DbResponse<any[]>> {
    try {
      const res = await fetch('/api/db-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          table: this.table,
          operation: 'select',
          columns: this._columns,
          filters: this.filters,
          orderBy: this._order,
          limit: this._limit,
        }),
      })
      const json = await res.json()
      if (json.error) return { data: null, error: json.error }
      return { data: json.data || [], error: null }
    } catch (err) {
      return { data: null, error: { message: err instanceof Error ? err.message : String(err) } }
    }
  }

  then<TResult1 = DbResponse<any[]>, TResult2 = never>(
    onfulfilled?: ((value: DbResponse<any[]>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected)
  }

  async single(): Promise<DbResponse<any>> {
    const res = await this.execute()
    if (res.error) return { data: null, error: res.error }
    return { data: res.data?.[0] ?? null, error: null }
  }

  async maybeSingle(): Promise<DbResponse<any | null>> {
    const res = await this.execute()
    if (res.error) return { data: null, error: res.error }
    return { data: res.data?.[0] ?? null, error: null }
  }

  async insert(data: any): Promise<DbResponse<any>> {
    try {
      const res = await fetch('/api/db-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ table: this.table, operation: 'insert', data: Array.isArray(data) ? data[0] : data }),
      })
      const json = await res.json()
      if (json.error) return { data: null, error: json.error }
      return { data: json.data ?? null, error: null }
    } catch (err) {
      return { data: null, error: { message: err instanceof Error ? err.message : String(err) } }
    }
  }

  async update(data: any): Promise<DbResponse<any>> {
    try {
      const res = await fetch('/api/db-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ table: this.table, operation: 'update', data, filters: this.filters }),
      })
      const json = await res.json()
      if (json.error) return { data: null, error: json.error }
      return { data: json.data ?? null, error: null }
    } catch (err) {
      return { data: null, error: { message: err instanceof Error ? err.message : String(err) } }
    }
  }

  async delete(): Promise<DbResponse<null>> {
    try {
      const res = await fetch('/api/db-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ table: this.table, operation: 'delete', filters: this.filters }),
      })
      const json = await res.json()
      if (json.error) return { data: null, error: json.error }
      return { data: null, error: null }
    } catch (err) {
      return { data: null, error: { message: err instanceof Error ? err.message : String(err) } }
    }
  }
}

export const clientDb = {
  from(table: string): ClientQuery {
    return new ClientQuery(table)
  },
}
