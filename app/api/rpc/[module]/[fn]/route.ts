// app/api/rpc/[module]/[fn]/route.ts — HTTP entry point for the named RPC API.

import { readSession } from "@/lib/session";
import { dispatchRpc } from "@/lib/api/rpc-dispatch";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ module: string; fn: string }> },
) {
  const session = await readSession(request);
  if (!session) {
    return Response.json({ error: "未登录" }, { status: 401 });
  }

  const { module, fn } = await params;

  const contentLength = Number(request.headers.get("Content-Length") ?? "0");
  if (contentLength > 1_000_000) {
    return Response.json({ error: "请求体过大" }, { status: 413 });
  }

  let body: { args?: unknown };
  try {
    body = (await request.json()) as { args?: unknown };
  } catch {
    return Response.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  if (!Array.isArray(body.args)) {
    return Response.json({ error: "缺少 args 数组" }, { status: 400 });
  }

  const result = await dispatchRpc(module, fn, body.args, session);
  if (!result.ok) {
    if (result.code || result.details) {
      return Response.json(
        {
          data: null,
          error: result.error,
          code: result.code,
          details: result.details,
          request_id: crypto.randomUUID(),
        },
        { status: result.status },
      );
    }
    return Response.json({ data: null, error: result.error }, { status: result.status });
  }

  return Response.json({ data: result.data, error: null });
}
