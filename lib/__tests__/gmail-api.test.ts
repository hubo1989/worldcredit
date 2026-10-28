import { describe, expect, it, vi } from "vitest";
import { refreshAccessToken, listMessageRefs, getRawMessage } from "../gmail/api";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

type FetchCall = [RequestInfo | URL, RequestInit | undefined];

function mockFetch(handler: (url: string) => Promise<Response>) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    void init;
    return handler(String(input));
  });
  const firstCall = () => fn.mock.calls[0] as unknown as FetchCall;
  return Object.assign(fn, { firstCall });
}

describe("gmail api client", () => {
  it("refreshes access token with client credentials", async () => {
    const fetchImpl = mockFetch(async () =>
      jsonResponse({ access_token: "at-1", expires_in: 3600, scope: "x" }),
    );
    const tokens = await refreshAccessToken("rt-1", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      clientId: "cid",
      clientSecret: "cs",
    });
    expect(tokens.accessToken).toBe("at-1");
    const body = String(fetchImpl.firstCall()[1]?.body);
    expect(body).toContain("refresh_token=rt-1");
    expect(body).toContain("client_id=cid");
  });

  it("lists message refs with page token", async () => {
    const fetchImpl = mockFetch(async () =>
      jsonResponse({ messages: [{ id: "m1", threadId: "t1" }, { id: "m2" }], nextPageToken: "t2" }),
    );
    const page = await listMessageRefs("at", "newer_than:30d 账单", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(page.refs).toEqual([
      { id: "m1", threadId: "t1" },
      { id: "m2", threadId: null },
    ]);
    expect(page.nextPageToken).toBe("t2");
    expect(String(fetchImpl.firstCall()[0])).toContain("q=newer_than");
  });

  it("returns raw message bytes decoded from base64url", async () => {
    const raw = new TextEncoder().encode("From: bank@example\r\n\r\nbody");
    const b64 = btoa(String.fromCharCode(...raw))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const fetchImpl = mockFetch(async () => jsonResponse({ raw: b64, id: "m1" }));
    const bytes = await getRawMessage("at", "m1", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(new TextDecoder().decode(bytes)).toContain("body");
  });

  it("surfaces API errors with status and snippet", async () => {
    const fetchImpl = mockFetch(async () => new Response("quota exceeded", { status: 429 }));
    await expect(
      getRawMessage("at", "m1", { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toThrow(/429/);
  });
});
