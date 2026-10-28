// APNs transport shared by Workers. No database bindings or server globals.

export interface ApnsConfig {
  keyP8?: string;
  keyId?: string;
  teamId?: string;
  bundleId?: string;
  isProduction?: boolean;
}

export interface ApnsAlertPayload {
  title: string;
  body: string;
}

export interface SendPushOptions {
  alert?: ApnsAlertPayload;
  badge?: number;
  sound?: string;
  isSilent?: boolean;
  expirationSeconds?: number;
  customData?: Record<string, unknown>;
}

const DEFAULT_ALERT_TTL_SECONDS = 86_400;

export interface ApnsResponse {
  success: boolean;
  statusCode?: number;
  error?: string;
  invalidToken?: boolean;
}

let cachedJwt: {
  token: string;
  expiresAt: number;
  keyP8: string;
  keyId: string;
  teamId: string;
} | null = null;

function base64UrlEncode(buffer: ArrayBuffer | Uint8Array | string): string {
  let str: string;
  if (typeof buffer === "string") {
    return base64UrlEncode(new TextEncoder().encode(buffer));
  } else {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    str = btoa(binary);
  }
  return str.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function pemToBinary(pem: string): Uint8Array {
  const cleanPem = pem
    .replace(/-----BEGIN [A-Z0-9 ]+-----/g, "")
    .replace(/-----END [A-Z0-9 ]+-----/g, "")
    .replace(/\s+/g, "");
  const binaryString = atob(cleanPem);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * 构造并签名 APNs 认证 JWT (ES256)。
 * 缓存 30 分钟以避免每次调用都重新导入私钥并签名。
 */
export async function getApnsJwt(config: ApnsConfig): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  const { keyP8, keyId, teamId } = config;
  if (!keyP8 || !keyId || !teamId) {
    throw new Error("APNs 凭证不完整（缺少 keyP8, keyId 或 teamId）");
  }

  if (
    cachedJwt &&
    cachedJwt.expiresAt > nowSec + 60 &&
    cachedJwt.keyP8 === keyP8 &&
    cachedJwt.keyId === keyId &&
    cachedJwt.teamId === teamId
  ) {
    return cachedJwt.token;
  }

  const header = {
    alg: "ES256",
    kid: keyId,
  };
  const payload = {
    iss: teamId,
    iat: nowSec,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const dataToSign = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`);

  const privateKeyDer = pemToBinary(keyP8);
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    privateKeyDer.buffer as ArrayBuffer,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: { name: "SHA-256" } },
    cryptoKey,
    dataToSign,
  );

  const encodedSignature = base64UrlEncode(signature);
  const jwt = `${encodedHeader}.${encodedPayload}.${encodedSignature}`;

  // 缓存 30 分钟 (1800 秒)
  cachedJwt = {
    token: jwt,
    expiresAt: nowSec + 1800,
    keyP8,
    keyId,
    teamId,
  };

  return jwt;
}

/**
 * 向单台 iOS 设备推送 APNs 消息。
 */
export async function sendApnsNotification(
  token: string,
  options: SendPushOptions,
  config: ApnsConfig,
): Promise<ApnsResponse> {
  const { keyP8, keyId, teamId } = config;
  if (!keyP8 || !keyId || !teamId) {
    return { success: false, error: "apns_not_configured" };
  }

  const bundleId = config.bundleId ?? "com.chunfenshijie.worldcredit";
  const isProduction = config.isProduction ?? false;
  const host = isProduction ? "https://api.push.apple.com" : "https://api.sandbox.push.apple.com";
  const endpoint = `${host}/3/device/${token}`;

  let jwt: string;
  try {
    jwt = await getApnsJwt(config);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }

  // 构造 aps 负载
  const aps: Record<string, unknown> = {};
  let pushType: "alert" | "background" = "alert";
  let priority = "10";

  if (options.isSilent) {
    aps["content-available"] = 1;
    pushType = "background";
    priority = "5";
  } else {
    if (options.alert) {
      aps.alert = options.alert;
    }
    if (typeof options.badge === "number") {
      aps.badge = options.badge;
    }
    if (options.sound) {
      aps.sound = options.sound;
    }
  }

  const requestBody = {
    aps,
    ...(options.customData ?? {}),
  };

  const ttlSeconds =
    options.expirationSeconds ?? (options.isSilent ? 0 : DEFAULT_ALERT_TTL_SECONDS);
  const apnsExpiration = ttlSeconds <= 0 ? "0" : String(Math.floor(Date.now() / 1000) + ttlSeconds);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(endpoint, {
      signal: controller.signal,
      method: "POST",
      headers: {
        authorization: `bearer ${jwt}`,
        "apns-topic": bundleId,
        "apns-push-type": pushType,
        "apns-priority": priority,
        "apns-expiration": apnsExpiration,
      },
      body: JSON.stringify(requestBody),
    });

    if (res.status === 200) {
      return { success: true, statusCode: 200 };
    }

    const text = await res.text();
    let reason: string | undefined;
    try {
      reason = (JSON.parse(text) as { reason?: string }).reason;
    } catch {
      // Unstructured proxy errors cannot establish that a token is invalid.
      reason = undefined;
    }
    return {
      success: false,
      statusCode: res.status,
      error: `APNs error ${res.status}: ${text}`,
      invalidToken: res.status === 410 || reason === "BadDeviceToken" || reason === "Unregistered",
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  } finally {
    clearTimeout(timeout);
  }
}
