// lib/admin-emails.ts — server-side allowlist of accounts that may hold the
// admin role.
//
// Admin is granted *explicitly* and never as a side effect of signing up. Both
// authorisation entrances used to hand out `role: 'admin'` automatically:
// the Google callback gave it to any brand-new Google account, and register
// gave it to whoever happened to be first in the table (a race, and one that
// reopens on any fresh database). Both now consult this list instead.
//
// Server-only on purpose: the browser must not need this list. Client code
// gates admin UI on `user.role` from the signed session, which the server
// already authoritative-ly sets at login.

export const ADMIN_EMAILS = ['hubo1989@gmail.com']

/** Case/whitespace-insensitive membership test; used at sign-in and sign-up. */
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false
  const normalized = email.trim().toLowerCase()
  return ADMIN_EMAILS.some(adminEmail => adminEmail.toLowerCase() === normalized)
}
