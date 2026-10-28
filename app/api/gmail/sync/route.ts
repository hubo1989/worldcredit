// app/api/gmail/sync/route.ts — iOS：手动触发一次 Gmail 拉取（Bearer 鉴权）。
import { readSession } from "@/lib/session";
import { syncGmailNow } from "@/lib/api/gmail.server";

export async function POST(request: Request) {
  const session = await readSession(request);
  if (!session) {
    return Response.json({ error: "未登录" }, { status: 401 });
  }
  try {
    return Response.json(await syncGmailNow(session.id));
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "同步失败" },
      { status: 400 },
    );
  }
}
