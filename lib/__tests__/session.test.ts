// lib/__tests__/session.test.ts — HMAC session cookie contract.

import { describe, it, expect, beforeAll } from 'vitest'
import { createSessionValue, verifySessionValue } from '../session'
import { setWorkerEnv } from '../db/client'

const USER = {
  id: "user-1",
  email: "admin@example.com",
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
});
