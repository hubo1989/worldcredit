// lib/api/rpc-dispatch.ts — shared allowlisted RPC dispatch and member isolation.

import { RPC_REGISTRY, type RpcEntry } from "@/lib/api/registry";
import { buildMemberContext, MemberScopeError, type MemberContext } from "@/lib/api/member-scope";
import { OpportunityError } from "@/lib/opportunities/errors";
import { RpcDomainError } from "@/lib/api/errors";
import type { OpportunityActor } from "@/lib/opportunities/types";
import type { SessionUser } from "@/lib/session";

export interface RpcDispatchResult {
  ok: boolean;
  data?: unknown;
  error?: string;
  code?: string;
  details?: unknown;
  status: number;
}

/**
 * 统一的错误响应体：结构化业务错误保留 code/details/request_id，
 * 未知错误只返回通用文案（原始信息仅进服务端日志）。
 */
export function rpcErrorResponseBody(result: RpcDispatchResult): {
  body: Record<string, unknown>;
  structured: boolean;
} {
  if (result.code || result.details) {
    return {
      body: {
        data: null,
        error: result.error,
        code: result.code,
        details: result.details,
        request_id: crypto.randomUUID(),
      },
      structured: true,
    };
  }
  return { body: { data: null, error: result.error }, structured: false };
}

export function bindEntryArgs(args: unknown[], entry: RpcEntry, user: { id: string }): unknown[] {
  const finalArgs = [...args];
  if (entry.bindUser !== undefined) {
    finalArgs[entry.bindUser] = user.id;
  }
  if (entry.bindField) {
    const { arg, field } = entry.bindField;
    const target = finalArgs[arg];
    if (target && typeof target === "object" && !Array.isArray(target)) {
      finalArgs[arg] = { ...(target as Record<string, unknown>), [field]: user.id };
    }
  }
  return finalArgs;
}

export async function dispatchRpc(
  module: string,
  fn: string,
  args: unknown[],
  session: SessionUser,
): Promise<RpcDispatchResult> {
  const entry = RPC_REGISTRY[module]?.[fn];
  if (!entry) {
    return { ok: false, error: "接口不存在", status: 404 };
  }
  if (entry.admin && session.role !== "admin") {
    return { ok: false, error: "需要管理员权限", status: 403 };
  }

  const impl = entry.impl as (...args: unknown[]) => unknown;
  const finalArgs = bindEntryArgs(args, entry, session);

  // Member isolation: resolve bound holders, validate args, and prepare the
  // response filter. Admins skip all of this.
  let memberCtx: MemberContext | null = null;
  if (session.role === "member") {
    memberCtx = await buildMemberContext(session);
    if (entry.memberGuard) {
      try {
        await entry.memberGuard(finalArgs, memberCtx);
      } catch (err) {
        if (err instanceof MemberScopeError) {
          return { ok: false, error: err.message, status: 403 };
        }
        throw err;
      }
    }
  }

  try {
    const actor: OpportunityActor | null = entry.prependActor
      ? { user_id: session.id, role: session.role }
      : null;
    const implArgs = actor ? [actor, ...finalArgs] : finalArgs;
    let data = await impl(...implArgs);
    if (memberCtx && entry.memberFilter) data = await entry.memberFilter(data, memberCtx);
    return { ok: true, data, status: 200 };
  } catch (err) {
    if (err instanceof MemberScopeError) {
      return { ok: false, error: err.message, status: 403 };
    }
    if (err instanceof OpportunityError || err instanceof RpcDomainError) {
      return {
        ok: false,
        error: err.message,
        code: err.code,
        details: err.details,
        status: err.status,
      };
    }
    const message = err instanceof Error ? err.message : String(err);
    // 原始数据库/驱动错误只记日志：对外会泄露表结构与内部实现。
    console.error(`[rpc] ${module}.${fn} unhandled error:`, message);
    return { ok: false, error: "服务暂时不可用，请稍后重试", status: 500 };
  }
}
