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

        return migrator
    }
}
