const encoder = new TextEncoder()

async function vaultKey(secret: string, userId: string): Promise<CryptoKey> {
  if (!secret || !userId) throw new Error('密码本密钥不可用')
  const material = await crypto.subtle.importKey('raw', encoder.encode(secret), 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey({
    name: 'HKDF', hash: 'SHA-256',
    salt: encoder.encode('worldcredit-statement-vault'),
    info: encoder.encode('pdf-password-vault/v1:' + userId),
  }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

export async function encryptVaultPassword(password: string, secret: string, userId: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await vaultKey(secret, userId)
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(password)))
  const bytes = new Uint8Array(iv.length + ciphertext.length)
  bytes.set(iv)
  bytes.set(ciphertext, iv.length)
  return 'v1:' + btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function decryptVaultPassword(value: string, secret: string, userId: string): Promise<string> {
  if (!/^v1:[A-Za-z0-9_-]{38,}$/.test(value)) throw new Error('密码本密文格式无效')
  const binary = atob(value.slice(3).replace(/-/g, '+').replace(/_/g, '/'))
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
  const key = await vaultKey(secret, userId)
  return new TextDecoder().decode(await crypto.subtle.decrypt({
    name: 'AES-GCM', iv: bytes.subarray(0, 12),
  }, key, bytes.subarray(12)))
}
