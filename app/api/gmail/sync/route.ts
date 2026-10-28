// app/api/gmail/sync/route.ts — iOS：手动触发一次 Gmail 拉取（Bearer 鉴权）。
import { readSession } from "@/lib/session";
import { syncGmailNow } from "@/lib/api/gmail.server";

export async function POST(request: Request) {
  const session = await readSession(request);
  if (!session) {
    return Response.json({ error: "未登录" }, { status: 401 });
  }
  try {
    // 可选 body {maxMessages}：客户端分轮拉取（每封 LLM 解析 5–15s，
    // 单请求超 ~100s 会被 Cloudflare 524 掐断），返回值带 remaining 供续拉。
    const body = (await request.json().catch(() => ({}))) as { maxMessages?: number };
    const maxMessages =
      typeof body.maxMessages === "number" && body.maxMessages > 0
        ? Math.min(Math.floor(body.maxMessages), 50)
        : undefined;
    return Response.json(await syncGmailNow(session.id, { maxMessages }));
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "同步失败" },
      { status: 400 },
    );
  }
}
