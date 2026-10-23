import Foundation
import Testing
import GRDB
import UserNotifications
@testable import WorldCreditCore

private final class DomainNotificationCenter: NotificationCenterProtocol, @unchecked Sendable {
    enum Failure: Error { case denied }
    var requests: [UNNotificationRequest] = []
    var rejectedIdentifiers: Set<String> = []
    var onAdd: (@Sendable () async throws -> Void)?

    func add(_ request: UNNotificationRequest) async throws {
        if rejectedIdentifiers.contains(request.identifier) { throw Failure.denied }
        try await onAdd?()
        requests.append(request)
    }
    func removePendingNotificationRequests(withIdentifiers identifiers: [String]) {
        requests.removeAll { identifiers.contains($0.identifier) }
    }
    func removeAllPendingNotificationRequests() { requests.removeAll() }
    func pendingNotificationRequests() async -> [UNNotificationRequest] { requests }
}

@Suite("PR42 domain regressions")
struct DomainRegressionTests {
    private func database() throws -> DatabaseManager {
        let manager = try DatabaseManager.inMemory()
        try manager.dbWriter.write { db in
            try db.execute(sql: """
                INSERT INTO banks (id, name) VALUES ('bank', '测试银行');
                INSERT INTO card_products (id, bank_id, bank_name, card_name, payment_due_type, payment_due_value)
                VALUES ('product', 'bank', '测试银行', '测试卡', 'after_billing', 18);
                INSERT INTO card_holders (id, created_by, managed_by, name) VALUES ('holder', 'user', 'user', '测试');
                INSERT INTO credit_cards (id, holder_id, card_product_id, billing_day, override_due_type, override_due_value)
                VALUES ('card', 'holder', 'product', 10, 'fixed', 25);
                """)
        }
        return manager
    }

    private func instant(_ value: String) -> Date { ISO8601DateFormatter().date(from: value)! }

    @Test("Billing date calculations use Shanghai midnight across device timezones")
    func shanghaiDates() {
        let today = instant("2026-10-22T16:30:00Z") // Shanghai Oct 23, LA Oct 22
        let due = instant("2026-10-22T16:00:00Z")
        #expect(BillingDateCalculator.diffInCalendarDays(target: due, today: today) == 0)
        #expect(BillingDateCalculator.diffInCalendarDays(target: due, today: instant("2026-10-22T15:30:00Z")) == 1)
        #expect(BillingDateCalculator.getActualBillingDate(billingDay: 1, month: instant("2026-10-31T16:30:00Z")) == instant("2026-10-31T16:00:00Z"))
        #expect(BillingDateCalculator.getLoanNextDueDate(loanDueDay: 23, today: today) == due)
        #expect(BillingDateCalculator.diffInCalendarDays(target: due, today: instant("2026-10-23T16:30:00Z")) == -1)
    }

    @Test("Watch countdown parses business dates in Shanghai even on UTC+14 devices")
    func watchCountdown() {
        var deviceCalendar = Calendar(identifier: .gregorian)
        deviceCalendar.timeZone = TimeZone(identifier: "Pacific/Kiritimati")!
        let bill = WatchBillItem(id: "bill", bankName: "银行", cardTitle: "卡", last4: "1234", holderName: "测试", dueDate: "2026-10-23", billAmount: 100, remainingAmount: 100)
        let today = instant("2026-10-22T16:30:00Z")
        #expect(bill.daysUntilDue(today: today, calendar: deviceCalendar) == 0)
        #expect(!bill.isOverdue(today: today, calendar: deviceCalendar))
        #expect(bill.distanceLabel(today: today, calendar: deviceCalendar) == "今天还款日")
    }

    @Test("Clearing a due override updates SQLite and sends two explicit JSON nulls")
    func clearDueOverride() async throws {
        let manager = try database()
        let service = CardEditService(dbManager: manager)
        var input = CardUpdateInput()
        input.clearDueOverride = true
        let card = try await service.updateCard(cardId: "card", input: input)
        #expect(card.overrideDueType == nil)
        #expect(card.overrideDueValue == nil)
        try await manager.dbWriter.read { db in
            let stored = try #require(try CreditCard.fetchOne(db, id: "card"))
            #expect(stored.overrideDueType == nil)
            #expect(stored.overrideDueValue == nil)
            let product = try #require(try CardProduct.fetchOne(db, id: "product"))
            #expect(BillingDateCalculator.getEffectiveDueConfig(card: stored, cardProduct: product) == DueConfig(type: .afterBilling, value: 18))
            let mutation = try #require(try MutationOutbox.fetchAll(db).first)
            let args = try #require(try JSONSerialization.jsonObject(with: Data(mutation.argsJson.utf8)) as? [Any])
            let patch = try #require(args[1] as? [String: Any])
            #expect(patch["override_due_type"] is NSNull)
            #expect(patch["override_due_value"] is NSNull)
        }
    }

    @Test("Omitted due override fields retain values and stay absent from the patch")
    func unchangedDueOverride() async throws {
        let manager = try database()
        let card = try await CardEditService(dbManager: manager).updateCard(cardId: "card", input: CardUpdateInput(creditLimit: 500))
        #expect(card.overrideDueType == .fixed)
        #expect(card.overrideDueValue == 25)
        try await manager.dbWriter.read { db in
            let mutation = try #require(try MutationOutbox.fetchAll(db).first)
            let args = try #require(try JSONSerialization.jsonObject(with: Data(mutation.argsJson.utf8)) as? [Any])
            let patch = try #require(args[1] as? [String: Any])
            #expect(patch["override_due_type"] == nil)
            #expect(patch["override_due_value"] == nil)
        }
    }

    @Test("Payment settlement tolerance rejects residuals up to one cent without writes", arguments: [0.005, 0.01])
    func paymentTolerance(residual: Double) async throws {
        let manager = try database()
        try await manager.dbWriter.write { db in
            try Bill(id: "bill", cardId: "card", billMonth: "2026-10", billAmount: residual, dueDate: "2026-10-28").insert(db)
        }
        await #expect(throws: PaymentError.billAlreadyPaid) {
            try await PaymentService(dbManager: manager).recordPayment(billId: "bill", amount: residual)
        }
        try await manager.dbWriter.read { db in
            let payments = try Payment.fetchCount(db)
            let mutations = try MutationOutbox.fetchCount(db)
            #expect(payments == 0)
            #expect(mutations == 0)
        }
    }

    @Test("Notification cap selects the earliest 64 actual trigger times")
    func earliestNotifications() async throws {
        let manager = try database()
        try await manager.dbWriter.write { db in
            for i in (1...40).reversed() {
                let date = String(format: "2026-11-%02d", min(i, 30))
                try CreditCard(id: "card-\(i)", holderId: "holder", cardProductId: "product", billingDay: 10).insert(db)
                try Bill(id: String(format: "b%02d", i), cardId: "card-\(i)", billMonth: "2026-11", billAmount: 100, dueDate: date).insert(db)
            }
        }
        let center = DomainNotificationCenter()
        try await NotificationScheduler(dbManager: manager, center: center).rescheduleAll(today: instant("2026-10-28T00:00:00Z"))
        var expected: [(String, String)] = []
        let df = DateFormatter()
        df.dateFormat = "yyyy-MM-dd"
        df.timeZone = TimeZone(identifier: "Asia/Shanghai")!
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = df.timeZone
        for i in 1...40 {
            let id = String(format: "b%02d", i)
            let due = String(format: "2026-11-%02d", min(i, 30))
            let before = df.string(from: calendar.date(byAdding: .day, value: -3, to: df.date(from: due)!)!)
            expected.append(("bill-due-\(id)", due))
            expected.append(("bill-3d-\(id)", before))
        }
        expected.sort { $0.1 == $1.1 ? $0.0 < $1.0 : $0.1 < $1.1 }
        #expect(center.requests.map(\.identifier) == Array(expected.prefix(64).map(\.0)))
        for request in center.requests {
            let trigger = try #require(request.trigger as? UNCalendarNotificationTrigger)
            #expect(trigger.dateComponents.timeZone?.identifier == "Asia/Shanghai")
            #expect(trigger.dateComponents.hour == 9)
        }
    }

    @Test("Notification amounts share one DB snapshot even when payments change during delivery")
    func notificationSnapshot() async throws {
        let manager = try database()
        try await manager.dbWriter.write { db in
            for id in ["a", "b"] {
                try CreditCard(id: "card-\(id)", holderId: "holder", cardProductId: "product", billingDay: 10).insert(db)
                try Bill(id: id, cardId: "card-\(id)", billMonth: "2026-10", billAmount: 100, dueDate: "2026-10-23").insert(db)
                try Payment(id: "old-\(id)", billId: id, amount: 20, paidAt: "2026-10-22", idempotencyKey: "old-\(id)").insert(db)
            }
        }
        let center = DomainNotificationCenter()
        center.onAdd = {
            try await manager.dbWriter.write { db in
                for id in ["a", "b"] {
                    try Payment(id: "new-\(id)", billId: id, amount: 30, paidAt: "2026-10-22", idempotencyKey: "new-\(id)").save(db)
                }
            }
        }
        try await NotificationScheduler(dbManager: manager, center: center).rescheduleAll(today: instant("2026-10-22T16:30:00Z"))
        #expect(center.requests.count == 2)
        #expect(center.requests.allSatisfy { $0.content.body.contains("80.00") })
    }

    @Test("DB read failure does not erase already scheduled notifications")
    func notificationReadFailure() async throws {
        let manager = try database()
        let center = DomainNotificationCenter()
        center.requests = [UNNotificationRequest(identifier: "existing", content: UNMutableNotificationContent(), trigger: nil)]
        try await manager.dbWriter.write { db in
            try db.execute(sql: "DROP TABLE bills")
        }
        await #expect(throws: DatabaseError.self) {
            try await NotificationScheduler(dbManager: manager, center: center).rescheduleAll(today: instant("2026-10-22T16:30:00Z"))
        }
        #expect(center.requests.map(\.identifier) == ["existing"])
    }

    @Test("Notification scheduling propagates delivery failure")
    func notificationFailure() async throws {
        enum DeliveryFailure: Error { case denied }
        let manager = try database()
        try await manager.dbWriter.write { db in
            try Bill(id: "bill", cardId: "card", billMonth: "2026-10", billAmount: 100, dueDate: "2026-10-23").insert(db)
        }
        let center = DomainNotificationCenter()
        center.onAdd = { throw DeliveryFailure.denied }
        await #expect(throws: DeliveryFailure.denied) {
            try await NotificationScheduler(dbManager: manager, center: center).rescheduleAll(today: instant("2026-10-22T16:30:00Z"))
        }
    }

    @Test("One notification failure does not prevent later reminders and is still propagated")
    func notificationPartialFailure() async throws {
        let manager = try database()
        try await manager.dbWriter.write { db in
            try Bill(id: "bill", cardId: "card", billMonth: "2026-10", billAmount: 100, dueDate: "2026-10-28").insert(db)
        }
        let center = DomainNotificationCenter()
        center.rejectedIdentifiers = ["bill-3d-bill"]
        await #expect(throws: DomainNotificationCenter.Failure.denied) {
            try await NotificationScheduler(dbManager: manager, center: center).rescheduleAll(today: instant("2026-10-22T16:30:00Z"))
        }
        #expect(center.requests.map(\.identifier) == ["bill-due-bill"])
    }

    @Test("Repayment calendar retains outstanding overdue and distant bills without projected billing events")
    func watchCalendarContract() async throws {
        let manager = try database()
        try await manager.dbWriter.write { db in
            try Bill(id: "overdue", cardId: "card", billMonth: "2026-01", billAmount: 100, dueDate: "2026-01-23").insert(db)
            try Bill(id: "distant", cardId: "card", billMonth: "2027-01", billAmount: 100, dueDate: "2027-01-23").insert(db)
        }
        let snapshot = try await WatchSnapshotManager().buildSnapshot(dbManager: manager, today: instant("2026-10-22T16:30:00Z"))
        #expect(snapshot.calendarEvents.map(\.id) == ["due-overdue", "due-distant"])
        #expect(snapshot.calendarEvents.allSatisfy { $0.type == "due" })
    }

    @Test("D1 phone and image fields survive decoding, local persistence and re-encoding")
    func referenceFieldMapping() async throws {
        let bankJSON = #"{"id":"remote-bank","name":"银行","customer_service_phone":"95555"}"#
        let productJSON = #"{"id":"remote-product","bank_id":"remote-bank","bank_name":"银行","card_name":"卡","currency":"CNY","payment_due_type":"fixed","payment_due_value":25,"card_image_id":"images/card-123"}"#
        let bank = try JSONDecoder().decode(Bank.self, from: Data(bankJSON.utf8))
        let product = try JSONDecoder().decode(CardProduct.self, from: Data(productJSON.utf8))
        #expect(bank.tel == "95555")
        #expect(product.cardArtUrl == "images/card-123")
        let manager = try database()
        try await manager.dbWriter.write { db in
            try bank.save(db)
            try product.save(db)
            #expect(try Bank.fetchOne(db, id: bank.id)?.tel == "95555")
            #expect(try CardProduct.fetchOne(db, id: product.id)?.cardArtUrl == "images/card-123")
        }
        let encodedBank = try JSONEncoder().encode(bank)
        let encodedProduct = try JSONEncoder().encode(product)
        #expect(try JSONDecoder().decode(Bank.self, from: encodedBank).tel == "95555")
        #expect(try JSONDecoder().decode(CardProduct.self, from: encodedProduct).cardArtUrl == "images/card-123")
        // The image alias must not weaken required repayment-rule decoding.
        let invalid = productJSON.replacingOccurrences(of: "\"fixed\"", with: "\"unknown\"")
        #expect(throws: DecodingError.self) { try JSONDecoder().decode(CardProduct.self, from: Data(invalid.utf8)) }
    }
}
