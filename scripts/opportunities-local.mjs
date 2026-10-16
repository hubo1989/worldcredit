#!/usr/bin/env node
// scripts/opportunities-local.mjs — isolated local runner (Task 24 early
// slice, plan §2.3: must exist before Task 12's first real UI verification).
//
//   node scripts/opportunities-local.mjs --persist-to /tmp/wc-opportunities-x --port 3051
//
// Contract:
//   - --persist-to <dir> and --port <n> are REQUIRED; no implicit defaults
//   - the directory must be empty or contain this runner's marker file — an
//     existing unrelated directory is refused, never wiped
//   - migrations from migrations/d1 apply in order via wrangler's LOCAL D1
//     (no remote access, no shared .wrangler state), then the idempotent seed
//   - the admin seed login comes from the static allowlist in
//     lib/admin-emails.ts (session role is derived from that allowlist, so a
//     random seed email could never exercise admin flows)
//   - SIGINT/SIGTERM stop only this runner's processes
//
// Verify flows (A01/A02/A08/A11/A12) with the printed credentials, then stop
// the server; nothing here touches production D1 or real push endpoints.

import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MARKER = '.wc-opportunities-local'

function die(message) {
  console.error(message)
  process.exit(2)
}

function parseArgs(argv) {
  const out = { persistTo: null, port: null }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--persist-to') out.persistTo = argv[++i]
    else if (argv[i] === '--port') out.port = Number(argv[++i])
    else die(`未知参数: ${argv[i]}`)
  }
  if (!out.persistTo || !out.port || !Number.isInteger(out.port) || out.port < 1024 || out.port > 65535) {
    die('用法: node scripts/opportunities-local.mjs --persist-to <空目录> --port <1024-65535>')
  }
  if (argv.includes('--remote')) die('本脚本不支持 remote；生产按 docs/runbooks/opportunities-release.md 执行。')
  return out
}

function adminEmailFromAllowlist() {
  const source = readFileSync(join(ROOT, 'lib/admin-emails.ts'), 'utf8')
  const m = /ADMIN_EMAILS = \['([^']+)'\]/.exec(source)
  if (!m) die('无法从 lib/admin-emails.ts 解析 admin 邮箱')
  return m[1]
}

function wrangler(args, opts = {}) {
  return execFileSync('npx', ['wrangler', ...args], { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'], ...opts })
}

/** Removes line and block comments outside string literals (JSONC). */
function stripJsonc(text) {
  let out = ''
  let inString = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    const next = text[i + 1]
    if (inString) {
      out += ch
      if (ch === '\\') { out += next ?? ''; i++ }
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') { inString = true; out += ch; continue }
    if (ch === '/' && next === '/') { while (i < text.length && text[i] !== '\n') i++; out += '\n'; continue }
    if (ch === '/' && next === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++; i++; continue }
    out += ch
  }
  return out
}

async function main() {
  const { persistTo, port } = parseArgs(process.argv.slice(2))
  const abs = (p) => (p.startsWith('/') ? p : join(process.cwd(), p))
  const persistDir = abs(persistTo)

  if (!existsSync(persistDir)) mkdirSync(persistDir, { recursive: true })
  else if (existsSync(join(persistDir, MARKER))) {
    // re-run on our own directory is fine
  } else if (readdirSync(persistDir).length > 0) {
    die(`目录非空且无本脚本标记（${MARKER}），拒绝使用：${persistDir}`)
  }
  writeFileSync(join(persistDir, MARKER), 'managed by scripts/opportunities-local.mjs\n')

  // Local-only wrangler config for the vite plugin: same bindings + a session
  // secret; D1 stays --local with the isolated persist dir (never remote).
  const secret = `local-verify-${Math.random().toString(36).slice(2)}`
  const configPath = join(persistDir, 'wrangler.local.jsonc')
  const config = JSON.parse(stripJsonc(readFileSync(join(ROOT, 'wrangler.jsonc'), 'utf8')))
  // Paths inside the temp config resolve relative to ITS directory — pin the
  // real worker entry to the repo root.
  config.main = join(ROOT, 'worker/index.ts')
  config.triggers = undefined
  config.vars = { ...(config.vars ?? {}), SESSION_SECRET: secret, APP_ORIGIN: `http://127.0.0.1:${port}` }
  writeFileSync(configPath, JSON.stringify(config, null, 2))

  console.log('[1/4] 应用迁移（本地 D1，顺序执行 migrations/d1/*.sql）…')
  const files = readdirSync(join(ROOT, 'migrations/d1')).filter((f) => f.endsWith('.sql')).sort()
  for (const file of files) {
    wrangler(['d1', 'execute', 'worldcredit', '--local',
      '--persist-to', persistDir, '--file', join(ROOT, 'migrations/d1', file), '--yes'])
  }

  console.log('[2/4] 写入幂等 seed（*.example.test + 验证管理员）…')
  const adminEmail = adminEmailFromAllowlist()
  const seedPath = join(persistDir, 'seed.substituted.sql')
  writeFileSync(seedPath, readFileSync(join(ROOT, 'scripts/opportunities-seed.sql'), 'utf8').replace(/__ADMIN_EMAIL__/g, adminEmail))
  wrangler(['d1', 'execute', 'worldcredit', '--local',
    '--persist-to', persistDir, '--file', seedPath, '--yes'])

  console.log('[3/4] 启动本地服务（vinext dev + 隔离 persist）…')
  const child = spawn('npx', ['vinext', 'dev', '-p', String(port)], {
    cwd: ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      WC_LOCAL_WRANGLER_CONFIG: configPath,
      WC_LOCAL_PERSIST: persistDir,
    },
  })
  const shutdown = () => {
    child.kill('SIGTERM')
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  console.log('[4/4] 就绪。')
  console.log(`  地址:     http://127.0.0.1:${port}`)
  console.log(`  管理员:   ${adminEmail.slice(0, 3)}***（密码 verify1234）`)
  console.log('  成员:     member-verify@example.test（密码 verify1234）')
  console.log('  持久化:  ' + persistDir)
  console.log('  验证完成后 Ctrl-C 停止（只终止本脚本进程）。')
  await new Promise(() => {})
}

main().catch((err) => die(String(err?.message ?? err)))
