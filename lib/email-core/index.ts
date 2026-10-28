// lib/email-core/index.ts — shared email→bill pipeline used by BOTH the
// email-worker (Cloudflare Email Routing) and the Gmail pull sync engine.
// Keeping one copy is load-bearing: keepPaidStatus / 0 元账单 / 账单日回写等
// 口径曾因两份实现而漂移过（见 bills.ts 注释）。
export * from './types'
export * from './mime'
export * from './holders'
export * from './bills'
export * from './ai'
