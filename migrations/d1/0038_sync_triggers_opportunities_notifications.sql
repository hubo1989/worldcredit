-- Phase 2 sync feed. Ownership matches the pull protocol and remains scoped
-- to the holder or user. Internal delivery jobs and audit logs stay server-side.
ALTER TABLE notification_history ADD COLUMN push_lease_until TEXT;

CREATE INDEX IF NOT EXISTS idx_phase2_definitions_private_holder
  ON opportunity_definitions(private_holder_id) WHERE visibility = 'private';
CREATE INDEX IF NOT EXISTS idx_phase2_account_cards_holder
  ON opportunity_account_cards(holder_id);
CREATE INDEX IF NOT EXISTS idx_phase2_user_states_account
  ON opportunity_user_states(account_id);
CREATE INDEX IF NOT EXISTS idx_phase2_fulfillments_holder
  ON opportunity_fulfillments(holder_id);
CREATE INDEX IF NOT EXISTS idx_phase2_fulfillments_task
  ON opportunity_fulfillments(task_cycle_id);

-- Each user is included once per holder, even when multiple owner columns match.
CREATE VIEW IF NOT EXISTS phase2_sync_holder_owners AS
  SELECT id AS holder_id, created_by AS owner_id FROM card_holders WHERE created_by IS NOT NULL
  UNION ALL
  SELECT id, managed_by FROM card_holders WHERE managed_by IS NOT NULL AND managed_by IS NOT created_by
  UNION ALL
  SELECT id, auth_user_id FROM card_holders
  WHERE auth_user_id IS NOT NULL AND auth_user_id IS NOT created_by AND auth_user_id IS NOT managed_by;

CREATE TRIGGER IF NOT EXISTS trg_phase2_definitions_insert
AFTER INSERT ON opportunity_definitions
BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT o.owner_id, 'opportunity_definitions', NEW.id, 'upsert'
  FROM (SELECT NULL AS owner_id WHERE NEW.visibility = 'shared'
        UNION ALL SELECT owner_id FROM phase2_sync_holder_owners
        WHERE NEW.visibility = 'private' AND holder_id = NEW.private_holder_id) o;
END;

CREATE TRIGGER IF NOT EXISTS trg_phase2_definitions_rules_old_scope
BEFORE UPDATE ON opportunity_definitions
WHEN OLD.visibility IS NOT NEW.visibility OR OLD.private_holder_id IS NOT NEW.private_holder_id
BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT o.owner_id, 'opportunity_rule_versions', v.id, 'delete'
  FROM opportunity_rule_versions v
  LEFT JOIN phase2_sync_holder_owners o ON OLD.visibility = 'private' AND o.holder_id = OLD.private_holder_id
  WHERE v.definition_id = OLD.id AND (OLD.visibility = 'shared' OR o.owner_id IS NOT NULL);
END;

CREATE TRIGGER IF NOT EXISTS trg_phase2_definitions_rules_new_scope
AFTER UPDATE ON opportunity_definitions
WHEN OLD.visibility IS NOT NEW.visibility OR OLD.private_holder_id IS NOT NEW.private_holder_id
BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT o.owner_id, 'opportunity_rule_versions', v.id, 'upsert'
  FROM opportunity_rule_versions v
  LEFT JOIN phase2_sync_holder_owners o ON NEW.visibility = 'private' AND o.holder_id = NEW.private_holder_id
  WHERE v.definition_id = NEW.id AND (NEW.visibility = 'shared' OR o.owner_id IS NOT NULL);
END;

CREATE TRIGGER IF NOT EXISTS trg_phase2_definitions_old_scope
BEFORE UPDATE ON opportunity_definitions
WHEN OLD.id IS NOT NEW.id OR OLD.visibility IS NOT NEW.visibility OR OLD.private_holder_id IS NOT NEW.private_holder_id
BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT o.owner_id, 'opportunity_definitions', OLD.id, 'delete'
  FROM (SELECT NULL AS owner_id WHERE OLD.visibility = 'shared'
        UNION ALL SELECT owner_id FROM phase2_sync_holder_owners
        WHERE OLD.visibility = 'private' AND holder_id = OLD.private_holder_id) o;
END;

CREATE TRIGGER IF NOT EXISTS trg_phase2_definitions_update
AFTER UPDATE ON opportunity_definitions
BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT o.owner_id, 'opportunity_definitions', NEW.id, 'upsert'
  FROM (SELECT NULL AS owner_id WHERE NEW.visibility = 'shared'
        UNION ALL SELECT owner_id FROM phase2_sync_holder_owners
        WHERE NEW.visibility = 'private' AND holder_id = NEW.private_holder_id) o;
END;

CREATE TRIGGER IF NOT EXISTS trg_phase2_definitions_delete
AFTER DELETE ON opportunity_definitions
BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT o.owner_id, 'opportunity_definitions', OLD.id, 'delete'
  FROM (SELECT NULL AS owner_id WHERE OLD.visibility = 'shared'
        UNION ALL SELECT owner_id FROM phase2_sync_holder_owners
        WHERE OLD.visibility = 'private' AND holder_id = OLD.private_holder_id) o;
END;

CREATE TRIGGER IF NOT EXISTS trg_phase2_rule_versions_insert
AFTER INSERT ON opportunity_rule_versions
BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT o.owner_id, 'opportunity_rule_versions', NEW.id, 'upsert'
  FROM opportunity_definitions d
  LEFT JOIN phase2_sync_holder_owners o ON d.visibility = 'private' AND o.holder_id = d.private_holder_id
  WHERE d.id = NEW.definition_id AND (d.visibility = 'shared' OR o.owner_id IS NOT NULL);
END;

CREATE TRIGGER IF NOT EXISTS trg_phase2_rule_versions_old_scope
BEFORE UPDATE ON opportunity_rule_versions
WHEN OLD.id IS NOT NEW.id OR OLD.definition_id IS NOT NEW.definition_id
BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT o.owner_id, 'opportunity_rule_versions', OLD.id, 'delete'
  FROM opportunity_definitions d
  LEFT JOIN phase2_sync_holder_owners o ON d.visibility = 'private' AND o.holder_id = d.private_holder_id
  WHERE d.id = OLD.definition_id AND (d.visibility = 'shared' OR o.owner_id IS NOT NULL);
END;

CREATE TRIGGER IF NOT EXISTS trg_phase2_rule_versions_update
AFTER UPDATE ON opportunity_rule_versions
BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT o.owner_id, 'opportunity_rule_versions', NEW.id, 'upsert'
  FROM opportunity_definitions d
  LEFT JOIN phase2_sync_holder_owners o ON d.visibility = 'private' AND o.holder_id = d.private_holder_id
  WHERE d.id = NEW.definition_id AND (d.visibility = 'shared' OR o.owner_id IS NOT NULL);
END;

CREATE TRIGGER IF NOT EXISTS trg_phase2_rule_versions_delete
AFTER DELETE ON opportunity_rule_versions
BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT o.owner_id, 'opportunity_rule_versions', OLD.id, 'delete'
  FROM opportunity_definitions d
  LEFT JOIN phase2_sync_holder_owners o ON d.visibility = 'private' AND o.holder_id = d.private_holder_id
  WHERE d.id = OLD.definition_id AND (d.visibility = 'shared' OR o.owner_id IS NOT NULL);
END;

CREATE TRIGGER IF NOT EXISTS trg_phase2_accounts_insert
AFTER INSERT ON opportunity_accounts
BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT o.owner_id, 'opportunity_accounts', NEW.id, 'upsert'
  FROM phase2_sync_holder_owners o WHERE o.holder_id = NEW.holder_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_phase2_accounts_old_scope
BEFORE UPDATE ON opportunity_accounts
WHEN OLD.id IS NOT NEW.id OR OLD.holder_id IS NOT NEW.holder_id
BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT o.owner_id, 'opportunity_accounts', OLD.id, 'delete'
  FROM phase2_sync_holder_owners o WHERE o.holder_id = OLD.holder_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_phase2_accounts_update
AFTER UPDATE ON opportunity_accounts
BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT o.owner_id, 'opportunity_accounts', NEW.id, 'upsert'
  FROM phase2_sync_holder_owners o WHERE o.holder_id = NEW.holder_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_phase2_accounts_delete
AFTER DELETE ON opportunity_accounts
BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT o.owner_id, 'opportunity_accounts', OLD.id, 'delete'
  FROM phase2_sync_holder_owners o WHERE o.holder_id = OLD.holder_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_phase2_account_cards_insert
AFTER INSERT ON opportunity_account_cards
BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT o.owner_id, 'opportunity_account_cards', json_array(NEW.account_id, NEW.card_id), 'upsert'
  FROM phase2_sync_holder_owners o WHERE o.holder_id = NEW.holder_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_phase2_account_cards_old_scope
BEFORE UPDATE ON opportunity_account_cards
WHEN OLD.account_id IS NOT NEW.account_id OR OLD.card_id IS NOT NEW.card_id OR OLD.holder_id IS NOT NEW.holder_id
BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT o.owner_id, 'opportunity_account_cards', json_array(OLD.account_id, OLD.card_id), 'delete'
  FROM phase2_sync_holder_owners o WHERE o.holder_id = OLD.holder_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_phase2_account_cards_update
AFTER UPDATE ON opportunity_account_cards
BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT o.owner_id, 'opportunity_account_cards', json_array(NEW.account_id, NEW.card_id), 'upsert'
  FROM phase2_sync_holder_owners o WHERE o.holder_id = NEW.holder_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_phase2_account_cards_delete
AFTER DELETE ON opportunity_account_cards
BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT o.owner_id, 'opportunity_account_cards', json_array(OLD.account_id, OLD.card_id), 'delete'
  FROM phase2_sync_holder_owners o WHERE o.holder_id = OLD.holder_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_phase2_cycles_insert
AFTER INSERT ON opportunity_cycles
BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT o.owner_id, 'opportunity_cycles', NEW.id, 'upsert'
  FROM phase2_sync_holder_owners o WHERE o.holder_id = (SELECT holder_id FROM opportunity_accounts WHERE id = NEW.account_id);
END;

CREATE TRIGGER IF NOT EXISTS trg_phase2_cycles_old_scope
BEFORE UPDATE ON opportunity_cycles
WHEN OLD.id IS NOT NEW.id OR OLD.account_id IS NOT NEW.account_id
BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT o.owner_id, 'opportunity_cycles', OLD.id, 'delete'
  FROM phase2_sync_holder_owners o WHERE o.holder_id = (SELECT holder_id FROM opportunity_accounts WHERE id = OLD.account_id);
END;

CREATE TRIGGER IF NOT EXISTS trg_phase2_cycles_update
AFTER UPDATE ON opportunity_cycles
BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT o.owner_id, 'opportunity_cycles', NEW.id, 'upsert'
  FROM phase2_sync_holder_owners o WHERE o.holder_id = (SELECT holder_id FROM opportunity_accounts WHERE id = NEW.account_id);
END;

CREATE TRIGGER IF NOT EXISTS trg_phase2_cycles_delete
AFTER DELETE ON opportunity_cycles
BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT o.owner_id, 'opportunity_cycles', OLD.id, 'delete'
  FROM phase2_sync_holder_owners o WHERE o.holder_id = (SELECT holder_id FROM opportunity_accounts WHERE id = OLD.account_id);
END;

CREATE TRIGGER IF NOT EXISTS trg_phase2_usages_insert
AFTER INSERT ON opportunity_usages
BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT o.owner_id, 'opportunity_usages', NEW.id, 'upsert'
  FROM phase2_sync_holder_owners o WHERE o.holder_id = (SELECT holder_id FROM opportunity_accounts WHERE id = NEW.account_id);
END;

CREATE TRIGGER IF NOT EXISTS trg_phase2_usages_old_scope
BEFORE UPDATE ON opportunity_usages
WHEN OLD.id IS NOT NEW.id OR OLD.account_id IS NOT NEW.account_id
BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT o.owner_id, 'opportunity_usages', OLD.id, 'delete'
  FROM phase2_sync_holder_owners o WHERE o.holder_id = (SELECT holder_id FROM opportunity_accounts WHERE id = OLD.account_id);
END;

CREATE TRIGGER IF NOT EXISTS trg_phase2_usages_update
AFTER UPDATE ON opportunity_usages
BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT o.owner_id, 'opportunity_usages', NEW.id, 'upsert'
  FROM phase2_sync_holder_owners o WHERE o.holder_id = (SELECT holder_id FROM opportunity_accounts WHERE id = NEW.account_id);
END;

CREATE TRIGGER IF NOT EXISTS trg_phase2_usages_delete
AFTER DELETE ON opportunity_usages
BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT o.owner_id, 'opportunity_usages', OLD.id, 'delete'
  FROM phase2_sync_holder_owners o WHERE o.holder_id = (SELECT holder_id FROM opportunity_accounts WHERE id = OLD.account_id);
END;

CREATE TRIGGER IF NOT EXISTS trg_phase2_tasks_insert
AFTER INSERT ON opportunity_tasks
BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT o.owner_id, 'opportunity_tasks', NEW.id, 'upsert'
  FROM phase2_sync_holder_owners o WHERE o.holder_id = NEW.holder_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_phase2_tasks_old_scope
BEFORE UPDATE ON opportunity_tasks
WHEN OLD.id IS NOT NEW.id OR OLD.holder_id IS NOT NEW.holder_id
BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT o.owner_id, 'opportunity_tasks', OLD.id, 'delete'
  FROM phase2_sync_holder_owners o WHERE o.holder_id = OLD.holder_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_phase2_tasks_update
AFTER UPDATE ON opportunity_tasks
BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT o.owner_id, 'opportunity_tasks', NEW.id, 'upsert'
  FROM phase2_sync_holder_owners o WHERE o.holder_id = NEW.holder_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_phase2_tasks_delete
AFTER DELETE ON opportunity_tasks
BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT o.owner_id, 'opportunity_tasks', OLD.id, 'delete'
  FROM phase2_sync_holder_owners o WHERE o.holder_id = OLD.holder_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_phase2_task_cycles_insert
AFTER INSERT ON opportunity_task_cycles
BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT o.owner_id, 'opportunity_task_cycles', NEW.id, 'upsert'
  FROM phase2_sync_holder_owners o WHERE o.holder_id = (SELECT holder_id FROM opportunity_tasks WHERE id = NEW.task_id);
END;

CREATE TRIGGER IF NOT EXISTS trg_phase2_task_cycles_old_scope
BEFORE UPDATE ON opportunity_task_cycles
WHEN OLD.id IS NOT NEW.id OR OLD.task_id IS NOT NEW.task_id
BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT o.owner_id, 'opportunity_task_cycles', OLD.id, 'delete'
  FROM phase2_sync_holder_owners o WHERE o.holder_id = (SELECT holder_id FROM opportunity_tasks WHERE id = OLD.task_id);
END;

CREATE TRIGGER IF NOT EXISTS trg_phase2_task_cycles_update
AFTER UPDATE ON opportunity_task_cycles
BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT o.owner_id, 'opportunity_task_cycles', NEW.id, 'upsert'
  FROM phase2_sync_holder_owners o WHERE o.holder_id = (SELECT holder_id FROM opportunity_tasks WHERE id = NEW.task_id);
END;

CREATE TRIGGER IF NOT EXISTS trg_phase2_task_cycles_delete
AFTER DELETE ON opportunity_task_cycles
BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT o.owner_id, 'opportunity_task_cycles', OLD.id, 'delete'
  FROM phase2_sync_holder_owners o WHERE o.holder_id = (SELECT holder_id FROM opportunity_tasks WHERE id = OLD.task_id);
END;

CREATE TRIGGER IF NOT EXISTS trg_phase2_fulfillments_insert
AFTER INSERT ON opportunity_fulfillments
BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT o.owner_id, 'opportunity_fulfillments', NEW.id, 'upsert'
  FROM phase2_sync_holder_owners o WHERE o.holder_id = NEW.holder_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_phase2_fulfillments_old_scope
BEFORE UPDATE ON opportunity_fulfillments
WHEN OLD.id IS NOT NEW.id OR OLD.holder_id IS NOT NEW.holder_id
BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT o.owner_id, 'opportunity_fulfillments', OLD.id, 'delete'
  FROM phase2_sync_holder_owners o WHERE o.holder_id = OLD.holder_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_phase2_fulfillments_update
AFTER UPDATE ON opportunity_fulfillments
BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT o.owner_id, 'opportunity_fulfillments', NEW.id, 'upsert'
  FROM phase2_sync_holder_owners o WHERE o.holder_id = NEW.holder_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_phase2_fulfillments_delete
AFTER DELETE ON opportunity_fulfillments
BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT o.owner_id, 'opportunity_fulfillments', OLD.id, 'delete'
  FROM phase2_sync_holder_owners o WHERE o.holder_id = OLD.holder_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_phase2_user_states_insert
AFTER INSERT ON opportunity_user_states
BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT NEW.user_id, 'opportunity_user_states', json_array(NEW.user_id, NEW.account_id), 'upsert';
END;

CREATE TRIGGER IF NOT EXISTS trg_phase2_user_states_old_scope
BEFORE UPDATE ON opportunity_user_states
WHEN OLD.user_id IS NOT NEW.user_id OR OLD.account_id IS NOT NEW.account_id
BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT OLD.user_id, 'opportunity_user_states', json_array(OLD.user_id, OLD.account_id), 'delete';
END;

CREATE TRIGGER IF NOT EXISTS trg_phase2_user_states_update
AFTER UPDATE ON opportunity_user_states
BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT NEW.user_id, 'opportunity_user_states', json_array(NEW.user_id, NEW.account_id), 'upsert';
END;

CREATE TRIGGER IF NOT EXISTS trg_phase2_user_states_delete
AFTER DELETE ON opportunity_user_states
BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT OLD.user_id, 'opportunity_user_states', json_array(OLD.user_id, OLD.account_id), 'delete';
END;

CREATE TRIGGER IF NOT EXISTS trg_phase2_reminder_states_insert
AFTER INSERT ON opportunity_reminder_states
BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT NEW.user_id, 'opportunity_reminder_states', json_array(NEW.user_id, NEW.event_key), 'upsert';
END;

CREATE TRIGGER IF NOT EXISTS trg_phase2_reminder_states_old_scope
BEFORE UPDATE ON opportunity_reminder_states
WHEN OLD.user_id IS NOT NEW.user_id OR OLD.event_key IS NOT NEW.event_key
BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT OLD.user_id, 'opportunity_reminder_states', json_array(OLD.user_id, OLD.event_key), 'delete';
END;

CREATE TRIGGER IF NOT EXISTS trg_phase2_reminder_states_update
AFTER UPDATE ON opportunity_reminder_states
BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT NEW.user_id, 'opportunity_reminder_states', json_array(NEW.user_id, NEW.event_key), 'upsert';
END;

CREATE TRIGGER IF NOT EXISTS trg_phase2_reminder_states_delete
AFTER DELETE ON opportunity_reminder_states
BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT OLD.user_id, 'opportunity_reminder_states', json_array(OLD.user_id, OLD.event_key), 'delete';
END;

CREATE TRIGGER IF NOT EXISTS trg_phase2_notification_history_insert
AFTER INSERT ON notification_history
BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT NEW.user_id, 'notification_history', NEW.id, CASE WHEN NEW.deleted_at IS NULL THEN 'upsert' ELSE 'delete' END;
END;

CREATE TRIGGER IF NOT EXISTS trg_phase2_notification_history_old_scope
BEFORE UPDATE ON notification_history
WHEN OLD.id IS NOT NEW.id OR OLD.user_id IS NOT NEW.user_id
BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT OLD.user_id, 'notification_history', OLD.id, 'delete';
END;

CREATE TRIGGER IF NOT EXISTS trg_phase2_notification_history_update
AFTER UPDATE OF id, user_id, notification_key, category, title, body, target_url, metadata_json,
                sent_at, status, error, read_at, deleted_at, push_sent_at ON notification_history
BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT NEW.user_id, 'notification_history', NEW.id, CASE WHEN NEW.deleted_at IS NULL THEN 'upsert' ELSE 'delete' END;
END;

CREATE TRIGGER IF NOT EXISTS trg_phase2_notification_history_delete
AFTER DELETE ON notification_history
BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT OLD.user_id, 'notification_history', OLD.id, 'delete';
END;

-- Keep each of these holder queries within D1's five-term compound SELECT limit.
CREATE VIEW IF NOT EXISTS phase2_sync_holder_account_rows AS
  SELECT private_holder_id AS holder_id, 'opportunity_definitions' AS tbl, id AS row_id, NULL AS row_user_id
  FROM opportunity_definitions WHERE visibility = 'private'
  UNION ALL
  SELECT d.private_holder_id, 'opportunity_rule_versions', v.id, NULL
  FROM opportunity_definitions d JOIN opportunity_rule_versions v ON v.definition_id = d.id
  WHERE d.visibility = 'private'
  UNION ALL
  SELECT holder_id, 'opportunity_accounts', id, NULL FROM opportunity_accounts
  UNION ALL
  SELECT holder_id, 'opportunity_account_cards', json_array(account_id, card_id), NULL
  FROM opportunity_account_cards
  UNION ALL
  SELECT a.holder_id, 'opportunity_cycles', c.id, NULL
  FROM opportunity_accounts a JOIN opportunity_cycles c ON c.account_id = a.id;

CREATE VIEW IF NOT EXISTS phase2_sync_holder_activity_rows AS
  SELECT a.holder_id AS holder_id, 'opportunity_usages' AS tbl, u.id AS row_id, NULL AS row_user_id
  FROM opportunity_accounts a JOIN opportunity_usages u ON u.account_id = a.id
  UNION ALL
  SELECT holder_id, 'opportunity_tasks', id, NULL FROM opportunity_tasks
  UNION ALL
  SELECT t.holder_id, 'opportunity_task_cycles', c.id, NULL
  FROM opportunity_tasks t JOIN opportunity_task_cycles c ON c.task_id = t.id
  UNION ALL
  SELECT holder_id, 'opportunity_fulfillments', id, NULL FROM opportunity_fulfillments
  UNION ALL
  SELECT a.holder_id, 'opportunity_user_states', json_array(s.user_id, s.account_id), s.user_id
  FROM opportunity_accounts a JOIN opportunity_user_states s ON s.account_id = a.id;

CREATE TRIGGER IF NOT EXISTS trg_phase2_holder_transfer
AFTER UPDATE OF created_by, managed_by, auth_user_id ON card_holders
WHEN OLD.created_by IS NOT NEW.created_by OR OLD.managed_by IS NOT NEW.managed_by
     OR OLD.auth_user_id IS NOT NEW.auth_user_id
BEGIN
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT u.id, r.tbl, r.row_id, 'delete'
  FROM users u CROSS JOIN phase2_sync_holder_activity_rows r
  WHERE u.id IN (OLD.created_by, OLD.managed_by, OLD.auth_user_id)
    AND CASE u.role WHEN 'admin' THEN u.id IS OLD.created_by OR u.id IS OLD.managed_by
                    ELSE u.id IS OLD.auth_user_id END
    AND NOT CASE u.role WHEN 'admin' THEN u.id IS NEW.created_by OR u.id IS NEW.managed_by
                        ELSE u.id IS NEW.auth_user_id END
    AND r.holder_id = NEW.id AND (r.row_user_id IS NULL OR r.row_user_id = u.id)
  ORDER BY CASE r.tbl
    WHEN 'opportunity_tasks' THEN 1
    WHEN 'opportunity_task_cycles' THEN 2
    WHEN 'opportunity_fulfillments' THEN 4
    ELSE 3 END DESC;
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT u.id, r.tbl, r.row_id, 'delete'
  FROM users u CROSS JOIN phase2_sync_holder_account_rows r
  WHERE u.id IN (OLD.created_by, OLD.managed_by, OLD.auth_user_id)
    AND CASE u.role WHEN 'admin' THEN u.id IS OLD.created_by OR u.id IS OLD.managed_by
                    ELSE u.id IS OLD.auth_user_id END
    AND NOT CASE u.role WHEN 'admin' THEN u.id IS NEW.created_by OR u.id IS NEW.managed_by
                        ELSE u.id IS NEW.auth_user_id END
    AND r.holder_id = NEW.id AND (r.row_user_id IS NULL OR r.row_user_id = u.id)
  ORDER BY CASE r.tbl
    WHEN 'opportunity_definitions' THEN 1
    WHEN 'opportunity_rule_versions' THEN 2
    WHEN 'opportunity_accounts' THEN 3
    WHEN 'opportunity_account_cards' THEN 4
    ELSE 5 END DESC;
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT u.id, r.tbl, r.row_id, 'upsert'
  FROM users u CROSS JOIN phase2_sync_holder_account_rows r
  WHERE u.id IN (NEW.created_by, NEW.managed_by, NEW.auth_user_id)
    AND CASE u.role WHEN 'admin' THEN u.id IS NEW.created_by OR u.id IS NEW.managed_by
                    ELSE u.id IS NEW.auth_user_id END
    AND NOT CASE u.role WHEN 'admin' THEN u.id IS OLD.created_by OR u.id IS OLD.managed_by
                        ELSE u.id IS OLD.auth_user_id END
    AND r.holder_id = NEW.id AND (r.row_user_id IS NULL OR r.row_user_id = u.id)
  ORDER BY CASE r.tbl
    WHEN 'opportunity_definitions' THEN 1
    WHEN 'opportunity_rule_versions' THEN 2
    WHEN 'opportunity_accounts' THEN 3
    WHEN 'opportunity_account_cards' THEN 4
    ELSE 5 END;
  INSERT INTO sync_changes (owner_id, tbl, row_id, op)
  SELECT u.id, r.tbl, r.row_id, 'upsert'
  FROM users u CROSS JOIN phase2_sync_holder_activity_rows r
  WHERE u.id IN (NEW.created_by, NEW.managed_by, NEW.auth_user_id)
    AND CASE u.role WHEN 'admin' THEN u.id IS NEW.created_by OR u.id IS NEW.managed_by
                    ELSE u.id IS NEW.auth_user_id END
    AND NOT CASE u.role WHEN 'admin' THEN u.id IS OLD.created_by OR u.id IS OLD.managed_by
                        ELSE u.id IS OLD.auth_user_id END
    AND r.holder_id = NEW.id AND (r.row_user_id IS NULL OR r.row_user_id = u.id)
  ORDER BY CASE r.tbl
    WHEN 'opportunity_tasks' THEN 1
    WHEN 'opportunity_task_cycles' THEN 2
    WHEN 'opportunity_fulfillments' THEN 4
    ELSE 3 END;
END;

-- Backfill in parent-first order, without duplicating existing change entries.

INSERT INTO sync_changes (owner_id, tbl, row_id, op)
SELECT o.owner_id, 'opportunity_definitions', t.id, 'upsert'
FROM opportunity_definitions t
LEFT JOIN phase2_sync_holder_owners o ON t.visibility = 'private' AND o.holder_id = t.private_holder_id
WHERE (t.visibility = 'shared' OR o.owner_id IS NOT NULL)
AND NOT EXISTS (
  SELECT 1 FROM sync_changes s
  WHERE s.tbl = 'opportunity_definitions' AND s.row_id = t.id AND s.owner_id IS o.owner_id
);

INSERT INTO sync_changes (owner_id, tbl, row_id, op)
SELECT o.owner_id, 'opportunity_rule_versions', t.id, 'upsert'
FROM opportunity_rule_versions t JOIN opportunity_definitions d ON d.id = t.definition_id
LEFT JOIN phase2_sync_holder_owners o ON d.visibility = 'private' AND o.holder_id = d.private_holder_id
WHERE (d.visibility = 'shared' OR o.owner_id IS NOT NULL)
AND NOT EXISTS (
  SELECT 1 FROM sync_changes s
  WHERE s.tbl = 'opportunity_rule_versions' AND s.row_id = t.id AND s.owner_id IS o.owner_id
);

INSERT INTO sync_changes (owner_id, tbl, row_id, op)
SELECT o.owner_id, 'opportunity_accounts', t.id, 'upsert'
FROM opportunity_accounts t JOIN phase2_sync_holder_owners o ON o.holder_id = t.holder_id
WHERE NOT EXISTS (
  SELECT 1 FROM sync_changes s
  WHERE s.tbl = 'opportunity_accounts' AND s.row_id = t.id AND s.owner_id IS o.owner_id
);

INSERT INTO sync_changes (owner_id, tbl, row_id, op)
SELECT o.owner_id, 'opportunity_account_cards', json_array(t.account_id, t.card_id), 'upsert'
FROM opportunity_account_cards t JOIN phase2_sync_holder_owners o ON o.holder_id = t.holder_id
WHERE NOT EXISTS (
  SELECT 1 FROM sync_changes s
  WHERE s.tbl = 'opportunity_account_cards' AND s.row_id = json_array(t.account_id, t.card_id) AND s.owner_id IS o.owner_id
);

INSERT INTO sync_changes (owner_id, tbl, row_id, op)
SELECT o.owner_id, 'opportunity_cycles', t.id, 'upsert'
FROM opportunity_cycles t JOIN phase2_sync_holder_owners o ON o.holder_id = (SELECT holder_id FROM opportunity_accounts WHERE id = t.account_id)
WHERE NOT EXISTS (
  SELECT 1 FROM sync_changes s
  WHERE s.tbl = 'opportunity_cycles' AND s.row_id = t.id AND s.owner_id IS o.owner_id
);

INSERT INTO sync_changes (owner_id, tbl, row_id, op)
SELECT o.owner_id, 'opportunity_usages', t.id, 'upsert'
FROM opportunity_usages t JOIN phase2_sync_holder_owners o ON o.holder_id = (SELECT holder_id FROM opportunity_accounts WHERE id = t.account_id)
WHERE NOT EXISTS (
  SELECT 1 FROM sync_changes s
  WHERE s.tbl = 'opportunity_usages' AND s.row_id = t.id AND s.owner_id IS o.owner_id
);

INSERT INTO sync_changes (owner_id, tbl, row_id, op)
SELECT o.owner_id, 'opportunity_tasks', t.id, 'upsert'
FROM opportunity_tasks t JOIN phase2_sync_holder_owners o ON o.holder_id = t.holder_id
WHERE NOT EXISTS (
  SELECT 1 FROM sync_changes s
  WHERE s.tbl = 'opportunity_tasks' AND s.row_id = t.id AND s.owner_id IS o.owner_id
);

INSERT INTO sync_changes (owner_id, tbl, row_id, op)
SELECT o.owner_id, 'opportunity_task_cycles', t.id, 'upsert'
FROM opportunity_task_cycles t JOIN phase2_sync_holder_owners o ON o.holder_id = (SELECT holder_id FROM opportunity_tasks WHERE id = t.task_id)
WHERE NOT EXISTS (
  SELECT 1 FROM sync_changes s
  WHERE s.tbl = 'opportunity_task_cycles' AND s.row_id = t.id AND s.owner_id IS o.owner_id
);

INSERT INTO sync_changes (owner_id, tbl, row_id, op)
SELECT o.owner_id, 'opportunity_fulfillments', t.id, 'upsert'
FROM opportunity_fulfillments t JOIN phase2_sync_holder_owners o ON o.holder_id = t.holder_id
WHERE NOT EXISTS (
  SELECT 1 FROM sync_changes s
  WHERE s.tbl = 'opportunity_fulfillments' AND s.row_id = t.id AND s.owner_id IS o.owner_id
);

INSERT INTO sync_changes (owner_id, tbl, row_id, op)
SELECT t.user_id, 'opportunity_user_states', json_array(t.user_id, t.account_id), 'upsert'
FROM opportunity_user_states t
WHERE NOT EXISTS (
  SELECT 1 FROM sync_changes s
  WHERE s.tbl = 'opportunity_user_states' AND s.row_id = json_array(t.user_id, t.account_id) AND s.owner_id IS t.user_id
);

INSERT INTO sync_changes (owner_id, tbl, row_id, op)
SELECT t.user_id, 'opportunity_reminder_states', json_array(t.user_id, t.event_key), 'upsert'
FROM opportunity_reminder_states t
WHERE NOT EXISTS (
  SELECT 1 FROM sync_changes s
  WHERE s.tbl = 'opportunity_reminder_states' AND s.row_id = json_array(t.user_id, t.event_key) AND s.owner_id IS t.user_id
);

INSERT INTO sync_changes (owner_id, tbl, row_id, op)
SELECT t.user_id, 'notification_history', t.id, 'upsert'
FROM notification_history t
WHERE t.deleted_at IS NULL
AND NOT EXISTS (
  SELECT 1 FROM sync_changes s
  WHERE s.tbl = 'notification_history' AND s.row_id = t.id AND s.owner_id IS t.user_id
);

-- Roll back after reverting the Worker. Keep the monotonic sync feed intact
-- so existing client cursors remain valid and reapplying is idempotent.
-- rollback: DROP TRIGGER IF EXISTS trg_phase2_holder_transfer;
-- rollback: DROP TRIGGER IF EXISTS trg_phase2_notification_history_delete;
-- rollback: DROP TRIGGER IF EXISTS trg_phase2_notification_history_update;
-- rollback: DROP TRIGGER IF EXISTS trg_phase2_notification_history_old_scope;
-- rollback: DROP TRIGGER IF EXISTS trg_phase2_notification_history_insert;
-- rollback: DROP TRIGGER IF EXISTS trg_phase2_reminder_states_delete;
-- rollback: DROP TRIGGER IF EXISTS trg_phase2_reminder_states_update;
-- rollback: DROP TRIGGER IF EXISTS trg_phase2_reminder_states_old_scope;
-- rollback: DROP TRIGGER IF EXISTS trg_phase2_reminder_states_insert;
-- rollback: DROP TRIGGER IF EXISTS trg_phase2_user_states_delete;
-- rollback: DROP TRIGGER IF EXISTS trg_phase2_user_states_update;
-- rollback: DROP TRIGGER IF EXISTS trg_phase2_user_states_old_scope;
-- rollback: DROP TRIGGER IF EXISTS trg_phase2_user_states_insert;
-- rollback: DROP TRIGGER IF EXISTS trg_phase2_fulfillments_delete;
-- rollback: DROP TRIGGER IF EXISTS trg_phase2_fulfillments_update;
-- rollback: DROP TRIGGER IF EXISTS trg_phase2_fulfillments_old_scope;
-- rollback: DROP TRIGGER IF EXISTS trg_phase2_fulfillments_insert;
-- rollback: DROP TRIGGER IF EXISTS trg_phase2_task_cycles_delete;
-- rollback: DROP TRIGGER IF EXISTS trg_phase2_task_cycles_update;
-- rollback: DROP TRIGGER IF EXISTS trg_phase2_task_cycles_old_scope;
-- rollback: DROP TRIGGER IF EXISTS trg_phase2_task_cycles_insert;
-- rollback: DROP TRIGGER IF EXISTS trg_phase2_tasks_delete;
-- rollback: DROP TRIGGER IF EXISTS trg_phase2_tasks_update;
-- rollback: DROP TRIGGER IF EXISTS trg_phase2_tasks_old_scope;
-- rollback: DROP TRIGGER IF EXISTS trg_phase2_tasks_insert;
-- rollback: DROP TRIGGER IF EXISTS trg_phase2_usages_delete;
-- rollback: DROP TRIGGER IF EXISTS trg_phase2_usages_update;
-- rollback: DROP TRIGGER IF EXISTS trg_phase2_usages_old_scope;
-- rollback: DROP TRIGGER IF EXISTS trg_phase2_usages_insert;
-- rollback: DROP TRIGGER IF EXISTS trg_phase2_cycles_delete;
-- rollback: DROP TRIGGER IF EXISTS trg_phase2_cycles_update;
-- rollback: DROP TRIGGER IF EXISTS trg_phase2_cycles_old_scope;
-- rollback: DROP TRIGGER IF EXISTS trg_phase2_cycles_insert;
-- rollback: DROP TRIGGER IF EXISTS trg_phase2_account_cards_delete;
-- rollback: DROP TRIGGER IF EXISTS trg_phase2_account_cards_update;
-- rollback: DROP TRIGGER IF EXISTS trg_phase2_account_cards_old_scope;
-- rollback: DROP TRIGGER IF EXISTS trg_phase2_account_cards_insert;
-- rollback: DROP TRIGGER IF EXISTS trg_phase2_accounts_delete;
-- rollback: DROP TRIGGER IF EXISTS trg_phase2_accounts_update;
-- rollback: DROP TRIGGER IF EXISTS trg_phase2_accounts_old_scope;
-- rollback: DROP TRIGGER IF EXISTS trg_phase2_accounts_insert;
-- rollback: DROP TRIGGER IF EXISTS trg_phase2_rule_versions_delete;
-- rollback: DROP TRIGGER IF EXISTS trg_phase2_rule_versions_update;
-- rollback: DROP TRIGGER IF EXISTS trg_phase2_rule_versions_old_scope;
-- rollback: DROP TRIGGER IF EXISTS trg_phase2_rule_versions_insert;
-- rollback: DROP TRIGGER IF EXISTS trg_phase2_definitions_delete;
-- rollback: DROP TRIGGER IF EXISTS trg_phase2_definitions_update;
-- rollback: DROP TRIGGER IF EXISTS trg_phase2_definitions_old_scope;
-- rollback: DROP TRIGGER IF EXISTS trg_phase2_definitions_rules_new_scope;
-- rollback: DROP TRIGGER IF EXISTS trg_phase2_definitions_rules_old_scope;
-- rollback: DROP TRIGGER IF EXISTS trg_phase2_definitions_insert;
-- rollback: DROP VIEW IF EXISTS phase2_sync_holder_activity_rows;
-- rollback: DROP VIEW IF EXISTS phase2_sync_holder_account_rows;
-- rollback: DROP VIEW IF EXISTS phase2_sync_holder_owners;
-- rollback: DROP INDEX IF EXISTS idx_phase2_fulfillments_task;
-- rollback: DROP INDEX IF EXISTS idx_phase2_fulfillments_holder;
-- rollback: DROP INDEX IF EXISTS idx_phase2_user_states_account;
-- rollback: DROP INDEX IF EXISTS idx_phase2_account_cards_holder;
-- rollback: DROP INDEX IF EXISTS idx_phase2_definitions_private_holder;
-- rollback: ALTER TABLE notification_history DROP COLUMN push_lease_until;
