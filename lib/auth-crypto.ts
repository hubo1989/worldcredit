// lib/auth-crypto.ts — PBKDF2 password hashing using Web Crypto (Workers compatible)
// Format: pbkdf2$<iterations>$<salt_b64>$<hash_b64>

const ITERATIONS = 100_000
const HASH_ALG = 'SHA-256'
const KEY_LEN = 32

function toB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function fromB64(s: string): Uint8Array {
  const binary = atob(s)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export async function pbkdf2Hash(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(password) as unknown as ArrayBuffer, 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as unknown as ArrayBuffer, iterations: ITERATIONS, hash: HASH_ALG },
    keyMaterial,
    KEY_LEN * 8
  )
  return `pbkdf2$${ITERATIONS}$${toB64(salt)}$${toB64(bits)}`
}

export async function pbkdf2Verify(password: string, stored: string): Promise<boolean> {
  const [alg, iterStr, saltB64, hashB64] = stored.split('$')
  if (alg !== 'pbkdf2') return false
  const iterations = parseInt(iterStr, 10)
  if (!iterations || !saltB64 || !hashB64) return false
  const salt = fromB64(saltB64)
  const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(password) as unknown as ArrayBuffer, 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as unknown as ArrayBuffer, iterations, hash: HASH_ALG },
    keyMaterial,
    (hashB64.length * 6 / 8) | 0
  )
  const expected = fromB64(hashB64)
  const actual = new Uint8Array(bits)
  if (expected.length !== actual.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= expected[i] ^ actual[i]
  return diff === 0
}
