import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { defineConfig, loadEnv } from "vite";
import vinext from "vinext";
import { VitePWA } from "vite-plugin-pwa";
import { cloudflare } from "@cloudflare/vite-plugin";

const requiredPublicEnv = ["NEXT_PUBLIC_INSFORGE_URL", "NEXT_PUBLIC_INSFORGE_ANON_KEY"];

function replaceInFile(filePath, replacements) {
  if (!existsSync(filePath)) return;

  let contents = readFileSync(filePath, "utf8");
  let nextContents = contents;

  for (const [from, to] of replacements) {
    nextContents = nextContents.replaceAll(from, to);
  }

  if (nextContents !== contents) {
    writeFileSync(filePath, nextContents);
  }
}

function patchVinextCloudflareOutput() {
  return {
    name: "worldcredit:patch-vinext-cloudflare-output",
    apply: "build",
    closeBundle() {
      // Vinext 0.0.32 emits Cloudflare Worker modules as .mjs in this repo,
      // but the generated runtime still imports the cross-environment entries
      // using .js extensions. Wrangler deploys modules by exact specifier, so
      // the Worker throws "No such module ssr/index.js" in production unless
      // the generated specifiers match the emitted file names.
      replaceInFile("dist/server/index.mjs", [["./ssr/index.js", "./ssr/index.mjs"]]);
      replaceInFile("dist/server/ssr/index.mjs", [["../index.js", "../index.mjs"]]);
    },
  };
}

export default defineConfig(({ mode, isSsrBuild }) => {
  const env = loadEnv(mode, process.cwd(), ["NEXT_PUBLIC_", "VITE_"]);
  const missingEnv = requiredPublicEnv.filter((key) => !env[key]);

  if (missingEnv.length > 0) {
    throw new Error(`Missing required public environment variables: ${missingEnv.join(", ")}`);
  }

  return {
    server: {
      port: 3050,
      strictPort: true,
      host: "127.0.0.1",
      allowedHosts: ["credit.localhost"],
    },
    envPrefix: ["VITE_", "NEXT_PUBLIC_"],
    define: Object.fromEntries(
      requiredPublicEnv.map((key) => [`process.env.${key}`, JSON.stringify(env[key])]),
    ),
    plugins: [
      vinext(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
      }),
      patchVinextCloudflareOutput(),
      ...(!isSsrBuild
        ? [
            VitePWA({
              registerType: "autoUpdate",
              strategies: "injectManifest",
              srcDir: "public",
              filename: "sw.js",
              manifest: {
                name: "WorldCredit",
                short_name: "WorldCredit",
                description: "信用卡账单与还款管理",
                theme_color: "#0A1F44",
                background_color: "#ffffff",
                display: "standalone",
                start_url: "/dashboard",
                icons: [
                  { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
                  { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
                ],
              },
              workbox: {
                globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
              },
              injectManifest: {
                maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
              },
              devOptions: {
                enabled: false,
                type: "module",
              },
            }),
          ]
        : []),
    ],
    resolve: {
      alias: {
        "@": new URL("./", import.meta.url).pathname,
      },
    },
  };
});
