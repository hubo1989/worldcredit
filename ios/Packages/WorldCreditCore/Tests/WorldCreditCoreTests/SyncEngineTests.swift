import Foundation
import Testing
import GRDB
import UserNotifications
@testable import WorldCreditCore

final class MockNotificationCenter: NotificationCenterProtocol, @unchecked Sendable {
    var requests: [UNNotificationRequest] = []

    func add(_ request: UNNotificationRequest) async throws {
        requests.append(request)
    }

    func removePendingNotificationRequests(withIdentifiers identifiers: [String]) {
        requests.removeAll { identifiers.contains($0.identifier) }
    }

    func removeAllPendingNotificationRequests() {
        requests.removeAll()
    }

    func pendingNotificationRequests() async -> [UNNotificationRequest] {
        requests
    }
}

final class MockNetworkSession: NetworkSession, @unchecked Sendable {
    var handler: @Sendable (URLRequest) async throws -> (Data, URLResponse)

    init(handler: @escaping @Sendable (URLRequest) async throws -> (Data, URLResponse)) {
        self.handler = handler
    }

    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        try await handler(request)
    }
}

@Suite("Sync Engine & Offline Payment Suite")
struct SyncEngineTests {

    private func makeTestDatabase() throws -> DatabaseManager {
        let dbManager = try DatabaseManager.inMemory()
        try dbManager.dbWriter.write { db in
            // Seed a minimal holder, product, card, and bill
            try db.execute(sql: """
            INSERT INTO banks (id, name, short_name) VALUES ('b-cmb', '招商银行', '招行');
            INSERT INTO card_products (id, bank_id, bank_name, card_name, payment_due_type, payment_due_value)
            VALUES ('cp-classic', 'b-cmb', '招商银行', '经典白金卡', 'after_billing', 18);
            INSERT INTO card_holders (id, created_by, managed_by, name)
            VALUES ('h-1', 'u-admin', 'u-admin', '测试持卡人');
            INSERT INTO credit_cards (id, holder_id, card_product_id, billing_day, credit_limit, card_number_last4)
            VALUES ('c-1', 'h-1', 'cp-classic', 10, 50000, '8888');
            INSERT INTO bills (id, card_id, bill_month, statement_date, due_date, bill_amount, status)
            VALUES ('b-100', 'c-1', '2026-10', '2026-10-10', '2026-10-28', 1000.0, 'unpaid');
            """)
        }
        return dbManager
    }

    @Test("PaymentService records offline payment and updates bill status")
    func testRecordPayment() async throws {
        let dbManager = try makeTestDatabase()
        let paymentService = PaymentService(dbManager: dbManager)

        // 1. Partial payment: 400 out of 1000
        let p1 = try await paymentService.recordPayment(
            billId: "b-100",
            amount: 400.0,
            paidAt: "2026-10-15",
            channel: "微信支付",
            note: "第一笔"
        )
        #expect(p1.billId == "b-100")
        #expect(p1.amount == 400.0)

        // Verify SQLite state
        try await dbManager.dbWriter.read { db in
            let bill = try Bill.fetchOne(db, id: "b-100")
            #expect(bill?.status == "partial")

            let outbox = try MutationOutbox.fetchAll(db)
            #expect(outbox.count == 1)
            #expect(outbox[0].name == "bills.recordPayment")
            #expect(outbox[0].argsJson.contains("第一笔"))
        }

        // 2. Summary check
        let summary = try await paymentService.getPaymentSummary(billId: "b-100")
        #expect(summary.totalPaid == 400.0)
        #expect(summary.remainingDue == 600.0)
        #expect(summary.payments.count == 1)

        // 3. Second payment to settle remaining: 600
        _ = try await paymentService.recordPayment(
            billId: "b-100",
            amount: 600.0,
            paidAt: "2026-10-16"
        )

        try await dbManager.dbWriter.read { db in
            let bill = try Bill.fetchOne(db, id: "b-100")
            #expect(bill?.status == "paid")

            let outbox = try MutationOutbox.fetchAll(db)
            #expect(outbox.count == 2)
        }

        // 4. Overpayment rejection
        await #expect(throws: PaymentError.billAlreadyPaid) {
            try await paymentService.recordPayment(billId: "b-100", amount: 100.0)
        }
    }

    @Test("PaymentService rejects overpayments and zero/negative amounts")
    func testPaymentValidation() async throws {
        let dbManager = try makeTestDatabase()
        let paymentService = PaymentService(dbManager: dbManager)

        // Negative
        await #expect(throws: PaymentError.invalidAmount(-50.0)) {
            try await paymentService.recordPayment(billId: "b-100", amount: -50.0)
        }

        // Zero
        await #expect(throws: PaymentError.invalidAmount(0.0)) {
            try await paymentService.recordPayment(billId: "b-100", amount: 0.0)
        }

        // Overpayment (bill is 1000, attempt to pay 1001)
        await #expect(throws: PaymentError.overpayment(remaining: 1000.0, requested: 1001.0)) {
            try await paymentService.recordPayment(billId: "b-100", amount: 1001.0)
        }
    }

    @Test("SyncEngine pulls changes and updates local SQLite and cursor")
    func testSyncPull() async throws {
        let dbManager = try makeTestDatabase()

        let pullJson = """
        {
            "cursor": 15,
            "has_more": false,
            "server_time": "2026-10-21T15:00:00.000Z",
            "changes": [
                {
                    "tbl": "banks",
                    "row_id": "b-icbc",
                    "op": "upsert",
                    "row": {
                        "id": "b-icbc",
                        "name": "中国工商银行",
                        "short_name": "工行"
                    }
                },
                {
                    "tbl": "bills",
                    "row_id": "b-100",
                    "op": "delete",
                    "row": null
                }
            ]
        }
        """

        let mockSession = MockNetworkSession { req in
            #expect(req.url?.path.contains("/api/sync/pull") == true)
            #expect(req.value(forHTTPHeaderField: "Authorization") == "Bearer mock-token")
            let response = HTTPURLResponse(url: req.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            return (Data(pullJson.utf8), response)
        }

        let apiClient = ApiClient(baseURL: URL(string: "https://test.local")!, session: mockSession, token: "mock-token")
        let syncEngine = SyncEngine(dbManager: dbManager, apiClient: apiClient)

        try await syncEngine.pull()

        try await dbManager.dbWriter.read { db in
            // Bank inserted
            let bank = try Bank.fetchOne(db, id: "b-icbc")
            #expect(bank?.name == "中国工商银行")

            // Bill deleted
            let bill = try Bill.fetchOne(db, id: "b-100")
            #expect(bill == nil)

            // Cursor updated
            let cursor = try SyncMeta.fetchOne(db, key: "sync_cursor")
            #expect(cursor?.value == "15")

            let lastSynced = try SyncMeta.fetchOne(db, key: "last_synced_at")
            #expect(lastSynced?.value == "2026-10-21T15:00:00.000Z")
        }
    }

    @Test("SyncEngine pushes outbox and cleans up on success")
    func testSyncPushSuccess() async throws {
        let dbManager = try makeTestDatabase()
        let paymentService = PaymentService(dbManager: dbManager)

        _ = try await paymentService.recordPayment(billId: "b-100", amount: 500.0)

        let mockSession = MockNetworkSession { req in
            #expect(req.url?.path.contains("/api/sync/push") == true)
            let body = try JSONSerialization.jsonObject(with: req.httpBody!) as! [String: Any]
            let mutations = body["mutations"] as! [[String: Any]]
            #expect(mutations.count == 1)
            let mutId = mutations[0]["id"] as! String

            let pushJson = """
            {
                "results": [
                    { "id": "\(mutId)", "ok": true }
                ]
            }
            """
            let response = HTTPURLResponse(url: req.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            return (Data(pushJson.utf8), response)
        }

        let apiClient = ApiClient(baseURL: URL(string: "https://test.local")!, session: mockSession, token: "mock-token")
        let syncEngine = SyncEngine(dbManager: dbManager, apiClient: apiClient)

        try await syncEngine.push()

        try await dbManager.dbWriter.read { db in
            let outbox = try MutationOutbox.fetchAll(db)
            #expect(outbox.isEmpty)

            let payment = try Payment.fetchAll(db)
            #expect(payment.count == 1)

            let bill = try Bill.fetchOne(db, id: "b-100")
            #expect(bill?.status == "partial")
        }
    }

    @Test("SyncEngine silently rolls back optimistic payment on permanent conflict")
    func testSyncPushPermanentRollback() async throws {
        let dbManager = try makeTestDatabase()
        let paymentService = PaymentService(dbManager: dbManager)

        // Optimistically record 500
        let payment = try await paymentService.recordPayment(billId: "b-100", amount: 500.0)

        try await dbManager.dbWriter.read { db in
            let bill = try Bill.fetchOne(db, id: "b-100")
            #expect(bill?.status == "partial")
            let payments = try Payment.fetchAll(db)
            #expect(payments.count == 1)
        }

        let mockSession = MockNetworkSession { req in
            let body = try JSONSerialization.jsonObject(with: req.httpBody!) as! [String: Any]
            let mutations = body["mutations"] as! [[String: Any]]
            let mutId = mutations[0]["id"] as! String

            // Server rejects permanently (e.g. bill was already paid on web)
            let pushJson = """
            {
                "results": [
                    {
                        "id": "\(mutId)",
                        "ok": false,
                        "permanent": true,
                        "error": "该账单已无应还金额，无需重复还款"
                    }
                ]
            }
            """
            let response = HTTPURLResponse(url: req.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            return (Data(pushJson.utf8), response)
        }

        let apiClient = ApiClient(baseURL: URL(string: "https://test.local")!, session: mockSession, token: "mock-token")
        let syncEngine = SyncEngine(dbManager: dbManager, apiClient: apiClient)

        // Push should silently rollback the optimistic payment and clear outbox
        try await syncEngine.push()

        try await dbManager.dbWriter.read { db in
            // Outbox cleared
            let outbox = try MutationOutbox.fetchAll(db)
            #expect(outbox.isEmpty)

            // Optimistic payment deleted
            let payments = try Payment.filter(Column("id") == payment.id).fetchAll(db)
            #expect(payments.isEmpty)

            // Bill status rolled back to unpaid
            let bill = try Bill.fetchOne(db, id: "b-100")
            #expect(bill?.status == "unpaid")
        }
    }

    @Test("NotificationScheduler schedules upcoming bill reminders and clears on payment")
    func testNotificationScheduling() async throws {
        let dbManager = try makeTestDatabase()
        let mockCenter = MockNotificationCenter()
        let scheduler = NotificationScheduler(dbManager: dbManager, center: mockCenter)
        let paymentService = PaymentService(dbManager: dbManager)

        // b-100 due date is 2026-10-28
        let calendar = Calendar(identifier: .gregorian)
        var comp = DateComponents()
        comp.year = 2026
        comp.month = 10
        comp.day = 20
        comp.hour = 8
        let testToday = calendar.date(from: comp)!

        try await scheduler.rescheduleAll(today: testToday, calendar: calendar)

        // Should schedule both due-date (10-28) and 3-days-before (10-25)
        #expect(mockCenter.requests.count == 2)
        #expect(mockCenter.requests.contains { $0.identifier == "bill-due-b-100" })
        #expect(mockCenter.requests.contains { $0.identifier == "bill-3d-b-100" })

        // Fully pay the bill
        _ = try await paymentService.recordPayment(billId: "b-100", amount: 1000.0)

        // Reschedule
        try await scheduler.rescheduleAll(today: testToday, calendar: calendar)

        // All notifications for b-100 cleared because it's settled!
        #expect(mockCenter.requests.isEmpty)
    }

    @Test("QueryService fetches dashboard summary and bills with correct calculations")
    func testQueryService() async throws {
        let dbManager = try makeTestDatabase()
        let queryService = QueryService(dbManager: dbManager)

        let calendar = Calendar(identifier: .gregorian)
        var comp = DateComponents()
        comp.year = 2026
        comp.month = 10
        comp.day = 22
        let today = calendar.date(from: comp)!

        // Dashboard summary
        let summary = try await queryService.fetchDashboardSummary(today: today)
        #expect(summary.totalDebt == 1000.0)
        #expect(summary.overdueCount == 0) // Due is 10-28, today is 10-22 (6 days)
        #expect(summary.totalCreditLimit == 50000.0)
        #expect(summary.urgentBills.count == 1) // 6 days away <= 7

        // Bills
        let bills = try await queryService.fetchBills(filter: .unpaid, today: today)
        #expect(bills.count == 1)
        #expect(bills[0].cardTitle == "经典白金卡")
        #expect(bills[0].remainingAmount == 1000.0)
        #expect(bills[0].daysUntilDue == 6)
        #expect(bills[0].isOverdue == false)

        // Cards
        let cards = try await queryService.fetchCards(today: today)
        #expect(cards.count == 1)
        #expect(cards[0].displayName == "经典白金卡")
        #expect(cards[0].interestFreeDaysToday > 0)
    }

    @Test("WatchSnapshot encodes, decodes and calculates dynamic countdown offline")
    func testWatchSnapshot() async throws {
        let dbManager = try makeTestDatabase()
        let snapshotManager = WatchSnapshotManager.shared

        let calendar = Calendar(identifier: .gregorian)
        var comp = DateComponents()
        comp.year = 2026
        comp.month = 10
        comp.day = 22
        let today = calendar.date(from: comp)!

        let snapshot = try await snapshotManager.buildSnapshot(dbManager: dbManager, today: today)

        #expect(snapshot.totalDebt == 1000.0)
        #expect(snapshot.bills.count == 1)
        #expect(snapshot.cards.count == 1)
        #expect(snapshot.calendarEvents.count == 1)

        let bill = snapshot.bills[0]
        #expect(bill.id == "b-100")
        #expect(bill.remainingAmount == 1000.0)
        #expect(bill.daysUntilDue(today: today, calendar: calendar) == 6)
        #expect(bill.isOverdue(today: today, calendar: calendar) == false)

        // 7 days later: 2026-10-29 (due date was 10-28)
        var futureComp = DateComponents()
        futureComp.year = 2026
        futureComp.month = 10
        futureComp.day = 29
        let futureDate = calendar.date(from: futureComp)!

        #expect(bill.daysUntilDue(today: futureDate, calendar: calendar) == -1)
        #expect(bill.isOverdue(today: futureDate, calendar: calendar) == true)
        #expect(bill.distanceLabel(today: futureDate, calendar: calendar) == "逾期 1 日")

        // Encode / decode test
        let data = try JSONEncoder().encode(snapshot)
        let decoded = try JSONDecoder().decode(WatchSnapshot.self, from: data)
        #expect(decoded.bills.count == 1)
        #expect(decoded.totalDebt == 1000.0)
    }
}
