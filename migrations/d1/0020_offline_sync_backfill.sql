-- 0019 captures only future writes. Seed the existing rows for a fresh client
-- starting at cursor 0, without rewriting business records or their timestamps.
-- Parents precede children so paged bootstrap can respect local foreign keys.
-- The per-owner upsert guard makes re-running this backfill harmless, including
-- rows already captured by the 0019 triggers between the two migrations.

INSERT INTO sync_changes (owner_id, tbl, row_id, op)
SELECT NULL, 'banks', t.id, 'upsert' FROM banks t
WHERE NOT EXISTS (SELECT 1 FROM sync_changes s
  WHERE s.owner_id IS NULL AND s.tbl = 'banks' AND s.row_id = t.id AND s.op = 'upsert')
ORDER BY t.id;

INSERT INTO sync_changes (owner_id, tbl, row_id, op)
SELECT NULL, 'card_products', t.id, 'upsert' FROM card_products t
WHERE NOT EXISTS (SELECT 1 FROM sync_changes s
  WHERE s.owner_id IS NULL AND s.tbl = 'card_products' AND s.row_id = t.id AND s.op = 'upsert')
ORDER BY t.id;

INSERT INTO sync_changes (owner_id, tbl, row_id, op)
SELECT NULL, 'benefits', t.id, 'upsert' FROM benefits t
WHERE NOT EXISTS (SELECT 1 FROM sync_changes s
  WHERE s.owner_id IS NULL AND s.tbl = 'benefits' AND s.row_id = t.id AND s.op = 'upsert')
ORDER BY t.id;

INSERT INTO sync_changes (owner_id, tbl, row_id, op)
SELECT NULL, 'promos', t.id, 'upsert' FROM promos t
WHERE NOT EXISTS (SELECT 1 FROM sync_changes s
  WHERE s.owner_id IS NULL AND s.tbl = 'promos' AND s.row_id = t.id AND s.op = 'upsert')
ORDER BY t.id;

INSERT INTO sync_changes (owner_id, tbl, row_id, op)
SELECT t.managed_by, 'card_holders', t.id, 'upsert' FROM card_holders t
WHERE NOT EXISTS (SELECT 1 FROM sync_changes s
  WHERE s.owner_id = t.managed_by AND s.tbl = 'card_holders' AND s.row_id = t.id AND s.op = 'upsert')
ORDER BY t.id;

INSERT INTO sync_changes (owner_id, tbl, row_id, op)
SELECT ch.managed_by, 'credit_cards', t.id, 'upsert' FROM credit_cards t
JOIN card_holders ch ON ch.id = t.holder_id
WHERE NOT EXISTS (SELECT 1 FROM sync_changes s
  WHERE s.owner_id = ch.managed_by AND s.tbl = 'credit_cards' AND s.row_id = t.id AND s.op = 'upsert')
ORDER BY t.id;

INSERT INTO sync_changes (owner_id, tbl, row_id, op)
SELECT ch.managed_by, 'bills', t.id, 'upsert' FROM bills t
JOIN credit_cards cc ON cc.id = t.card_id
JOIN card_holders ch ON ch.id = cc.holder_id
WHERE NOT EXISTS (SELECT 1 FROM sync_changes s
  WHERE s.owner_id = ch.managed_by AND s.tbl = 'bills' AND s.row_id = t.id AND s.op = 'upsert')
ORDER BY t.id;

INSERT INTO sync_changes (owner_id, tbl, row_id, op)
SELECT ch.managed_by, 'payments', t.id, 'upsert' FROM payments t
JOIN bills b ON b.id = t.bill_id
JOIN credit_cards cc ON cc.id = b.card_id
JOIN card_holders ch ON ch.id = cc.holder_id
WHERE NOT EXISTS (SELECT 1 FROM sync_changes s
  WHERE s.owner_id = ch.managed_by AND s.tbl = 'payments' AND s.row_id = t.id AND s.op = 'upsert')
ORDER BY t.id;

INSERT INTO sync_changes (owner_id, tbl, row_id, op)
SELECT t.user_id, 'user_preferences', t.user_id, 'upsert' FROM user_preferences t
WHERE NOT EXISTS (SELECT 1 FROM sync_changes s
  WHERE s.owner_id = t.user_id AND s.tbl = 'user_preferences' AND s.row_id = t.user_id AND s.op = 'upsert')
ORDER BY t.user_id;

INSERT INTO sync_changes (owner_id, tbl, row_id, op)
SELECT t.user_id, 'notification_preferences', t.user_id, 'upsert' FROM notification_preferences t
WHERE NOT EXISTS (SELECT 1 FROM sync_changes s
  WHERE s.owner_id = t.user_id AND s.tbl = 'notification_preferences' AND s.row_id = t.user_id AND s.op = 'upsert')
ORDER BY t.user_id;

INSERT INTO sync_changes (owner_id, tbl, row_id, op)
SELECT t.created_by, 'recurring_payables', t.id, 'upsert' FROM recurring_payables t
WHERE NOT EXISTS (SELECT 1 FROM sync_changes s
  WHERE s.owner_id = t.created_by AND s.tbl = 'recurring_payables' AND s.row_id = t.id AND s.op = 'upsert')
ORDER BY t.id;

INSERT INTO sync_changes (owner_id, tbl, row_id, op)
SELECT rp.created_by, 'recurring_payable_payments', t.id, 'upsert' FROM recurring_payable_payments t
JOIN recurring_payables rp ON rp.id = t.payable_id
WHERE NOT EXISTS (SELECT 1 FROM sync_changes s
  WHERE s.owner_id = rp.created_by AND s.tbl = 'recurring_payable_payments' AND s.row_id = t.id AND s.op = 'upsert')
ORDER BY t.id;
