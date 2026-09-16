// lib/base64url.ts — base64url helpers shared by the OAuth/ID-token modules.

export function toB64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromB64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function encodeB64UrlJson(value: unknown): string {
  return toB64Url(new TextEncoder().encode(JSON.stringify(value)))
}

export function decodeB64UrlJson<T>(value: string): T | null {
  try {
    return JSON.parse(new TextDecoder().decode(fromB64Url(value))) as T
  } catch {
    return null
  }
}
