import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { proxy, config } from "../../proxy";
import { createSessionValue, type SessionUser } from "../session";
import { setWorkerEnv } from "../db/client";

const SESSION_SECRET = "root-redirect-test-session-secret";

const USER: SessionUser = {
  id: "user-123",
  email: "member@example.com",
  name: "Test Member",
  role: "member",
  created_at: "2026-10-05T00:00:00.000Z",
};

beforeEach(() => {
  setWorkerEnv({ SESSION_SECRET });
});

afterEach(() => {
  setWorkerEnv({});
});

describe("root route proxy", () => {
  it("matches only the landing page", () => {
    expect(config.matcher).toBe("/");
  });

  it("redirects a valid session from / to /dashboard", async () => {
    const session = await createSessionValue(USER);
    const request = new Request("https://worldcredit.example/", {
      headers: { cookie: `wc_user=${session}` },
    });

    const response = await proxy(request);

    expect(response?.status).toBe(307);
    expect(response?.headers.get("location")).toBe("https://worldcredit.example/dashboard");
  });

  it.each([undefined, "not-a-valid-session"])(
    "continues for an unauthenticated visitor (%s)",
    async (session) => {
      const headers = session ? { cookie: `wc_user=${session}` } : undefined;
      const request = new Request("https://worldcredit.example/", { headers });

      expect(await proxy(request)).toBeUndefined();
    },
  );

  it("does not redirect paths other than /", async () => {
    const session = await createSessionValue(USER);
    const request = new Request("https://worldcredit.example/dashboard", {
      headers: { cookie: `wc_user=${session}` },
    });

    expect(await proxy(request)).toBeUndefined();
  });
});
