// ESM flat config。项目根 package.json 的 "type" 会被 `npx vinext deploy`
// 每次强制翻转成 "module"（工具副作用，见 docs/ 与会话记录），所以这里
// 必须用 ESM 语法，不能依赖 require。
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import prettierConfig from "eslint-config-prettier";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,
  {
    files: ["public/sw.js"],
    languageOptions: {
      globals: {
        self: "readonly",
        clients: "readonly",
        registration: "readonly",
      },
    },
  },
  {
    files: ["**/*.js", "**/*.mjs", "**/*.cjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        fetch: "readonly",
        URL: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        Buffer: "readonly",
      },
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        window: "readonly",
        document: "readonly",
        navigator: "readonly",
        location: "readonly",
        localStorage: "readonly",
        sessionStorage: "readonly",
        fetch: "readonly",
        FormData: "readonly",
        File: "readonly",
        alert: "readonly",
        Notification: "readonly",
        atob: "readonly",
        btoa: "readonly",
        crypto: "readonly",
        caches: "readonly",
        Request: "readonly",
        Response: "readonly",
        Headers: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        AbortController: "readonly",
        ReadableStream: "readonly",
        HTMLElement: "readonly",
        HTMLInputElement: "readonly",
        HTMLTextAreaElement: "readonly",
        import: "readonly",
      },
    },
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    // OpenPencil 设计脚本：在 QuickJS 沙箱里执行，`I(parent, node)` 由运行时注入。
    // 只声明真实用到的沙箱全局，其余 lint 规则照常生效，避免整目录失守。
    files: ["design/openpencil/scripts/**/*.js"],
    languageOptions: {
      globals: {
        I: "readonly",
        console: "readonly",
      },
    },
  },
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "dist/**",
      ".vinext/**",
      "build/**",
      "**/*.config.{js,mjs}",
      // Generated ambient files
      "next-env.d.ts",
      "env.d.ts",
      // Operational one-off scripts and fixtures, not shipped app source
      "scripts/**",
      "docs/**",
      "db/**",
      "import_bills.mjs",
      // Swift 工具链管辖（SPM 的 .build/checkouts 含第三方 js，不归 web lint）
      "ios/**",
    ],
  },
);
