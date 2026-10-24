import { describe, it, expect, beforeAll } from 'vitest'
import { setWorkerEnv } from '../db/client'
import { createSessionValue, readSession, type SessionUser } from '../session'

describe('Bearer token authentication in lib/session.ts', () => {
  beforeAll(() => {
    setWorkerEnv({ SESSION_SECRET: 'test-secret-at-least-16-chars' })
  })

  const mockUser: SessionUser = {
    id: 'u_test_bearer',
    email: 'hubo1989@gmail.com',
    name: 'Admin',
    role: 'admin',
    created_at: '2026-10-21T00:00:00Z',
  }

  it('reads session from Authorization: Bearer <token>', async () => {
    const token = await createSessionValue(mockUser)

    const request = new Request('https://app.all-bill.com/api/rpc/bills/getRecentBills', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    const session = await readSession(request)
    expect(session).not.toBeNull()
    expect(session?.id).toBe(mockUser.id)
    expect(session?.email).toBe(mockUser.email)
    expect(session?.role).toBe('admin')
  })

  it('falls back to Cookie when Authorization header is absent', async () => {
    const token = await createSessionValue(mockUser)

    const request = new Request('https://app.all-bill.com/api/rpc/bills/getRecentBills', {
      method: 'POST',
      headers: {
        Cookie: `wc_user=${token}`,
      },
    })

    const session = await readSession(request)
    expect(session).not.toBeNull()
    expect(session?.id).toBe(mockUser.id)
  })

  it('returns null for invalid Bearer token', async () => {
    const request = new Request('https://app.all-bill.com/api/rpc/bills/getRecentBills', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer invalid.garbage.token',
      },
    })

    const session = await readSession(request)
    expect(session).toBeNull()
  })
})
