// app/api/gmail/disconnect/route.ts — iOS：断开 Gmail 连接（Bearer 鉴权）。
import { readSession } from "@/lib/session";
import { disconnectGmail } from "@/lib/api/gmail.server";

export async function POST(request: Request) {
  const session = await readSession(request);
  if (!session) {
    return Response.json({ error: "未登录" }, { status: 401 });
  }
  try {
    return Response.json(await disconnectGmail(session.id));
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "断开失败" },
      { status: 500 },
    );
  }
}
