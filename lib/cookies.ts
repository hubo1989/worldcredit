// lib/cookies.ts — cookie header parsing shared by the session and OAuth state cookies.

export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined
  // Split-based parsing: a malformed dynamic RegExp here silently breaks every
  // request whose target cookie is not the first one in the header.
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1)
  }
  return undefined
}
