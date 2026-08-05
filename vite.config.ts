import { defineConfig } from "vite";
import vinext from "vinext";
import { cloudflare } from "@cloudflare/vite-plugin";
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  server: {
    port: 3050,
    host: "credit.localhost",
  },
  plugins: [
    vinext(),
    cloudflare({
      viteEnvironment: {
        name: "rsc",
        childEnvironments: ["ssr"],
      },
    }),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon.svg', 'icons/icon-512.svg'],
      manifest: {
        name: 'WorldCredit',
        short_name: 'WorldCredit',
        description: '家庭信用卡账单、还款、权益管理',
        theme_color: '#1976d2',
        icons: [
          {
            src: '/icons/icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable'
          },
          {
            src: '/icons/icon-512.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'any maskable'
          }
        ]
      }
    })
  ],
});
