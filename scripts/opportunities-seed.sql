-- scripts/opportunities-seed.sql — idempotent seed for LOCAL UI verification
-- only (Task 24 early slice, plan §2.3). Every row uses *.example.test emails
-- except the admin login, which must match the static admin allowlist; the
-- admin email is substituted by scripts/opportunities-local.mjs at seed time
-- (the placeholder below would never authenticate).
--
-- Idempotent: INSERT OR IGNORE everywhere; re-running adds nothing.

-- Users ------------------------------------------------------------------
-- admin login: password "verify1234" (PBKDF2-100k, fixed salt for determinism)
INSERT OR IGNORE INTO users (id, email, password_hash, name, role)
VALUES ('u-verify-admin', '__ADMIN_EMAIL__', 'pbkdf2$100000$qV/8ri3djT1UQPt4iMnACw==$xyIn84rZ+g2OE+TC7zntp9QEEnAjtng7fO7i7O8Tu0o=', '验证管理员', 'admin');
INSERT OR IGNORE INTO users (id, email, password_hash, name, role)
VALUES ('u-verify-member', 'member-verify@example.test', 'pbkdf2$100000$qV/8ri3djT1UQPt4iMnACw==$xyIn84rZ+g2OE+TC7zntp9QEEnAjtng7fO7i7O8Tu0o=', '验证成员', 'member');

-- Catalog ----------------------------------------------------------------
INSERT OR IGNORE INTO banks (id, name, country) VALUES ('bk-verify-cmb', '验证银行', 'CN');
INSERT OR IGNORE INTO card_products (id, bank_id, bank_name, card_name, currency)
VALUES ('p-verify-classic', 'bk-verify-cmb', '验证银行', '验证白金卡', 'CNY');
INSERT OR IGNORE INTO card_products (id, bank_id, bank_name, card_name, currency)
VALUES ('p-verify-life', 'bk-verify-cmb', '验证银行', '验证生活卡', 'CNY');

-- Holders + cards (issued_on for anniversary checks) ----------------------
INSERT OR IGNORE INTO card_holders (id, created_by, managed_by, name, auth_user_id)
VALUES ('h-verify-self', 'u-verify-admin', 'u-verify-admin', '我（验证）', NULL);
INSERT OR IGNORE INTO card_holders (id, created_by, managed_by, name, auth_user_id)
VALUES ('h-verify-family', 'u-verify-admin', 'u-verify-admin', '家人（验证）', NULL);

INSERT OR IGNORE INTO credit_cards
  (id, holder_id, card_product_id, card_number_last4, credit_limit, billing_day, status, card_type, issued_on)
VALUES ('c-verify-main', 'h-verify-self', 'p-verify-classic', '1001', 50000, 5, 'active', 'credit', '2024-03-10');
INSERT OR IGNORE INTO credit_cards
  (id, holder_id, card_product_id, card_number_last4, credit_limit, billing_day, status, card_type)
VALUES ('c-verify-second', 'h-verify-self', 'p-verify-life', '1002', 20000, 10, 'active', 'credit');
INSERT OR IGNORE INTO credit_cards
  (id, holder_id, card_product_id, card_number_last4, credit_limit, billing_day, status, card_type)
VALUES ('c-verify-family', 'h-verify-family', 'p-verify-classic', '1003', 30000, 5, 'active', 'credit');

-- Legacy catalog (kept for compat read/write verification) ----------------
INSERT OR IGNORE INTO benefits (id, card_product_id, name, description, quota, period)
VALUES ('b-verify-lounge', 'p-verify-classic', '验证贵宾厅', '每月 2 次贵宾厅', 2, 'monthly');
INSERT OR IGNORE INTO benefits (id, card_product_id, name, description, quota, period)
VALUES ('b-verify-movie', 'p-verify-life', '验证观影券', '每月 1 次观影立减', 1, 'monthly');

-- Opportunity world --------------------------------------------------------
-- Shared definition with a monthly cycle of 2; usable window covers the
-- current month regardless of when the seed runs (period anchors at month
-- start, effective_from well in the past so no clipping).
INSERT OR IGNORE INTO opportunity_definitions (id, kind, visibility, private_holder_id, status, created_by, created_at)
VALUES ('odef-verify-lounge', 'benefit', 'shared', NULL, 'active', 'u-verify-admin', '2026-01-01T00:00:00Z');
INSERT OR IGNORE INTO opportunity_rule_versions
  (id, definition_id, version, effective_from, rules_json, verification, published_at)
VALUES ('orv-verify-lounge', 'odef-verify-lounge', 1, '2026-01-01',
  json_object(
    'schema_version', 1,
    'title', '验证贵宾厅',
    'description', '每月 2 次贵宾厅',
    'category', 'travel',
    'time_zone', 'Asia/Shanghai',
    'bank_id', 'bk-verify-cmb',
    'card_product_ids', json_array('p-verify-classic'),
    'valid_from', NULL,
    'valid_until_before', NULL,
    'open_ended', json('true'),
    'weekdays', NULL,
    'cycle', json_object('kind', 'monthly', 'anchor_month', NULL, 'anchor_day', 1, 'anchor_source', NULL),
    'allocation', 'recurring',
    'count_limit', 2,
    'amount_limit_minor', NULL,
    'currency', NULL,
    'unit_label', '次',
    'eligibility_text', NULL,
    'requires_personal_confirmation', json('false'),
    'claim_window', NULL,
    'booking_window', NULL,
    'workflow_time_basis', 'fixed',
    'booking_consumes', 'reserve_then_use',
    'cancellation_rule', 'confirm_with_issuer',
    'entry', json_object('website_url', NULL, 'app_name', '验证银行APP', 'app_path', NULL)
  ),
  'user_confirmed', '2026-01-01T00:00:00Z');

-- Holder-scoped account across the two self cards (A01 shared quota)
INSERT OR IGNORE INTO opportunity_accounts
  (id, definition_id, holder_id, scope_kind, scope_key, eligibility, created_by, created_at)
VALUES ('oacc-verify-self', 'odef-verify-lounge', 'h-verify-self', 'holder', 'holder:h-verify-self', 'confirmed', 'u-verify-admin', '2026-01-01T00:00:00Z');
INSERT OR IGNORE INTO opportunity_account_cards (account_id, definition_id, holder_id, card_id)
VALUES ('oacc-verify-self', 'odef-verify-lounge', 'h-verify-self', 'c-verify-main');
INSERT OR IGNORE INTO opportunity_account_cards (account_id, definition_id, holder_id, card_id)
VALUES ('oacc-verify-self', 'odef-verify-lounge', 'h-verify-self', 'c-verify-second');

-- Current-month cycle: period spans this calendar month; SQLite computes the
-- dates so the seed file itself stays date-independent.
INSERT OR IGNORE INTO opportunity_cycles
  (id, account_id, version_id, version_as_of_on, cycle_key, allocation_kind,
   period_start_on, period_end_before, usable_start_on, usable_end_before,
   time_zone, count_limit, created_at)
VALUES ('ocyc-verify-current', 'oacc-verify-self', 'orv-verify-lounge',
  date('now', 'start of month'), 'regular:' || date('now', 'start of month'), 'regular',
  date('now', 'start of month'), date(date('now', 'start of month'), '+1 month'),
  date('now', 'start of month'), date(date('now', 'start of month'), '+1 month'),
  'Asia/Shanghai', 2, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));
