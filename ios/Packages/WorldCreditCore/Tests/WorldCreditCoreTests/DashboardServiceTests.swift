import Foundation
import Testing
import GRDB
@testable import WorldCreditCore

@Suite("Dashboard queries and offline batch payments")
struct DashboardServiceTests {
    private func database() throws -> DatabaseManager {
        let manager = try DatabaseManager.inMemory()
        try manager.dbWriter.write { db in
            try db.execute(sql: """
                INSERT INTO banks (id, name) VALUES ('bank', '测试银行');
                INSERT INTO card_products (id, bank_id, bank_name, card_name, currency, payment_due_type, payment_due_value)
                VALUES ('p-cny', 'bank', '测试银行', '人民币卡', 'CNY', 'fixed', 25),
                       ('p-usd', 'bank', '测试银行', '美元卡', 'USD', 'fixed', 25);
                INSERT INTO card_holders (id, created_by, managed_by, name, created_at)
                VALUES ('h1', 'user', 'user', '张三', '2026-01-02T00:00:00Z'),
                       ('h2', 'user', 'user', '李四', '2026-01-01T00:00:00Z'),
                       ('h3', 'user', 'user', '无卡人', '2026-01-03T00:00:00Z');
                INSERT INTO credit_cards (id, holder_id, card_product_id, billing_day, credit_limit)
                VALUES ('c1', 'h1', 'p-cny', 10, 10000),
                       ('c2', 'h2', 'p-usd', 10, 2000);
                INSERT INTO bills (id, card_id, bill_month, bill_amount, due_date, status)
                VALUES ('b1', 'c1', '2026-10', 300, '2026-10-21', 'unpaid'),
                       ('b2', 'c1', '2026-09', 200, '2026-10-23', 'partial'),
                       ('b3', 'c2', '2026-10', 100, '2026-10-24', 'unpaid'),
                       ('b4', 'c1', '2026-08', 400, '2026-10-25', 'paid'),
                       ('b5', 'c1', '2026-07', 50, '2026-09-25', 'unpaid');
                INSERT INTO payments (id, bill_id, amount, paid_at, idempotency_key)
                VALUES ('pay-b1', 'b1', 100, '2026-10-20', 'k1'),
                       ('pay-b2', 'b2', 120, '2026-10-10', 'k2'),
                       ('pay-b5', 'b5', 50, '2026-09-26', 'k5');
                """)
        }
        return manager
    }

    @Test("fetchHolders returns every holder including cardless ones in creation order")
    func holders() async throws {
        let holders = try await QueryService(dbManager: try database()).fetchHolders()
        #expect(holders.map(\.id) == ["h2", "h1", "h3"])
        #expect(holders.map(\.name) == ["李四", "张三", "无卡人"])
    }

    @Test("fetchDashboardBills loads the full unpaid set across holders and currencies")
    func dashboardBills() async throws {
        let today = ISO8601DateFormatter().date(from: "2026-10-23T04:00:00Z")!
        let bills = try await QueryService(dbManager: try database()).fetchDashboardBills(today: today)
        #expect(bills.map(\.bill.id) == ["b1", "b2", "b3"])
        #expect(bills.first?.currency == "CNY")
        #expect(bills.last?.currency == "USD")
        #expect(bills.map(\.remainingAmount) == [200, 80, 100])
        #expect(bills.first?.daysUntilDue == -2)
        #expect(bills[1].daysUntilDue == 0)
    }

    @Test("Batch full payments settle each bill at its re-read original-currency remaining inside one transaction")
    func batchPaysFullRemaining() async throws {
        let manager = try database()
        let count = try await PaymentService(dbManager: manager).recordFullPayments(billIds: ["b1", "b2", "b3", "b2"])
        #expect(count == 3)
        try await manager.dbWriter.read { db in
            let payments = try Payment.filter(!["pay-b1", "pay-b2", "pay-b5"].contains(Column("id"))).fetchAll(db)
            #expect(payments.map(\.billId).sorted() == ["b1", "b2", "b3"])
            #expect(payments.map(\.amount) == [200, 80, 100])
            #expect(payments.map(\.channel) == Array(repeating: "快捷全额结清", count: 3))
            for id in ["b1", "b2", "b3"] {
                let bill = try #require(try Bill.fetchOne(db, id: id))
                #expect(bill.status == "paid")
            }
            let paidBill = try #require(try Bill.fetchOne(db, id: "b4"))
            #expect(paidBill.status == "paid")
            let settledUnpaidStatus = try #require(try Bill.fetchOne(db, id: "b5"))
            #expect(settledUnpaidStatus.status == "unpaid")
            let mutations = try MutationOutbox.fetchAll(db)
            #expect(mutations.count == 3)
            for mutation in mutations {
                #expect(mutation.name == "bills.recordPayment")
                let args = try #require(try JSONSerialization.jsonObject(with: Data(mutation.argsJson.utf8)) as? [[String: Any]])
                let record = try #require(args.first)
                let paymentId = try #require(record["id"] as? String)
                let stored = try #require(try Payment.fetchOne(db, id: paymentId))
                #expect(record["bill_id"] as? String == stored.billId)
                #expect(record["amount"] as? Double == stored.amount)
                #expect(record["idempotency_key"] as? String == stored.idempotencyKey)
                #expect(record["note"] as? String == "一键全部还款结清")
            }
        }
    }

    @Test("Rejected bills roll back the whole batch without silent partial loss")
    func rollbackOnFailure() async throws {
        let manager = try database()
        await #expect(throws: PaymentError.self) {
            _ = try await PaymentService(dbManager: manager).recordFullPayments(billIds: ["b1", "missing"])
        }
        try await manager.dbWriter.read { db in
            let paymentCount = try Payment.fetchCount(db)
            #expect(paymentCount == 3)
            let mutationCount = try MutationOutbox.fetchCount(db)
            #expect(mutationCount == 0)
            let bill = try #require(try Bill.fetchOne(db, id: "b1"))
            #expect(bill.status == "unpaid")
        }
    }

    @Test("Concurrent duplicates and settled bills are tolerated without double payment")
    func idempotentAndConcurrent() async throws {
        let manager = try database()
        let service = PaymentService(dbManager: manager)
        async let first: Int = service.recordFullPayments(billIds: ["b1", "b2"])
        async let second: Int = service.recordFullPayments(billIds: ["b1", "b2"])
        let (a, b) = try await (first, second)
        #expect(a + b == 2)
        try await manager.dbWriter.read { db in
            let b1Count = try Payment.filter(Column("bill_id") == "b1").fetchCount(db)
            #expect(b1Count == 2) // seed 100 + full 200
            let b2Count = try Payment.filter(Column("bill_id") == "b2").fetchCount(db)
            #expect(b2Count == 2)
        }
        let rerun = try await service.recordFullPayments(billIds: ["b1", "b2", "b5"])
        #expect(rerun == 0)
        let mutationCount = try await manager.dbWriter.read { db in try MutationOutbox.fetchCount(db) }
        #expect(mutationCount == 2)
    }

    @Test("Settled bill keeps raising billAlreadyPaid under recordPayment semantics")
    func recordPaymentUnchanged() async throws {
        let manager = try database()
        await #expect(throws: PaymentError.billAlreadyPaid) {
            _ = try await PaymentService(dbManager: manager).recordPayment(billId: "b5", amount: 10)
        }
    }
}
