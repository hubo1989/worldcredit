import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createOpportunityDb } from './helpers/sqlite-d1'
import { setDb } from '../db/client'
import { registerDeviceToken, unregisterDeviceToken } from '../api/devices.server'
import {
  getApnsJwt,
  sendApnsNotification,
  sendApnsToUser,
  triggerSilentSyncForUser,
  type ApnsConfig,
} from '../apns.server'

describe('Device Tokens & APNs Push Server', () => {
  let db: ReturnType<typeof createOpportunityDb>
  const userId = 'u_dev_test'

  beforeEach(async () => {
    db = createOpportunityDb()
    setDb(db as unknown as D1Database)

    await db.exec(`
      INSERT INTO users (id, email, password_hash) VALUES ('${userId}', 'dev@example.com', 'hash');
    `)
  })

  describe('Device Tokens Registration', () => {
    it('registers a new device token', async () => {
      const res = await registerDeviceToken(
        {
          platform: 'ios',
          token: 'token_abc_123',
          appVersion: '1.0.0',
        },
        userId
      )

      expect(res.success).toBe(true)
      expect(res.id).toBeDefined()

      const row = await db
        .prepare('SELECT * FROM device_tokens WHERE token = ?')
        .bind('token_abc_123')
        .first<{ user_id: string; platform: string; app_version: string }>()

      expect(row?.user_id).toBe(userId)
      expect(row?.platform).toBe('ios')
      expect(row?.app_version).toBe('1.0.0')
    })

    it('updates existing token on conflict without duplicating', async () => {
      await registerDeviceToken(
        {
          platform: 'ios',
          token: 'same_token',
          appVersion: '1.0.0',
        },
        userId
      )

      // Another user logs in on the same physical device
      const user2Id = 'u_dev_test_2'
      await db.exec(`
        INSERT INTO users (id, email, password_hash) VALUES ('${user2Id}', 'user2@example.com', 'hash');
      `)

      await registerDeviceToken(
        {
          platform: 'ios',
          token: 'same_token',
          appVersion: '1.0.1',
        },
        user2Id
      )

      const count = await db
        .prepare('SELECT count(*) as total FROM device_tokens WHERE token = ?')
        .bind('same_token')
        .first<{ total: number }>()

      expect(count?.total).toBe(1)

      const row = await db
        .prepare('SELECT user_id, app_version FROM device_tokens WHERE token = ?')
        .bind('same_token')
        .first<{ user_id: string; app_version: string }>()

      expect(row?.user_id).toBe(user2Id)
      expect(row?.app_version).toBe('1.0.1')
    })

    it('unregisters token on user logout', async () => {
      await registerDeviceToken(
        {
          platform: 'ios',
          token: 'logout_token',
        },
        userId
      )

      const res = await unregisterDeviceToken({ token: 'logout_token' }, userId)
      expect(res.success).toBe(true)

      const row = await db
        .prepare('SELECT * FROM device_tokens WHERE token = ?')
        .bind('logout_token')
        .first()

      expect(row).toBeNull()
    })

    it('rejects empty token', async () => {
      await expect(
        registerDeviceToken({ platform: 'ios', token: '   ' }, userId)
      ).rejects.toThrow('Device Token 不能为空')
    })
  })

  describe('APNs Client', () => {
    it('returns error when APNs credentials are not configured', async () => {
      const res = await sendApnsNotification(
        'mock_token',
        { isSilent: true },
        {}
      )
      expect(res.success).toBe(false)
      expect(res.error).toBe('apns_not_configured')
    })

    it('generates a valid ES256 APNs JWT with real Web Crypto key', async () => {
      // Dynamically generate a P-256 key pair to test real Web Crypto ES256 signing
      const keyPair = await crypto.subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['sign', 'verify']
      )
      const pkcs8 = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey)
      const base64Key = btoa(String.fromCharCode(...new Uint8Array(pkcs8)))
      const pem = `-----BEGIN PRIVATE KEY-----\n${base64Key}\n-----END PRIVATE KEY-----`

      const config: ApnsConfig = {
        keyP8: pem,
        keyId: 'KEYID12345',
        teamId: 'TEAMID1234',
        bundleId: 'com.chunfenshijie.worldcredit',
      }

      const jwt = await getApnsJwt(config)
      expect(jwt).toBeDefined()
      const parts = jwt.split('.')
      expect(parts.length).toBe(3)

      const header = JSON.parse(atob(parts[0]))
      expect(header.alg).toBe('ES256')
      expect(header.kid).toBe('KEYID12345')

      const payload = JSON.parse(atob(parts[1]))
      expect(payload.iss).toBe('TEAMID1234')
      expect(payload.iat).toBeGreaterThan(0)

      const signature = Uint8Array.from(
        atob(parts[2].replace(/-/g, '+').replace(/_/g, '/')),
        char => char.charCodeAt(0)
      )
      expect(await crypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        keyPair.publicKey,
        signature,
        new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
      )).toBe(true)

      // Distinct Worker credentials must never reuse a cached JWT from another team/key.
      const otherJwt = await getApnsJwt({ ...config, keyId: 'OTHERKEY', teamId: 'OTHERTEAM' })
      expect(otherJwt).not.toBe(jwt)
      expect(JSON.parse(atob(otherJwt.split('.')[0])).kid).toBe('OTHERKEY')
      expect(JSON.parse(atob(otherJwt.split('.')[1])).iss).toBe('OTHERTEAM')
    })

    it('deletes invalid token when APNs responds with 410 Gone', async () => {
      const keyPair = await crypto.subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['sign', 'verify']
      )
      const pkcs8 = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey)
      const base64Key = btoa(String.fromCharCode(...new Uint8Array(pkcs8)))
      const pem = `-----BEGIN PRIVATE KEY-----\n${base64Key}\n-----END PRIVATE KEY-----`

      const config: ApnsConfig = {
        keyP8: pem,
        keyId: 'KEYID12345',
        teamId: 'TEAMID1234',
        bundleId: 'com.chunfenshijie.worldcredit',
      }

      const token = 'expired_token'
      await registerDeviceToken({ platform: 'ios', token }, userId)

      // Mock fetch returning 410 Unregistered
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('{"reason":"Unregistered"}', { status: 410 })
      )

      const res = await sendApnsNotification(token, { isSilent: true }, config)
      expect(res.success).toBe(false)
      expect(res.statusCode).toBe(410)

      // Token should have been pruned from DB
      const row = await db
        .prepare('SELECT * FROM device_tokens WHERE token = ?')
        .bind(token)
        .first()

      expect(row).toBeNull()
      fetchSpy.mockRestore()
    })

    it('broadcasts to all user devices and triggers silent sync', async () => {
      await registerDeviceToken({ platform: 'ios', token: 't1' }, userId)
      await registerDeviceToken({ platform: 'ios', token: 't2' }, userId)

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('{}', { status: 200 })
      )

      const keyPair = await crypto.subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['sign', 'verify']
      )
      const pkcs8 = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey)
      const base64Key = btoa(String.fromCharCode(...new Uint8Array(pkcs8)))
      const pem = `-----BEGIN PRIVATE KEY-----\n${base64Key}\n-----END PRIVATE KEY-----`

      const config: ApnsConfig = {
        keyP8: pem,
        keyId: 'KEYID12345',
        teamId: 'TEAMID1234',
      }

      const alertRes = await sendApnsToUser(
        userId,
        { alert: { title: '测试', body: '内容' } },
        config
      )
      expect(alertRes.total).toBe(2)
      expect(alertRes.sent).toBe(2)

      await triggerSilentSyncForUser(userId, config)

      expect(fetchSpy).toHaveBeenCalledTimes(4)
      fetchSpy.mockRestore()
    })

    it.each([
      { status: 400, reason: 'BadDeviceToken', removed: true },
      { status: 403, reason: 'InvalidProviderToken', removed: false },
      { status: 503, reason: 'ServiceUnavailable', removed: false },
    ])('APNs $status $reason only removes definitively invalid device tokens', async ({ status, reason, removed }) => {
      const keyPair = await crypto.subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']
      )
      const pkcs8 = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey)
      const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...new Uint8Array(pkcs8)))}\n-----END PRIVATE KEY-----`
      await registerDeviceToken({ platform: 'ios', token: 'device-token' }, userId)
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        Response.json({ reason }, { status })
      )
      try {
        const result = await sendApnsNotification('device-token', { isSilent: true }, {
          keyP8: pem, keyId: 'TESTKEY', teamId: 'TESTTEAM',
        })
        expect(result).toMatchObject({ success: false, statusCode: status, invalidToken: removed })
        const row = await db.prepare('SELECT token FROM device_tokens WHERE token = ?').bind('device-token').first()
        expect(row === null).toBe(removed)
      } finally {
        fetchSpy.mockRestore()
      }
    })
  })
})
