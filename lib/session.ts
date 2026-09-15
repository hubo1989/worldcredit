// lib/session.ts — HMAC-signed session cookie for wc_user (server only).
//
// Cookie value: base64url(JSON user) + "." + base64url(HMAC-SHA256).
// Unsigned or tampered cookies are rejected, so identity can no longer be
// forged by hand-crafting the cookie. The signing secret comes from the
// worker env (SESSION_SECRET): set it via .dev.vars locally and via
// "wrangler secret put SESSION_SECRET" in production.

import { getWorkerEnv } from "./db/client"
import { isAdminEmail } from "./admin-emails"

export interface SessionUser {
  id: string
  email: string
  name: string | null
  role: "admin" | "member"
  created_at: string
}

const SESSION_COOKIE = "wc_user"
const MAX_AGE_SECONDS = 7 * 24 * 3600

function toB64Url(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromB64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function getSessionKey(): Promise<CryptoKey> {
  const secret = getWorkerEnv().SESSION_SECRET
  if (typeof secret !== 'string' || secret.length < 16) {
    throw new Error(
      'SESSION_SECRET 未配置（至少 16 字符）。本地请在 .dev.vars 设置，生产请 wrangler secret put SESSION_SECRET。'
    )
  }
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret) as unknown as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  )
}

interface SessionPayload extends SessionUser {
  exp: number
}

export async function createSessionValue(user: SessionUser): Promise<string> {
  const key = await getSessionKey()
  const payload: SessionPayload = { ...user, exp: Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS }
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload))
  const signature = await crypto.subtle.sign('HMAC', key, payloadBytes as unknown as ArrayBuffer)
  return toB64Url(payloadBytes) + '.' + toB64Url(new Uint8Array(signature))
}

export async function verifySessionValue(value: string | undefined | null): Promise<SessionUser | null> {
  if (!value) return null
  const dot = value.lastIndexOf('.')
  if (dot <= 0) return null
  try {
    const payloadBytes = fromB64Url(value.slice(0, dot))
    const signature = fromB64Url(value.slice(dot + 1))
    const key = await getSessionKey()
    const rawSecret = getWorkerEnv().SESSION_SECRET
    const secretLen = typeof rawSecret === 'string' ? rawSecret.length : -1
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      signature as unknown as ArrayBuffer,
      payloadBytes as unknown as ArrayBuffer
    )
    if (!valid) {
      console.log(`[session-verify] reject=bad-signature payloadBytes=${payloadBytes.length} sigBytes=${signature.length} secretLen=${secretLen}`)
      return null
    }
    const payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as Partial<SessionPayload>
    if (
      !payload ||
      typeof payload.id !== 'string' ||
      !payload.id ||
      typeof payload.exp !== 'number' ||
      payload.exp < Math.floor(Date.now() / 1000)
    ) {
      console.log(`[session-verify] reject=payload-fields exp=${String(payload.exp)} idType=${typeof payload.id}`)
      return null
    }
    const email = typeof payload.email === 'string' ? payload.email : ''
    return {
      id: payload.id,
      email,
      name: payload.name ?? null,
      // 角色不取自 cookie，而是按白名单在每次请求时重新裁定。cookie 自带 7 天
      // 有效期，若信任其中的 role，任何已签发的旧 admin cookie 都会在有效期内
      // 继续生效——收紧授权入口也拦不住它们。email 在签名载荷内不可篡改，且
      // 白名单是静态常量（不查库），所以这一步既安全又便宜。
      role: isAdminEmail(email) ? 'admin' : 'member',
      created_at: typeof payload.created_at === 'string' ? payload.created_at : '',
    }
  } catch (err) {
    console.log(`[session-verify] reject=exception ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}

function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined
  // Split-based parsing: a malformed dynamic RegExp here silently breaks every
  // request whose wc_user cookie is not the first one in the header.
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1)
  }
  return undefined
}

export async function readSession(request: Request): Promise<SessionUser | null> {
  return verifySessionValue(readCookie(request.headers.get('Cookie'), SESSION_COOKIE))
}

export function sessionCookieHeader(value: string): string {
  return SESSION_COOKIE + '=' + value + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + MAX_AGE_SECONDS
}

export function clearSessionCookieHeader(): string {
  return SESSION_COOKIE + '=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'
}
