// lib/api/devices.server.ts — Device tokens management for APNs/FCM push.

import { queryOne, execute, uuid, now } from "../db";
import { RpcDomainError } from "./errors";

const VALID_PLATFORMS = new Set(["ios", "android"]);

export interface RegisterDeviceInput {
  platform: "ios" | "android";
  token: string;
  appVersion?: string;
}

export interface UnregisterDeviceInput {
  token: string;
}

/**
 * 注册或更新设备推送 Token。
 * 同一个 token 只能归属于一个用户，若该设备换了用户登录，自动迁移至当前用户。
 */
export async function registerDeviceToken(
  input: RegisterDeviceInput,
  userId: string,
): Promise<{ success: boolean; id: string }> {
  if (!input || typeof input !== "object" || typeof input.token !== "string" || !input.platform) {
    throw new RpcDomainError("VALIDATION_FAILED", "设备推送参数不完整");
  }
  if (!VALID_PLATFORMS.has(input.platform)) {
    throw new RpcDomainError("VALIDATION_FAILED", "不支持的设备平台");
  }

  const trimmedToken = input.token.trim();
  if (!trimmedToken || trimmedToken.length > 512) {
    throw new RpcDomainError("VALIDATION_FAILED", "Device Token 不能为空");
  }

  // 检查是否已有该 token
  const { data: existing } = await queryOne<{ id: string }>(
    "SELECT id FROM device_tokens WHERE token = ?",
    [trimmedToken],
  );

  const candidateId = existing?.id ?? uuid();
  const currentTime = now();

  const { error } = await execute(
    `INSERT INTO device_tokens (id, user_id, platform, token, app_version, last_seen_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(token) DO UPDATE SET
       user_id = excluded.user_id,
       platform = excluded.platform,
       app_version = excluded.app_version,
       last_seen_at = excluded.last_seen_at`,
    [
      candidateId,
      userId,
      input.platform,
      trimmedToken,
      input.appVersion ?? null,
      currentTime,
      currentTime,
    ],
  );

  if (error) {
    throw new Error(error.message);
  }

  const persisted = await queryOne<{ id: string }>("SELECT id FROM device_tokens WHERE token = ?", [
    trimmedToken,
  ]);
  if (persisted.error) throw new Error(persisted.error.message);

  return { success: true, id: persisted.data?.id ?? candidateId };
}

/**
 * 注销当前用户的设备推送 Token（用户退出登录时调用）。
 */
export async function unregisterDeviceToken(
  input: UnregisterDeviceInput,
  userId: string,
): Promise<{ success: boolean }> {
  const trimmedToken = typeof input?.token === "string" ? input.token.trim() : "";
  if (!trimmedToken) {
    throw new RpcDomainError("VALIDATION_FAILED", "Device Token 不能为空");
  }

  const { error } = await execute("DELETE FROM device_tokens WHERE token = ? AND user_id = ?", [
    trimmedToken,
    userId,
  ]);

  if (error) {
    throw new Error(error.message);
  }

  return { success: true };
}
