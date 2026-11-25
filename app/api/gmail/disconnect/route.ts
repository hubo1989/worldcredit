// app/api/gmail/disconnect/route.ts — 断开 Gmail 连接（Bearer 鉴权）。
//
// HUB-156 扩展（HUB-154 §3.3(3)）：可选 body { connectionId? }。
// 传 connectionId 只删该邮箱及其专属 R2 前缀；省略保持旧行为（断开全部）。
import { readSession } from "@/lib/session";
import {
  disconnectGmail,
  disconnectGmailConnection,
} from "@/lib/api/gmail.server";
import { MemberScopeError } from "@/lib/api/member-scope";
import { RpcDomainError } from "@/lib/api/errors";

export async function POST(request: Request) {
  const session = await readSession(request);
  if (!session) {
    return Response.json({ error: "未登录" }, { status: 401 });
  }
  try {
    const body = (await request.json().catch(() => ({}))) as { connectionId?: string };
    const connectionId =
      typeof body.connectionId === "string" && body.connectionId.trim()
        ? body.connectionId.trim()
        : undefined;
    if (connectionId) {
      return Response.json(await disconnectGmailConnection(connectionId, session.id));
    }
    return Response.json(await disconnectGmail(session.id));
  } catch (err) {
    if (err instanceof MemberScopeError) {
      return Response.json({ error: err.message }, { status: 403 });
    }
    if (err instanceof RpcDomainError) {
      return Response.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return Response.json(
      { error: err instanceof Error ? err.message : "断开失败" },
      { status: 500 },
    );
  }
}
