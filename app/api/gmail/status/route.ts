// app/api/gmail/status/route.ts — iOS：Gmail 连接状态（Bearer 鉴权，与 api/sync/* 同款）。
import { readSession } from "@/lib/session";
import { getGmailConnection } from "@/lib/api/gmail.server";

export async function GET(request: Request) {
  const session = await readSession(request);
  if (!session) {
    return Response.json({ error: "未登录" }, { status: 401 });
  }
  return Response.json(await getGmailConnection(session.id));
}
