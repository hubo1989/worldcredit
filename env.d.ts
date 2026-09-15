// env.d.ts — Cloudflare Workers bindings + vinext public env
/// <reference types="@cloudflare/workers-types" />

// @cloudflare/workers-types replaces the DOM Response type. Restore the standard
// body-mixin methods so `res.json()` returns Promise<any> in app code.
interface Body {
  json(): Promise<any>
}

declare namespace NodeJS {
  interface ProcessEnv {
    NODE_ENV: 'development' | 'production' | 'test'
  }
}

interface Env {
  DB: D1Database
  APP_ORIGIN?: string
  ATTACHMENTS: R2Bucket
  ASSETS: { fetch(request: Request): Promise<Response> }
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>
      }
    }
  }
}
