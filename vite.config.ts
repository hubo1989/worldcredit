import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import vinext from 'vinext'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig(({ command, isSsrBuild }) => ({
  server: {
    port: 3050, // 强制使用 3050 端口
    strictPort: true,
    host: '127.0.0.1', // 配合 portless 映射
    allowedHosts: ['credit.localhost']
  },
  plugins: [
    vinext(),
    {
      name: 'vinext-fix-ssr-entry',
      config(config) {
        if (config.build?.ssr) {
          config.build.rollupOptions = config.build.rollupOptions || {}
          config.build.rollupOptions.input = undefined
        }
      }
    },
    // Only apply PWA plugin for client build
    ...(!isSsrBuild ? [
      VitePWA({
        registerType: 'autoUpdate',
        // Use custom sw.js in public/
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
            { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
            { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
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
      })
    ] : []),
  ]
}))
