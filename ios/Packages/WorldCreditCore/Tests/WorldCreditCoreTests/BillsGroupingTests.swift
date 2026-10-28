import Foundation
import Testing
import GRDB
@testable import WorldCreditCore

/// 卡分组、组间排序与多币种合计折算 —— 对齐 Web bills 页的卡组语义。
@Suite("Bills grouping, group sort and converted totals")
struct BillsGroupingTests {
    private func database() throws -> DatabaseManager {
        let manager = try DatabaseManager.inMemory()
        try manager.dbWriter.write { db in
            try db.execute(sql: """
                INSERT INTO banks (id, name) VALUES ('bank', '测试银行');
                INSERT INTO card_products (id, bank_id, bank_name, card_name, currency, payment_due_type, payment_due_value)
                VALUES ('p1', 'bank', '测试银行', '人民币卡', 'CNY', 'fixed', 25),
                       ('p2', 'bank', '测试银行', '美元卡', 'USD', 'fixed', 25),
                       ('p3', 'bank', '测试银行', '里程卡', 'CNY', 'fixed', 25);
                INSERT INTO card_holders (id, created_by, managed_by, name, created_at)
                VALUES ('h1', 'user', 'user', '张三', '2026-01-02T00:00:00Z'),
                       ('h2', 'user', 'user', '李四', '2026-01-01T00:00:00Z');
                INSERT INTO credit_cards (id, holder_id, card_product_id, billing_day, credit_limit)
                VALUES ('c1', 'h1', 'p1', 10, 10000),
                       ('c2', 'h2', 'p2', 10, 2000),
                       ('c3', 'h1', 'p3', 24, 5000);
                INSERT INTO bills (id, card_id, bill_month, bill_amount, due_date, status)
                VALUES ('b1', 'c1', '2026-10', 300, '2026-10-21', 'unpaid'),
                       ('b4', 'c1', '2026-08', 400, '2026-10-25', 'paid'),
                       ('b2', 'c2', '2026-10', 100, '2026-11-10', 'unpaid'),
                       ('b3', 'c3', '2026-10', 50, '2026-10-26', 'unpaid');
                INSERT INTO payments (id, bill_id, amount, paid_at, idempotency_key)
                VALUES ('pay-b4', 'b4', 400, '2026-09-30', 'k4');
                """)
        }
        return manager
    }

    private func allBills() async throws -> [BillDisplayItem] {
        let today = ISO8601DateFormatter().date(from: "2026-10-23T04:00:00Z")!
        return try await QueryService(dbManager: try database()).fetchBills(filter: .all, today: today)
    }

    @Test("groups collapse per-card bills in first-seen order with card-level rollups")
    func grouping() async throws {
        let groups = BillsGrouping.groups(from: try await allBills())
        #expect(groups.map(\.cardId) == ["c1", "c3", "c2"])
        let c1 = try #require(groups.first(where: { $0.cardId == "c1" }))
        #expect(c1.bills.map(\.bill.id) == ["b1", "b4"])
        #expect(c1.unpaidAmount == 300)
        #expect(c1.hasOverdue)
        #expect(c1.hasUnpaid)
        #expect(c1.holderName == "张三")
        #expect(c1.currency == "CNY")
        let c2 = try #require(groups.first(where: { $0.cardId == "c2" }))
        #expect(c2.currency == "USD")
        #expect(c2.nearestDaysUntilDue == 18)
    }

    @Test("nearestDue orders overdue cards first then soonest unpaid due")
    func nearestDueGroupSort() async throws {
        let groups = BillsGrouping.groups(from: try await allBills())
        let sorted = BillsGrouping.sorted(groups, by: .nearestDue)
        #expect(sorted.map(\.cardId) == ["c1", "c3", "c2"])
    }

    @Test("maxInterestFree ignores urgency and ranks by interest-free days")
    func maxInterestFreeGroupSort() async throws {
        let groups = BillsGrouping.groups(from: try await allBills())
        let sorted = BillsGrouping.sorted(groups, by: .maxInterestFree)
        // c1/c2 免息 63 天并列(账单日 10 已过),逾期压力最大的 c1 也不下沉;
        // c3 账单日 24 未到,免息 33 天垫底。
        #expect(sorted.map(\.cardId).last == "c3")
        #expect(Set(sorted.map(\.cardId).prefix(2)) == Set(["c1", "c2"]))
    }

    @Test("totals convert per-card currency sums and degrade when rates are missing")
    func convertedTotals() async throws {
        let groups = BillsGrouping.groups(from: try await allBills())
        let usdBase = FxRates(base: "USD", rates: ["USD": 1, "CNY": 7.1], timestamp: 0, fetchedAt: Date().timeIntervalSince1970)

        let cnyTotal = BillsGrouping.total(of: groups, rates: usdBase, displayCurrency: "CNY")
        #expect(cnyTotal.unconvertedCurrencies.isEmpty)
        let expectedCny = 300.0 + 100.0 * 7.1 + 50.0
        #expect(abs(cnyTotal.amount - expectedCny) < 0.001)

        // 单边缺汇率:USD 组无法折算(经基准中转需要来源/目标都在 rates 里),
        // CNY 组同币种直返不受影响
        let usdOnlyMissing = FxRates(base: "EUR", rates: ["EUR": 1, "CNY": 7.8], timestamp: 0, fetchedAt: Date().timeIntervalSince1970)
        let partial = BillsGrouping.total(of: groups, rates: usdOnlyMissing, displayCurrency: "CNY")
        #expect(partial.unconvertedCurrencies == ["USD"])
        #expect(abs(partial.amount - 350.0) < 0.001)

        // rates 为 nil:同币种组无需汇率直接累计(300+50),外币组才列为未折算
        let none = BillsGrouping.total(of: groups, rates: nil, displayCurrency: "CNY")
        #expect(abs(none.amount - 350.0) < 0.001)
        #expect(none.unconvertedCurrencies == ["USD"])
    }
}
