import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { handleScheduled } from "./cron";
import { routeOpportunityCron, scanOpportunityNotifications, webPushSender } from "./opportunity-cron";
import { setDb, setWorkerEnv } from "../lib/db/client";

interface WorkerEnv {
  DB: D1Database;
  ATTACHMENTS: R2Bucket;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  APP_ORIGIN?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
  APNS_KEY_P8?: string;
  APNS_KEY_ID?: string;
  APNS_TEAM_ID?: string;
  APNS_BUNDLE_ID?: string;
  APNS_ENVIRONMENT?: string;
  ASSETS: { fetch(request: Request): Promise<Response> };
  IMAGES: { input(stream: ReadableStream): { transform(options: Record<string, unknown>): { output(options: { format: string; quality: number }): Promise<{ response(): Response }> } } };
}

export default {
  async fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext): Promise<Response> {
    // Inject D1 binding for API routes
    setDb(env.DB);
    setWorkerEnv(env as unknown as Record<string, unknown>);

    const url = new URL(request.url);

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path: string) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body: ReadableStream, { width, format, quality }: { width: number; format: string; quality: number }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },

  async scheduled(event: ScheduledEvent, env: WorkerEnv, ctx: ExecutionContext) {
    setDb(env.DB);
    setWorkerEnv(env as unknown as Record<string, unknown>);
    // Task 15（spec §10.3）：两条 cron 各管各的——*/15 只扫权益投递，0 9 只做
    // 既有账单日扫；两个触发同时到达时互不重复（作业唯一键兜底）。
    const route = routeOpportunityCron(event.cron);
    if (route === "opportunities") {
      ctx.waitUntil(
        scanOpportunityNotifications({
          db: env.DB,
          now: new Date(event.scheduledTime),
          sender: webPushSender(env),
        }),
      );
      return;
    }
    if (route === "bills") {
      ctx.waitUntil(handleScheduled(event, env, ctx));
      return;
    }
    console.log(`[scheduled] unhandled cron ${event.cron}`);
  },
};
