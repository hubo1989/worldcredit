// lib/__tests__/opportunity-scope.test.ts — actor scope for the opportunity
// ledger, exercised against real SQL and the real RPC route:
//   1. resolveOpportunityScope returns each actor's holder universe
//      (admin = created/managed, member = own binding, none = empty)
//   2. cross-world object access is uniformly FORBIDDEN_OR_NOT_FOUND and
//      leaks nothing about the object's existence
//   3. the route derives actor from the session only — forged body.actor /
//      user_id never reach the impl
//   4. OpportunityError responses keep .message for old callers and add
//      {code, details, request_id}; RpcError surfaces the same on the client

import { describe, it, expect, beforeEach, beforeAll, afterEach, afterAll } from 'vitest'
import { createOpportunityDb, type SqliteD1 } from './helpers/sqlite-d1'
import {
  seedOpportunityFixtures,
  seedOpportunityLedgerWorld,
  FIXTURE_IDS,
  LEDGER_IDS,
} from './helpers/opportunity-fixtures'
import { setDb, setWorkerEnv } from '../db/client'
import { createSessionValue } from '../session'
import { RPC_REGISTRY, type RpcEntry } from '../api/registry'
import { POST as rpcPost } from '@/app/api/rpc/[module]/[fn]/route'
import {
  resolveOpportunityScope,
  assertAccountAccess,
  assertCardAccess,
  assertUsageAccess,
} from '../opportunities/scope.server'
import { OpportunityError } from '../opportunities/errors'
import type { OpportunityActor } from '../opportunities/types'
import { RpcError, callRpc } from '../api/rpc-client'
import { ADMIN_EMAILS } from '../admin-emails'

let db: SqliteD1
const f = FIXTURE_IDS
const l = LEDGER_IDS

beforeEach(async () => {
  db = createOpportunityDb()
  await seedOpportunityFixtures(db)
  await seedOpportunityLedgerWorld(db)
  setDb(db as unknown as D1Database)
  setWorkerEnv({ SESSION_SECRET: 'unit-test-session-secret' })
})

afterEach(() => {
  setDb(null)
  delete RPC_REGISTRY['__scope-test']
  db.close()
})

const actorAdminA = { user_id: f.users.adminA, role: 'admin' as const }
const actorMemberA = { user_id: f.users.memberA, role: 'member' as const }
const actorAdminB = { user_id: f.users.adminB, role: 'admin' as const }

describe('resolveOpportunityScope', () => {
  it('admin scope = holders they created or manage', async () => {
    expect(await resolveOpportunityScope(actorAdminA)).toEqual(
      expect.arrayContaining([f.holders.self, f.holders.family]),
    )
    expect(await resolveOpportunityScope(actorAdminB)).toEqual([f.holders.adminB])
  })

  it('member scope = exactly their own holder binding', async () => {
    expect(await resolveOpportunityScope(actorMemberA)).toEqual([f.holders.memberSelf])
  })

  it('a user with no holders gets an empty scope, not an error', async () => {
    await db
      .prepare('INSERT INTO users (id, email, password_hash, name, role) VALUES (?,?,?,?,?)')
      .bind('u-orphan', 'orphan@example.test', 'x', '孤儿用户', 'member')
      .run()
    expect(await resolveOpportunityScope({ user_id: 'u-orphan', role: 'member' })).toEqual([])
  })
})

describe('object assertions (real SQL, no post-filtering)', () => {
  it('admin A reaches their own account but not admin B’s private one', async () => {
    const account = await assertAccountAccess(l.accounts.self, actorAdminA)
    expect(account.holder_id).toBe(f.holders.self)
    await expect(assertAccountAccess(l.accounts.adminB, actorAdminA)).rejects.toMatchObject({
      code: 'FORBIDDEN_OR_NOT_FOUND',
    })
  })

  it('admin B reaches their own account but not admin A’s', async () => {
    const account = await assertAccountAccess(l.accounts.adminB, actorAdminB)
    expect(account.holder_id).toBe(f.holders.adminB)
    await expect(assertAccountAccess(l.accounts.self, actorAdminB)).rejects.toBeInstanceOf(
      OpportunityError,
    )
  })

  it('a member only reaches objects on their bound holder', async () => {
    await expect(assertAccountAccess(l.accounts.self, actorMemberA)).rejects.toMatchObject({
      code: 'FORBIDDEN_OR_NOT_FOUND',
    })
    await expect(assertCardAccess(f.cards.selfMain, actorMemberA)).rejects.toBeInstanceOf(
      OpportunityError,
    )
    // Admin A's cards are in their scope:
    const card = await assertCardAccess(f.cards.selfMain, actorAdminA)
    expect(card.holder_id).toBe(f.holders.self)
  })

  it('usage access follows its account chain', async () => {
    const usage = await assertUsageAccess(l.usages.adminB, actorAdminB)
    expect(usage.account_id).toBe(l.accounts.adminB)
    await expect(assertUsageAccess(l.usages.adminB, actorAdminA)).rejects.toMatchObject({
      code: 'FORBIDDEN_OR_NOT_FOUND',
    })
  })

  it('missing objects and foreign objects are indistinguishable', async () => {
    let foreignMessage = ''
    try {
      await assertAccountAccess(l.accounts.adminB, actorAdminA)
    } catch (err) {
      foreignMessage = (err as Error).message
    }
    await expect(assertAccountAccess('no-such-account', actorAdminA)).rejects.toThrow(
      foreignMessage,
    )
  })

  it('rejects malformed ids instead of querying', async () => {
    await expect(assertAccountAccess(null, actorAdminA)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    })
    await expect(assertCardAccess(undefined, actorAdminA)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    })
    await expect(assertUsageAccess(42, actorAdminA)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    })
  })
})

// ---- route-level: actor comes from the session, never from the body ----
// The session role is re-derived from ADMIN_EMAILS on every request (never
// trusted from the cookie), so the fixture admin addresses join the list for
// the route tests only.

let lastCallArgs: unknown[] = []
let adminListLength: number

beforeAll(() => {
  adminListLength = ADMIN_EMAILS.length
  ADMIN_EMAILS.push('admin-a@example.test', 'admin-b@example.test')
})

afterAll(() => {
  ADMIN_EMAILS.length = adminListLength
})

type TestEntry = Partial<RpcEntry> & {
  impl: (...args: unknown[]) => unknown
}

function registerTestEntry(name: string, entry: TestEntry): void {
  RPC_REGISTRY['__scope-test'] = { ...(RPC_REGISTRY['__scope-test'] ?? {}), [name]: entry }
}

async function postRpc(
  sessionUserId: string,
  email: string,
  fn: string,
  args: unknown[],
): Promise<{ status: number; payload: Record<string, unknown> }> {
  const cookie = await createSessionValue({
    id: sessionUserId,
    email,
    name: null,
    role: 'admin', // role is re-derived from ADMIN_EMAILS; the cookie value is ignored
    created_at: '2026-01-01T00:00:00Z',
  })
  const request = new Request(`http://localhost/api/rpc/__scope-test/${fn}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `wc_user=${cookie}` },
    body: JSON.stringify({ args }),
  })
  const response = await rpcPost(request, { params: Promise.resolve({ module: '__scope-test', fn }) })
  return { status: response.status, payload: (await response.json()) as Record<string, unknown> }
}

describe('RPC route: actor injection', () => {
  it('prepends the session actor and ignores forged body.actor', async () => {
    registerTestEntry('echo', {
      prependActor: true,
      impl: (actor, ...rest) => {
        lastCallArgs = [actor, ...rest]
        return { ok: true }
      },
    })
    const { status, payload } = await postRpc(f.users.adminA, 'admin-a@example.test', 'echo', [
      { actor: { user_id: f.users.adminB, role: 'admin' }, user_id: f.users.adminB },
    ])
    expect(status).toBe(200)
    expect(payload.data).toEqual({ ok: true })
    // The impl saw the session actor at position 0; the forged object stayed
    // an ordinary argument the impl never reads as identity.
    expect(lastCallArgs[0]).toEqual({ user_id: f.users.adminA, role: 'admin' })
    expect(lastCallArgs[1]).toMatchObject({ user_id: f.users.adminB })
  })

  it('member requests get the member actor and pass memberGuard first', async () => {
    let guardRan = false
    registerTestEntry('guardedEcho', {
      prependActor: true,
      impl: (actor) => ({ role: (actor as OpportunityActor).role }),
      memberGuard: async () => {
        guardRan = true
      },
    })
    const { payload } = await postRpc(f.users.memberA, 'member-a@example.test', 'guardedEcho', [])
    expect(payload.data).toEqual({ role: 'member' })
    expect(guardRan).toBe(true)
  })

  it('bindUser still overwrites the client-supplied user id at its position', async () => {
    registerTestEntry('boundEcho', {
      prependActor: true,
      bindUser: 1,
      impl: (...args) => args,
    })
    const { payload } = await postRpc(f.users.adminA, 'admin-a@example.test', 'boundEcho', [
      'ignored-actor-slot',
      'forged-user-id',
    ])
    // impl position 0 = session actor; client positions shift by one, and the
    // forged user id at client position 1 was overwritten by bindUser.
    expect(payload.data).toEqual([
      { user_id: f.users.adminA, role: 'admin' },
      'ignored-actor-slot',
      f.users.adminA,
    ])
  })

  it('OpportunityError responses keep .message and add code/details/request_id', async () => {
    registerTestEntry('boom', {
      prependActor: true,
      impl: () => {
        throw new OpportunityError('CONFLICT', '配额已被并发修改', { revision: 7 })
      },
    })
    const { status, payload } = await postRpc(f.users.adminA, 'admin-a@example.test', 'boom', [])
    expect(status).toBe(409)
    expect(payload.error).toBe('配额已被并发修改')
    expect(payload.code).toBe('CONFLICT')
    expect(payload.details).toEqual({ revision: 7 })
    expect(typeof payload.request_id).toBe('string')
  })

  it('unauthenticated requests never reach the impl', async () => {
    lastCallArgs = []
    registerTestEntry('echo', {
      prependActor: true,
      impl: (...args) => {
        lastCallArgs = args
        return { ok: true }
      },
    })
    const request = new Request('http://localhost/api/rpc/__scope-test/echo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ args: [] }),
    })
    const response = await rpcPost(request, { params: Promise.resolve({ module: '__scope-test', fn: 'echo' }) })
    expect(response.status).toBe(401)
    expect(lastCallArgs).toEqual([])
  })
})

describe('rpc-client: RpcError', () => {
  const realFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = realFetch
  })

  it('surfaces code/details/request_id while keeping .message', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          data: null,
          error: '配额已被并发修改',
          code: 'CONFLICT',
          details: { revision: 7 },
          request_id: 'req-1',
        }),
        { status: 409, headers: { 'Content-Type': 'application/json' } },
      )) as typeof fetch
    let caught: unknown
    await callRpc('__scope-test', 'nope').catch((err: unknown) => {
      caught = err
    })
    expect(caught).toBeInstanceOf(RpcError)
    const err = caught as RpcError
    expect(err.message).toBe('配额已被并发修改')
    expect(err.code).toBe('CONFLICT')
    expect(err.details).toEqual({ revision: 7 })
    expect(err.request_id).toBe('req-1')
  })

  it('plain errors stay plain Errors for legacy catch sites', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ data: null, error: '接口不存在' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch
    await expect(callRpc('__scope-test', 'missing')).rejects.toThrow('接口不存在')
  })

  it('resolves data on success', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ data: { value: 42 }, error: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch
    await expect(callRpc<(a: number) => Promise<{ value: number }>>('__scope-test', 'ok', 1)).resolves.toEqual({ value: 42 })
  })
})
