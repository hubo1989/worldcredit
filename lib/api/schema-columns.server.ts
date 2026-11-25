// lib/api/schema-columns.server.ts — 列存在性探测（server only）。
//
// 方向1 的 0034–0036 迁移由 HUB-155 交付，与后端 API（HUB-156）并行开发。
// 写入前探测一次列集合，缺失的列从 INSERT/UPDATE 中剔除，而不是让整条语句
// 报 "no such column" 变成 500：迁移落地前后行为一致，合入顺序不再是运行时前提。

import { getDb } from '../db/client'
import { query } from '../db'

const cache = new WeakMap<object, Map<string, Promise<Set<string>>>>()

/** 返回某张表当前的列名集合；探测失败时返回空集（调用方据此跳过可选列）。 */
export async function tableColumns(table: string): Promise<Set<string>> {
  const db = getDb() as unknown as object
  let perDb = cache.get(db)
  if (!perDb) {
    perDb = new Map()
    cache.set(db, perDb)
  }
  const cached = perDb.get(table)
  if (cached) return cached
  const pending = (async () => {
    const { data, error } = await query<{ name: string }>(`PRAGMA table_info(${table})`, [])
    if (error) return new Set<string>()
    return new Set((data || []).map(row => row.name))
  })()
  perDb.set(table, pending)
  return pending
}

export function hasColumn(columns: Set<string>, name: string): boolean {
  return columns.has(name)
}

/** 只保留当前表真实存在的键，供动态 INSERT 使用。 */
export function pickExistingColumns(
  row: Record<string, unknown>,
  columns: Set<string>,
): Array<{ key: string; value: unknown }> {
  return Object.keys(row)
    .filter(key => columns.has(key))
    .map(key => {
      const value = row[key]
      return { key, value: typeof value === 'boolean' ? (value ? 1 : 0) : value }
    })
}

/**
 * UPDATE 语句的列过滤：把 (列名, 值) 对里当前表不存在的列剔除。
 * 用于 0034–0036 迁移落地前后都能安全写入——迁移没到时少写一列，
 * 而不是整条 UPDATE 500。返回 null 表示没有任何可写列（调用方决定是否报错）。
 */
export function filterUpdatePairs(
  table: string,
  pairs: Array<{ column: string; value: unknown }>,
): Promise<{ sets: string[]; params: unknown[] } | null> {
  return tableColumns(table).then(existing => {
    const sets: string[] = []
    const params: unknown[] = []
    for (const pair of pairs) {
      if (!existing.has(pair.column)) continue
      sets.push(`${pair.column} = ?`)
      params.push(typeof pair.value === 'boolean' ? (pair.value ? 1 : 0) : pair.value)
    }
    return sets.length > 0 ? { sets, params } : null
  })
}
