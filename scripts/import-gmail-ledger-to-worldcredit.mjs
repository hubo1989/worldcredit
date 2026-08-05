import { createClient } from '@insforge/sdk'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import 'dotenv/config'

const DEFAULT_LEDGER_PATH = '/Users/hubo/Markdown/document/gmail-financial-bills-ledger/normalized_bills.json'

function usage() {
  console.log(`Usage:
  node scripts/import-gmail-ledger-to-worldcredit.mjs [ledger-json-path]

Environment:
  NEXT_PUBLIC_INSFORGE_URL       InsForge base URL
  INSFORGE_SERVICE_KEY           preferred for import, bypasses RLS
  NEXT_PUBLIC_INSFORGE_ANON_KEY  fallback if service key is not set
  WORLDCREDIT_IMPORT_USER_ID     optional; used for email_parse_logs user_id when a card holder cannot be resolved
`)
  process.exit(0)
}

function isIsoDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function billMonthFrom(statementDate, dueDate) {
  const source = statementDate && isIsoDate(statementDate) ? statementDate : dueDate
  return source.slice(0, 7)
}

function normalizeAmount(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  // Some bank statements encode payable balances as negative numbers; bills need positive payable amount.
  return Math.abs(value)
}

function compactText(value) {
  return String(value ?? '').toLowerCase().replace(/\s+/g, '')
}

function bankMatches(cardBank, billBank) {
  const card = compactText(cardBank)
  const bill = compactText(billBank)
  if (!card || !bill) return false
  return bill.includes(card) || card.includes(bill) || bill.split('/').some(part => part && card.includes(part))
}

function stableIdempotencyKey(row) {
  const raw = [
    row.id,
    row.message_id,
    row.thread_id,
    row.bank,
    row.account_tail,
    row.statement_date,
    row.due_date,
    row.statement_amount,
    row.subject,
    row.attachment_path,
  ].join('|')
  return createHash('sha1').update(raw).digest('hex')
}

function findMatchingCard(row, cards) {
  const tail = String(row.account_tail ?? '').trim()
  const tailMatches = tail ? cards.filter(card => String(card.card_number_last4 ?? '') === tail) : cards
  if (tailMatches.length === 1) return tailMatches[0]

  const bankMatchedCards = tailMatches.filter(card => bankMatches(card.card_product?.bank_name, row.bank))
  if (bankMatchedCards.length === 1) return bankMatchedCards[0]

  // Only guess when there is exactly one card and the ledger has no tail. Never guess across multiple cards.
  if (!tail && cards.length === 1) return cards[0]
  return null
}

async function main() {
  const ledgerPath = process.argv[2] ?? DEFAULT_LEDGER_PATH
  if (process.argv.includes('--help') || process.argv.includes('-h')) usage()

  const url = process.env.NEXT_PUBLIC_INSFORGE_URL
  const key = process.env.INSFORGE_SERVICE_KEY || process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY
  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_INSFORGE_URL and INSFORGE_SERVICE_KEY/NEXT_PUBLIC_INSFORGE_ANON_KEY')
  }

  const rows = JSON.parse(await readFile(ledgerPath, 'utf8'))
  const client = createClient({ baseUrl: url, anonKey: key })

  const { data: cards, error: cardError } = await client.database
    .from('credit_cards')
    .select('id,holder_id,card_number_last4,card_product:card_products(bank_name,card_name),holder:card_holders(created_by)')
  if (cardError) throw cardError

  const result = { imported: 0, skipped: 0, failed: 0, details: [] }

  for (const row of rows) {
    const amount = normalizeAmount(row.statement_amount)
    if (!amount || !isIsoDate(row.due_date)) {
      result.skipped++
      result.details.push(`SKIP missing amount/due_date: ${row.bank ?? 'unknown'} ${row.subject ?? ''}`)
      continue
    }

    const card = findMatchingCard(row, cards ?? [])
    if (!card) {
      result.skipped++
      result.details.push(`SKIP no card match: bank=${row.bank ?? ''} tail=${row.account_tail ?? ''} subject=${row.subject ?? ''}`)
      continue
    }

    const userId = card.holder?.created_by || process.env.WORLDCREDIT_IMPORT_USER_ID
    const billMonth = billMonthFrom(row.statement_date, row.due_date)
    const minPayment = normalizeAmount(row.minimum_payment)
    const auditPayload = {
      source: row.source,
      ledger_id: row.id,
      message_id: row.message_id,
      thread_id: row.thread_id,
      evidence: row.evidence,
      attachment_path: row.attachment_path,
      currency: row.currency,
      import_key: stableIdempotencyKey(row),
    }

    const { data: bill, error: billError } = await client.database
      .from('bills')
      .upsert({
        card_id: card.id,
        bill_month: billMonth,
        statement_date: isIsoDate(row.statement_date) ? row.statement_date : null,
        bill_amount: amount,
        min_payment: minPayment ?? 0,
        due_date: row.due_date,
        status: 'unpaid',
      }, { onConflict: 'card_id,bill_month' })
      .select('id')
      .single()

    if (billError) {
      result.failed++
      result.details.push(`FAIL bill upsert: ${billError.message}`)
      continue
    }

    if (userId) {
      const { error: logError } = await client.database.from('email_parse_logs').insert({
        user_id: userId,
        from_email: null,
        subject: row.subject ?? null,
        bill_id: bill?.id ?? null,
        status: 'success',
        error_msg: null,
        raw_ai_response: JSON.stringify(auditPayload),
      })
      if (logError) result.details.push(`WARN email_parse_logs insert failed: ${logError.message}`)
    }

    result.imported++
    result.details.push(`OK ${row.bank ?? ''} ${row.account_tail ?? ''} ${billMonth} amount=${amount}`)
  }

  console.log(JSON.stringify(result, null, 2))
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
