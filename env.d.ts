// env.d.ts — vinext 使用 NEXT_PUBLIC_ 前缀 + process.env 访问环境变量
declare namespace NodeJS {
  interface ProcessEnv {
    NEXT_PUBLIC_INSFORGE_URL: string
    NEXT_PUBLIC_INSFORGE_ANON_KEY: string
    NODE_ENV: 'development' | 'production' | 'test'
  }
}
