// lib/gmail/token-crypto.ts — Gmail OAuth token 静态加密（server only）。
//
// refresh token 是长期凭据，等价于「读完整个邮箱」的授权。D1 明文存储在
// 导出/备份/误读时等于凭证泄露，所以落库前用 SESSION_SECRET 派生的 AES-GCM
// 密钥加密；派生用 HKDF，避免直接拿 session 签名密钥当加密密钥（职责分开，
// session 签名密钥轮换语义不被加密用途绑死）。

export class GmailCryptoError extends Error {}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

async function deriveKey(secret: string): Promise<CryptoKey> {
  if (!secret) throw new GmailCryptoError('SESSION_SECRET 未配置，无法加解密 Gmail token')
  const material = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), 'HKDF', false, ['deriveKey']
  )
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: encoder.encode('worldcredit-gmail'),
      info: encoder.encode('gmail-tokens/v1'),
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

function toB64Url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromB64Url(value: string): Uint8Array {
  const bin = atob(value.replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** 密文格式：base64url( 12B IV || AES-GCM CT )。 */
export async function encryptToken(plain: string, secret: string): Promise<string> {
  const key = await deriveKey(secret)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(plain))
  )
  const joined = new Uint8Array(iv.length + ct.length)
  joined.set(iv, 0)
  joined.set(ct, iv.length)
  return toB64Url(joined)
}

export async function decryptToken(enc: string, secret: string): Promise<string> {
  try {
    const joined = fromB64Url(enc)
    if (joined.length <= 12) throw new GmailCryptoError('密文长度非法')
    const key = await deriveKey(secret)
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: joined.slice(0, 12) }, key, joined.slice(12)
    )
    return decoder.decode(plain)
  } catch (err) {
    if (err instanceof GmailCryptoError) throw err
    throw new GmailCryptoError('Gmail token 解密失败（密钥不匹配或密文被篡改）')
  }
}
