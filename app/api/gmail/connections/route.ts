// app/api/gmail/connections/route.ts — 多邮箱连接列表（Bearer / Cookie 双鉴权）。
import { readSession } from "@/lib/session";
import { getGmailConnections } from "@/lib/api/gmail.server";

export async function GET(request: Request) {
  const session = await readSession(request);
  if (!session) {
    return Response.json({ error: "未登录" }, { status: 401 });
  }
  try {
    return Response.json({ data: await getGmailConnections(session.id), error: null });
  } catch (err) {
    const message = err instanceof Error ? err.message : "读取邮箱连接失败";
    const status = /403|无权/.test(message) ? 403 : 400;
    return Response.json({ error: message }, { status });
  }
}
