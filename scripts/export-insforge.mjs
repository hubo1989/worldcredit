// scripts/export-insforge.mjs
// Export data from InsForge Postgres via the REST API.
// Requires INSFORGE_URL and INSFORGE_ANON_KEY environment variables.
// Output: ./data/insforge-export/*.json (one file per table)

const BASE_URL = process.env.INSFORGE_URL || 'https://pxjywhe6.us-east.insforge.app'
const API_KEY = process.env.INSFORGE_ANON_KEY || 'ik_dc920419d78adda89852846019da2f48'

const TABLES = [
  'banks', 'card_products', 'benefits', 'promos',
  'card_holders', 'credit_cards', 'bills', 'payments',
  'benefit_usages', 'promo_usages', 'system_settings',
  'push_subscriptions', 'reminder_logs',
  'bill_email_sources', 'record_attachments', 'email_parse_logs',
  'user_preferences', 'gmail_ledger_entries', 'bill_import_drafts',
  'notification_preferences', 'notification_history', 'users',
]

import { mkdirSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(__dirname, '..', 'data', 'insforge-export')

mkdirSync(OUT_DIR, { recursive: true })

async function exportTable(table) {
  const url = `${BASE_URL}/rest/v1/${table}?select=*`
  const res = await fetch(url, {
    headers: {
      'apikey': API_KEY,
      'Authorization': `Bearer ${API_KEY}`,
      'Range': '0-99999',
      'Prefer': 'count=exact',
    },
  })
  if (!res.ok) {
    console.error(`[export] ${table}: HTTP ${res.status} ${await res.text().then(t => t.slice(0, 200))}`)
    return null
  }
  const data = await res.json()
  if (!Array.isArray(data) || data.length === 0) {
    console.log(`[export] ${table}: 0 rows`)
    return null
  }
  const outPath = join(OUT_DIR, `${table}.json`)
  writeFileSync(outPath, JSON.stringify(data, null, 2))
  console.log(`[export] ${table}: ${data.length} rows → ${outPath}`)
  return data.length
}

async function main() {
  console.log(`Exporting from ${BASE_URL}...`)
  const results = {}
  for (const table of TABLES) {
    try {
      results[table] = await exportTable(table)
    } catch (err) {
      console.error(`[export] ${table}: ${err.message}`)
      results[table] = null
    }
  }
  const summary = Object.fromEntries(Object.entries(results).filter(([, v]) => v !== null))
  console.log('\n=== Summary ===')
  console.table(summary)
  const total = Object.values(summary).reduce((a, b) => a + b, 0)
  console.log(`Total rows: ${total}`)
}

main().catch(console.error)
