#!/usr/bin/env node
/**
 * Copy normalized_bills.json from Gmail ledger workspace into project data/ dir.
 * Run: node scripts/import-gmail-ledger-data.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(__dirname, '..')

const source = '/Users/hubo/Markdown/document/gmail-financial-bills-ledger/normalized_bills.json'
const dest = join(projectRoot, 'data', 'gmail-bills.json')

try {
  const raw = readFileSync(source, 'utf-8')
  // Validate JSON
  const data = JSON.parse(raw)
  console.log(`Read ${data.length} records from ledger`)
  
  mkdirSync(join(projectRoot, 'data'), { recursive: true })
  writeFileSync(dest, JSON.stringify(data, null, 2))
  console.log(`Written to ${dest}`)
} catch (err) {
  console.error('Failed:', err.message)
  process.exit(1)
}
