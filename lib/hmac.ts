// lib/hmac.ts — HMAC-SHA256 primitives over the worker's SESSION_SECRET.
//
// Extracted from lib/session.ts so the OAuth state cookie can be signed with the
// same key without duplicating the key handling. The wire format of the session
// cookie is intentionally untouched: live cookies have a 7-day lifetime, and
// changing the envelope would sign every user out again.

import { getWorkerEnv } from './db/client'

export async function getSigningKey(): Promise<CryptoKey> {
  const secret = getWorkerEnv().SESSION_SECRET
  if (typeof secret !== 'string' || secret.length < 16) {
    throw new Error(
      'SESSION_SECRET 未配置（至少 16 字符）。本地请在 .dev.vars 设置，生产请 wrangler secret put SESSION_SECRET。'
    )
  }
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret) as unknown as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  )
}

export async function hmacSign(payload: string): Promise<Uint8Array> {
  const key = await getSigningKey()
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(payload) as unknown as ArrayBuffer
  )
  return new Uint8Array(signature)
}

export async function hmacVerify(payload: string, signature: Uint8Array): Promise<boolean> {
  const key = await getSigningKey()
  return crypto.subtle.verify(
    'HMAC',
    key,
    signature as unknown as ArrayBuffer,
    new TextEncoder().encode(payload) as unknown as ArrayBuffer
  )
}
