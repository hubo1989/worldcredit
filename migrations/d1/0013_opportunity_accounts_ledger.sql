-- 0013_opportunity_accounts_ledger.sql — scoped opportunity accounts,
-- rule versions, quota cycles, idempotent commands and the immutable ledger.
-- Source of truth: docs/specs/12-credit-card-benefits-opportunities-technical.md §6.1.

ALTER TABLE credit_cards ADD COLUMN issued_on TEXT;
ALTER TABLE credit_cards ADD COLUMN activated_on TEXT;
CREATE UNIQUE INDEX idx_opportunity_card_holder ON credit_cards(id, holder_id);

CREATE TABLE opportunity_definitions (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('benefit','promo','private_reward')),
  legacy_benefit_id TEXT UNIQUE REFERENCES benefits(id) ON DELETE RESTRICT,
  legacy_promo_id TEXT UNIQUE REFERENCES promos(id) ON DELETE RESTRICT,
  visibility TEXT NOT NULL CHECK (visibility IN ('shared','private')),
  private_holder_id TEXT REFERENCES card_holders(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  terminated_at TEXT,
  termination_reason TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  CHECK ((visibility='private' AND private_holder_id IS NOT NULL) OR
         (visibility='shared' AND private_holder_id IS NULL)),
  CHECK (NOT (legacy_benefit_id IS NOT NULL AND legacy_promo_id IS NOT NULL)),
  CHECK (kind!='private_reward' OR visibility='private'),
  CHECK (created_by IS NOT NULL OR legacy_benefit_id IS NOT NULL OR legacy_promo_id IS NOT NULL)
);

CREATE TABLE opportunity_rule_versions (
  id TEXT PRIMARY KEY,
  definition_id TEXT NOT NULL REFERENCES opportunity_definitions(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL CHECK (version > 0),
  effective_from TEXT NOT NULL,
  effective_until_before TEXT,
  rules_json TEXT NOT NULL CHECK (json_valid(rules_json)),
  verification TEXT NOT NULL CHECK (verification IN ('unverified','user_confirmed','official_verified')),
  source_url TEXT,
  source_excerpt TEXT,
  checked_at TEXT,
  checked_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
  published_at TEXT NOT NULL,
  UNIQUE(definition_id, version),
  UNIQUE(id, definition_id),
  CHECK (effective_until_before IS NULL OR effective_until_before > effective_from)
);

CREATE TABLE opportunity_accounts (
  id TEXT PRIMARY KEY,
  definition_id TEXT NOT NULL REFERENCES opportunity_definitions(id) ON DELETE RESTRICT,
  holder_id TEXT NOT NULL REFERENCES card_holders(id) ON DELETE RESTRICT,
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('card','holder')),
  scope_key TEXT NOT NULL,
  eligibility TEXT NOT NULL DEFAULT 'unknown' CHECK (eligibility IN ('unknown','confirmed','ineligible')),
  eligibility_note TEXT,
  eligibility_confirmed_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
  eligibility_confirmed_at TEXT,
  eligible_from_on TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  UNIQUE(definition_id, scope_key),
  UNIQUE(id, definition_id, holder_id)
);
CREATE INDEX idx_opportunity_accounts_holder ON opportunity_accounts(holder_id,status);

CREATE TABLE opportunity_account_cards (
  account_id TEXT NOT NULL,
  definition_id TEXT NOT NULL,
  holder_id TEXT NOT NULL,
  card_id TEXT NOT NULL,
  retired_at TEXT,
  PRIMARY KEY(account_id, card_id),
  FOREIGN KEY(account_id,definition_id,holder_id)
    REFERENCES opportunity_accounts(id,definition_id,holder_id) ON DELETE RESTRICT,
  FOREIGN KEY(card_id,holder_id) REFERENCES credit_cards(id,holder_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX idx_opportunity_active_card_definition
  ON opportunity_account_cards(definition_id,card_id) WHERE retired_at IS NULL;

CREATE TABLE opportunity_cycles (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES opportunity_accounts(id) ON DELETE RESTRICT,
  version_id TEXT NOT NULL REFERENCES opportunity_rule_versions(id) ON DELETE RESTRICT,
  version_as_of_on TEXT NOT NULL,
  cycle_key TEXT NOT NULL,
  allocation_kind TEXT NOT NULL CHECK (allocation_kind IN ('regular','grant')),
  activation_state TEXT NOT NULL DEFAULT 'active' CHECK (activation_state IN ('active','pending_claim','voided')),
  period_start_on TEXT NOT NULL,
  period_end_before TEXT,
  usable_start_on TEXT NOT NULL,
  usable_end_before TEXT,
  time_zone TEXT NOT NULL,
  count_limit INTEGER CHECK (count_limit IS NULL OR count_limit >= 0),
  amount_limit_minor INTEGER CHECK (amount_limit_minor IS NULL OR amount_limit_minor >= 0),
  currency TEXT,
  workflow_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(workflow_json)),
  opening_used_count INTEGER NOT NULL DEFAULT 0 CHECK (opening_used_count >= 0),
  opening_used_minor INTEGER NOT NULL DEFAULT 0 CHECK (opening_used_minor >= 0),
  used_count INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  used_minor INTEGER NOT NULL DEFAULT 0 CHECK (used_minor >= 0),
  reserved_count INTEGER NOT NULL DEFAULT 0 CHECK (reserved_count >= 0),
  reserved_minor INTEGER NOT NULL DEFAULT 0 CHECK (reserved_minor >= 0),
  balance_verified INTEGER NOT NULL DEFAULT 0 CHECK (balance_verified IN (0,1)),
  verified_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
  verified_at TEXT,
  opening_as_of_on TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at TEXT NOT NULL,
  UNIQUE(account_id, cycle_key),
  UNIQUE(id,account_id),
  CHECK (period_end_before IS NULL OR period_end_before > period_start_on),
  CHECK (version_as_of_on>=period_start_on AND (period_end_before IS NULL OR version_as_of_on<period_end_before)),
  CHECK (usable_start_on>=version_as_of_on),
  CHECK (usable_end_before IS NULL OR usable_end_before > usable_start_on),
  CHECK (amount_limit_minor IS NULL OR currency IS NOT NULL),
  CHECK (count_limit IS NULL OR opening_used_count+used_count+reserved_count <= count_limit),
  CHECK (amount_limit_minor IS NULL OR opening_used_minor+used_minor+reserved_minor <= amount_limit_minor)
);
CREATE INDEX idx_opportunity_cycles_account_dates ON opportunity_cycles(account_id,usable_start_on,usable_end_before);

CREATE TABLE opportunity_commands (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  request_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  command_type TEXT NOT NULL,
  result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
  created_at TEXT NOT NULL,
  UNIQUE(actor_user_id,request_key)
);

CREATE TABLE opportunity_write_checks (
  command_id TEXT PRIMARY KEY REFERENCES opportunity_commands(id) ON DELETE RESTRICT,
  ok INTEGER NOT NULL CHECK (ok=1)
);

CREATE TABLE opportunity_usages (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES opportunity_accounts(id) ON DELETE RESTRICT,
  cycle_id TEXT NOT NULL,
  card_id TEXT NOT NULL,
  used_on TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  amount_minor INTEGER NOT NULL DEFAULT 0 CHECK (amount_minor >= 0),
  note TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','voided')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(cycle_id,account_id) REFERENCES opportunity_cycles(id,account_id) ON DELETE RESTRICT,
  FOREIGN KEY(account_id,card_id) REFERENCES opportunity_account_cards(account_id,card_id) ON DELETE RESTRICT
);
CREATE INDEX idx_opportunity_usages_history ON opportunity_usages(account_id,used_on,id);

CREATE TABLE opportunity_events (
  id TEXT PRIMARY KEY,
  command_id TEXT NOT NULL REFERENCES opportunity_commands(id) ON DELETE RESTRICT,
  entity_kind TEXT NOT NULL CHECK (entity_kind IN ('account','usage','cycle','task','fulfillment','legacy')),
  entity_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  account_id TEXT REFERENCES opportunity_accounts(id) ON DELETE RESTRICT,
  cycle_id TEXT,
  delta_opening_count INTEGER NOT NULL DEFAULT 0,
  delta_opening_minor INTEGER NOT NULL DEFAULT 0,
  delta_used_count INTEGER NOT NULL DEFAULT 0,
  delta_used_minor INTEGER NOT NULL DEFAULT 0,
  delta_reserved_count INTEGER NOT NULL DEFAULT 0,
  delta_reserved_minor INTEGER NOT NULL DEFAULT 0,
  before_json TEXT CHECK (before_json IS NULL OR json_valid(before_json)),
  after_json TEXT CHECK (after_json IS NULL OR json_valid(after_json)),
  reason TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(cycle_id,account_id) REFERENCES opportunity_cycles(id,account_id) ON DELETE RESTRICT,
  CHECK (cycle_id IS NOT NULL OR (
    delta_opening_count=0 AND delta_opening_minor=0 AND delta_used_count=0 AND delta_used_minor=0
    AND delta_reserved_count=0 AND delta_reserved_minor=0
  )),
  CHECK (cycle_id IS NULL OR account_id IS NOT NULL)
);
CREATE INDEX idx_opportunity_events_entity ON opportunity_events(entity_kind,entity_id,created_at,id);

CREATE TRIGGER opportunity_events_no_update BEFORE UPDATE ON opportunity_events
BEGIN SELECT RAISE(ABORT,'OPPORTUNITY_IMMUTABLE_EVENT'); END;
CREATE TRIGGER opportunity_events_no_delete BEFORE DELETE ON opportunity_events
BEGIN SELECT RAISE(ABORT,'OPPORTUNITY_IMMUTABLE_EVENT'); END;
CREATE TRIGGER opportunity_events_apply AFTER INSERT ON opportunity_events
WHEN NEW.cycle_id IS NOT NULL
BEGIN
  UPDATE opportunity_cycles SET
    opening_used_count=opening_used_count+NEW.delta_opening_count,
    opening_used_minor=opening_used_minor+NEW.delta_opening_minor,
    used_count=used_count+NEW.delta_used_count,
    used_minor=used_minor+NEW.delta_used_minor,
    reserved_count=reserved_count+NEW.delta_reserved_count,
    reserved_minor=reserved_minor+NEW.delta_reserved_minor,
    revision=revision+1
  WHERE id=NEW.cycle_id AND account_id=NEW.account_id;
END;

CREATE TABLE opportunity_legacy_links (
  source_table TEXT NOT NULL CHECK (source_table IN ('benefit_usages','promo_usages')),
  source_id TEXT NOT NULL,
  target_usage_id TEXT NOT NULL UNIQUE REFERENCES opportunity_usages(id) ON DELETE RESTRICT,
  included_in_opening INTEGER NOT NULL DEFAULT 0 CHECK (included_in_opening IN (0,1)),
  offset_opening_count INTEGER NOT NULL DEFAULT 0 CHECK (offset_opening_count>=0),
  offset_opening_minor INTEGER NOT NULL DEFAULT 0 CHECK (offset_opening_minor>=0),
  assigned_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL,
  assigned_at TEXT NOT NULL,
  PRIMARY KEY(source_table,source_id)
);

CREATE TABLE opportunity_user_states (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  account_id TEXT NOT NULL REFERENCES opportunity_accounts(id) ON DELETE RESTRICT,
  followed INTEGER NOT NULL DEFAULT 0 CHECK (followed IN (0,1)),
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(user_id,account_id)
);

-- Declarative consistency protection (spec §6.1 continuation).

CREATE TRIGGER opportunity_versions_immutable
BEFORE UPDATE OF definition_id,version,effective_from,rules_json,verification,source_url,source_excerpt,checked_at,checked_by,published_at ON opportunity_rule_versions
BEGIN SELECT RAISE(ABORT,'OPPORTUNITY_IMMUTABLE_VERSION'); END;
CREATE TRIGGER opportunity_versions_no_delete BEFORE DELETE ON opportunity_rule_versions
BEGIN SELECT RAISE(ABORT,'OPPORTUNITY_IMMUTABLE_VERSION'); END;
CREATE TRIGGER opportunity_versions_no_overlap BEFORE INSERT ON opportunity_rule_versions
WHEN EXISTS (
  SELECT 1 FROM opportunity_rule_versions v
  WHERE v.definition_id=NEW.definition_id
    AND (v.effective_until_before IS NULL OR NEW.effective_from<v.effective_until_before)
    AND (NEW.effective_until_before IS NULL OR v.effective_from<NEW.effective_until_before)
)
BEGIN SELECT RAISE(ABORT,'OPPORTUNITY_VERSION_OVERLAP'); END;
CREATE TRIGGER opportunity_versions_guard_end BEFORE UPDATE OF effective_until_before ON opportunity_rule_versions
WHEN (OLD.effective_until_before IS NOT NULL AND (NEW.effective_until_before IS NULL OR NEW.effective_until_before>OLD.effective_until_before))
  OR EXISTS (
    SELECT 1 FROM opportunity_rule_versions v
    WHERE v.definition_id=NEW.definition_id AND v.id!=NEW.id
      AND (v.effective_until_before IS NULL OR NEW.effective_from<v.effective_until_before)
      AND (NEW.effective_until_before IS NULL OR v.effective_from<NEW.effective_until_before)
  )
  OR EXISTS (
    SELECT 1 FROM opportunity_cycles c WHERE c.version_id=OLD.id
      AND (c.version_as_of_on<NEW.effective_from OR (NEW.effective_until_before IS NOT NULL AND c.version_as_of_on>=NEW.effective_until_before))
  )
BEGIN SELECT RAISE(ABORT,'OPPORTUNITY_VERSION_END_CONFLICT'); END;
CREATE TRIGGER opportunity_accounts_check_private BEFORE INSERT ON opportunity_accounts
WHEN EXISTS (
  SELECT 1 FROM opportunity_definitions d WHERE d.id=NEW.definition_id
    AND d.visibility='private' AND d.private_holder_id!=NEW.holder_id
)
BEGIN SELECT RAISE(ABORT,'OPPORTUNITY_PRIVATE_HOLDER_MISMATCH'); END;
CREATE TRIGGER opportunity_accounts_identity_immutable
BEFORE UPDATE OF definition_id,holder_id,scope_kind,scope_key ON opportunity_accounts
BEGIN SELECT RAISE(ABORT,'OPPORTUNITY_ACCOUNT_IDENTITY_IMMUTABLE'); END;
CREATE TRIGGER opportunity_cycles_check_version BEFORE INSERT ON opportunity_cycles
WHEN NOT EXISTS (
  SELECT 1 FROM opportunity_accounts a JOIN opportunity_rule_versions v ON v.definition_id=a.definition_id
  WHERE a.id=NEW.account_id AND v.id=NEW.version_id
    AND NEW.version_as_of_on>=v.effective_from
    AND (v.effective_until_before IS NULL OR NEW.version_as_of_on<v.effective_until_before)
)
BEGIN SELECT RAISE(ABORT,'OPPORTUNITY_CYCLE_VERSION_MISMATCH'); END;
CREATE TRIGGER opportunity_cycles_identity_immutable
BEFORE UPDATE OF account_id,version_id,version_as_of_on,cycle_key,allocation_kind,period_start_on,period_end_before,usable_start_on,usable_end_before,time_zone,count_limit,amount_limit_minor,currency ON opportunity_cycles
BEGIN SELECT RAISE(ABORT,'OPPORTUNITY_CYCLE_IDENTITY_IMMUTABLE'); END;
CREATE TRIGGER opportunity_links_identity_immutable
BEFORE UPDATE OF account_id,definition_id,holder_id,card_id ON opportunity_account_cards
BEGIN SELECT RAISE(ABORT,'OPPORTUNITY_CARD_LINK_IMMUTABLE'); END;
CREATE TRIGGER opportunity_card_holder_guard BEFORE UPDATE OF holder_id ON credit_cards
WHEN OLD.holder_id!=NEW.holder_id AND EXISTS (
  SELECT 1 FROM opportunity_account_cards ac WHERE ac.card_id=OLD.id
)
BEGIN SELECT RAISE(ABORT,'OPPORTUNITY_CARD_OWNERSHIP_CONFLICT'); END;
