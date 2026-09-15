// lib/__tests__/session.test.ts — HMAC session cookie contract.

import { describe, it, expect, beforeAll } from 'vitest'
import { createSessionValue, verifySessionValue } from '../session'
import { setWorkerEnv } from '../db/client'
import { ADMIN_EMAILS } from '../admin-emails'

const ADMIN_EMAIL = ADMIN_EMAILS[0]
const USER = {
  id: "user-1",
  email: ADMIN_EMAIL,
  name: "Admin",
  role: "admin" as const,
  created_at: "2026-09-11T00:00:00.000Z",
};

beforeAll(() => {
  setWorkerEnv({ SESSION_SECRET: "test-secret-at-least-16-chars" });
});

describe('signed session cookie', () => {
  it('round-trips a valid session', async () => {
    const value = await createSessionValue(USER);
    const parsed = await verifySessionValue(value);
    expect(parsed).not.toBeNull();
    expect(parsed!.id).toBe(USER.id);
    expect(parsed!.role).toBe("admin");
  });

  it('rejects tampered payloads', async () => {
    const value = await createSessionValue(USER);
    const [payload, sig] = value.split(".");
    const forged = Buffer.from(JSON.stringify({ ...USER, id: "attacker", role: "admin", exp: Math.floor(Date.now() / 1000) + 9999 })).toString("base64url");
    expect(await verifySessionValue(`${forged}.${sig}`)).toBeNull();
    expect(await verifySessionValue(`${payload}.badsignature`)).toBeNull();
  });

  it('rejects legacy unsigned cookies', async () => {
    const legacy = Buffer.from(JSON.stringify(USER)).toString("base64url");
    expect(await verifySessionValue(legacy)).toBeNull();
    expect(await verifySessionValue(JSON.stringify(USER))).toBeNull();
    expect(await verifySessionValue(null)).toBeNull();
  });

  it('rejects expired sessions', async () => {
    const value = await createSessionValue(USER);
    const [payload, sig] = value.split(".");
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString());
    decoded.exp = Math.floor(Date.now() / 1000) - 10;
    const expired = Buffer.from(JSON.stringify(decoded)).toString("base64url");
    expect(await verifySessionValue(`${expired}.${sig}`)).toBeNull();
  });

  it('derives the role from the allowlist, not from the cookie payload', async () => {
    // A cookie minted while the account held admin must stop being admin as soon
    // as the email leaves the allowlist. Otherwise tightening the sign-in
    // entrances would leave already-issued admin cookies live for their full
    // 7-day lifetime.
    const stale = await createSessionValue({
      ...USER,
      id: 'test-user',
      email: 'test@worldcredit.dev',
      role: 'admin',
    })
    const parsed = await verifySessionValue(stale)
    expect(parsed).not.toBeNull()
    expect(parsed!.email).toBe('test@worldcredit.dev')
    expect(parsed!.role).toBe('member')
  });

  it('grants admin only to an allowlisted email', async () => {
    const value = await createSessionValue(USER)
    const parsed = await verifySessionValue(value)
    expect(parsed!.role).toBe('admin')

    const memberValue = await createSessionValue({ ...USER, email: 'someone@example.com', role: 'admin' })
    expect((await verifySessionValue(memberValue))!.role).toBe('member')
  });
});
