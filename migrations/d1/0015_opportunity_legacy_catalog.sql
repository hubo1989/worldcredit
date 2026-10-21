-- 0015_opportunity_legacy_catalog.sql — structural backfill of the legacy
-- benefit/promo catalog into opportunity definitions (tech spec §6.3).
--
-- Only provable structure moves: one definition + one version v1 per legacy
-- row, verification='unverified', effective_from at the migration date unless
-- the legacy row itself proves an earlier start (promo start_date). No user is
-- fabricated: created_by stays NULL, which the 0013 CHECK permits only for
-- definitions carrying a legacy source id. No account is created — accounts
-- follow explicit user setup or the reviewed backfill script.
--
-- Both statements are idempotent (WHERE NOT EXISTS), so re-applying adds no
-- rows and a later legitimate wrap of the same id stays impossible.

INSERT INTO opportunity_definitions (id, kind, legacy_benefit_id, visibility, status, created_at)
SELECT 'odef-lgb-' || b.id, 'benefit', b.id, 'shared', 'active', COALESCE(b.created_at, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
FROM benefits b
WHERE NOT EXISTS (SELECT 1 FROM opportunity_definitions d WHERE d.legacy_benefit_id = b.id);

INSERT INTO opportunity_rule_versions (id, definition_id, version, effective_from, rules_json, verification, published_at)
SELECT 'orv-lgb-' || b.id, 'odef-lgb-' || b.id, 1, strftime('%Y-%m-%d','now'),
  json_object(
    'schema_version', 1,
    'title', b.name,
    'description', b.description,
    'category', 'other',
    'time_zone', 'Asia/Shanghai',
    'bank_id', NULL,
    'card_product_ids', json_array(b.card_product_id),
    'valid_from', NULL,
    'valid_until_before',
      CASE WHEN b.expiry_date IS NOT NULL AND date(b.expiry_date) = b.expiry_date
           THEN date(b.expiry_date, '+1 day') ELSE NULL END,
    'open_ended',
      CASE WHEN b.expiry_date IS NOT NULL AND date(b.expiry_date) = b.expiry_date
           THEN json('false') ELSE json('true') END,
    'weekdays', NULL,
    'cycle', json_object(
      'kind', CASE b.period WHEN 'monthly' THEN 'monthly' WHEN 'one_time' THEN 'one_time' ELSE 'annual' END,
      'anchor_month', CASE WHEN b.period = 'monthly' OR b.period = 'one_time' THEN NULL ELSE COALESCE(b.reset_month, 1) END,
      'anchor_day', CASE WHEN b.period = 'monthly' OR b.period = 'one_time' THEN NULL ELSE 1 END,
      'anchor_source', NULL
    ),
    'allocation', 'recurring',
    'count_limit', MAX(b.quota, 0),
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
    'entry', json_object('website_url', NULL, 'app_name', NULL, 'app_path', NULL)
  ),
  'unverified', strftime('%Y-%m-%dT%H:%M:%SZ','now')
FROM benefits b
WHERE NOT EXISTS (
  SELECT 1 FROM opportunity_rule_versions v WHERE v.definition_id = 'odef-lgb-' || b.id
);

INSERT INTO opportunity_definitions (id, kind, legacy_promo_id, visibility, status, created_at)
SELECT 'odef-lgp-' || p.id, 'promo', p.id, 'shared',
  CASE WHEN p.is_active = 1 THEN 'active' ELSE 'archived' END,
  COALESCE(p.created_at, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
FROM promos p
WHERE NOT EXISTS (SELECT 1 FROM opportunity_definitions d WHERE d.legacy_promo_id = p.id);

-- Promo rules: the activity window IS the usable window (one_time). Dates that
-- do not re-parse as civil dates stay NULL — those records need human review
-- before anyone can open an account on them. effective_from uses the promo's
-- own documented start when provable, else the migration date (unknown rule
-- start must not fabricate past eligibility, §6.3).
INSERT INTO opportunity_rule_versions (id, definition_id, version, effective_from, rules_json, verification, published_at)
SELECT 'orv-lgp-' || p.id, 'odef-lgp-' || p.id, 1,
  CASE WHEN p.start_date IS NOT NULL AND date(p.start_date) = p.start_date
       THEN p.start_date ELSE strftime('%Y-%m-%d','now') END,
  json_object(
    'schema_version', 1,
    'title', p.title,
    'description', p.description,
    'category', 'other',
    'time_zone', 'Asia/Shanghai',
    'bank_id', p.bank_id,
    'card_product_ids',
      CASE WHEN p.card_product_id IS NOT NULL THEN json_array(p.card_product_id) ELSE json_array() END,
    'valid_from',
      CASE WHEN p.start_date IS NOT NULL AND date(p.start_date) = p.start_date
           THEN p.start_date ELSE NULL END,
    'valid_until_before',
      CASE WHEN p.end_date IS NOT NULL AND date(p.end_date) = p.end_date
           THEN date(p.end_date, '+1 day') ELSE NULL END,
    'open_ended',
      CASE WHEN p.end_date IS NOT NULL AND date(p.end_date) = p.end_date
           THEN json('false') ELSE json('true') END,
    'weekdays', NULL,
    'cycle', json_object(
      'kind', 'one_time',
      'anchor_month', NULL,
      'anchor_day', NULL,
      'anchor_source', NULL
    ),
    'allocation', 'recurring',
    'count_limit', NULL,
    'amount_limit_minor', NULL,
    'currency', NULL,
    'unit_label', '次',
    'eligibility_text', p.conditions,
    'requires_personal_confirmation', json('false'),
    'claim_window', NULL,
    'booking_window', NULL,
    'workflow_time_basis', 'fixed',
    'booking_consumes', 'reserve_then_use',
    'cancellation_rule', 'confirm_with_issuer',
    'entry', json_object('website_url', NULL, 'app_name', NULL, 'app_path', NULL)
  ),
  'unverified', strftime('%Y-%m-%dT%H:%M:%SZ','now')
FROM promos p
WHERE NOT EXISTS (
  SELECT 1 FROM opportunity_rule_versions v WHERE v.definition_id = 'odef-lgp-' || p.id
);
