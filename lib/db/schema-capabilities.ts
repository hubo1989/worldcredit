// lib/db/schema-capabilities.ts — 表列存在性探测（server-only）。
//
// 背景：方向 4 的 0043/0044 迁移由 HUB-176（Backend-Data）交付，而本分支
// （HUB-177）必须能在迁移尚未合入时独立跑通 `npm test`。因此读写新列前先探测
// 一次列集合：存在则带上新列，不存在则退回旧列——不是「静默 1:1 估算」，只是
// 让合入顺序（HUB-176 → HUB-177）与分支自测都不被阻塞。
//
// 缓存按 D1Database 实例隔离：测试里每个用例换一个内存库，WeakMap 天然失效；
// 生产里 Worker isolate 只有一个实例，探测只发生一次。

/// <reference types="@cloudflare/workers-types" />

import { getDb } from './client'

let cache = new WeakMap<object, Map<string, Promise<Set<string>>>>()

/** 读取某张表的列名集合（探测失败时返回空集，调用方按「列不存在」降级）。 */
export async function tableColumns(table: string): Promise<Set<string>> {
  const db = getDb()
  let perDb = cache.get(db as unknown as object)
  if (!perDb) {
    perDb = new Map<string, Promise<Set<string>>>()
    cache.set(db as unknown as object, perDb)
  }
  const cached = perDb.get(table)
  if (cached) return cached

  const pending = (async () => {
    try {
      const { results } = await db
        .prepare('SELECT name FROM pragma_table_info(?)')
        .bind(table)
        .all<{ name: string }>()
      return new Set((results ?? []).map(row => row.name))
    } catch {
      return new Set<string>()
    }
  })()
  perDb.set(table, pending)
  return pending
}

/** 这些列是否全部存在（用于决定 SQL 是否带上 0043/0044 新列）。 */
export async function hasColumns(table: string, columns: readonly string[]): Promise<boolean> {
  if (columns.length === 0) return true
  const present = await tableColumns(table)
  return columns.every(column => present.has(column))
}

/** 测试侧清空缓存（同一进程内重复初始化数据库时使用）。 */
export function resetSchemaCapabilityCache(): void {
  cache = new WeakMap()
}
