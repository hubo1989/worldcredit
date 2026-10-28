import { describe, expect, it, vi } from "vitest";
import { refreshAccessToken, listMessageRefs, getRawMessage } from "../gmail/api";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

describe("gmail api client", () => {
  it("refreshes access token with client credentials", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ access_token: "at-1", expires_in: 3600, scope: "x" })
    );
    const tokens = await refreshAccessToken("rt-1", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      clientId: "cid",
      clientSecret: "cs",
    });
    expect(tokens.accessToken).toBe("at-1");
    const body = String(fetchImpl.mock.calls[0][1].body);
    expect(body).toContain("refresh_token=rt-1");
    expect(body).toContain("client_id=cid");
  });

  it("lists message refs with page token", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ messages: [{ id: "m1", threadId: "t1" }, { id: "m2" }], nextPageToken: "t2" })
    );
    const page = await listMessageRefs("at", "newer_than:30d 账单", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(page.refs).toEqual([
      { id: "m1", threadId: "t1" },
      { id: "m2", threadId: null },
    ]);
    expect(page.nextPageToken).toBe("t2");
    expect(String(fetchImpl.mock.calls[0][0])).toContain("q=newer_than");
  });

  it("returns raw message bytes decoded from base64url", async () => {
    const raw = new TextEncoder().encode("From: bank@example\r\n\r\nbody");
    const b64 = btoa(String.fromCharCode(...raw)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const fetchImpl = vi.fn(async () => jsonResponse({ raw: b64, id: "m1" }));
    const bytes = await getRawMessage("at", "m1", { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(new TextDecoder().decode(bytes)).toContain("body");
  });

  it("surfaces API errors with status and snippet", async () => {
    const fetchImpl = vi.fn(async () => new Response("quota exceeded", { status: 429 }));
    await expect(
      getRawMessage("at", "m1", { fetchImpl: fetchImpl as unknown as typeof fetch })
    ).rejects.toThrow(/429/);
  });
});
