-- 0036_gmail_ledger_single_track_migration.sql
-- 方向1 (HUB-152): 历史 gmail_ledger_entries 一次性无损分流至 bill_import_drafts

ALTER TABLE gmail_ledger_entries ADD COLUMN migration_status TEXT DEFAULT NULL
  CHECK (migration_status IS NULL OR migration_status IN ('archived_matched', 'migrated_to_draft', 'skipped_noise'));
ALTER TABLE gmail_ledger_entries ADD COLUMN migrated_draft_id TEXT REFERENCES bill_import_drafts(id) ON DELETE SET NULL;

-- 1. 已关联 matched_bill_id 的记录直接归档，不重复生成草稿
UPDATE gmail_ledger_entries
SET migration_status = 'archived_matched'
WHERE matched_bill_id IS NOT NULL AND migration_status IS NULL;

-- 2. 溢缴款与无账期附属卡明细噪音标记为 skipped_noise
UPDATE gmail_ledger_entries
SET migration_status = 'skipped_noise'
WHERE matched_bill_id IS NULL
  AND migration_status IS NULL
  AND COALESCE(statement_amount, 0) > 0
  AND (
    COALESCE(is_overpayment, 0) = 1
    OR COALESCE(amount_direction, '') = 'credit'
    OR (COALESCE(manually_priced, 0) = 0 AND due_date IS NULL AND statement_date IS NULL)
  );

-- 3. 同用户同卡同期同金额重复记录只保留已还金额最高/最新一条，其余标记 skipped_noise
WITH ranked_priced AS (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY COALESCE(created_by, ''), bank, COALESCE(account_tail, ''), COALESCE(due_date, statement_date, ''), COALESCE(currency, 'CNY'), statement_amount
      ORDER BY COALESCE(paid_amount, 0) DESC, updated_at DESC, id ASC
    ) AS rk
  FROM gmail_ledger_entries
  WHERE matched_bill_id IS NULL AND migration_status IS NULL AND COALESCE(statement_amount, 0) > 0
    AND COALESCE(due_date, statement_date, '') <> ''
)
UPDATE gmail_ledger_entries
SET migration_status = 'skipped_noise'
WHERE id IN (SELECT id FROM ranked_priced WHERE rk > 1);

-- 4. 未关联有效记录（含未还/部分还款/已还清未进主表 & statement_amount = 0 待补金额记录）转入草稿箱
INSERT OR IGNORE INTO bill_import_drafts (
  id, created_by, card_id, source_type, source_label, raw_text,
  parsed_payload, status, parse_status, confidence, created_at, updated_at
)
SELECT
  'draft_leg_' || gle.id,
  COALESCE(gle.created_by, (SELECT id FROM users WHERE role = 'admin' ORDER BY created_at ASC, id LIMIT 1)),
  (SELECT id FROM credit_cards WHERE id = gle.matched_card_id),
  'legacy_ledger',
  '历史邮箱账本迁入',
  COALESCE(gle.evidence, gle.subject),
  json_object(
    'is_bill', json('true'),
    'bank_name', gle.bank,
    'card_last4', gle.account_tail,
    'currency', COALESCE(gle.currency, 'CNY'),
    'bill_amount', CASE WHEN COALESCE(gle.statement_amount, 0) > 0 THEN gle.statement_amount ELSE NULL END,
    'min_payment', CASE WHEN COALESCE(gle.minimum_payment, 0) > 0 THEN gle.minimum_payment ELSE NULL END,
    'due_date', gle.due_date,
    'due_date_status', CASE WHEN gle.due_date IS NOT NULL THEN 'exact' ELSE 'missing' END,
    'statement_date', gle.statement_date,
    'bill_month', COALESCE(substr(gle.statement_date, 1, 7), substr(gle.due_date, 1, 7)),
    'holder_hint', gle.cardholder_name,
    'warnings', CASE
      WHEN COALESCE(gle.statement_amount, 0) <= 0 THEN json_array('原邮件无金额，请补录后确认入账')
      WHEN gle.due_date IS NULL THEN json_array('缺少确切还款截止日，请补全后确认入账')
      ELSE json_array()
    END,
    'legacy_ledger', json_object(
      'entry_id', gle.id,
      'ledger_id', gle.ledger_id,
      'paid_amount', COALESCE(gle.paid_amount, 0),
      'payment_status', gle.payment_status,
      'payment_date', gle.payment_date,
      'payment_note', gle.payment_note
    )
  ),
  'draft',
  'ready',
  CASE WHEN COALESCE(gle.statement_amount, 0) > 0 AND gle.due_date IS NOT NULL THEN 0.8 ELSE 0.4 END,
  gle.created_at,
  strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
FROM gmail_ledger_entries gle
WHERE gle.matched_bill_id IS NULL
  AND gle.migration_status IS NULL
  AND COALESCE(gle.created_by, (SELECT id FROM users WHERE role = 'admin' ORDER BY created_at ASC, id LIMIT 1)) IS NOT NULL;

UPDATE gmail_ledger_entries
SET migration_status = 'migrated_to_draft',
    migrated_draft_id = 'draft_leg_' || id
WHERE matched_bill_id IS NULL
  AND migration_status IS NULL
  AND EXISTS (SELECT 1 FROM bill_import_drafts d WHERE d.id = 'draft_leg_' || gmail_ledger_entries.id);
