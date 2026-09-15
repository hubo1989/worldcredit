import { defineConfig } from 'vitest/config'

// email-worker 自带一份 vitest 配置：根 vitest.config.ts 只 include lib/__tests__/**，
// 改动风险最高的 mime.ts（约 590 行纯解析器）此前完全在 CI 覆盖之外。
// 这份配置刻意自包含，不依赖根目录配置与任何外部 fixture。
export default defineConfig({
  test: {
    globals: true,
    include: ['__tests__/**/*.test.ts'],
    environment: 'node',
  },
})
