// lib/opportunities/hash.ts — canonical request hashing for idempotent
// commands (tech spec §7.1). The request_hash covers ONLY the whitelist the
// command type declares, in a fixed order: object keys sorted, no undefined
// values, finite numbers. Client-supplied balances, actor identity or extra
// payload keys outside the whitelist never enter the hash.

export type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | CanonicalValue[]
  | { [key: string]: CanonicalValue | undefined }

/**
 * Deterministic JSON: object keys sorted, `undefined` values dropped, arrays
 * order-preserving. Non-finite numbers are rejected — they have no stable
 * serialization and must never reach a command payload.
 */
export function canonicalJson(value: CanonicalValue): string {
  if (value === null) return 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('canonicalJson: non-finite numbers cannot be hashed')
    }
    return JSON.stringify(value)
  }
  if (typeof value === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v ?? null)).join(',')}]`
  const record = value as { [key: string]: CanonicalValue | undefined }
  const entries = Object.keys(record)
    .filter((k) => record[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k] as CanonicalValue)}`)
  return `{${entries.join(',')}}`
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * request_hash over the whitelisted fields only. Fields are deduplicated and
 * sorted so declaration order cannot change the hash; a missing whitelist
 * field hashes as `null`. Keys outside `fields` are ignored entirely.
 */
export async function hashCommandPayload(
  fields: readonly string[],
  payload: Record<string, unknown>,
): Promise<string> {
  const ordered = [...new Set(fields)].sort()
  const canonical = ordered
    .map((field) => `${JSON.stringify(field)}=${canonicalJson((payload[field] ?? null) as CanonicalValue)}`)
    .join('\n')
  return sha256Hex(canonical)
}
