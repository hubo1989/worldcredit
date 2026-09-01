import { defineConfig } from 'vite'
import vinext from 'vinext'
import { VitePWA } from 'vite-plugin-pwa'
import { cloudflare } from '@cloudflare/vite-plugin'

export default defineConfig(({ isSsrBuild }) => ({
  server: {
    port: 3050,
    strictPort: true,
    host: '127.0.0.1',
    allowedHosts: ['credit.localhost'],
  },
  plugins: [
    vinext(),
    cloudflare({
      viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
    }),
    ...(!isSsrBuild
      ? [
          VitePWA({
            registerType: 'autoUpdate',
            strategies: 'injectManifest',
            srcDir: 'public',
            filename: 'sw.js',
            manifest: {
              name: 'WorldCredit',
              short_name: 'WorldCredit',
              description: '信用卡账单与还款管理',
              theme_color: '#0A1F44',
              background_color: '#ffffff',
              display: 'standalone',
              start_url: '/dashboard',
              icons: [
                { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
                { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
              ],
            },
            workbox: {
              globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
            },
            injectManifest: {
              maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
            },
            devOptions: {
              enabled: false,
              type: 'module',
            },
          }),
        ]
      : []),
  ],
  resolve: {
    alias: {
      '@': new URL('./', import.meta.url).pathname,
    },
  },
}))
