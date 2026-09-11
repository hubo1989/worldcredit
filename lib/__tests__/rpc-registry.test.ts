// Guards the dedicated RPC API contract:
// 1. every client rpc call must have an allowlisted registry entry
// 2. the migration-era bridges stay deleted

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { RPC_REGISTRY } from '../api/registry'

const ROOT = join(__dirname, '../..')

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules' || name === '.server.ts') continue
      walk(full, out)
    } else if (/\.tsx?$/.test(name)) {
      out.push(full)
    }
  }
  return out
}

const RPC_CALL_RE = /callRpc<typeof [A-Za-z0-9_.]+>\(\s*'([a-z-]+)'\s*,\s*'([A-Za-z0-9]+)'/g

function collectClientRpcCalls(): Array<{ file: string; module: string; fn: string }> {
  const files = [
    ...walk(join(ROOT, 'lib/api')),
    join(ROOT, 'lib/reminders.ts'),
  ]
  const calls: Array<{ file: string; module: string; fn: string }> = []
  for (const file of files) {
    if (file.endsWith('.server.ts')) continue
    const src = readFileSync(file, 'utf8')
    let m: RegExpExecArray | null
    while ((m = RPC_CALL_RE.exec(src))) {
      calls.push({ file, module: m[1], fn: m[2] })
    }
  }
  return calls
}

describe('RPC registry contract', () => {
  it('has an allowlist entry for every client rpc call', () => {
    const calls = collectClientRpcCalls()
    expect(calls.length).toBeGreaterThan(50)
    for (const { file, module, fn } of calls) {
      const entry = RPC_REGISTRY[module]?.[fn]
      expect(entry, `${file} calls ${module}.${fn} which is missing from RPC_REGISTRY`).toBeTruthy()
    }
  })

  it('never passes raw SQL or table names through the RPC surface', () => {
    const calls = collectClientRpcCalls()
    for (const { fn } of calls) {
      expect(fn).not.toMatch(/sql|query|execute|table|proxy/i)
    }
  })

  it('keeps the migration-era bridges deleted', () => {
    expect(existsSync(join(ROOT, 'lib/client-db.ts'))).toBe(false)
    expect(existsSync(join(ROOT, 'app/api/sql-proxy'))).toBe(false)
    expect(existsSync(join(ROOT, 'app/api/db-proxy'))).toBe(false)
    const helpers = readFileSync(join(ROOT, 'lib/db/helpers.ts'), 'utf8')
    expect(helpers).not.toContain('sql-proxy')
    expect(helpers).not.toContain('proxySql')
  })

  it('derives user identity server-side for user-scoped queries', () => {
    // User-scoped list/read functions must never trust a client-provided userId.
    for (const [moduleName, mod] of Object.entries(RPC_REGISTRY)) {
      for (const [fn, entry] of Object.entries(mod)) {
        if (/^(getHolders|getUserPreferences|updateUserPreferences|getBillEmailSources|addBillEmailSource|getAllMyBenefits|getCardsWithBillsSummary|getBillDashboardItems|markAllOverdueBillsAsPaid|syncGmailLedgerToCardsAndBills|getDueBillsForReminders|subscribePush)$/.test(fn)) {
          expect(entry.bindUser !== undefined || entry.bindField !== undefined, `${moduleName}.${fn} must bind the session user`).toBe(true)
        }
      }
    }
  })

  it('keeps base-data mutations admin-only (plan.md D2)', () => {
    const adminOnlyFns: Array<[string, string]> = [
      ['cards', 'createCard'],
      ['cards', 'updateCard'],
      ['bills', 'createBill'],
      ['bills', 'updateBill'],
      ['bills', 'updateBillStatus'],
      ['billDrafts', 'confirmBillImportDraft'],
      ['holders', 'createHolder'],
      ['holders', 'updateHolder'],
      ['holders', 'mergeHolders'],
      ['promos', 'createUserPromo'],
      ['emailBills', 'syncEmailBillToAccount'],
      ['sync-gmail', 'syncGmailLedgerToCardsAndBills'],
    ];
    for (const [moduleName, fn] of adminOnlyFns) {
      expect(RPC_REGISTRY[moduleName]?.[fn]?.admin, `${moduleName}.${fn} must require admin`).toBe(true);
    }
  });

  it('lets members record their own repayments and benefit usage via guards (plan.md D2)', () => {
    expect(RPC_REGISTRY.bills.createPayment.memberGuard).toBeDefined();
    expect(RPC_REGISTRY.bills.markBillAsPaid.memberGuard).toBeDefined();
    expect(RPC_REGISTRY.benefits.recordBenefitUsage.memberGuard).toBeDefined();
  });
})
