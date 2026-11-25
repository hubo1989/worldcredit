import Foundation
import GRDB

public final class DatabaseManager: @unchecked Sendable {
    public let dbWriter: any DatabaseWriter

    public init(dbWriter: any DatabaseWriter) throws {
        self.dbWriter = dbWriter
        try migrator.migrate(dbWriter)
    }

    public static func inMemory() throws -> DatabaseManager {
        var config = Configuration()
        config.foreignKeysEnabled = true
        let queue = try DatabaseQueue(configuration: config)
        return try DatabaseManager(dbWriter: queue)
    }

    public static func file(at url: URL) throws -> DatabaseManager {
        try file(at: url, fileManager: .default)
    }

    // Simulator filesystems may accept protection writes without returning protectionKey.
    // Physical devices must always verify protection before exposing the database.
    static var requiresProtectionReadback: Bool {
        #if targetEnvironment(simulator)
        false
        #else
        true
        #endif
    }

    static func file(at url: URL, fileManager: FileManager,
                     requiresProtectionReadback: Bool = DatabaseManager.requiresProtectionReadback) throws -> DatabaseManager {
        // Protect the directory before SQLite can create database or sidecar files.
        let dir = url.deletingLastPathComponent()
        try fileManager.createDirectory(at: dir, withIntermediateDirectories: true)
        try protectFile(at: dir.path, fileManager: fileManager, requiresReadback: requiresProtectionReadback)
        let paths = [url.path, url.path + "-wal", url.path + "-shm"]
        // Existing files may have been created with weaker protection.
        for path in paths where fileManager.fileExists(atPath: path) {
            try protectFile(at: path, fileManager: fileManager, requiresReadback: requiresProtectionReadback)
        }

        var config = Configuration()
        config.foreignKeysEnabled = true
        let pool = try DatabasePool(path: url.path, configuration: config)
        let manager = try DatabaseManager(dbWriter: pool)
        for path in paths where fileManager.fileExists(atPath: path) {
            try protectFile(at: path, fileManager: fileManager, requiresReadback: requiresProtectionReadback)
        }
        return manager
    }

    private static func protectFile(at path: String, fileManager: FileManager, requiresReadback: Bool) throws {
        let protection = FileProtectionType.completeUntilFirstUserAuthentication
        try fileManager.setAttributes([.protectionKey: protection], ofItemAtPath: path)
        let attributes = try fileManager.attributesOfItem(atPath: path)
        if !requiresReadback && attributes[.protectionKey] == nil { return }
        guard attributes[.protectionKey] as? FileProtectionType == protection else {
            throw NSError(domain: "DatabaseManager.FileProtection", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "Database file protection verification failed"])
        }
    }

    public static func defaultDatabase() throws -> DatabaseManager {
        let fileManager = FileManager.default
        let folder: URL
        if let groupURL = fileManager.containerURL(forSecurityApplicationGroupIdentifier: "group.com.chunfenshijie.worldcredit") {
            folder = groupURL
        } else {
            folder = fileManager.urls(for: .documentDirectory, in: .userDomainMask)[0]
        }
        let fileURL = folder.appendingPathComponent("worldcredit.sqlite")
        return try DatabaseManager.file(at: fileURL)
    }

    /// Clears account-scoped rows, queued mutations and sync state on logout.
    ///
    /// 这是登出防跨账号数据泄漏的最后防线，必须覆盖全部 15 张业务表、
    /// mutation_outbox 与 sync_meta 整表（含 sync_cursor、sync_retry_after_%、
    /// sync_reconcile_targets 及任何未来新增键）。
    ///
    /// device 级 `sync_client_id` 的决定：**删除并重置**。理由：
    /// 1) 登出后沿用同一 clientId 会让服务端把同一设备跨账号关联（隐私泄漏面）；
    /// 2) mutation_outbox 已清空，不存在需要同一 clientId 续传的未确认操作；
    /// 3) 下次 SyncEngine 启动会自动生成新 id（见 SyncEngine.init）。
    /// 删除顺序遵循外键约束：12 张权益/通知明细表 → 既有 15 张业务表 →
    /// mutation_outbox → sync_meta。
    public func clearUserData() async throws {
        try await dbWriter.write { db in
            try db.execute(sql: """
                DELETE FROM notification_history;
                DELETE FROM opportunity_reminder_states;
                DELETE FROM opportunity_user_states;
                DELETE FROM opportunity_fulfillments;
                DELETE FROM opportunity_task_cycles;
                DELETE FROM opportunity_tasks;
                DELETE FROM opportunity_usages;
                DELETE FROM opportunity_cycles;
                DELETE FROM opportunity_account_cards;
                DELETE FROM opportunity_accounts;
                DELETE FROM opportunity_rule_versions;
                DELETE FROM opportunity_definitions;
                DELETE FROM bill_card_subtotals;
                DELETE FROM payments;
                DELETE FROM bills;
                DELETE FROM credit_cards;
                DELETE FROM credit_accounts;
                DELETE FROM recurring_payable_payments;
                DELETE FROM recurring_payables;
                DELETE FROM payable_custom_categories;
                DELETE FROM user_preferences;
                DELETE FROM notification_preferences;
                DELETE FROM card_holders;
                DELETE FROM benefits;
                DELETE FROM promos;
                DELETE FROM card_products;
                DELETE FROM banks;
                DELETE FROM mutation_outbox;
                DELETE FROM sync_meta;
                """)
        }
    }

    private var migrator: DatabaseMigrator {
        var migrator = DatabaseMigrator()

        migrator.registerMigration("v1_initial_schema") { db in
            // 1. Catalog tables
            try db.execute(sql: """
            CREATE TABLE IF NOT EXISTS banks (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                short_name TEXT,
                logo_url TEXT,
                tel TEXT,
                quota_mode TEXT,
                statement_mode TEXT
            );

            CREATE TABLE IF NOT EXISTS card_products (
                id TEXT PRIMARY KEY,
                bank_id TEXT REFERENCES banks(id) ON DELETE SET NULL,
                bank_name TEXT NOT NULL DEFAULT '',
                card_name TEXT NOT NULL,
                card_type TEXT NOT NULL DEFAULT 'credit',
                currency TEXT NOT NULL DEFAULT 'CNY',
                payment_due_type TEXT NOT NULL,
                payment_due_value INTEGER NOT NULL,
                annual_fee REAL,
                card_art_url TEXT
            );

            -- 2. User tables
            CREATE TABLE IF NOT EXISTS card_holders (
                id TEXT PRIMARY KEY,
                created_by TEXT NOT NULL,
                managed_by TEXT NOT NULL,
                name TEXT NOT NULL,
                phone TEXT,
                email TEXT,
                aliases TEXT,
                avatar_color TEXT DEFAULT '#1976d2',
                auth_user_id TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS credit_cards (
                id TEXT PRIMARY KEY,
                holder_id TEXT NOT NULL REFERENCES card_holders(id) ON DELETE CASCADE,
                card_product_id TEXT NOT NULL REFERENCES card_products(id) ON DELETE RESTRICT,
                card_number_last4 TEXT,
                credit_limit REAL NOT NULL DEFAULT 0,
                billing_day INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'active',
                card_type TEXT NOT NULL DEFAULT 'credit',
                loan_due_day INTEGER,
                override_billing_day INTEGER,
                override_due_type TEXT,
                override_due_value INTEGER,
                name_override TEXT,
                annual_fee_override REAL,
                account_mode_override TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS bills (
                id TEXT PRIMARY KEY,
                card_id TEXT NOT NULL REFERENCES credit_cards(id) ON DELETE CASCADE,
                bill_month TEXT NOT NULL,
                statement_start TEXT,
                statement_end TEXT,
                statement_date TEXT,
                bill_amount REAL NOT NULL DEFAULT 0,
                min_payment REAL DEFAULT 0,
                due_date TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'unpaid',
                bill_amount_override REAL,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                UNIQUE(card_id, bill_month)
            );

            CREATE TABLE IF NOT EXISTS payments (
                id TEXT PRIMARY KEY,
                bill_id TEXT NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
                amount REAL NOT NULL,
                paid_at TEXT NOT NULL DEFAULT (date('now')),
                channel TEXT DEFAULT '手动还款',
                note TEXT,
                idempotency_key TEXT UNIQUE NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            -- 3. Local sync infrastructure
            CREATE TABLE IF NOT EXISTS sync_meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS mutation_outbox (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                args_json TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                retry_count INTEGER NOT NULL DEFAULT 0,
                last_error TEXT
            );
            """)
        }

        migrator.registerMigration("v2_syncable_parity") { db in
            try db.execute(sql: """
            -- 1. Extend existing v1 tables to parity with D1 schema
            ALTER TABLE banks ADD COLUMN full_name TEXT;
            ALTER TABLE banks ADD COLUMN country TEXT NOT NULL DEFAULT 'CN';
            ALTER TABLE banks ADD COLUMN customer_service_phone TEXT;
            ALTER TABLE banks ADD COLUMN website_url TEXT;
            ALTER TABLE banks ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;
            ALTER TABLE banks ADD COLUMN created_at TEXT;
            UPDATE banks SET customer_service_phone = tel
                WHERE customer_service_phone IS NULL AND tel IS NOT NULL;

            ALTER TABLE card_products ADD COLUMN country TEXT NOT NULL DEFAULT 'CN';
            ALTER TABLE card_products ADD COLUMN card_image_id TEXT;
            ALTER TABLE card_products ADD COLUMN description_md TEXT;
            ALTER TABLE card_products ADD COLUMN apply_url TEXT;
            ALTER TABLE card_products ADD COLUMN rewards_summary TEXT;
            ALTER TABLE card_products ADD COLUMN annual_fee_waiver TEXT;
            ALTER TABLE card_products ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;
            ALTER TABLE card_products ADD COLUMN created_at TEXT;
            UPDATE card_products SET card_image_id = card_art_url
                WHERE card_image_id IS NULL AND card_art_url IS NOT NULL;

            ALTER TABLE credit_cards ADD COLUMN account_id TEXT;
            ALTER TABLE credit_cards ADD COLUMN credit_limit_override REAL;
            ALTER TABLE credit_cards ADD COLUMN issued_on TEXT;
            ALTER TABLE credit_cards ADD COLUMN activated_on TEXT;
            CREATE INDEX IF NOT EXISTS idx_credit_cards_account ON credit_cards(account_id);

            ALTER TABLE bills ADD COLUMN account_id TEXT;
            ALTER TABLE bills ADD COLUMN min_payment_override REAL;
            ALTER TABLE bills ADD COLUMN due_date_override TEXT;
            ALTER TABLE bills ADD COLUMN statement_date_override TEXT;
            ALTER TABLE bills ADD COLUMN statement_start_override TEXT;
            ALTER TABLE bills ADD COLUMN statement_end_override TEXT;
            CREATE INDEX IF NOT EXISTS idx_bills_account ON bills(account_id);

            -- 2. Create the remaining 9 SYNCABLE_TABLES
            CREATE TABLE IF NOT EXISTS credit_accounts (
                id TEXT PRIMARY KEY,
                holder_id TEXT NOT NULL REFERENCES card_holders(id) ON DELETE CASCADE,
                bank_id TEXT REFERENCES banks(id) ON DELETE SET NULL,
                bank_name TEXT NOT NULL DEFAULT '',
                currency TEXT NOT NULL DEFAULT 'CNY',
                account_tail TEXT,
                statement_mode TEXT NOT NULL DEFAULT 'independent',
                quota_mode TEXT NOT NULL DEFAULT 'independent',
                shared_credit_limit REAL,
                billing_day INTEGER,
                due_type TEXT DEFAULT 'after_billing',
                due_value INTEGER DEFAULT 20,
                primary_card_id TEXT,
                label TEXT,
                status TEXT NOT NULL DEFAULT 'active',
                created_at TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL DEFAULT ''
            );
            CREATE INDEX IF NOT EXISTS idx_credit_accounts_holder_bank
                ON credit_accounts(holder_id, bank_id, bank_name, currency);
            CREATE INDEX IF NOT EXISTS idx_credit_accounts_primary_card
                ON credit_accounts(primary_card_id);

            CREATE TABLE IF NOT EXISTS bill_card_subtotals (
                id TEXT PRIMARY KEY,
                bill_id TEXT NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
                card_id TEXT,
                card_tail TEXT NOT NULL,
                subtotal_amount REAL NOT NULL,
                currency TEXT DEFAULT 'CNY',
                source TEXT NOT NULL DEFAULT 'email',
                created_at TEXT NOT NULL DEFAULT '',
                UNIQUE(bill_id, card_tail)
            );
            CREATE INDEX IF NOT EXISTS idx_bill_card_subtotals_bill ON bill_card_subtotals(bill_id);
            CREATE INDEX IF NOT EXISTS idx_bill_card_subtotals_card ON bill_card_subtotals(card_id);

            CREATE TABLE IF NOT EXISTS benefits (
                id TEXT PRIMARY KEY,
                card_product_id TEXT NOT NULL REFERENCES card_products(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                description TEXT,
                quota INTEGER NOT NULL DEFAULT 1,
                period TEXT NOT NULL DEFAULT 'yearly',
                reset_month INTEGER,
                expiry_date TEXT,
                created_at TEXT NOT NULL DEFAULT ''
            );
            CREATE INDEX IF NOT EXISTS idx_benefits_product ON benefits(card_product_id);

            CREATE TABLE IF NOT EXISTS promos (
                id TEXT PRIMARY KEY,
                card_product_id TEXT REFERENCES card_products(id) ON DELETE SET NULL,
                bank_id TEXT REFERENCES banks(id) ON DELETE SET NULL,
                bank_name TEXT NOT NULL DEFAULT '',
                title TEXT NOT NULL,
                description TEXT,
                discount_type TEXT,
                start_date TEXT,
                end_date TEXT,
                conditions TEXT,
                max_uses INTEGER,
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL DEFAULT ''
            );
            CREATE INDEX IF NOT EXISTS idx_promos_product ON promos(card_product_id);
            CREATE INDEX IF NOT EXISTS idx_promos_bank ON promos(bank_id);

            CREATE TABLE IF NOT EXISTS user_preferences (
                id TEXT,
                user_id TEXT PRIMARY KEY,
                display_config TEXT NOT NULL DEFAULT '{"privacy_mode":false,"show_min_payment":true,"show_statement_date":true,"show_annual_fee":true,"show_card_last4":true,"default_currency":"CNY"}',
                reminder_config TEXT NOT NULL DEFAULT '{"remind_days_before":[3,1,0],"quiet_hours_start":"22:00","quiet_hours_end":"08:00","enabled_channels":["web_push"]}',
                updated_at TEXT NOT NULL DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS notification_preferences (
                user_id TEXT PRIMARY KEY,
                bill_due_enabled INTEGER NOT NULL DEFAULT 1,
                overdue_enabled INTEGER NOT NULL DEFAULT 1,
                due_days_before INTEGER NOT NULL DEFAULT 3,
                notify_time TEXT NOT NULL DEFAULT '09:00',
                created_at TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS recurring_payables (
                id TEXT PRIMARY KEY,
                created_by TEXT NOT NULL,
                name TEXT NOT NULL,
                category TEXT NOT NULL DEFAULT 'other',
                custom_category TEXT,
                amount REAL NOT NULL DEFAULT 0,
                currency TEXT NOT NULL DEFAULT 'CNY',
                due_day INTEGER NOT NULL,
                cycle_type TEXT NOT NULL DEFAULT 'monthly',
                cycle_months INTEGER NOT NULL DEFAULT 1,
                due_month INTEGER,
                anchor_period TEXT,
                holder_id TEXT,
                bank_name TEXT,
                bank_account TEXT,
                note TEXT,
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL DEFAULT ''
            );
            CREATE INDEX IF NOT EXISTS idx_recurring_payables_user
                ON recurring_payables(created_by, is_active);

            CREATE TABLE IF NOT EXISTS recurring_payable_payments (
                id TEXT PRIMARY KEY,
                payable_id TEXT NOT NULL REFERENCES recurring_payables(id) ON DELETE CASCADE,
                period TEXT NOT NULL,
                amount REAL NOT NULL,
                paid_at TEXT NOT NULL,
                note TEXT,
                created_at TEXT NOT NULL DEFAULT '',
                UNIQUE(payable_id, period)
            );
            CREATE INDEX IF NOT EXISTS idx_recurring_payments_payable
                ON recurring_payable_payments(payable_id, period);

            CREATE TABLE IF NOT EXISTS payable_custom_categories (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                name TEXT NOT NULL,
                normalized_name TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT '',
                UNIQUE(user_id, normalized_name)
            );
            CREATE INDEX IF NOT EXISTS idx_payable_custom_categories_user
                ON payable_custom_categories(user_id, created_at);

            -- 3. Reset sync cursor if present so upgraded clients backfill all 15 tables & new columns.
            UPDATE sync_meta SET value = '0' WHERE key = 'sync_cursor';
            """)
        }

        migrator.registerMigration("v3_phase2_opportunities_and_notifications") { db in
            try db.execute(sql: """
            -- 1. 权益与任务全离线可同步表 (11 张 opportunity_* + notification_history)
            CREATE TABLE IF NOT EXISTS opportunity_definitions (
                id TEXT PRIMARY KEY,
                kind TEXT NOT NULL,
                legacy_benefit_id TEXT UNIQUE,
                legacy_promo_id TEXT UNIQUE,
                visibility TEXT NOT NULL,
                private_holder_id TEXT,
                status TEXT NOT NULL DEFAULT 'active',
                terminated_at TEXT,
                termination_reason TEXT,
                revision INTEGER NOT NULL DEFAULT 1,
                created_by TEXT,
                created_at TEXT NOT NULL DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS opportunity_rule_versions (
                id TEXT PRIMARY KEY,
                definition_id TEXT NOT NULL REFERENCES opportunity_definitions(id) ON DELETE CASCADE,
                version INTEGER NOT NULL,
                effective_from TEXT NOT NULL,
                effective_until_before TEXT,
                rules_json TEXT NOT NULL,
                verification TEXT NOT NULL DEFAULT 'unverified',
                source_url TEXT,
                source_excerpt TEXT,
                checked_at TEXT,
                checked_by TEXT,
                published_at TEXT NOT NULL DEFAULT ''
            );
            CREATE INDEX IF NOT EXISTS idx_opp_rule_versions_def ON opportunity_rule_versions(definition_id, version);

            CREATE TABLE IF NOT EXISTS opportunity_accounts (
                id TEXT PRIMARY KEY,
                definition_id TEXT NOT NULL REFERENCES opportunity_definitions(id) ON DELETE CASCADE,
                holder_id TEXT NOT NULL REFERENCES card_holders(id) ON DELETE CASCADE,
                scope_kind TEXT NOT NULL,
                scope_key TEXT NOT NULL,
                eligibility TEXT NOT NULL DEFAULT 'unknown',
                eligibility_note TEXT,
                eligibility_confirmed_by TEXT,
                eligibility_confirmed_at TEXT,
                eligible_from_on TEXT,
                status TEXT NOT NULL DEFAULT 'active',
                revision INTEGER NOT NULL DEFAULT 1,
                created_by TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT ''
            );
            CREATE INDEX IF NOT EXISTS idx_opp_accounts_holder ON opportunity_accounts(holder_id, status);

            CREATE TABLE IF NOT EXISTS opportunity_account_cards (
                account_id TEXT NOT NULL REFERENCES opportunity_accounts(id) ON DELETE CASCADE,
                definition_id TEXT NOT NULL,
                holder_id TEXT NOT NULL,
                card_id TEXT NOT NULL REFERENCES credit_cards(id) ON DELETE CASCADE,
                retired_at TEXT,
                PRIMARY KEY(account_id, card_id)
            );
            CREATE INDEX IF NOT EXISTS idx_opp_account_cards_card ON opportunity_account_cards(card_id, retired_at);

            CREATE TABLE IF NOT EXISTS opportunity_cycles (
                id TEXT PRIMARY KEY,
                account_id TEXT NOT NULL REFERENCES opportunity_accounts(id) ON DELETE CASCADE,
                version_id TEXT NOT NULL REFERENCES opportunity_rule_versions(id) ON DELETE CASCADE,
                version_as_of_on TEXT NOT NULL,
                cycle_key TEXT NOT NULL,
                allocation_kind TEXT NOT NULL DEFAULT 'regular',
                activation_state TEXT NOT NULL DEFAULT 'active',
                period_start_on TEXT NOT NULL,
                period_end_before TEXT,
                usable_start_on TEXT NOT NULL,
                usable_end_before TEXT,
                time_zone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
                count_limit INTEGER,
                amount_limit_minor INTEGER,
                currency TEXT,
                workflow_json TEXT NOT NULL DEFAULT '{}',
                opening_used_count INTEGER NOT NULL DEFAULT 0,
                opening_used_minor INTEGER NOT NULL DEFAULT 0,
                used_count INTEGER NOT NULL DEFAULT 0,
                used_minor INTEGER NOT NULL DEFAULT 0,
                reserved_count INTEGER NOT NULL DEFAULT 0,
                reserved_minor INTEGER NOT NULL DEFAULT 0,
                balance_verified INTEGER NOT NULL DEFAULT 0,
                verified_by TEXT,
                verified_at TEXT,
                opening_as_of_on TEXT,
                revision INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL DEFAULT ''
            );
            CREATE INDEX IF NOT EXISTS idx_opp_cycles_account ON opportunity_cycles(account_id, usable_start_on, usable_end_before);

            CREATE TABLE IF NOT EXISTS opportunity_usages (
                id TEXT PRIMARY KEY,
                account_id TEXT NOT NULL REFERENCES opportunity_accounts(id) ON DELETE CASCADE,
                cycle_id TEXT NOT NULL REFERENCES opportunity_cycles(id) ON DELETE CASCADE,
                card_id TEXT NOT NULL REFERENCES credit_cards(id) ON DELETE CASCADE,
                used_on TEXT NOT NULL,
                quantity INTEGER NOT NULL DEFAULT 1,
                amount_minor INTEGER NOT NULL DEFAULT 0,
                note TEXT,
                status TEXT NOT NULL DEFAULT 'active',
                revision INTEGER NOT NULL DEFAULT 1,
                created_by TEXT NOT NULL DEFAULT '',
                updated_by TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL DEFAULT ''
            );
            CREATE INDEX IF NOT EXISTS idx_opp_usages_account ON opportunity_usages(account_id, used_on, id);

            CREATE TABLE IF NOT EXISTS opportunity_tasks (
                id TEXT PRIMARY KEY,
                holder_id TEXT NOT NULL REFERENCES card_holders(id) ON DELETE CASCADE,
                task_type TEXT NOT NULL,
                title TEXT NOT NULL,
                card_ids_json TEXT NOT NULL DEFAULT '[]',
                rules_json TEXT NOT NULL,
                reward_json TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'active',
                revision INTEGER NOT NULL DEFAULT 1,
                created_by TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL DEFAULT ''
            );
            CREATE INDEX IF NOT EXISTS idx_opp_tasks_holder ON opportunity_tasks(holder_id, status);

            CREATE TABLE IF NOT EXISTS opportunity_task_cycles (
                id TEXT PRIMARY KEY,
                task_id TEXT NOT NULL REFERENCES opportunity_tasks(id) ON DELETE CASCADE,
                cycle_key TEXT NOT NULL,
                rules_snapshot_json TEXT NOT NULL,
                reward_snapshot_json TEXT NOT NULL,
                period_start_on TEXT NOT NULL,
                period_end_before TEXT NOT NULL,
                deadline_at TEXT NOT NULL,
                expected_from_on TEXT,
                expected_until_before TEXT,
                progress_json TEXT NOT NULL DEFAULT '{}',
                as_of_on TEXT,
                revision INTEGER NOT NULL DEFAULT 1,
                updated_by TEXT,
                updated_at TEXT NOT NULL DEFAULT ''
            );
            CREATE INDEX IF NOT EXISTS idx_opp_task_cycles_task ON opportunity_task_cycles(task_id, cycle_key);

            CREATE TABLE IF NOT EXISTS opportunity_fulfillments (
                id TEXT PRIMARY KEY,
                holder_id TEXT NOT NULL REFERENCES card_holders(id) ON DELETE CASCADE,
                kind TEXT NOT NULL,
                account_id TEXT,
                cycle_id TEXT,
                task_cycle_id TEXT,
                reward_key TEXT,
                source_key TEXT NOT NULL,
                card_id TEXT,
                status TEXT NOT NULL,
                quantity INTEGER NOT NULL DEFAULT 1,
                amount_minor INTEGER NOT NULL DEFAULT 0,
                recorded_on TEXT NOT NULL,
                service_at TEXT,
                service_time_zone TEXT,
                external_reference TEXT,
                entry_json TEXT NOT NULL DEFAULT '{}',
                settlement TEXT,
                usage_id TEXT,
                note TEXT,
                revision INTEGER NOT NULL DEFAULT 1,
                created_by TEXT NOT NULL DEFAULT '',
                updated_by TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL DEFAULT ''
            );
            CREATE INDEX IF NOT EXISTS idx_opp_fulfillments_account ON opportunity_fulfillments(account_id, status, service_at);

            CREATE TABLE IF NOT EXISTS opportunity_user_states (
                user_id TEXT NOT NULL,
                account_id TEXT NOT NULL REFERENCES opportunity_accounts(id) ON DELETE CASCADE,
                followed INTEGER NOT NULL DEFAULT 0,
                revision INTEGER NOT NULL DEFAULT 1,
                updated_at TEXT NOT NULL DEFAULT '',
                PRIMARY KEY(user_id, account_id)
            );

            CREATE TABLE IF NOT EXISTS opportunity_reminder_states (
                user_id TEXT NOT NULL,
                event_key TEXT NOT NULL,
                read_steps_json TEXT NOT NULL DEFAULT '[]',
                dismissed_at TEXT,
                snooze_until TEXT,
                revision INTEGER NOT NULL DEFAULT 1,
                updated_at TEXT NOT NULL DEFAULT '',
                PRIMARY KEY(user_id, event_key)
            );

            CREATE TABLE IF NOT EXISTS notification_history (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                notification_key TEXT NOT NULL,
                category TEXT NOT NULL DEFAULT 'system',
                title TEXT NOT NULL,
                body TEXT,
                target_url TEXT,
                metadata_json TEXT,
                sent_at TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'sent',
                error TEXT,
                read_at TEXT,
                deleted_at TEXT,
                push_sent_at TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_notif_history_inbox ON notification_history(user_id, deleted_at, sent_at DESC);

            -- 2. Reset sync cursor if present so upgraded clients backfill all 27 tables cleanly.
            UPDATE sync_meta SET value = '0' WHERE key = 'sync_cursor';
            """)
        }

        // 方向 4 增量迁移：与方向 2 (v3) / 方向 3 (v4_payment_fx_lock) 保持命名正交且顺序递增
        migrator.registerMigration("v5_direction4_card_rules_and_roi") { db in
            try db.execute(sql: """
            ALTER TABLE card_products ADD COLUMN ftf_rate REAL;
            ALTER TABLE card_products ADD COLUMN fx_free_currencies_json TEXT;
            ALTER TABLE card_products ADD COLUMN reward_rules_json TEXT;
            ALTER TABLE card_products ADD COLUMN annual_fee_cycle_type TEXT;
            ALTER TABLE card_products ADD COLUMN annual_fee_waiver_rules_json TEXT;
            ALTER TABLE card_products ADD COLUMN rules_updated_at TEXT;

            ALTER TABLE credit_cards ADD COLUMN annual_fee_cycle_type TEXT;
            ALTER TABLE credit_cards ADD COLUMN next_annual_fee_date TEXT;
            ALTER TABLE credit_cards ADD COLUMN annual_fee_status TEXT;
            ALTER TABLE credit_cards ADD COLUMN waiver_progress_json TEXT;
            ALTER TABLE credit_cards ADD COLUMN actual_fee_paid REAL;
            ALTER TABLE credit_cards ADD COLUMN manual_reward_value REAL;

            CREATE INDEX IF NOT EXISTS idx_credit_cards_next_annual_fee
                ON credit_cards(status, card_type, next_annual_fee_date)
                WHERE next_annual_fee_date IS NOT NULL;

            UPDATE sync_meta SET value = '0' WHERE key = 'sync_cursor';
            """)
        }

        return migrator
    }
}
