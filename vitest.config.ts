import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      // Mirror tsconfig "paths" so tests can import app/ route handlers the
      // same way the Next.js (vinext) build resolves them.
      '@': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
  test: {
    globals: true,
    include: ['lib/__tests__/**/*.test.ts'],
  },
})
