// app/api/gmail/sync/route.ts — 手动触发一次 Gmail 拉取（Bearer 鉴权）。
//
// HUB-156 扩展（HUB-154 §3.3(3)）：可选 body { connectionId?, maxMessages? }。
// 传 connectionId 只同步该邮箱；省略则轮询当前用户名下全部 active + sync_enabled 邮箱。
import { readSession } from "@/lib/session";
import { syncGmailConnection } from "@/lib/api/gmail.server";
import { MemberScopeError } from "@/lib/api/member-scope";
import { RpcDomainError } from "@/lib/api/errors";

export async function POST(request: Request) {
  const session = await readSession(request);
  if (!session) {
    return Response.json({ error: "未登录" }, { status: 401 });
  }
  try {
    // 可选 body {maxMessages}：客户端分轮拉取（每封 LLM 解析 5–15s，
    // 单请求超 ~100s 会被 Cloudflare 524 掐断），返回值带 remaining 供续拉。
    const body = (await request.json().catch(() => ({}))) as {
      maxMessages?: number;
      connectionId?: string;
    };
    const maxMessages =
      typeof body.maxMessages === "number" && body.maxMessages > 0
        ? Math.min(Math.floor(body.maxMessages), 50)
        : undefined;
    const connectionId =
      typeof body.connectionId === "string" && body.connectionId.trim()
        ? body.connectionId.trim()
        : undefined;
    return Response.json(await syncGmailConnection({ maxMessages, connectionId }, session.id));
  } catch (err) {
    if (err instanceof MemberScopeError) {
      return Response.json({ error: err.message }, { status: 403 });
    }
    if (err instanceof RpcDomainError) {
      return Response.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return Response.json(
      { error: err instanceof Error ? err.message : "同步失败" },
      { status: 400 },
    );
  }
}
