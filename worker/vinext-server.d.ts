// vinext@0.0.32 的类型通过 package.json exports map 暴露，而 tsconfig 的
// moduleResolution: "node" 不解析 exports map，这里手工补声明。
declare module 'vinext/server/image-optimization' {
  export interface ImageConfig {
    dangerouslyAllowSVG?: boolean
    [key: string]: unknown
  }
  export const DEFAULT_DEVICE_SIZES: number[]
  export const DEFAULT_IMAGE_SIZES: number[]
  export function handleImageOptimization(
    request: Request,
    options: {
      fetchAsset: (path: string) => Promise<Response>
      transformImage: (
        body: ReadableStream,
        params: { width: number; format: string; quality: number }
      ) => Promise<Response>
    },
    allowedWidths: number[]
  ): Promise<Response>
}

declare module 'vinext/server/app-router-entry' {
  const handler: {
    fetch(request: Request, env: unknown, ctx: unknown): Promise<Response>
  }
  export default handler
}
