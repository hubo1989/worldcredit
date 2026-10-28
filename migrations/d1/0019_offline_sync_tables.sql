-- migrations/d1/0019_offline_sync_tables.sql
-- Offline sync infrastructure: sync_changes, sync_mutations, device_tokens and change triggers

CREATE TABLE IF NOT EXISTS sync_changes (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id TEXT, -- NULL for catalog items (visible to all users)
  tbl TEXT NOT NULL,
  row_id TEXT NOT NULL,
  op TEXT NOT NULL CHECK (op IN ('upsert', 'delete')),
  changed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sync_changes_owner_seq ON sync_changes(owner_id, seq);
CREATE INDEX IF NOT EXISTS idx_sync_changes_tbl_row ON sync_changes(tbl, row_id);

CREATE TABLE IF NOT EXISTS sync_mutations (
  client_id TEXT NOT NULL,
  mutation_id TEXT NOT NULL,
  result TEXT, -- JSON string representation of mutation response
  processed_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (client_id, mutation_id)
);

CREATE TABLE IF NOT EXISTS device_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  token TEXT NOT NULL UNIQUE,
  app_version TEXT,
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_device_tokens_user ON device_tokens(user_id);

-- ============================================================
-- Triggers: Catalog tables (owner_id IS NULL)
-- ============================================================

-- banks
CREATE TRIGGER IF NOT EXISTS trg_banks_insert AFTER INSERT ON banks BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op) VALUES (NULL, 'banks', NEW.id, 'upsert');
END;
CREATE TRIGGER IF NOT EXISTS trg_banks_update AFTER UPDATE ON banks BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op) VALUES (NULL, 'banks', NEW.id, 'upsert');
END;
CREATE TRIGGER IF NOT EXISTS trg_banks_delete AFTER DELETE ON banks BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op) VALUES (NULL, 'banks', OLD.id, 'delete');
END;

-- card_products
CREATE TRIGGER IF NOT EXISTS trg_card_products_insert AFTER INSERT ON card_products BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op) VALUES (NULL, 'card_products', NEW.id, 'upsert');
END;
CREATE TRIGGER IF NOT EXISTS trg_card_products_update AFTER UPDATE ON card_products BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op) VALUES (NULL, 'card_products', NEW.id, 'upsert');
END;
CREATE TRIGGER IF NOT EXISTS trg_card_products_delete AFTER DELETE ON card_products BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op) VALUES (NULL, 'card_products', OLD.id, 'delete');
END;

-- benefits
CREATE TRIGGER IF NOT EXISTS trg_benefits_insert AFTER INSERT ON benefits BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op) VALUES (NULL, 'benefits', NEW.id, 'upsert');
END;
CREATE TRIGGER IF NOT EXISTS trg_benefits_update AFTER UPDATE ON benefits BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op) VALUES (NULL, 'benefits', NEW.id, 'upsert');
END;
CREATE TRIGGER IF NOT EXISTS trg_benefits_delete AFTER DELETE ON benefits BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op) VALUES (NULL, 'benefits', OLD.id, 'delete');
END;

-- promos
CREATE TRIGGER IF NOT EXISTS trg_promos_insert AFTER INSERT ON promos BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op) VALUES (NULL, 'promos', NEW.id, 'upsert');
END;
CREATE TRIGGER IF NOT EXISTS trg_promos_update AFTER UPDATE ON promos BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op) VALUES (NULL, 'promos', NEW.id, 'upsert');
END;
CREATE TRIGGER IF NOT EXISTS trg_promos_delete AFTER DELETE ON promos BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op) VALUES (NULL, 'promos', OLD.id, 'delete');
END;

-- ============================================================
-- Triggers: User data tables
-- ============================================================

-- card_holders (owner = managed_by)
CREATE TRIGGER IF NOT EXISTS trg_card_holders_insert AFTER INSERT ON card_holders BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op) VALUES (NEW.managed_by, 'card_holders', NEW.id, 'upsert');
END;
CREATE TRIGGER IF NOT EXISTS trg_card_holders_update AFTER UPDATE ON card_holders BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op) VALUES (NEW.managed_by, 'card_holders', NEW.id, 'upsert');
END;
CREATE TRIGGER IF NOT EXISTS trg_card_holders_delete AFTER DELETE ON card_holders BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op) VALUES (OLD.managed_by, 'card_holders', OLD.id, 'delete');
END;

-- credit_cards (owner = card_holders.managed_by)
CREATE TRIGGER IF NOT EXISTS trg_credit_cards_insert AFTER INSERT ON credit_cards BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT ch.managed_by, 'credit_cards', NEW.id, 'upsert'
  FROM card_holders ch WHERE ch.id = NEW.holder_id;
END;
CREATE TRIGGER IF NOT EXISTS trg_credit_cards_update AFTER UPDATE ON credit_cards BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT ch.managed_by, 'credit_cards', NEW.id, 'upsert'
  FROM card_holders ch WHERE ch.id = NEW.holder_id;
END;
CREATE TRIGGER IF NOT EXISTS trg_credit_cards_delete AFTER DELETE ON credit_cards BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT ch.managed_by, 'credit_cards', OLD.id, 'delete'
  FROM card_holders ch WHERE ch.id = OLD.holder_id;
END;

-- bills (owner = card_holders.managed_by)
CREATE TRIGGER IF NOT EXISTS trg_bills_insert AFTER INSERT ON bills BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT ch.managed_by, 'bills', NEW.id, 'upsert'
  FROM credit_cards cc
  JOIN card_holders ch ON cc.holder_id = ch.id
  WHERE cc.id = NEW.card_id;
END;
CREATE TRIGGER IF NOT EXISTS trg_bills_update AFTER UPDATE ON bills BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT ch.managed_by, 'bills', NEW.id, 'upsert'
  FROM credit_cards cc
  JOIN card_holders ch ON cc.holder_id = ch.id
  WHERE cc.id = NEW.card_id;
END;
CREATE TRIGGER IF NOT EXISTS trg_bills_delete AFTER DELETE ON bills BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT ch.managed_by, 'bills', OLD.id, 'delete'
  FROM credit_cards cc
  JOIN card_holders ch ON cc.holder_id = ch.id
  WHERE cc.id = OLD.card_id;
END;

-- payments (owner = card_holders.managed_by)
CREATE TRIGGER IF NOT EXISTS trg_payments_insert AFTER INSERT ON payments BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT ch.managed_by, 'payments', NEW.id, 'upsert'
  FROM bills b
  JOIN credit_cards cc ON b.card_id = cc.id
  JOIN card_holders ch ON cc.holder_id = ch.id
  WHERE b.id = NEW.bill_id;
END;
CREATE TRIGGER IF NOT EXISTS trg_payments_update AFTER UPDATE ON payments BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT ch.managed_by, 'payments', NEW.id, 'upsert'
  FROM bills b
  JOIN credit_cards cc ON b.card_id = cc.id
  JOIN card_holders ch ON cc.holder_id = ch.id
  WHERE b.id = NEW.bill_id;
END;
CREATE TRIGGER IF NOT EXISTS trg_payments_delete AFTER DELETE ON payments BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT ch.managed_by, 'payments', OLD.id, 'delete'
  FROM bills b
  JOIN credit_cards cc ON b.card_id = cc.id
  JOIN card_holders ch ON cc.holder_id = ch.id
  WHERE b.id = OLD.bill_id;
END;

-- user_preferences
CREATE TRIGGER IF NOT EXISTS trg_user_preferences_insert AFTER INSERT ON user_preferences BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op) VALUES (NEW.user_id, 'user_preferences', NEW.user_id, 'upsert');
END;
CREATE TRIGGER IF NOT EXISTS trg_user_preferences_update AFTER UPDATE ON user_preferences BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op) VALUES (NEW.user_id, 'user_preferences', NEW.user_id, 'upsert');
END;
CREATE TRIGGER IF NOT EXISTS trg_user_preferences_delete AFTER DELETE ON user_preferences BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op) VALUES (OLD.user_id, 'user_preferences', OLD.user_id, 'delete');
END;

-- notification_preferences
CREATE TRIGGER IF NOT EXISTS trg_notification_preferences_insert AFTER INSERT ON notification_preferences BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op) VALUES (NEW.user_id, 'notification_preferences', NEW.user_id, 'upsert');
END;
CREATE TRIGGER IF NOT EXISTS trg_notification_preferences_update AFTER UPDATE ON notification_preferences BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op) VALUES (NEW.user_id, 'notification_preferences', NEW.user_id, 'upsert');
END;
CREATE TRIGGER IF NOT EXISTS trg_notification_preferences_delete AFTER DELETE ON notification_preferences BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op) VALUES (OLD.user_id, 'notification_preferences', OLD.user_id, 'delete');
END;

-- recurring_payables
CREATE TRIGGER IF NOT EXISTS trg_recurring_payables_insert AFTER INSERT ON recurring_payables BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op) VALUES (NEW.created_by, 'recurring_payables', NEW.id, 'upsert');
END;
CREATE TRIGGER IF NOT EXISTS trg_recurring_payables_update AFTER UPDATE ON recurring_payables BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op) VALUES (NEW.created_by, 'recurring_payables', NEW.id, 'upsert');
END;
CREATE TRIGGER IF NOT EXISTS trg_recurring_payables_delete AFTER DELETE ON recurring_payables BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op) VALUES (OLD.created_by, 'recurring_payables', OLD.id, 'delete');
END;

-- recurring_payable_payments
CREATE TRIGGER IF NOT EXISTS trg_recurring_payable_payments_insert AFTER INSERT ON recurring_payable_payments BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT rp.created_by, 'recurring_payable_payments', NEW.id, 'upsert'
  FROM recurring_payables rp WHERE rp.id = NEW.payable_id;
END;
CREATE TRIGGER IF NOT EXISTS trg_recurring_payable_payments_update AFTER UPDATE ON recurring_payable_payments BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT rp.created_by, 'recurring_payable_payments', NEW.id, 'upsert'
  FROM recurring_payables rp WHERE rp.id = NEW.payable_id;
END;
CREATE TRIGGER IF NOT EXISTS trg_recurring_payable_payments_delete AFTER DELETE ON recurring_payable_payments BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT rp.created_by, 'recurring_payable_payments', OLD.id, 'delete'
  FROM recurring_payables rp WHERE rp.id = OLD.payable_id;
END;
