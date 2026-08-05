/**
 * 导入 Gmail 账单数据到 InsForge DB (gmail_ledger_entries 表)
 *
 * 用法:
 *   node scripts/import-gmail-ledger-entries.mjs [ledger-json-path]
 *   node scripts/import-gmail-ledger-entries.mjs --dry-run          # 只预览不写入
 *   node scripts/import-gmail-ledger-entries.mjs --force            # 强制覆盖 payment_status
 */
import { createClient } from '@insforge/sdk'
import { readFile } from 'node:fs/promises'
import { config } from 'dotenv'
config({ path: '.env.local' })

const DEFAULT_LEDGER_PATH = '/Users/hubo/Markdown/document/gmail-financial-bills-ledger/normalized_bills_clean.json'

function usage() {
  console.log(`Usage:
  node scripts/import-gmail-ledger-entries.mjs [ledger-json-path] [--dry-run] [--force]

Options:
  --dry-run   预览导入结果，不写入数据库
  --force     覆盖已有的 payment_status（默认保留 DB 中已标记的还款状态）
`)
  process.exit(0)
}

async function main() {
  const ledgerPath = process.argv.find(a => !a.startsWith('-') && !a.endsWith('.mjs')) ?? DEFAULT_LEDGER_PATH
  const dryRun = process.argv.includes('--dry-run')
  const force = process.argv.includes('--force')
  if (process.argv.includes('--help') || process.argv.includes('-h')) usage()

  const url = process.env.NEXT_PUBLIC_INSFORGE_URL
  const key = process.env.INSFORGE_SERVICE_KEY || process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY
  if (!url || !key) throw new Error('Missing InsForge env vars')

  const raw = await readFile(ledgerPath, 'utf8')
  const rows = JSON.parse(raw)
  const client = createClient({ baseUrl: url, anonKey: key })

  // 预加载已有记录（用于保留已标记的还款状态）
  const { data: existing } = await client.database
    .from('gmail_ledger_entries')
    .select('id, ledger_id, paid_amount, remaining_amount, completed, payment_status, payment_note, payment_date')
  const existingMap = new Map((existing ?? []).map(e => [e.ledger_id, e]))

  let imported = 0, skipped = 0, updated = 0, failed = 0

  for (const row of rows) {
    try {
      const existingRecord = existingMap.get(row.id)
      const now = new Date().toISOString()

      // 如果已有记录且非 force 模式，保留已标记的还款状态
      const paidAmount = force ? Number(row.paid_amount ?? 0) : (existingRecord?.paid_amount ?? Number(row.paid_amount ?? 0))
      const remainingAmount = force ? Number(row.remaining_amount ?? 0) : (existingRecord?.remaining_amount ?? Number(row.remaining_amount ?? 0))
      const completed = force ? Boolean(row.completed) : (existingRecord?.completed ?? Boolean(row.completed))
      const paymentStatus = force ? (row.payment_status || '未还款') : (existingRecord?.payment_status || row.payment_status || '未还款')
      const paymentNote = force ? (row.payment_note || null) : ((existingRecord?.payment_note) ?? (row.payment_note || null))
      const paymentDate = force ? (row.payment_date || null) : ((existingRecord?.payment_date) ?? (row.payment_date || null))

      const payload = {
        ledger_id: row.id,
        bank: row.bank,
        account_tail: row.account_tail || null,
        kind: row.kind || '信用卡',
        region: row.region || '国内/中国',
        currency: row.currency || 'CNY',
        statement_amount: typeof row.statement_amount === 'number' ? Math.abs(row.statement_amount) : 0,
        statement_amount_raw: row.statement_amount_raw || null,
        minimum_payment: typeof row.minimum_payment === 'number' ? Math.abs(row.minimum_payment) : 0,
        minimum_payment_raw: row.minimum_payment_raw || null,
        due_date: row.due_date || null,
        statement_date: row.statement_date || null,
        subject: row.subject || null,
        source: row.source || null,
        message_id: row.message_id || null,
        thread_id: row.thread_id || null,
        evidence: row.evidence || null,
        attachment_path: row.attachment_path || null,
        // LLM-enriched fields
        cardholder_name: row.cardholder_name || null,
        is_overpayment: Boolean(row.is_overpayment),
        amount_direction: row.amount_direction || 'unknown',
        loan_monthly_payment: row.loan_monthly_payment || null,
        loan_details: row.loan_details || null,
        llm_confidence: row.llm_confidence || null,
        // 还款状态（从已有记录或 JSON 继承）
        paid_amount: paidAmount,
        remaining_amount: remainingAmount,
        completed,
        payment_status: paymentStatus,
        payment_note: paymentNote,
        payment_date: paymentDate,
        last_payment_update: now,
        updated_at: now,
      }

      if (dryRun) {
        imported++
        console.log(`[DRY-RUN] ${row.bank} ${row.account_tail} ${row.due_date} amt=${payload.statement_amount} status=${paymentStatus}`)
        continue
      }

      const { error } = await client.database
        .from('gmail_ledger_entries')
        .upsert(payload, { onConflict: 'ledger_id' })

      if (error) {
        failed++
        console.error(`FAIL ${row.id}: ${error.message}`)
        continue
      }

      if (existingRecord) updated++
      else imported++
    } catch (e) {
      failed++
      console.error(`ERROR ${row.id}:`, e.message)
    }
  }

  console.log(JSON.stringify({
    total: rows.length,
    imported,
    updated,
    skipped,
    failed,
    mode: dryRun ? 'dry-run' : (force ? 'force' : 'merge'),
  }, null, 2))
}

main().catch(err => { console.error(err); process.exit(1) })
