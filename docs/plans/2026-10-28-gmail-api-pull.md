# Gmail API 直连拉取账单 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 用户授权 Gmail（gmail.readonly）后，服务端直接拉取银行账单邮件：证据足的直接合并落账单，不足的预填草稿等账单页手改；原文 .eml 存 R2 留证；手动同步 + 每日 cron。

**Architecture:** 先把 email-worker 的邮件解析/落库管线抽到 `lib/email-core/`（两侧共用一套语义，禁止复制）；新增 `lib/gmail/` 负责 OAuth token 加密存储、Gmail API 客户端与同步引擎；同步引擎按 email-worker 同款口径路由——字段齐 + 持卡人/卡命中 → `upsertBillForCard` 直接落，否则 `parkBillAsDraft` 预填草稿。每个 Gmail message 落一行 `gmail_sync_messages` 做去重与审计。

**Tech Stack:** Cloudflare Workers + D1 + R2、Gmail REST API v1（users.messages.list/get format=raw）、WebCrypto AES-GCM/HKDF、vitest（node:sqlite D1 假件 `lib/__tests__/helpers/sqlite-d1.ts`，自动套用 `migrations/d1/`）。

**产品决策（已确认）：**
1. 接受 `gmail.readonly` 授权范围（Google 无按发件人细分的 scope）。
2. 入库路由：证据足够 → 直接落账单（合并语义）；不足 → 把可代入信息预填进草稿，账单页手动修改确认。
3. 触发：设置页手动「立即同步」+ 每日 cron（`0 9 * * *`）。

**背景（为什么不是 SMTP 转发）：** Gmail 自动转发会破坏银行 DKIM 对齐，银行域 `DMARC p=reject` 时 Cloudflare Email Routing 直接 `550 5.7.1 DMARC checks failed` 拒收（2026-10-26 实测退信），信根本进不了 worker。直连 Gmail API 绕开整条 SMTP 转发链。

**边界与安全：**
- refresh token 用 `SESSION_SECRET` 派生密钥 AES-GCM 加密后入 D1，不进日志。
- 原文 `.eml` 存 R2 `gmail-raw/{user_id}/{gmail_message_id}.eml`，断开连接时删除 token 与 R2 副本（账单/草稿业务数据保留）。
- Gmail 侧真正的「原文永久留存」在用户邮箱里；R2 是服务端留证副本。
- 不做 Gmail History API（historyId 一周过期）；用 `after:` 查询 + 去重表兜底，YAGNI。

---

## Task 0: 分支与基线

**Files:** 无（只做 git 操作）

**Step 1: 从 main 切特性分支**（当前 worktree 停在 `feat/ios-native-sync-p0`，Gmail 特性与 iOS 同步无关，另开分支）

```bash
git stash list --format='%H %gs' | head -3   # 记录现场，确认没有属于本任务的 stash
git fetch origin main
git checkout -b feat/gmail-api-pull origin/main
```

**Step 2: 记录基线绿**

```bash
npm run typecheck && npm run lint && npm test
cd email-worker && npm run typecheck && npm test
```

Expected: 全绿。若基线已有失败，停下来报告，不要在红基线上开工。

**Step 3: Commit**（无改动则跳过）

---

## Task 1: 抽出共享邮件管线 `lib/email-core/`

email-worker（`email-worker/src/{types,mime,holders,bills}.ts` + index.ts 里的 AI 解析）与新的 Gmail 同步引擎必须共用同一套「解析 → 认人 → 找/建卡 → 落账单/停草稿」语义。主 tsconfig 已 `exclude: ["email-worker"]`，所以共享代码放进主工程的 `lib/email-core/`，email-worker 反过来相对导入。

**Files:**
- Move: `email-worker/src/types.ts` → `lib/email-core/types.ts`
- Move: `email-worker/src/mime.ts` → `lib/email-core/mime.ts`
- Move: `email-worker/src/holders.ts` → `lib/email-core/holders.ts`
- Move: `email-worker/src/bills.ts` → `lib/email-core/bills.ts`
- Create: `lib/email-core/ai.ts`（从 `email-worker/src/index.ts` 抽出 SYSTEM_PROMPT / loadAiConfig / parseBillWithAI）
- Create: `lib/email-core/index.ts`（桶导出）
- Modify: `email-worker/src/index.ts`、`email-worker/src/forwarded.ts`、`email-worker/__tests__/*.test.ts` 的 import 路径

**Step 1: 移动文件**

```bash
mkdir -p lib/email-core
git mv email-worker/src/types.ts lib/email-core/types.ts
git mv email-worker/src/mime.ts lib/email-core/mime.ts
git mv email-worker/src/holders.ts lib/email-core/holders.ts
git mv email-worker/src/bills.ts lib/email-core/bills.ts
```

内部相对导入保持不变（`./types`、`./mime`、`./holders` 在同目录内依然成立）。

**Step 2: 抽出 AI 解析到 `lib/email-core/ai.ts`**

把 `email-worker/src/index.ts` 中的 `SYSTEM_PROMPT`、`loadAiConfig`、`parseBillWithAI` 原样搬到新文件（AI config 形状来自 `types.ts` 的 `AiConfig`），文件头注释保留原说明。`index.ts` 里删除这三个定义，改从共享模块导入。

**Step 3: 建桶导出 `lib/email-core/index.ts`**

```typescript
// lib/email-core/index.ts — shared email→bill pipeline used by BOTH the
// email-worker (Cloudflare Email Routing) and the Gmail pull sync engine.
// Keeping one copy is load-bearing: keepPaidStatus / 0 元账单 / 账单日回写等
// 口径曾因两份实现而漂移过（见 email-worker/src/bills.ts 注释）。
export * from './types'
export * from './mime'
export * from './holders'
export * from './bills'
export * from './ai'
```

**Step 4: 更新 email-worker 侧 import**

- `email-worker/src/index.ts`：`./types|./mime|./bills|./holders` 中属于共享模块的改为 `../../lib/email-core`（`forwarded.ts`/`push.ts` 仍在本地）。
- `email-worker/src/forwarded.ts`：`./types`、`./bills`、`./holders` 改 `../../lib/email-core`。
- `email-worker/__tests__/*.test.ts`：`../src/mime` → `../../lib/email-core/mime` 等，逐个改。

**Step 5: 两个测试套件都跑绿**

```bash
npm run typecheck && npm test
cd email-worker && npm run typecheck && npm test
```

Expected: 与基线同样全绿（行为零变化）。

**Step 6: Commit**

```bash
git add -A
git commit -m "refactor(email-core): extract shared email-to-bill pipeline from email-worker"
```

---

## Task 2: 迁移 0023 — gmail 连接与去重表

**Files:**
- Create: `migrations/d1/0023_gmail_connections.sql`

**Step 1: 写迁移**

```sql
-- 0023: Gmail 直连拉取（path C）——连接凭据与消息去重/审计。
-- refresh_token_enc / access_token_enc 是 AES-GCM 密文（lib/gmail/token-crypto.ts），
-- 明文 token 绝不落库、绝不进日志。

CREATE TABLE IF NOT EXISTS gmail_connections (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  google_sub TEXT NOT NULL,
  email TEXT NOT NULL,
  refresh_token_enc TEXT NOT NULL,
  access_token_enc TEXT,
  access_token_expires_at TEXT,
  scopes TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'error', 'revoked')),
  last_error TEXT,
  last_sync_at TEXT,
  last_sync_summary TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS gmail_sync_messages (
  gmail_message_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  thread_id TEXT,
  rfc_message_id TEXT,
  from_email TEXT,
  subject TEXT,
  internal_date TEXT,
  raw_r2_key TEXT,
  status TEXT NOT NULL CHECK (status IN ('bill_written', 'draft_parked', 'skipped', 'failed')),
  bill_id TEXT,
  draft_id TEXT,
  parse_confidence REAL,
  error_msg TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_gmail_sync_messages_user
  ON gmail_sync_messages(user_id, created_at DESC);
```

**Step 2: 本地验证迁移可套用**（sqlite-d1 测试假件自动重放 `migrations/d1/`，Task 5 的测试即覆盖；此处做语法级确认）

```bash
cd email-worker && npx vitest run __tests__/mime.test.ts
```

Expected: 现有测试仍绿（迁移能被套用、没写坏旧表）。

**Step 3: Commit**

```bash
git add migrations/d1/0023_gmail_connections.sql
git commit -m "feat(db): add gmail_connections and gmail_sync_messages tables"
```

---

## Task 3: Token 加密（AES-GCM + HKDF）

**Files:**
- Create: `lib/gmail/token-crypto.ts`
- Test: `lib/__tests__/gmail-token-crypto.test.ts`

**Step 1: 写失败测试**

```typescript
// lib/__tests__/gmail-token-crypto.test.ts
import { describe, expect, it } from "vitest";
import { encryptToken, decryptToken, GmailCryptoError } from "../gmail/token-crypto";

const SECRET = "test-session-secret-for-gmail-tokens";

describe("gmail token crypto", () => {
  it("round-trips a refresh token", async () => {
    const enc = await encryptToken("1//0refresh-token-é中文", SECRET);
    expect(enc).not.toContain("refresh-token");
    expect(await decryptToken(enc, SECRET)).toBe("1//0refresh-token-é中文");
  });

  it("produces different ciphertexts for the same plaintext (random IV)", async () => {
    const a = await encryptToken("same", SECRET);
    const b = await encryptToken("same", SECRET);
    expect(a).not.toBe(b);
  });

  it("fails closed on wrong key or tampered ciphertext", async () => {
    const enc = await encryptToken("secret-value", SECRET);
    await expect(decryptToken(enc, "other-secret-xxxxxxxx")).rejects.toBeInstanceOf(GmailCryptoError);
    const tampered = enc.slice(0, -4) + (enc.endsWith("AAAA") ? "BBBB" : "AAAA");
    await expect(decryptToken(tampered, SECRET)).rejects.toBeInstanceOf(GmailCryptoError);
  });
});
```

**Step 2: 跑测试确认失败**

```bash
npx vitest run lib/__tests__/gmail-token-crypto.test.ts
```

Expected: FAIL（模块不存在）。

**Step 3: 最小实现**

```typescript
// lib/gmail/token-crypto.ts — Gmail OAuth token 静态加密（server only）。
//
// refresh token 是长期凭据，等价于「读完整个邮箱」的授权。D1 明文存储在
// 导出/备份/误读时等于凭证泄露，所以落库前用 SESSION_SECRET 派生的 AES-GCM
// 密钥加密；派生用 HKDF，避免直接拿 session 密钥当加密密钥（职责分开，
// session 签名密钥轮换语义不被加密用途绑死）。

export class GmailCryptoError extends Error {}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

async function deriveKey(secret: string): Promise<CryptoKey> {
  if (!secret) throw new GmailCryptoError('SESSION_SECRET 未配置，无法加解密 Gmail token')
  const material = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), 'HKDF', false, ['deriveKey']
  )
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: encoder.encode('worldcredit-gmail'),
      info: encoder.encode('gmail-tokens/v1'),
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

function toB64Url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromB64Url(value: string): Uint8Array {
  const bin = atob(value.replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** 密文格式：base64url( 12B IV || AES-GCM CT )。 */
export async function encryptToken(plain: string, secret: string): Promise<string> {
  const key = await deriveKey(secret)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(plain))
  )
  const joined = new Uint8Array(iv.length + ct.length)
  joined.set(iv, 0)
  joined.set(ct, iv.length)
  return toB64Url(joined)
}

export async function decryptToken(enc: string, secret: string): Promise<string> {
  try {
    const joined = fromB64Url(enc)
    if (joined.length <= 12) throw new GmailCryptoError('密文长度非法')
    const key = await deriveKey(secret)
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: joined.slice(0, 12) }, key, joined.slice(12)
    )
    return decoder.decode(plain)
  } catch (err) {
    if (err instanceof GmailCryptoError) throw err
    throw new GmailCryptoError('Gmail token 解密失败（密钥不匹配或密文被篡改）')
  }
}
```

**Step 4: 跑测试确认通过**

```bash
npx vitest run lib/__tests__/gmail-token-crypto.test.ts
```

Expected: PASS。

**Step 5: Commit**

```bash
git add lib/gmail/token-crypto.ts lib/__tests__/gmail-token-crypto.test.ts
git commit -m "feat(gmail): encrypt OAuth tokens at rest with HKDF-derived AES-GCM"
```

---

## Task 4: Gmail API 客户端

**Files:**
- Create: `lib/gmail/api.ts`
- Test: `lib/__tests__/gmail-api.test.ts`

**Step 1: 写失败测试**（mock fetch，不打真实网络）

```typescript
// lib/__tests__/gmail-api.test.ts
import { describe, expect, it, vi } from "vitest";
import { refreshAccessToken, listMessageIds, getRawMessage } from "../gmail/api";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

describe("gmail api client", () => {
  it("refreshes access token with client credentials", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ access_token: "at-1", expires_in: 3600, scope: "x" })
    );
    const tokens = await refreshAccessToken("rt-1", {
      fetchImpl,
      clientId: "cid",
      clientSecret: "cs",
    });
    expect(tokens.accessToken).toBe("at-1");
    const body = String(fetchImpl.mock.calls[0][1].body);
    expect(body).toContain("refresh_token=rt-1");
    expect(body).toContain("client_id=cid");
  });

  it("lists message ids with page token", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ messages: [{ id: "m1" }, { id: "m2" }], nextPageToken: "t2" })
    );
    const page = await listMessageIds("at", "newer_than:30d 账单", { fetchImpl });
    expect(page.ids).toEqual(["m1", "m2"]);
    expect(page.nextPageToken).toBe("t2");
    expect(String(fetchImpl.mock.calls[0][0])).toContain("q=newer_than");
  });

  it("returns raw message bytes decoded from base64url", async () => {
    const raw = new TextEncoder().encode("From: bank@example\r\n\r\nbody");
    const b64 = btoa(String.fromCharCode(...raw)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const fetchImpl = vi.fn(async () => jsonResponse({ raw: b64, id: "m1" }));
    const bytes = await getRawMessage("at", "m1", { fetchImpl });
    expect(new TextDecoder().decode(bytes)).toContain("body");
  });

  it("surfaces API errors with status and snippet", async () => {
    const fetchImpl = vi.fn(async () => new Response("quota exceeded", { status: 429 }));
    await expect(getRawMessage("at", "m1", { fetchImpl })).rejects.toThrow(/429/);
  });
});
```

**Step 2: 确认失败**

```bash
npx vitest run lib/__tests__/gmail-api.test.ts
```

Expected: FAIL（模块不存在）。

**Step 3: 最小实现**

```typescript
// lib/gmail/api.ts — Gmail REST v1 薄客户端（server only）。
// 只封装本项目用到的三个端点：refresh token、列表、取原始 .eml。
// 所有函数接受可注入 fetchImpl 与凭证，测试不打真实网络。

export interface GmailClientOptions {
  fetchImpl?: typeof fetch
  clientId?: string
  clientSecret?: string
}

export interface GmailTokenSet {
  accessToken: string
  expiresIn: number
}

export interface GmailMessageRef {
  id: string
  threadId: string | null
}

async function callJson(
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch
): Promise<Record<string, unknown>> {
  const res = await fetchImpl(url, init)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Gmail API error (${res.status}): ${text.slice(0, 300)}`)
  }
  return res.json() as Promise<Record<string, unknown>>
}

export async function refreshAccessToken(
  refreshToken: string,
  opts?: GmailClientOptions
): Promise<GmailTokenSet> {
  const fetchImpl = opts?.fetchImpl ?? fetch
  const json = await callJson('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: opts?.clientId ?? '',
      client_secret: opts?.clientSecret ?? '',
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  }, fetchImpl)
  return {
    accessToken: String(json.access_token ?? ''),
    expiresIn: Number(json.expires_in ?? 0),
  }
}

export async function listMessageRefs(
  accessToken: string,
  q: string,
  opts?: GmailClientOptions & { maxResults?: number; pageToken?: string }
): Promise<{ refs: GmailMessageRef[]; nextPageToken: string | null }> {
  const fetchImpl = opts?.fetchImpl ?? fetch
  const params = new URLSearchParams({ q, maxResults: String(opts?.maxResults ?? 50) })
  if (opts?.pageToken) params.set('pageToken', opts.pageToken)
  const json = await callJson(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
    fetchImpl
  )
  const messages = Array.isArray(json.messages) ? json.messages as Array<{ id?: string; threadId?: string }> : []
  return {
    refs: messages
      .map(m => ({ id: String(m.id ?? ''), threadId: m.threadId ? String(m.threadId) : null }))
      .filter(m => m.id),
    nextPageToken: json.nextPageToken ? String(json.nextPageToken) : null,
  }
}

/** format=raw 的 raw 字段是 base64url 编码的完整 .eml 字节。 */
export async function getRawMessage(
  accessToken: string,
  messageId: string,
  opts?: GmailClientOptions
): Promise<Uint8Array> {
  const fetchImpl = opts?.fetchImpl ?? fetch
  const json = await callJson(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?format=raw`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
    fetchImpl
  )
  const rawB64 = String(json.raw ?? '').replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(rawB64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
```

> 凭证一律显式注入（`clientId/clientSecret` 由同步引擎从 env 读了传进来），客户端模块不探测 env，测试更干净。

**Step 4: 确认通过**

```bash
npx vitest run lib/__tests__/gmail-api.test.ts
```

Expected: PASS。

**Step 5: Commit**

```bash
git add lib/gmail/api.ts lib/__tests__/gmail-api.test.ts
git commit -m "feat(gmail): add thin Gmail REST client for token refresh and raw messages"
```

---

## Task 5: 同步引擎（核心）

**Files:**
- Create: `lib/gmail/sync.server.ts`
- Test: `lib/__tests__/gmail-sync.test.ts`

**Step 1: 写失败测试**（真 sqlite D1 假件 + mock Gmail fetch + mock AI 解析）

```typescript
// lib/__tests__/gmail-sync.test.ts
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setDb, setWorkerEnv } from "../db/client";
import { createOpportunityDb, type SqliteD1 } from "./helpers/sqlite-d1";
import { encryptToken } from "../gmail/token-crypto";
import { syncUserGmail, __setGmailSyncDeps } from "../gmail/sync.server";

let db: SqliteD1;

const RAW_EML = new TextEncoder().encode(
  "From: statements@chase.com\r\nTo: Hubo <hubo@example.com>\r\nSubject: Your statement\r\n\r\n尊敬的Hubo先生，本期应还 1234.56"
);

function toRawB64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function gmailFetch(handlers: { list: unknown; raw: unknown }) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/messages?")) return new Response(JSON.stringify(handlers.list));
    if (url.includes("/token")) {
      return new Response(JSON.stringify({ access_token: "at", expires_in: 3600 }));
    }
    return new Response(JSON.stringify(handlers.raw));
  });
}

beforeAll(() => {
  setWorkerEnv({ SESSION_SECRET: "test-gmail-sync-secret", GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "cs" });
});

beforeEach(async () => {
  db = createOpportunityDb();
  setDb(db as unknown as D1Database);
  await db.prepare("INSERT INTO users (id,email,password_hash,name,role,created_at) VALUES (?,?,?,?,?,?)")
    .bind("u1", "u1@example.test", "x", "U", "member", "2026-10-01T00:00:00Z").run();
  await db.prepare("INSERT INTO card_holders (id,created_by,name,created_at,updated_at) VALUES (?,?,?,?,?)")
    .bind("h1", "u1", "Hubo", "2026-10-01T00:00:00Z", "2026-10-01T00:00:00Z").run();
  const enc = await encryptToken("rt-1", "test-gmail-sync-secret");
  await db.prepare(
    "INSERT INTO gmail_connections (user_id,google_sub,email,refresh_token_enc,scopes,status) VALUES (?,?,?,?,?,?)"
  ).bind("u1", "sub1", "u1@example.test", enc, "gmail.readonly", "active").run();
});

const parseOk = {
  is_bill: true, email_kind: "statement", bank_name: "Chase Bank", card_last4: "7491",
  bill_amount: 1234.56, min_payment: 100, due_date: "2026-11-10", bill_month: "2026-10",
  statement_date: "2026-10-16", currency: "USD", confidence: 0.95,
};

describe("syncUserGmail", () => {
  it("证据足够时直接落账单，并记录去重行", async () => {
    __setGmailSyncDeps({
      parse: async () => ({ ...parseOk }),
      fetchImpl: gmailFetch({
        list: { messages: [{ id: "m1", threadId: "t1" }] },
        raw: { raw: toRawB64(RAW_EML), id: "m1" },
      }),
    });
    await db.prepare("INSERT INTO card_products (id,bank_name,card_name,currency,is_active,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
      .bind("p1", "Chase Bank", "Sapphire", "USD", 1, "2026-10-01T00:00:00Z", "2026-10-01T00:00:00Z").run();

    const summary = await syncUserGmail("u1");
    expect(summary.written).toBe(1);
    const bill = await db.prepare("SELECT * FROM bills").all();
    expect(bill.results.length).toBe(1);
    const msg = await db.prepare("SELECT * FROM gmail_sync_messages WHERE gmail_message_id='m1'").first();
    expect(msg.status).toBe("bill_written");
  });

  it("证据不足（识别不出持卡人且不可信）时停草稿", async () => {
    __setGmailSyncDeps({
      parse: async () => ({ ...parseOk }),
      fetchImpl: gmailFetch({
        list: { messages: [{ id: "m2", threadId: "t2" }] },
        raw: { raw: toRawB64(RAW_EML), id: "m2" },
      }),
    });
    await db.prepare("DELETE FROM card_holders").run(); // 无持卡人 → 预填草稿

    const summary = await syncUserGmail("u1");
    expect(summary.drafted).toBe(1);
    const draft = await db.prepare("SELECT * FROM bill_import_drafts").first();
    expect(draft.status).toBe("draft");
    expect(draft.source_type).toBe("email");
  });

  it("同一封邮件第二次同步不重复处理", async () => {
    const deps = {
      parse: async () => ({ ...parseOk }),
      fetchImpl: gmailFetch({ list: { messages: [{ id: "m3" }] }, raw: { raw: toRawB64(RAW_EML), id: "m3" } }),
    };
    __setGmailSyncDeps(deps);
    await db.prepare("INSERT INTO card_products (id,bank_name,card_name,currency,is_active,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
      .bind("p1", "Chase Bank", "Sapphire", "USD", 1, "2026-10-01T00:00:00Z", "2026-10-01T00:00:00Z").run();

    await syncUserGmail("u1");
    const second = await syncUserGmail("u1");
    expect(second.scanned).toBe(1);
    expect(second.written + second.drafted + second.skipped + second.failed).toBe(0);
  });

  it("非账单邮件记 skipped 且不建账单", async () => {
    __setGmailSyncDeps({
      parse: async () => ({ is_bill: false, email_kind: "other" }),
      fetchImpl: gmailFetch({
        list: { messages: [{ id: "m4" }] },
        raw: { raw: toRawB64(RAW_EML), id: "m4" },
      }),
    });
    const summary = await syncUserGmail("u1");
    expect(summary.skipped).toBe(1);
    expect((await db.prepare("SELECT COUNT(*) c FROM bills").first()).c).toBe(0);
  });
});
```

> 卡表 fixture 列名以 `migrations/d1/0001` 为准；如与上面 INSERT 列不符，对照 `email-worker/__tests__/persist-bills.test.ts` 的 fixture 写法调整。

**Step 2: 确认失败**

```bash
npx vitest run lib/__tests__/gmail-sync.test.ts
```

Expected: FAIL（模块不存在）。

**Step 3: 实现同步引擎**

```typescript
// lib/gmail/sync.server.ts — Gmail 拉取 → 解析 → 落账单/停草稿（server only）。
//
// 路由口径与 email-worker 完全一致（共用 lib/email-core）：
//   字段齐 + 持卡人命中 + 卡命中/可建 → upsertBillForCard 直接合并落账单
//   其余（认不出人、卡对不上、字段缺）→ parkBillAsDraft 预填草稿，账单页手改
// 每个 Gmail message 必写 gmail_sync_messages 一行做去重与审计。

import { getDb, getWorkerEnv } from '../db/client'
import { query, queryOne, execute } from '../db/helpers'
import {
  loadAiConfig,
  parseBillWithAI,
  parseRawMessage,
  loadHolderScope,
  resolveHolder,
  extractHeaderDisplayName,
  extractNameFromBody,
  findOrCreateCardForHolder,
  upsertBillForCard,
  parkBillAsDraft,
  syncBillingDayFromBill,
  type BillParseResult,
} from '../email-core'
import { decryptToken } from './token-crypto'
import { refreshAccessToken, listMessageRefs, getRawMessage, type GmailClientOptions } from './api'

export interface GmailSyncSummary {
  scanned: number
  written: number
  drafted: number
  skipped: number
  failed: number
  errors: string[]
}

/** 预筛查询：宁可多拉几封让 AI 用 email_kind 门禁过滤，也不要漏账单。 */
const DEFAULT_QUERY =
  'newer_than:30d (账单 OR 对账单 OR 月结单 OR statement OR "payment due" OR "e-statement")'

interface SyncDeps {
  parse: (text: string) => Promise<BillParseResult>
  fetchImpl?: typeof fetch
  clientId?: string
  clientSecret?: string
  sessionSecret?: string
  bucket?: R2Bucket | null
}

let depsOverride: SyncDeps | null = null
/** 仅测试用：注入 AI 解析、fetch 与 R2。 */
export function __setGmailSyncDeps(deps: SyncDeps | null) {
  depsOverride = deps
}

function resolveSecret(override?: string): string {
  if (override) return override
  const env = getWorkerEnv() as { SESSION_SECRET?: string }
  return env.SESSION_SECRET
    ?? (typeof process !== 'undefined' ? process.env?.SESSION_SECRET ?? '' : '')
}

export async function syncUserGmail(userId: string): Promise<GmailSyncSummary> {
  const summary: GmailSyncSummary = { scanned: 0, written: 0, drafted: 0, skipped: 0, failed: 0, errors: [] }
  const db = getDb()

  const conn = await queryOne<{ user_id: string; refresh_token_enc: string }>(
    "SELECT user_id, refresh_token_enc FROM gmail_connections WHERE user_id = ? AND status = 'active'",
    [userId]
  )
  if (conn.error) throw new Error(conn.error.message)
  if (!conn.data) throw new Error('未连接 Gmail 或连接已停用')

  const deps: SyncDeps = depsOverride ?? {
    parse: (text) => parseBillWithAI(await loadAiConfigSync(db), text),
  }
  const secret = resolveSecret(deps.sessionSecret)
  const env = getWorkerEnv() as { GOOGLE_CLIENT_ID?: string; GOOGLE_CLIENT_SECRET?: string; ATTACHMENTS?: R2Bucket }
  const clientOpts: GmailClientOptions = {
    fetchImpl: deps.fetchImpl,
    clientId: deps.clientId ?? env.GOOGLE_CLIENT_ID ?? process.env?.GOOGLE_CLIENT_ID,
    clientSecret: deps.clientSecret ?? env.GOOGLE_CLIENT_SECRET ?? process.env?.GOOGLE_CLIENT_SECRET,
  }

  const refreshToken = await decryptToken(conn.data.refresh_token_enc, secret)
  const tokens = await refreshAccessToken(refreshToken, clientOpts)
  await execute(
    "UPDATE gmail_connections SET access_token_expires_at = ?, updated_at = datetime('now') WHERE user_id = ?",
    [new Date(Date.now() + tokens.expiresIn * 1000).toISOString(), userId]
  )

  const { refs } = await listMessageRefs(tokens.accessToken, DEFAULT_QUERY, clientOpts)
  summary.scanned = refs.length

  for (const ref of refs) {
    const seen = await queryOne(
      'SELECT gmail_message_id FROM gmail_sync_messages WHERE gmail_message_id = ?', [ref.id]
    )
    if (seen.data) continue

    try {
      const raw = await getRawMessage(tokens.accessToken, ref.id, clientOpts)
      const parsedTop = parseRawMessage(raw)
      const r2Key = `gmail-raw/${userId}/${ref.id}.eml`
      const bucket = deps.bucket !== undefined ? deps.bucket : (env.ATTACHMENTS ?? null)
      if (bucket) await bucket.put(r2Key, raw as unknown as ArrayBuffer)

      const aiResult = await deps.parse(parsedTop.text)
      const outcome = await routeParsedMessage({ db, userId, top: parsedTop, aiResult })

      await execute(
        `INSERT INTO gmail_sync_messages
           (gmail_message_id, user_id, thread_id, rfc_message_id, from_email, subject, internal_date,
            raw_r2_key, status, bill_id, draft_id, parse_confidence, error_msg)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          ref.id, userId, ref.threadId,
          parsedTop.headers['message-id'] ?? null,
          parsedTop.headers.from ?? null,
          parsedTop.headers.subject ?? null,
          parsedTop.headers.date ?? null,
          r2Key, outcome.status, outcome.billId ?? null, outcome.draftId ?? null,
          typeof aiResult.confidence === 'number' ? aiResult.confidence : null,
          outcome.reason ?? null,
        ]
      )
      if (outcome.status === 'bill_written') summary.written++
      else if (outcome.status === 'draft_parked') summary.drafted++
      else if (outcome.status === 'skipped') summary.skipped++
      else summary.failed++
    } catch (err) {
      summary.failed++
      const msg = err instanceof Error ? err.message : String(err)
      summary.errors.push(`${ref.id}: ${msg}`)
      await execute(
        "INSERT INTO gmail_sync_messages (gmail_message_id, user_id, status, error_msg) VALUES (?,?, 'failed', ?)",
        [ref.id, userId, msg]
      )
    }
  }

  const summaryText =
    `扫描 ${summary.scanned}｜落账单 ${summary.written}｜草稿 ${summary.drafted}｜跳过 ${summary.skipped}｜失败 ${summary.failed}`
  await execute(
    "UPDATE gmail_connections SET last_sync_at = datetime('now'), last_sync_summary = ?, last_error = ?, updated_at = datetime('now') WHERE user_id = ?",
    [summaryText, summary.errors[0] ?? null, userId]
  )
  return summary
}

// loadAiConfig 是 async；depsOverride 为 null 时用它现取 AI 配置。
async function loadAiConfigSync(db: D1Database) {
  return loadAiConfig(db)
}

interface RouteOutcome {
  status: 'bill_written' | 'draft_parked' | 'skipped' | 'failed'
  billId?: string | null
  draftId?: string | null
  reason?: string | null
}

/**
 * 与 email-worker/src/index.ts 同款路由：
 *   email_kind 非 statement、字段缺 → skipped
 *   认得出人且（卡命中或可信可建卡）→ upsertBillForCard
 *   其余一切「解析出了账单但自动落不下去」→ 预填草稿
 */
async function routeParsedMessage(params: {
  db: D1Database
  userId: string
  top: ReturnType<typeof parseRawMessage>
  aiResult: BillParseResult
}): Promise<RouteOutcome> {
  const { db, userId, top, aiResult } = params

  if (aiResult.email_kind && aiResult.email_kind !== 'statement') {
    return { status: 'skipped', reason: `非账单邮件（email_kind=${aiResult.email_kind}）` }
  }
  const zeroBill = Number(aiResult.bill_amount) === 0
  if (
    aiResult.is_bill === false ||
    !aiResult.bill_month ||
    aiResult.bill_amount == null || Number.isNaN(Number(aiResult.bill_amount)) ||
    (!zeroBill && !aiResult.due_date)
  ) {
    return { status: 'skipped', reason: 'Not a bill email or missing required fields' }
  }

  const scope = await loadHolderScope(db, userId)
  const toHeader = top.headers.to ?? ''
  const resolution = resolveHolder({
    holders: scope.holders,
    defaultHolderId: scope.defaultHolderId,
    headerName: extractHeaderDisplayName(toHeader),
    bodyName: extractNameFromBody(top.text),
  })
  const trusted = resolution.source === 'header_name' || resolution.source === 'body_honorific'

  const prefill = { ...aiResult, raw_text: top.text.slice(0, 2000) }

  if (!resolution.holderId) {
    const draftId = await parkBillAsDraft(db, userId, prefill)
    return { status: 'draft_parked', draftId, reason: '未找到持卡人，预填草稿待人工确认' }
  }

  const created = await findOrCreateCardForHolder(db, {
    holderId: resolution.holderId,
    cardTail: aiResult.card_last4 ?? null,
    bankName: aiResult.bank_name ?? null,
    currency: aiResult.currency ?? null,
    statementDate: aiResult.statement_date ?? null,
    statementDay: aiResult.statement_day ?? null,
    dueDate: aiResult.due_date ?? null,
    receivedDate: top.headers.date ?? null,
    allowCreate: trusted,
  })
  if (!created.ok) {
    const draftId = await parkBillAsDraft(db, userId, prefill)
    return { status: 'draft_parked', draftId, reason: `${created.reason}｜草稿已预填` }
  }

  const outcome = await upsertBillForCard(db, created.cardId, aiResult, { trusted })
  await syncBillingDayFromBill(db, created.cardId, aiResult)
  return {
    status: 'bill_written',
    billId: outcome.billId,
    reason: outcome.action === 'preserved' ? outcome.reason : null,
  }
}

/** cron 用：同步全部 active 连接，单用户失败不影响其他用户。 */
export async function syncAllGmailConnections(): Promise<{ users: number; failures: number }> {
  const rows = await query<{ user_id: string }>("SELECT user_id FROM gmail_connections WHERE status = 'active'")
  let failures = 0
  for (const row of rows.data ?? []) {
    try {
      await syncUserGmail(row.user_id)
    } catch (err) {
      failures++
      const msg = err instanceof Error ? err.message : String(err)
      await execute(
        "UPDATE gmail_connections SET status = 'error', last_error = ?, updated_at = datetime('now') WHERE user_id = ?",
        [msg.slice(0, 300), row.user_id]
      )
    }
  }
  return { users: rows.data?.length ?? 0, failures }
}
```

实现注意（以测试逼出来为准，允许微调）：
- `parkBillAsDraft(db, userId, parsed: Record<string, unknown>)` 传 `{...aiResult, raw_text}` 合法。
- `deps.parse` 默认实现的 async 配置加载写法按 TS 习惯整理（例如 `parse: async (text) => parseBillWithAI(await loadAiConfig(db), text)`），不必保留 `loadAiConfigSync` 这种别名。
- 0 元账单（`bill_amount === 0`）可缺 `due_date`，与 email-worker 同口径。
- 测试里无 R2 binding：`deps.bucket` 传 `null` 跳过存原文。

**Step 4: 确认通过**

```bash
npx vitest run lib/__tests__/gmail-sync.test.ts
```

Expected: PASS（4 个用例）。

**Step 5: 全量回归**

```bash
npm test
```

Expected: 全绿。

**Step 6: Commit**

```bash
git add lib/gmail/sync.server.ts lib/__tests__/gmail-sync.test.ts
git commit -m "feat(gmail): pull-to-bill sync engine with direct-write and draft routing"
```

---

## Task 6: OAuth 连接（start + callback）

**Files:**
- Modify: `lib/auth-origin.ts`（加 `GMAIL_CALLBACK_PATH` + `gmailRedirectUri`）
- Create: `app/api/auth/gmail/start/route.ts`
- Create: `app/api/auth/gmail/callback/route.ts`

**Step 1: `lib/auth-origin.ts` 追加**

```typescript
/** Gmail 增量授权回调路径。与登录回调分开：登录走 /api/auth/google/callback，
 *  连接邮箱走这里；两者都要在 Google Console 已授权重定向 URI 里登记。 */
export const GMAIL_CALLBACK_PATH = '/api/auth/gmail/callback'

export function gmailRedirectUri(request: Request): string {
  return `${resolveAuthOrigin(request)}${GMAIL_CALLBACK_PATH}`
}
```

**Step 2: start 路由**

```typescript
// app/api/auth/gmail/start/route.ts — 连接 Gmail（增量授权 gmail.readonly）。
// 必须已登录：这是给当前会话用户挂邮箱授权，不是登录入口。
import { readSession } from '@/lib/session'
import { issueOAuthState } from '@/lib/oauth-state'
import { gmailRedirectUri, resolveAuthOrigin } from '@/lib/auth-origin'

export async function GET(request: Request) {
  const origin = resolveAuthOrigin(request)
  const url = new URL(request.url)
  if (url.origin !== origin) {
    return Response.redirect(`${origin}${url.pathname}`, 302)
  }

  const session = await readSession(request)
  if (!session) {
    return Response.redirect(`${origin}/login?error=login_required`, 302)
  }

  const clientId = process.env.GOOGLE_CLIENT_ID
  if (!clientId) {
    console.error('[gmail-start] GOOGLE_CLIENT_ID not found in env')
    return Response.json({ error: 'Google OAuth not configured' }, { status: 500 })
  }

  const { state, cookie: stateCookie } = await issueOAuthState()
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: gmailRedirectUri(request),
    response_type: 'code',
    // gmail.readonly = 整个邮箱只读；Google 没有「只读银行邮件」的细分 scope。
    scope: 'openid email https://www.googleapis.com/auth/gmail.readonly',
    state,
    nonce: state,
    access_type: 'offline',
    // consent 强制重新同意，保证每次连接都拿到 refresh_token（Google 默认
    // 只在首次授权时给 refresh_token）。
    prompt: 'consent select_account',
  })

  const headers = new Headers()
  headers.set('Location', `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`)
  headers.append('Set-Cookie', stateCookie)
  return new Response(null, { status: 302, headers })
}
```

**Step 3: callback 路由**

```typescript
// app/api/auth/gmail/callback/route.ts — 保存 Gmail 连接（加密 refresh token）。
import { getDb, getWorkerEnv } from '@/lib/db/client'
import { readSession } from '@/lib/session'
import { clearOAuthStateCookie, verifyOAuthState } from '@/lib/oauth-state'
import { gmailRedirectUri, resolveAuthOrigin } from '@/lib/auth-origin'
import { verifyGoogleIdToken } from '@/lib/google-id-token'
import { encryptToken } from '@/lib/gmail/token-crypto'

export async function GET(request: Request) {
  const origin = resolveAuthOrigin(request)
  const url = new URL(request.url)
  const stateFromQuery = url.searchParams.get('state')

  const fail = (code: string) => {
    const headers = new Headers()
    headers.set('Location', `${origin}/settings?gmail=error&reason=${code}`)
    headers.append('Set-Cookie', clearOAuthStateCookie())
    return new Response(null, { status: 302, headers })
  }

  const stateOk = await verifyOAuthState(request, stateFromQuery)
  if (!stateOk) return fail('state_invalid')

  const session = await readSession(request)
  if (!session) return fail('login_required')

  const code = url.searchParams.get('code')
  if (!code) return fail('no_code')

  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) return fail('not_configured')

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: gmailRedirectUri(request),
        grant_type: 'authorization_code',
      }),
    })
    if (!tokenRes.ok) return fail('token_exchange')
    const tokens = await tokenRes.json() as {
      id_token?: string; refresh_token?: string; access_token?: string
    }
    if (!tokens.id_token || !tokens.refresh_token) return fail('no_refresh_token')

    const verified = await verifyGoogleIdToken(tokens.id_token, {
      clientId,
      nonce: stateFromQuery ?? undefined,
    })
    if (!verified.ok) return fail('id_token_invalid')
    const { email, sub } = verified.identity

    const secret = (getWorkerEnv() as { SESSION_SECRET?: string }).SESSION_SECRET
      ?? process.env.SESSION_SECRET
    if (!secret) return fail('no_session_secret')
    const refreshEnc = await encryptToken(tokens.refresh_token, secret)
    const accessEnc = tokens.access_token ? await encryptToken(tokens.access_token, secret) : null

    const db = getDb()
    await db.prepare(
      `INSERT INTO gmail_connections
         (user_id, google_sub, email, refresh_token_enc, access_token_enc, scopes, status, updated_at)
       VALUES (?,?,?,?,?,?, 'active', datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET
         google_sub = excluded.google_sub,
         email = excluded.email,
         refresh_token_enc = excluded.refresh_token_enc,
         access_token_enc = excluded.access_token_enc,
         scopes = excluded.scopes,
         status = 'active',
         last_error = NULL,
         updated_at = datetime('now')`
    ).bind(
      session.id, sub, email, refreshEnc, accessEnc,
      'https://www.googleapis.com/auth/gmail.readonly'
    ).run()

    return Response.redirect(`${origin}/settings?gmail=connected`, 302)
  } catch (err) {
    console.error('[gmail-callback] unexpected error:', err)
    return fail('unexpected')
  }
}
```

**Step 4: 手动验证**（本地 dev）

```bash
npm run dev
```

- 登录后访问 `/api/auth/gmail/start` → Google 同意页应显示「查看电子邮件」权限 → 回调后跳 `settings?gmail=connected`
- 查 `gmail_connections`：`refresh_token_enc` 非空且不含明文 token

**Step 5: Commit**

```bash
git add lib/auth-origin.ts app/api/auth/gmail/
git commit -m "feat(gmail): OAuth connect flow with encrypted refresh-token storage"
```

---

## Task 7: RPC 注册 + 客户端包装

**Files:**
- Create: `lib/api/gmail.server.ts`
- Create: `lib/api/gmail.ts`
- Modify: `lib/api/registry.ts`
- Modify: `lib/api/billDrafts.ts`（补 `getBillImportDrafts` 包装，如已缺）
- Test: `lib/__tests__/rpc-registry.test.ts`（追加注册断言）

**Step 1: 服务端实现 `lib/api/gmail.server.ts`**

```typescript
// lib/api/gmail.server.ts — Gmail 连接管理与手动同步（server only）。
import { queryOne, query, execute } from '../db'
import { getWorkerEnv } from '../db/client'
import { syncUserGmail, type GmailSyncSummary } from '../gmail/sync.server'

export interface GmailConnectionStatus {
  connected: boolean
  email: string | null
  status: 'active' | 'error' | 'revoked' | null
  last_sync_at: string | null
  last_sync_summary: string | null
  last_error: string | null
}

export async function getGmailConnection(userId: string): Promise<GmailConnectionStatus> {
  const { data } = await queryOne<{
    email: string; status: string; last_sync_at: string | null
    last_sync_summary: string | null; last_error: string | null
  }>(
    'SELECT email, status, last_sync_at, last_sync_summary, last_error FROM gmail_connections WHERE user_id = ?',
    [userId]
  )
  if (!data) {
    return { connected: false, email: null, status: null, last_sync_at: null, last_sync_summary: null, last_error: null }
  }
  return {
    connected: data.status === 'active',
    email: data.email,
    status: data.status as GmailConnectionStatus['status'],
    last_sync_at: data.last_sync_at,
    last_sync_summary: data.last_sync_summary,
    last_error: data.last_error,
  }
}

export async function syncGmailNow(userId: string): Promise<GmailSyncSummary> {
  return syncUserGmail(userId)
}

/**
 * 断开连接：删 token、删 R2 原文副本。gmail_sync_messages 与账单/草稿是
 * 业务数据，保留（审计与既成账单不受「断开邮箱」影响）。
 */
export async function disconnectGmail(userId: string): Promise<{ ok: true }> {
  const bucket = getWorkerEnv().ATTACHMENTS as R2Bucket | undefined
  if (bucket) {
    const listed = await bucket.list({ prefix: `gmail-raw/${userId}/` })
    for (const obj of listed.objects) await bucket.delete(obj.key)
  }
  await execute('DELETE FROM gmail_connections WHERE user_id = ?', [userId])
  await execute('UPDATE gmail_sync_messages SET raw_r2_key = NULL WHERE user_id = ?', [userId])
  return { ok: true }
}
```

> `query` 导入若未用到就删掉，保持 lint 干净。

**Step 2: 客户端包装 `lib/api/gmail.ts`**

```typescript
// lib/api/gmail.ts — client-side RPC wrappers (server: gmail.server.ts).
import type * as Server from './gmail.server'
import { callRpc } from './rpc-client'

export type { GmailConnectionStatus } from './gmail.server'

export function getGmailConnection(...args: Parameters<typeof Server.getGmailConnection>) {
  return callRpc<typeof Server.getGmailConnection>('gmail', 'getGmailConnection', ...args)
}
export function syncGmailNow(...args: Parameters<typeof Server.syncGmailNow>) {
  return callRpc<typeof Server.syncGmailNow>('gmail', 'syncGmailNow', ...args)
}
export function disconnectGmail(...args: Parameters<typeof Server.disconnectGmail>) {
  return callRpc<typeof Server.disconnectGmail>('gmail', 'disconnectGmail', ...args)
}
```

> `bindUser: 0` 由服务端注入 userId，客户端调用不传（对照 `syncGmailLedgerToCardsAndBills` 的现有用法）。

**Step 3: registry 注册**（`lib/api/registry.ts`）

```typescript
import * as gmailServer from './gmail.server'
// RPC_REGISTRY 里新增：
  gmail: {
    getGmailConnection: { impl: gmailServer.getGmailConnection, bindUser: 0 },
    syncGmailNow: { impl: gmailServer.syncGmailNow, bindUser: 0 },
    disconnectGmail: { impl: gmailServer.disconnectGmail, bindUser: 0 },
  },
// billDrafts 模块补（若缺）：
    getBillImportDrafts: { impl: billDraftsServer.getBillImportDrafts, bindUser: 0 },
```

**Step 4: 客户端 `lib/api/billDrafts.ts` 补包装**（若缺）

```typescript
export function getBillImportDrafts(...args: Parameters<typeof Server.getBillImportDrafts>) {
  return callRpc<typeof Server.getBillImportDrafts>('billDrafts', 'getBillImportDrafts', ...args)
}
```

**Step 5: 测试**（`lib/__tests__/rpc-registry.test.ts` 按现有断言风格追加）：`RPC_REGISTRY.gmail` 三个函数存在且 `bindUser === 0`；`billDrafts.getBillImportDrafts` 已注册。

```bash
npm test -- rpc-registry
```

Expected: PASS。

**Step 6: Commit**

```bash
git add lib/api/gmail.server.ts lib/api/gmail.ts lib/api/registry.ts lib/api/billDrafts.ts lib/__tests__/rpc-registry.test.ts
git commit -m "feat(gmail): RPC surface for connect status, manual sync and disconnect"
```

---

## Task 8: 设置页连接面板

**Files:**
- Create: `components/mobile/GmailConnectPanel.tsx`
- Modify: `app/(mobile)/settings/page.tsx`

**Step 1: 面板组件**

```tsx
'use client'
// components/mobile/GmailConnectPanel.tsx — 连接 Gmail / 立即同步 / 断开。
// 为什么不再引导「转发到专属地址」：转发会破坏银行 DKIM，银行域 DMARC
// p=reject 时 Cloudflare 直接 550 5.7.1 拒收（实测 2026-10-26 退信），
// 信进不了 worker。直连 Gmail API 绕开整个 SMTP 转发链。
import { useCallback, useEffect, useState } from 'react'
import { getGmailConnection, syncGmailNow, disconnectGmail, type GmailConnectionStatus } from '@/lib/api/gmail'

export function GmailConnectPanel() {
  const [status, setStatus] = useState<GmailConnectionStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try { setStatus(await getGmailConnection()) } catch { /* 面板降级为未连接 */ }
  }, [])
  useEffect(() => { void reload() }, [reload])

  const sync = async () => {
    setBusy(true); setNotice(null)
    try {
      const summary = await syncGmailNow()
      setNotice(`同步完成：扫描 ${summary.scanned}，落账单 ${summary.written}，草稿 ${summary.drafted}，跳过 ${summary.skipped}，失败 ${summary.failed}`)
      await reload()
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err))
    } finally { setBusy(false) }
  }

  const disconnect = async () => {
    if (!window.confirm('断开后将删除服务端的邮箱授权与原文副本，已导入账单保留。确认？')) return
    setBusy(true)
    try { await disconnectGmail(); setNotice('已断开'); await reload() }
    catch (err) { setNotice(err instanceof Error ? err.message : String(err)) }
    finally { setBusy(false) }
  }

  if (!status?.connected) {
    return (
      <div className='rounded-2xl border border-d-border bg-d-surface p-4'>
        <p className='text-[13px] leading-5 text-d-muted'>
          授权只读 Gmail 后，系统直接拉取银行账单邮件并解析入库，原文留证，不经过转发（转发会被银行 DMARC 拒收）。
        </p>
        <a href='/api/auth/gmail/start'
           className='mt-3 inline-flex h-10 items-center rounded-full border border-d-accent px-4 text-[12px] font-semibold text-d-accent-light'>
          连接 Gmail（只读）
        </a>
        {notice && <p className='mt-2 text-[12px] text-d-muted'>{notice}</p>}
      </div>
    )
  }
  return (
    <div className='rounded-2xl border border-d-border bg-d-surface p-4'>
      <p className='text-[15px] font-semibold text-d-text'>{status.email}</p>
      <p className='mt-0.5 text-[12px] leading-4 text-d-muted'>
        {status.last_sync_at ? `上次同步 ${status.last_sync_at}` : '尚未同步'}
        {status.last_sync_summary ? `｜${status.last_sync_summary}` : ''}
      </p>
      {notice && <p className='mt-2 text-[12px] text-d-muted'>{notice}</p>}
      <div className='mt-3 flex gap-2'>
        <button type='button' onClick={sync} disabled={busy}
          className='h-10 rounded-full border border-d-accent px-4 text-[12px] font-semibold text-d-accent-light disabled:opacity-50'>
          {busy ? '同步中…' : '立即同步'}
        </button>
        <button type='button' onClick={disconnect} disabled={busy}
          className='h-10 rounded-full border border-d-border px-4 text-[12px] font-semibold text-d-muted disabled:opacity-50'>
          断开
        </button>
      </div>
    </div>
  )
}
```

**Step 2: settings 页接入**（`app/(mobile)/settings/page.tsx`）

- import `GmailConnectPanel`，在「邮箱账单导入」展开区（`openGmail`）顶部插入
- 原「收账单邮箱」卡片文案改口径：专属地址复制保留，但用途改为「转发为附件(.eml) 补录通道」；删除 196 行附近「转发银行账单至以下地址，系统将自动解析入库」的错误引导

**Step 3: 视觉验证**

```bash
npm run dev
```

浏览器 `/settings` → 展开「邮箱账单导入」：未连接显示引导 + 连接按钮；连接后显示邮箱、上次同步、立即同步/断开。截图留档。

**Step 4: Commit**

```bash
git add components/mobile/GmailConnectPanel.tsx "app/(mobile)/settings/page.tsx"
git commit -m "feat(web): Gmail connect panel with manual sync, drop forward-by-SMTP guidance"
```

---

## Task 9: 账单页草稿面板

**Files:**
- Create: `components/mobile/BillDraftsPanel.tsx`
- Modify: `app/(mobile)/bills/page.tsx`

**Step 1: 面板组件**（列表 + 选卡 + 确认/丢弃；金额等字段的细编辑后续迭代）

```tsx
'use client'
// components/mobile/BillDraftsPanel.tsx — 邮件导入的待确认草稿。
// 同步引擎对「解析出账单但自动落不下去」的邮件会预填草稿（source_type=email），
// 用户在这里选卡后确认，走 confirmBillImportDraft 落正式账单。
import { useCallback, useEffect, useState } from 'react'
import {
  getBillImportDrafts, confirmBillImportDraft, discardBillImportDraft,
  type BillImportDraft,
} from '@/lib/api/billDrafts'
import { getCardsWithBillsSummary } from '@/lib/api/bills'

export function BillDraftsPanel({ onChanged }: { onChanged?: () => void }) {
  const [drafts, setDrafts] = useState<BillImportDraft[]>([])
  const [cards, setCards] = useState<Array<{ id: string; label: string }>>([])
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setDrafts(await getBillImportDrafts().catch(() => []))
  }, [])
  useEffect(() => {
    void reload()
    void getCardsWithBillsSummary().then(list =>
      setCards(list.map(c => ({ id: c.card.id, label: `${c.bank_name ?? ''} ${formatCardTail(c.card.card_last4 ?? '')}`.trim() })))
    ).catch(() => {})
  }, [reload])

  if (!drafts.length) return null

  const confirm = async (draft: BillImportDraft) => {
    try { await confirmBillImportDraft(draft.id); await reload(); onChanged?.() }
    catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  }
  const discard = async (draft: BillImportDraft) => {
    try { await discardBillImportDraft(draft.id); await reload(); onChanged?.() }
    catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  }

  return (
    <div className='rounded-2xl border border-d-border bg-d-surface p-4'>
      <p className='text-[15px] font-semibold text-d-text'>待确认导入草稿 {drafts.length}</p>
      {error && <p className='mt-1 text-[12px] text-red-400'>{error}</p>}
      {drafts.map(draft => (
        <div key={draft.id} className='mt-3 border-t border-d-border pt-3 text-[12px] text-d-muted'>
          <p className='text-d-text'>
            {draft.parsed_payload.bill_month ?? '未识别月份'}｜{draft.parsed_payload.bill_amount ?? '—'}｜到期 {draft.parsed_payload.due_date ?? '—'}
          </p>
          <select
            className='mt-2 h-9 w-full rounded-lg border border-d-border bg-transparent px-2'
            value={draft.card_id ?? ''}
            onChange={e => void patchCard(draft, e.target.value)}
          >
            <option value=''>选择卡片（必选）</option>
            {cards.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          <div className='mt-2 flex gap-2'>
            <button type='button' disabled={!draft.card_id} onClick={() => void confirm(draft)}
              className='h-9 rounded-full border border-d-accent px-3 text-[12px] text-d-accent-light disabled:opacity-40'>
              确认入库
            </button>
            <button type='button' onClick={() => void discard(draft)}
              className='h-9 rounded-full border border-d-border px-3 text-[12px] text-d-muted'>
              丢弃
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
```

> 执行时以代码为准修正：`getCardsWithBillsSummary` 的返回形状（字段名）、`formatCardTail` 的导入来源（`@/lib/utils`）、`patchCard` 用 `updateBillImportDraft(draft.id, { card_id })` 实现。`confirmBillImportDraft` 要求 `bill_amount/due_date/bill_month` 齐全且已选卡——缺字段的草稿在 UI 上禁用确认并提示补齐（可后迭代内联编辑）。

**Step 2: bills 页挂载**（`app/(mobile)/bills/page.tsx`，`<BillsView` 之前）

```tsx
import { BillDraftsPanel } from '@/components/mobile/BillDraftsPanel'
// ...
<BillDraftsPanel onChanged={() => void reloadBills()} />
```

`reloadBills` 用页面现有的重新取数函数。

**Step 3: 视觉验证**：造一条草稿（跑一次同步让证据不足的邮件停草稿，或直接 `createBillImportDraft`），打开 `/bills` 看到面板，确认后账单出现在列表。截图留档。

**Step 4: Commit**

```bash
git add components/mobile/BillDraftsPanel.tsx "app/(mobile)/bills/page.tsx"
git commit -m "feat(web): bill drafts panel for email-imported pending statements"
```

---

## Task 10: 每日 cron 拉取

**Files:**
- Modify: `worker/cron.ts`
- Test: `lib/__tests__/gmail-sync.test.ts`（追加用例）

**Step 1: 在 `handleScheduled` 的账单日扫描之后追加**

```typescript
import { syncAllGmailConnections } from "../lib/gmail/sync.server";
// ...
  // Gmail 拉取：只在每日账单 cron（0 9）跑，*/15 的权益扫描不掺和。
  try {
    const gmail = await syncAllGmailConnections();
    console.log(`[cron] gmail sync done: users=${gmail.users} failures=${gmail.failures}`);
  } catch (err) {
    console.error("[cron] gmail sync failed:", err);
  }
```

单用户失败由 `syncAllGmailConnections` 内部隔离（置 `status='error'` + `last_error`），不影响提醒扫描。

**Step 2: 测试追加**（`lib/__tests__/gmail-sync.test.ts`）

```typescript
it("syncAllGmailConnections 逐用户隔离失败", async () => {
  // u1 连接有效但 fetch 抛错；u2 正常。断言 u2 仍被处理、u1 置 error。
});
```

**Step 3: 跑测试**

```bash
npx vitest run lib/__tests__/gmail-sync.test.ts && npm test
```

Expected: 全绿。

**Step 4: Commit**

```bash
git add worker/cron.ts lib/__tests__/gmail-sync.test.ts
git commit -m "feat(cron): daily Gmail bill pull for all active connections"
```

---

## Task 11: 全量验证与部署清单

**Step 1: 门禁全绿**

```bash
npm run typecheck && npm run lint && npm test
cd email-worker && npm run typecheck && npm test
bash design/openpencil/verify-batch.sh --source-only
```

Expected: 全绿（Task 8/9 改了 UI，设计源检查必须过）。

**Step 2: 部署前置清单**（写进 PR 描述）

1. **Google Console**：为 Web Client 追加已授权重定向 URI `https://app.all-bill.com/api/auth/gmail/callback`（本地调试再加 `http://localhost:PORT/api/auth/gmail/callback`）。没登记则 Google 400 `redirect_uri_mismatch`。
2. **Gmail API**：Google Cloud Console 启用 Gmail API。
3. **Secrets**：`SESSION_SECRET` 必须已配置（token 加密派生自它）；`GOOGLE_CLIENT_ID/SECRET` 已在 wrangler vars。
4. **D1 迁移**：`npx wrangler d1 migrations apply worldcredit --remote`（0023）。
5. **部署**：`npx vinext deploy`。

**Step 3: 发布后冒烟**

- 连接 Gmail → 立即同步 → `gmail_sync_messages` 出现行、账单/草稿按路由出现
- 断开 → `gmail_connections` 行消失、R2 `gmail-raw/{userId}/` 清空
- 触发每日 cron 或看日志 `[cron] gmail sync done`

**Step 4: PR**

分支 `feat/gmail-api-pull` → PR 到 main，描述写清：变更、DMARC 背景（为何弃 SMTP 转发）、路由口径、隐私边界（gmail.readonly、token 加密、断开即删）、测试与部署清单。

---

## 未做（明确出界，勿顺手扩）

- Gmail History API 增量同步（`newer_than:` + 去重表已够，YAGNI）
- 多 Gmail 账号绑定
- 自定义拉取查询语句（DEFAULT_QUERY 内置，后续有需求再开放）
- 草稿里逐笔交易明细编辑（第一版只做「选卡 + 确认/丢弃」）
- email-worker 专属地址转发路径的移除（保留，作 .eml 附件补录通道）
