// app/api/sync/push/route.ts — Offline mutation push endpoint.

import { getDb } from '@/lib/db'
import { readSession } from '@/lib/session'
import { dispatchRpc } from '@/app/api/rpc/[module]/[fn]/route'

interface MutationItem {
  id: string
  name: string // e.g. "bills.recordPayment"
  args: unknown[]
}

interface MutationResult {
  id: string
  ok: boolean
  data?: unknown
  error?: string
  code?: string
  permanent?: boolean
  already_processed?: boolean
}

export async function POST(request: Request) {
  const session = await readSession(request)
  if (!session) {
    return Response.json({ error: '未登录' }, { status: 401 })
  }

  const body = (await request.json().catch(() => ({}))) as {
    client_id?: string
    mutations?: MutationItem[]
  }

  const clientId = body.client_id
  const mutations = body.mutations

  if (!clientId || typeof clientId !== 'string') {
    return Response.json({ error: '缺少 client_id' }, { status: 400 })
  }
  if (!Array.isArray(mutations)) {
    return Response.json({ error: '缺少 mutations 数组' }, { status: 400 })
  }

  const db = getDb()
  const results: MutationResult[] = []

  for (const mut of mutations) {
    if (!mut.id || !mut.name || !Array.isArray(mut.args)) {
      results.push({
        id: mut.id || 'unknown',
        ok: false,
        error: '不合法的 mutation 格式',
        permanent: true,
      })
      continue
    }

    // 1. 幂等检查：是否已在 sync_mutations 中
    const existing = await db
      .prepare('SELECT result FROM sync_mutations WHERE client_id = ? AND mutation_id = ?')
      .bind(clientId, mut.id)
      .first<{ result: string }>()

    if (existing) {
      let parsed: MutationResult = { id: mut.id, ok: true }
      try {
        parsed = JSON.parse(existing.result) as MutationResult
      } catch {
        // Fallback
      }
      results.push({ ...parsed, already_processed: true })
      continue
    }

    // 2. 解析 module.fn
    const dot = mut.name.indexOf('.')
    if (dot <= 0 || dot === mut.name.length - 1) {
      results.push({
        id: mut.id,
        ok: false,
        error: `不合法的调用名称: ${mut.name}`,
        permanent: true,
      })
      continue
    }

    const module = mut.name.slice(0, dot)
    const fn = mut.name.slice(dot + 1)

    // 3. 执行 RPC
    const dispatchRes = await dispatchRpc(module, fn, mut.args, session)

    if (dispatchRes.ok) {
      const successResult: MutationResult = {
        id: mut.id,
        ok: true,
        data: dispatchRes.data,
      }
      await db
        .prepare('INSERT INTO sync_mutations (client_id, mutation_id, result) VALUES (?, ?, ?)')
        .bind(clientId, mut.id, JSON.stringify(successResult))
        .run()

      results.push(successResult)
    } else {
      const isPermanent = dispatchRes.status < 500
      const failureResult: MutationResult = {
        id: mut.id,
        ok: false,
        error: dispatchRes.error,
        code: dispatchRes.code,
        permanent: isPermanent,
      }

      if (isPermanent) {
        // 永久失败也记录下来，防止客户端重复提交
        await db
          .prepare('INSERT INTO sync_mutations (client_id, mutation_id, result) VALUES (?, ?, ?)')
          .bind(clientId, mut.id, JSON.stringify(failureResult))
          .run()
      }

      results.push(failureResult)
    }
  }

  return Response.json({ results })
}
