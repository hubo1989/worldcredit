const { createClient } = require('@insforge/sdk');
const fs = require('fs');

const client = createClient({
  baseUrl: 'https://dr7vjx28.us-east.insforge.app',
  anonKey: 'ik_57fece43b0eb5f4c1110d80f6fa28189'
});
const db = client.database;

const bills = JSON.parse(fs.readFileSync('/Users/hubo/Markdown/document/gmail-financial-bills-ledger/llm_extracted_bills.json', 'utf-8'));

const CUR_MAP = { 'RMB': 'CNY', 'USD': 'USD', 'HKD': 'HKD', 'EUR': 'EUR' };
function normalizeCur(c) { return (CUR_MAP[c] || c || 'CNY').toUpperCase(); }

function region(bank) {
  const n = (bank || '').toLowerCase();
  if (['chase','capital one','boa','amex','apple','discover'].some(x => n.includes(x))) return 'US';
  if (['hsbc','hang seng','bea','cncbi'].some(x => n.includes(x))) return 'HK';
  return 'CN';
}

async function run() {
  let imported = 0, skipped = 0, errors = 0;

  for (const bill of bills) {
    if (bill.bill_type === 'ignore' || !bill.bill_type) { skipped++; continue; }
    
    for (const card of (bill.cards || [])) {
      if (!card.card_tail && card.statement_amount == null) { skipped++; continue; }
      
      const amount = Number(card.statement_amount || 0);
      if (amount === 0) { skipped++; continue; }
      
      const cur = normalizeCur(card.currency);
      const entry = {
        ledger_id: `llm_${bill._cache_key}_${card.card_tail || 'unk'}`,
        bank: bill.bank_name || '',
        account_tail: card.card_tail || null,
        kind: 'credit_card',
        region: region(bill.bank_name),
        currency: cur,
        statement_amount: amount,
        statement_amount_raw: amount ? String(amount) : null,
        minimum_payment: Number(card.minimum_payment || 0),
        minimum_payment_raw: card.minimum_payment != null ? String(card.minimum_payment) : null,
        due_date: card.due_date || null,
        statement_date: card.statement_date || null,
        subject: null, source: bill._source || null,
        message_id: null, thread_id: null, evidence: null,
        attachment_path: bill._source || null,
        cardholder_name: bill.cardholder_name || null,
        is_overpayment: !!card.is_overpayment,
        amount_direction: card.is_overpayment ? 'credit' : 'debit',
        loan_monthly_payment: null, loan_details: null, llm_confidence: null,
        paid_amount: 0, remaining_amount: amount,
        completed: false, payment_status: '\u672a\u8fd8\u6b3e',
        payment_note: null, payment_date: null, last_payment_update: null,
        matched_card_id: null, matched_bill_id: null,
      };

      try {
        const { error } = await db.from('gmail_ledger_entries').upsert(entry, { onConflict: 'ledger_id' });
        if (error) { console.error('UPSERT ERROR', entry.ledger_id, ':', error.message); errors++; }
        else { imported++; }
      } catch (e) {
        console.error('EXCEPTION', entry.ledger_id, ':', e.message); errors++;
      }
    }
  }

  console.log('\nImport complete:', imported, 'imported,', skipped, 'skipped,', errors, 'errors');
}

run().catch(e => { console.error(e.message); process.exit(1); });
