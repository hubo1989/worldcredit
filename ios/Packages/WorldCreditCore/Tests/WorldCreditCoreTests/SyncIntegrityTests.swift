import Foundation
import GRDB
import Testing
@testable import WorldCreditCore

@Suite("Sync wire contract and optimistic state integrity")
struct SyncIntegrityTests {
    private let billID = "sync-fixture-bill"
    private let cardID = "sync-fixture-card"

    private func fixtureRoot() -> [String: Any] {
        var root = URL(fileURLWithPath: #filePath)
        for _ in 0..<6 { root.deleteLastPathComponent() }
        let data = try! Data(contentsOf: root.appendingPathComponent("shared/fixtures/sync-d1-rows.json"))
        return try! #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    private func fixtureResponse() throws -> [String: Any] {
        try #require(fixtureRoot()["response"] as? [String: Any])
    }

    private func extendedFixtureResponse() throws -> [String: Any] {
        try #require(fixtureRoot()["extended_response"] as? [String: Any])
    }

    private func responseData(changes: [[String: Any]], cursor: Int = 6) throws -> Data {
        try JSONSerialization.data(withJSONObject: [
            "cursor": cursor, "has_more": false, "changes": changes,
            "server_time": "2026-10-22T00:00:00Z",
        ])
    }

    private func fixtureChange(table: String) throws -> [String: Any] {
        let changes = try #require(fixtureResponse()["changes"] as? [[String: Any]])
        return try #require(changes.first { $0["tbl"] as? String == table })
    }

    private func database() throws -> DatabaseManager {
        let manager = try DatabaseManager.inMemory()
        try manager.dbWriter.write { db in
            try db.execute(sql: """
                INSERT INTO banks (id,name) VALUES ('sync-fixture-bank','测试银行');
                INSERT INTO card_products (id,bank_id,bank_name,card_name,payment_due_type,payment_due_value)
                VALUES ('sync-fixture-product','sync-fixture-bank','测试银行','测试信用卡','after_billing',20);
                INSERT INTO card_holders (id,created_by,managed_by,name)
                VALUES ('sync-fixture-holder','sync-fixture-user','sync-fixture-user','测试用户');
                INSERT INTO credit_cards (id,holder_id,card_product_id,billing_day,credit_limit)
                VALUES ('sync-fixture-card','sync-fixture-holder','sync-fixture-product',5,50000);
                INSERT INTO bills (id,card_id,bill_month,due_date,bill_amount,status)
                VALUES ('sync-fixture-bill','sync-fixture-card','2026-10','2026-10-25',1000,'partial');
                INSERT INTO payments (id,bill_id,amount,paid_at,idempotency_key)
                VALUES ('sync-fixture-payment','sync-fixture-bill',100,'2026-10-20','sync-fixture-idempotency');
                """)
            try SyncMeta(key: "sync_cursor", value: "6").save(db)
            try SyncMeta(key: "last_synced_at", value: "before-sync").save(db)
        }
        return manager
    }

    private func engine(_ manager: DatabaseManager, handler: @escaping @Sendable (URLRequest) async throws -> Data) -> SyncEngine {
        let session = MockNetworkSession { request in
            let data = try await handler(request)
            return (data, HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
        }
        let client = ApiClient(baseURL: URL(string: "https://sync.example.test")!, session: session,
                               token: "fixture-token", useKeychain: false)
        return SyncEngine(dbManager: manager, apiClient: client)
    }

    private func edit(_ kind: String, in manager: DatabaseManager) async throws {
        switch kind {
        case "payment":
            try await PaymentService(dbManager: manager).recordPayment(billId: billID, amount: 900,
                                                                       paymentId: "optimistic-payment")
        case "bill":
            try await BillEditService(dbManager: manager).setBillAmountOverride(billId: billID, amount: 400)
        default:
            try await CardEditService(dbManager: manager).updateCard(cardId: cardID,
                input: CardUpdateInput(nameOverride: "离线备注", creditLimit: 88000))
        }
    }

    private func rejection(_ request: URLRequest, permanent: Bool) throws -> Data {
        let body = try #require(JSONSerialization.jsonObject(with: request.httpBody!) as? [String: Any])
        let mutations = try #require(body["mutations"] as? [[String: Any]])
        return try JSONSerialization.data(withJSONObject: ["results": mutations.map { mutation in
            ["id": mutation["id"]!, "ok": false, "permanent": permanent, "error": "fixture rejection"]
        }])
    }

    @Test("Raw D1 product rows without card_type decode with the credit default")
    func rawProductDecoding() throws {
        let row = try #require(fixtureChange(table: "card_products")["row"] as? [String: Any])
        #expect(row["card_type"] == nil)
        let product = try JSONDecoder().decode(CardProduct.self, from: JSONSerialization.data(withJSONObject: row))
        #expect(product.cardType == "credit")
        #expect(product.paymentDueType == .afterBilling)
    }

    @Test("The complete real D1 response persists all six supported tables")
    func rawD1Pull() async throws {
        let manager = try DatabaseManager.inMemory()
        let data = try JSONSerialization.data(withJSONObject: fixtureResponse())
        try await engine(manager) { _ in data }.pull()
        try await manager.dbWriter.read { (db: Database) throws -> Void in
            #expect(try Bank.fetchCount(db) == 1)
            #expect(try CardProduct.fetchOne(db, id: "sync-fixture-product")?.cardType == "credit")
            #expect(try CardHolder.fetchCount(db) == 1)
            #expect(try CreditCard.fetchCount(db) == 1)
            #expect(try Bill.fetchCount(db) == 1)
            #expect(try Payment.fetchCount(db) == 1)
            #expect(try SyncMeta.fetchOne(db, key: "sync_cursor")?.value == "6")
        }
    }

    @Test("A malformed known change is isolated so the rest of the page and the cursor still advance", arguments: ["missing-field", "missing-row", "wrong-id", "wrong-op"])
    func malformedChangeIsolated(kind: String) async throws {
        let manager = try database()
        var bad = try fixtureChange(table: "bills")
        var row = try #require(bad["row"] as? [String: Any])
        switch kind {
        case "missing-field": row.removeValue(forKey: "due_date"); bad["row"] = row
        case "missing-row": bad.removeValue(forKey: "row")
        case "wrong-id": row["id"] = "another-bill"; bad["row"] = row
        default: bad["op"] = "replace"
        }
        let good: [String: Any] = ["tbl": "banks", "row_id": "new-bank", "op": "upsert",
                                   "row": ["id": "new-bank", "name": "New bank"]]
        let data = try responseData(changes: [good, bad], cursor: 10)
        // 按条隔离：坏变更不拖垮整批，也不再让毒丸把游标永久卡住。
        try await engine(manager) { _ in data }.pull()
        try await manager.dbWriter.read { (db: Database) throws -> Void in
            // 同页好变更正常落库
            #expect(try Bank.fetchOne(db, id: "new-bank") != nil)
            // 游标必须前进，否则同一毒变更会被永久重放
            #expect(try SyncMeta.fetchOne(db, key: "sync_cursor")?.value == "10")
            #expect(try SyncMeta.fetchOne(db, key: "last_synced_at")?.value == "2026-10-22T00:00:00Z")
            // 被隔离的行留下记录，便于排查丢弃了什么
            let isolated = try SyncMeta.fetchOne(db, key: "sync_isolated_changes")?.value
            #expect(isolated?.contains(billID) == true)
        }
    }

    @Test("未知还款规则拒绝猜测默认到期日")
    func unknownDueRule() throws {
        var row = try #require(fixtureChange(table: "card_products")["row"] as? [String: Any])
        row["payment_due_type"] = "future-rule"
        let data = try JSONSerialization.data(withJSONObject: row)
        #expect(throws: (any Error).self) { try JSONDecoder().decode(CardProduct.self, from: data) }
    }

    @Test("坏行被隔离记录后游标仍前进，修正行从新游标继续应用不漏账")
    func correctedPageRecovers() async throws {
        let manager = try database()
        var bad = try fixtureChange(table: "bills")
        bad.removeValue(forKey: "row")
        let broken = try responseData(changes: [bad], cursor: 10)
        // 坏行被隔离而不是毒丸卡死：pull 不抛错，游标前进。
        try await engine(manager) { _ in broken }.pull()
        try await manager.dbWriter.read { (db: Database) throws -> Void in
            #expect(try SyncMeta.fetchOne(db, key: "sync_cursor")?.value == "10")
            let isolated = try SyncMeta.fetchOne(db, key: "sync_isolated_changes")?.value
            #expect(isolated?.contains(billID) == true)
        }
        // 修正行以新的服务端变更重新到达（游标 10 之后），照常落库。
        var corrected = try fixtureChange(table: "bills")
        var row = try #require(corrected["row"] as? [String: Any])
        row["bill_amount"] = 2000.0
        corrected["row"] = row
        let next = try responseData(changes: [corrected], cursor: 12)
        try await engine(manager) { request in
            let body = try #require(JSONSerialization.jsonObject(with: request.httpBody!) as? [String: Any])
            #expect(body["cursor"] as? Int == 10)
            return next
        }.pull()
        try await manager.dbWriter.read { (db: Database) throws -> Void in
            let bill = try Bill.fetchOne(db, id: billID)
            #expect(bill?.billAmount == 2000.0)
            #expect(try SyncMeta.fetchOne(db, key: "sync_cursor")?.value == "12")
        }
    }

    @Test("Unsupported server entities remain forward compatible")
    func unsupportedTable() async throws {
        let manager = try database()
        let data = try responseData(changes: [["tbl": "opportunity_definitions", "row_id": "opp-def-1", "op": "upsert"]], cursor: 7)
        try await engine(manager) { _ in data }.pull()
        try await manager.dbWriter.read { (db: Database) throws -> Void in
            #expect(try SyncMeta.fetchOne(db, key: "sync_cursor")?.value == "7")
        }
    }

    @Test("A successful empty pull refreshes freshness without changing its cursor")
    func successfulEmptyPull() async throws {
        let manager = try database()
        let empty = try responseData(changes: [])
        try await engine(manager) { _ in empty }.pull()
        try await manager.dbWriter.read { (db: Database) throws -> Void in
            #expect(try SyncMeta.fetchOne(db, key: "sync_cursor")?.value == "6")
            #expect(try SyncMeta.fetchOne(db, key: "last_synced_at")?.value == "2026-10-22T00:00:00Z")
        }
    }

    @Test("A non-advancing page cannot claim there are more changes")
    func nonAdvancingPage() async throws {
        let manager = try database()
        let data = try JSONSerialization.data(withJSONObject: [
            "cursor": 6, "has_more": true, "changes": [], "server_time": "2026-10-22T00:00:00Z",
        ])
        await #expect(throws: SyncError.self) { try await engine(manager) { _ in data }.pull() }
        try await manager.dbWriter.read { (db: Database) throws -> Void in
            #expect(try SyncMeta.fetchOne(db, key: "sync_cursor")?.value == "6")
            #expect(try SyncMeta.fetchOne(db, key: "last_synced_at")?.value == "before-sync")
        }
    }

    @Test("An empty pull still checks for a new local edit before confirming freshness")
    func mutationDuringEmptyPull() async throws {
        let manager = try database()
        let empty = try responseData(changes: [])
        let sync = engine(manager) { _ in
            try await edit("card", in: manager)
            return empty
        }
        await #expect(throws: SyncError.self) { try await sync.pull() }
        try await manager.dbWriter.read { (db: Database) throws -> Void in
            #expect(try CreditCard.fetchOne(db, id: cardID)?.creditLimit == 88000)
            #expect(try SyncMeta.fetchOne(db, key: "last_synced_at")?.value == "before-sync")
        }
    }

    @Test("Transient outbox failures cannot overwrite optimistic changes", arguments: ["payment", "bill", "card"])
    func transientFailure(kind: String) async throws {
        let manager = try database()
        try await edit(kind, in: manager)
        let remote = try JSONSerialization.data(withJSONObject: fixtureResponse())
        let sync = engine(manager) { request in
            if request.url?.path == "/api/sync/push" { return try rejection(request, permanent: false) }
            Issue.record("A pending outbox must block pull")
            return remote
        }
        await #expect(throws: (any Error).self) { try await sync.sync() }
        try await manager.dbWriter.read { (db: Database) throws -> Void in
            #expect(try MutationOutbox.fetchCount(db) == 1)
            #expect(try SyncMeta.fetchOne(db, key: "sync_cursor")?.value == "6")
            if kind == "payment" { #expect(try Bill.fetchOne(db, id: billID)?.status == "paid") }
            if kind == "bill" { #expect(try Bill.fetchOne(db, id: billID)?.billAmountOverride == 400) }
            if kind == "card" { #expect(try CreditCard.fetchOne(db, id: cardID)?.creditLimit == 88000) }
        }
    }

    @Test("A local mutation created during a pull also protects local data and the cursor")
    func mutationDuringPull() async throws {
        let manager = try database()
        let remote = try JSONSerialization.data(withJSONObject: fixtureResponse())
        let sync = engine(manager) { _ in
            try await edit("card", in: manager)
            return remote
        }
        await #expect(throws: (any Error).self) { try await sync.pull() }
        try await manager.dbWriter.read { (db: Database) throws -> Void in
            #expect(try CreditCard.fetchOne(db, id: cardID)?.creditLimit == 88000)
            #expect(try SyncMeta.fetchOne(db, key: "sync_cursor")?.value == "6")
        }
    }

    @Test("Permanent rejection of an unparseable mutation marks only that item and continues the batch")
    func unparseablePermanentRejection() async throws {
        let manager = try database()
        try await edit("payment", in: manager)
        // 未来版本/形状漂移的 mutation：argsJson 合法但 targetsForRejectedMutation 无法解析。
        try await manager.dbWriter.write { db in
            try MutationOutbox(id: "mut-unknown", name: "future.unknownMutation", argsJson: "[]").insert(db)
        }
        // 服务端对整批返回永久拒绝（已幂等记录，重放只会拿到同样结果）。
        let sync = engine(manager) { request in
            if request.url?.path == "/api/sync/push" { return try rejection(request, permanent: true) }
            throw URLError(.notConnectedToInternet)
        }
        // 解析失败只标记该条，绝不允许整个事务回滚或抛出中断其余条目。
        try await sync.push()
        try await manager.dbWriter.read { (db: Database) throws -> Void in
            // 解析失败条目保留并被标记
            let unknown = try MutationOutbox.fetchOne(db, id: "mut-unknown")
            #expect(unknown?.retryCount == 1)
            #expect(unknown?.lastError?.isEmpty == false)
            // 同批可解析的永久拒绝仍按原语义删除并回滚乐观状态
            let recordPayment = try MutationOutbox.filter(Column("name") == "bills.recordPayment").fetchAll(db)
            #expect(recordPayment.isEmpty)
            #expect(try Payment.fetchOne(db, id: "optimistic-payment") == nil)
            #expect(try Bill.fetchOne(db, id: billID)?.status == "partial")
        }
        // 重放拿到同样的永久结果时继续只标记该条，不再 throw（死锁回归）。
        try await sync.push()
        try await manager.dbWriter.read { (db: Database) throws -> Void in
            let unknown = try MutationOutbox.fetchOne(db, id: "mut-unknown")
            #expect(unknown?.retryCount == 2)
            #expect(try MutationOutbox.filter(Column("name") == "bills.recordPayment").fetchCount(db) == 0)
        }
    }

    @Test("Permanent rejections recover authoritative unchanged rows", arguments: ["payment", "bill", "card"])
    func permanentReconciliation(kind: String) async throws {
        let manager = try database()
        try await edit(kind, in: manager)
        let expectedTable = kind == "card" ? "credit_cards" : "bills"
        let expectedID = kind == "card" ? cardID : billID
        var changes = [try fixtureChange(table: expectedTable)]
        if kind == "payment" {
            changes.append(["tbl": "payments", "row_id": "optimistic-payment", "op": "delete"])
        }
        let data = try responseData(changes: changes)
        let sync = engine(manager) { request in
            if request.url?.path == "/api/sync/push" { return try rejection(request, permanent: true) }
            let body = try #require(JSONSerialization.jsonObject(with: request.httpBody!) as? [String: Any])
            let targets = try #require(body["reconcile"] as? [[String: String]])
            #expect(targets.contains(["tbl": expectedTable, "row_id": expectedID]))
            if kind == "payment" { #expect(targets.contains(["tbl": "payments", "row_id": "optimistic-payment"])) }
            #expect(body["cursor"] as? Int == 6)
            return data
        }
        try await sync.sync()
        try await manager.dbWriter.read { (db: Database) throws -> Void in
            #expect(try MutationOutbox.fetchCount(db) == 0)
            #expect(try Bill.fetchOne(db, id: billID)?.billAmountOverride == nil)
            #expect(try Bill.fetchOne(db, id: billID)?.status == "partial")
            #expect(try CreditCard.fetchOne(db, id: cardID)?.creditLimit == 50000)
            #expect(try Payment.fetchOne(db, id: "optimistic-payment") == nil)
            #expect(try SyncMeta.fetchOne(db, key: "sync_reconcile_targets")?.value == "[]")
        }
    }

    @Test("Reconciliation survives interrupted pull and a new sync engine")
    func recoveryAfterRestart() async throws {
        let manager = try database()
        try await edit("card", in: manager)
        let first = engine(manager) { request in
            if request.url?.path == "/api/sync/push" { return try rejection(request, permanent: true) }
            throw URLError(.notConnectedToInternet)
        }
        await #expect(throws: (any Error).self) { try await first.sync() }
        try await manager.dbWriter.read { (db: Database) throws -> Void in
            #expect(try MutationOutbox.fetchCount(db) == 0)
            #expect(try SyncMeta.fetchOne(db, key: "sync_reconcile_targets")?.value.contains("credit_cards") == true)
        }
        let authoritative = try responseData(changes: [fixtureChange(table: "credit_cards")])
        let second = engine(manager) { _ in authoritative }
        try await second.sync()
        try await manager.dbWriter.read { (db: Database) throws -> Void in
            #expect(try CreditCard.fetchOne(db, id: cardID)?.creditLimit == 50000)
            #expect(try SyncMeta.fetchOne(db, key: "sync_reconcile_targets")?.value == "[]")
        }
    }

    @Test("Missing authoritative replies cannot discard queued recovery")
    func missingReconcileResponse() async throws {
        let manager = try database()
        try await edit("bill", in: manager)
        let empty = try responseData(changes: [])
        let sync = engine(manager) { request in
            if request.url?.path == "/api/sync/push" { return try rejection(request, permanent: true) }
            return empty
        }
        await #expect(throws: (any Error).self) { try await sync.sync() }
        try await manager.dbWriter.read { (db: Database) throws -> Void in
            #expect(try SyncMeta.fetchOne(db, key: "sync_reconcile_targets")?.value.contains("bills") == true)
            #expect(try SyncMeta.fetchOne(db, key: "sync_cursor")?.value == "6")
        }
    }

    @Test("15 SYNCABLE_TABLES complete pull upsert and delete including user_id primary keys")
    func full15TablesPullUpsertAndDelete() async throws {
        let manager = try DatabaseManager.inMemory()
        let extended = try extendedFixtureResponse()
        let upsertData = try JSONSerialization.data(withJSONObject: extended)
        try await engine(manager) { _ in upsertData }.pull()

        try await manager.dbWriter.read { (db: Database) throws -> Void in
            #expect(try Bank.fetchCount(db) == 1)
            #expect(try CardProduct.fetchCount(db) == 1)
            #expect(try BenefitRecord.fetchCount(db) == 1)
            #expect(try PromoRecord.fetchCount(db) == 1)
            #expect(try CardHolder.fetchCount(db) == 1)
            #expect(try CreditAccount.fetchCount(db) == 1)
            #expect(try CreditCard.fetchCount(db) == 1)
            #expect(try Bill.fetchCount(db) == 1)
            #expect(try BillCardSubtotal.fetchCount(db) == 1)
            #expect(try Payment.fetchCount(db) == 1)
            #expect(try UserPreferenceRecord.fetchCount(db) == 1)
            #expect(try NotificationPreferenceRecord.fetchCount(db) == 1)
            #expect(try RecurringPayableRecord.fetchCount(db) == 1)
            #expect(try RecurringPayablePaymentRecord.fetchCount(db) == 1)
            #expect(try PayableCustomCategoryRecord.fetchCount(db) == 1)

            let bank = try #require(try Bank.fetchOne(db, id: "sync-fixture-bank"))
            #expect(bank.fullName == "测试银行股份有限公司")
            #expect(bank.country == "CN")
            #expect(bank.customerServicePhone == "95555")
            #expect(bank.tel == "95555")
            #expect(bank.websiteUrl == "https://example.test")
            #expect(bank.isActive == true)

            let product = try #require(try CardProduct.fetchOne(db, id: "sync-fixture-product"))
            #expect(product.cardImageId == "img-card-1")
            #expect(product.cardArtUrl == "img-card-1")
            #expect(product.annualFeeWaiver == "年刷 6 笔免年费")
            #expect(product.rewardsSummary == "境外消费 3% 返现")
            #expect(product.isActive == true)

            let card = try #require(try CreditCard.fetchOne(db, id: "sync-fixture-card"))
            #expect(card.accountId == "sync-fixture-account")
            #expect(card.creditLimit == 50000.0)
            #expect(card.creditLimitOverride == 80000.0)
            #expect(card.effectiveCreditLimit == 80000.0)
            #expect(card.issuedOn == "2025-05-01")
            #expect(card.activatedOn == "2025-05-10")

            let bill = try #require(try Bill.fetchOne(db, id: "sync-fixture-bill"))
            #expect(bill.accountId == "sync-fixture-account")
            #expect(bill.effectiveMinPayment == 120.0)
            #expect(bill.effectiveDueDate == "2026-10-26")
            #expect(bill.effectiveStatementDate == "2026-10-06")

            let userPref = try #require(
                try UserPreferenceRecord.filter(Column("user_id") == "sync-fixture-user").fetchOne(db)
            )
            let display = userPref.decodedDisplayConfig()
            #expect(display.privacyMode == true)
            #expect(display.showMinPayment == false)
            #expect(display.defaultCurrency == "USD")

            let notifPref = try #require(
                try NotificationPreferenceRecord.filter(Column("user_id") == "sync-fixture-user").fetchOne(db)
            )
            #expect(notifPref.billDueEnabled == true)
            #expect(notifPref.notifyTime == "09:30")

            let payable = try #require(try RecurringPayableRecord.fetchOne(db, id: "sync-fixture-payable"))
            #expect(payable.cycleType == "every_n_months")
            #expect(payable.cycleMonths == 3)
            #expect(payable.anchorPeriod == "2026-10")
            #expect(payable.customCategory == "物业费")
            #expect(payable.bankAccount == "622200001234")
            #expect(payable.isActive == true)

            #expect(try SyncMeta.fetchOne(db, key: "sync_cursor")?.value == "15")
            #expect(try SyncMeta.fetchOne(db, key: "sync_isolated_changes") == nil)
        }

        // Now send delete operations for all 15 tables (even in parent-before-child order to verify topological ordering)
        let originalChanges = try #require(extended["changes"] as? [[String: Any]])
        let deleteChanges: [[String: Any]] = originalChanges.map { change in
            ["tbl": change["tbl"]!, "row_id": change["row_id"]!, "op": "delete"]
        }
        let deleteData = try responseData(changes: deleteChanges, cursor: 30)
        try await engine(manager) { _ in deleteData }.pull()

        try await manager.dbWriter.read { (db: Database) throws -> Void in
            #expect(try Bank.fetchCount(db) == 0)
            #expect(try CardProduct.fetchCount(db) == 0)
            #expect(try BenefitRecord.fetchCount(db) == 0)
            #expect(try PromoRecord.fetchCount(db) == 0)
            #expect(try CardHolder.fetchCount(db) == 0)
            #expect(try CreditAccount.fetchCount(db) == 0)
            #expect(try CreditCard.fetchCount(db) == 0)
            #expect(try Bill.fetchCount(db) == 0)
            #expect(try BillCardSubtotal.fetchCount(db) == 0)
            #expect(try Payment.fetchCount(db) == 0)
            #expect(try UserPreferenceRecord.fetchCount(db) == 0)
            #expect(try NotificationPreferenceRecord.fetchCount(db) == 0)
            #expect(try RecurringPayableRecord.fetchCount(db) == 0)
            #expect(try RecurringPayablePaymentRecord.fetchCount(db) == 0)
            #expect(try PayableCustomCategoryRecord.fetchCount(db) == 0)
            #expect(try SyncMeta.fetchOne(db, key: "sync_cursor")?.value == "30")
            #expect(try SyncMeta.fetchOne(db, key: "sync_isolated_changes") == nil)
        }
    }

    @Test("v1 -> v2 migration preserves v1 rows, adds parity columns/tables and resets existing sync_cursor")
    func v1ToV2MigrationRegression() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let dbURL = root.appendingPathComponent("legacy-v1.sqlite")

        // Create a real v1-only database using v1_initial_schema DDL and seed v1 rows + sync_cursor='42'
        do {
            var v1Config = Configuration()
            v1Config.foreignKeysEnabled = true
            let queue = try DatabaseQueue(path: dbURL.path, configuration: v1Config)
            var v1Migrator = DatabaseMigrator()
            v1Migrator.registerMigration("v1_initial_schema") { db in
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
            try v1Migrator.migrate(queue)
            try queue.write { db in
                try db.execute(sql: """
                    INSERT INTO banks (id, name, short_name, tel) VALUES ('b-v1', '招商银行', '招行', '95555');
                    INSERT INTO card_products (id, bank_id, bank_name, card_name, payment_due_type, payment_due_value, card_art_url)
                    VALUES ('p-v1', 'b-v1', '招商银行', '经典白', 'after_billing', 18, 'images/classic');
                    INSERT INTO card_holders (id, created_by, managed_by, name) VALUES ('h-v1', 'u-1', 'u-1', '张三');
                    INSERT INTO credit_cards (id, holder_id, card_product_id, billing_day, credit_limit)
                    VALUES ('c-v1', 'h-v1', 'p-v1', 5, 60000);
                    INSERT INTO bills (id, card_id, bill_month, due_date, bill_amount, status)
                    VALUES ('bill-v1', 'c-v1', '2026-09', '2026-09-23', 2500, 'partial');
                    INSERT INTO payments (id, bill_id, amount, paid_at, idempotency_key)
                    VALUES ('pay-v1', 'bill-v1', 500, '2026-09-10', 'idem-v1');
                    INSERT INTO sync_meta (key, value) VALUES ('sync_cursor', '42'), ('sync_client_id', 'cid-v1');
                """)
            }
        }

        // Reopen via DatabaseManager -> executes v2_syncable_parity
        let upgraded = try DatabaseManager.file(at: dbURL, fileManager: .default, requiresProtectionReadback: false)
        try upgraded.dbWriter.read { db in
            let bank = try #require(try Bank.fetchOne(db, id: "b-v1"))
            #expect(bank.tel == "95555")
            #expect(bank.customerServicePhone == "95555")
            #expect(bank.country == "CN")
            #expect(bank.isActive == true)

            let product = try #require(try CardProduct.fetchOne(db, id: "p-v1"))
            #expect(product.cardArtUrl == "images/classic")
            #expect(product.cardImageId == "images/classic")
            #expect(product.isActive == true)

            let card = try #require(try CreditCard.fetchOne(db, id: "c-v1"))
            #expect(card.effectiveCreditLimit == 60000)
            #expect(card.accountId == nil)

            let bill = try #require(try Bill.fetchOne(db, id: "bill-v1"))
            #expect(bill.effectiveDueDate == "2026-09-23")

            // Cursor must reset to "0" so upgraded app backfills 15 tables & new columns
            #expect(try SyncMeta.fetchOne(db, key: "sync_cursor")?.value == "0")
            #expect(try SyncMeta.fetchOne(db, key: "sync_client_id")?.value == "cid-v1")

            let tables = try String.fetchAll(db, sql: """
                SELECT name FROM sqlite_master
                WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != 'grdb_migrations'
            """)
            for expected in [
                "credit_accounts", "bill_card_subtotals", "benefits", "promos",
                "user_preferences", "notification_preferences", "recurring_payables",
                "recurring_payable_payments", "payable_custom_categories"
            ] {
                #expect(tables.contains(expected))
            }
        }
    }

    @Test("clearUserData wipes every single business and sync table reflected from sqlite_master")
    func sqliteMasterFullWipeAssertion() async throws {
        let manager = try DatabaseManager.inMemory()
        let extendedData = try JSONSerialization.data(withJSONObject: try extendedFixtureResponse())
        try await engine(manager) { _ in extendedData }.pull()

        try await manager.dbWriter.write { db in
            try MutationOutbox(id: "mut-wipe", name: "bills.updateBillFields", argsJson: "[]").insert(db)
            try SyncMeta(key: "sync_client_id", value: "client-wipe").save(db)
        }

        let reflectedTablesBefore = try await manager.dbWriter.read { db in
            try String.fetchAll(db, sql: """
                SELECT name FROM sqlite_master
                WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != 'grdb_migrations'
                ORDER BY name
            """)
        }
        #expect(reflectedTablesBefore.count == 17)

        for table in reflectedTablesBefore {
            let count = try await manager.dbWriter.read { db in
                try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM \"\(table)\"") ?? -1
            }
            #expect(count > 0, Comment(rawValue: "Table \(table) must be populated before clearUserData()"))
        }

        try await manager.clearUserData()

        for table in reflectedTablesBefore {
            let count = try await manager.dbWriter.read { db in
                try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM \"\(table)\"") ?? -1
            }
            #expect(count == 0, Comment(rawValue: "Table \(table) leaked rows after clearUserData()"))
        }
    }

    @Test("Permanent rejections of Phase 1 offline mutations clean outbox without deadlock")
    func phase1OfflineMutationsPermanentRejectionDoesNotDeadlock() async throws {
        let manager = try database()
        try await manager.dbWriter.write { db in
            try UserPreferenceRecord(userId: "u-pref-1").insert(db)
            try RecurringPayableRecord(
                id: "pay-rec-1", createdBy: "u-pref-1", name: "房租", amount: 2000, dueDay: 5
            ).insert(db)
            try MutationOutbox(id: "m1", name: "bills.updateBillFields", argsJson: #"["\#(billID)",{"amount":500}]"#).insert(db)
            try MutationOutbox(id: "m2", name: "bills.clearOverride", argsJson: #"["\#(billID)",["amount"]]"#).insert(db)
            try MutationOutbox(id: "m3", name: "payments.updatePayment", argsJson: #"["sync-fixture-payment",{"amount":120}]"#).insert(db)
            try MutationOutbox(id: "m4", name: "payables.createRecurringPayable", argsJson: #"[{"name":"车贷","category":"loan","amount":1000,"currency":"CNY","due_day":10}]"#).insert(db)
            try MutationOutbox(id: "m5", name: "payables.updateRecurringPayable", argsJson: #"["pay-rec-1",{"amount":2200}]"#).insert(db)
            try MutationOutbox(id: "m6", name: "notifications.markNotificationRead", argsJson: #"["","notif-1"]"#).insert(db)
            try MutationOutbox(id: "m7", name: "notifications.markAllNotificationsRead", argsJson: #"[""]"#).insert(db)
            try MutationOutbox(id: "m8", name: "preferences.updateUserPreferences", argsJson: #"["u-pref-1",{"display_config":{"privacy_mode":true}}]"#).insert(db)
        }

        let sync = engine(manager) { request in
            if request.url?.path == "/api/sync/push" { return try self.rejection(request, permanent: true) }
            throw URLError(.notConnectedToInternet)
        }
        try await sync.push()

        try await manager.dbWriter.read { db in
            #expect(try MutationOutbox.fetchCount(db) == 0)
            let rawTargets = try SyncMeta.fetchOne(db, key: "sync_reconcile_targets")?.value ?? "[]"
            let targets = try JSONDecoder().decode([SyncReconcileTarget].self, from: Data(rawTargets.utf8))
            #expect(targets.contains(SyncReconcileTarget(tbl: "bills", rowId: billID)))
            #expect(targets.contains(SyncReconcileTarget(tbl: "payments", rowId: "sync-fixture-payment")))
            #expect(targets.contains(SyncReconcileTarget(tbl: "recurring_payables", rowId: "pay-rec-1")))
            #expect(targets.contains(SyncReconcileTarget(tbl: "user_preferences", rowId: "u-pref-1")))
            // Non-syncable or server-generated mutations must not insert empty or invalid targets
            #expect(targets.allSatisfy { !$0.rowId.isEmpty && $0.tbl != "notification_history" })
        }
    }
}
