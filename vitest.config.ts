import { fileURLToPath } from 'node:url'
import { defineConfig, type ViteUserConfig } from 'vitest/config'

// 组件测试含 JSX，rolldown-vite 的 oxc 转换需要插件设置 oxc.jsx 才会处理 .tsx。
// 手写最小插件而非 import @vitejs/plugin-react：tsconfig 的 moduleResolution
// 是 "node"，解析不了该包 exports 里的类型声明，会让 npm run typecheck 挂掉。
// （vitest 不跑 dev server，fast-refresh 分支全不需要。）
const reactJsxPlugin = {
  name: 'vitest:react-jsx',
  config: () => ({
    oxc: { jsx: { runtime: 'automatic' as const } },
  }),
}

export default defineConfig({
  plugins: [reactJsxPlugin as unknown as ViteUserConfig['plugins'][number]],
  resolve: {
    alias: {
      // Mirror tsconfig "paths" so tests can import app/ route handlers the
      // same way the Next.js (vinext) build resolves them.
      '@': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
  test: {
    globals: true,
    include: ['lib/__tests__/**/*.test.ts', 'components/__tests__/**/*.test.{ts,tsx}'],
    // 组件测试用文件级 `@vitest-environment jsdom` 注解声明 DOM 环境
    //（vitest 4 移除了 environmentMatchGlobs）；lib 纯函数测试仍是 node 环境。
  },
})
