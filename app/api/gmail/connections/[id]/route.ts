// app/api/gmail/connections/[id]/route.ts — 修改单个邮箱连接（备注 / 默认持卡人 / 归属模式 / 同步开关）。
import { readSession } from "@/lib/session";
import { updateGmailConnection } from "@/lib/api/gmail.server";
import { MemberScopeError } from "@/lib/api/member-scope";
import { RpcDomainError } from "@/lib/api/errors";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await readSession(request);
  if (!session) {
    return Response.json({ error: "未登录" }, { status: 401 });
  }
  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  try {
    const updated = await updateGmailConnection(id, body, session.id);
    return Response.json({ data: updated, error: null });
  } catch (err) {
    if (err instanceof MemberScopeError) {
      return Response.json({ error: err.message }, { status: 403 });
    }
    if (err instanceof RpcDomainError) {
      return Response.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return Response.json({ error: "更新邮箱连接失败" }, { status: 500 });
  }
}
