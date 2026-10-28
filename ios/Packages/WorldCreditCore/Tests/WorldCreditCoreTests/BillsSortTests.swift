import Foundation
import Testing
import GRDB
@testable import WorldCreditCore

/// 账单页排序模式：与 Web BillsSortMode 同口径。
/// - nearestDue：逾期 → 待还 → 已结清分组，组内距还款日升序（原有行为，回归保护）。
/// - maxInterestFree：纯按「今日刷卡免息天数」降序，不分组。
@Suite("Bills list sort modes and interest-free ranking")
struct BillsSortTests {
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
                VALUES ('b1', 'c1', '2026-10', 300, '2026-10-24', 'unpaid'),
                       ('b2', 'c2', '2026-10', 100, '2026-11-10', 'unpaid'),
                       ('b3', 'c3', '2026-10', 50, '2026-10-26', 'unpaid');
                """)
        }
        return manager
    }

    @Test("max_interest_free ranks by next-period due date and ignores current-bill pressure")
    func maxInterestFreeSort() async throws {
        let today = ISO8601DateFormatter().date(from: "2026-10-23T04:00:00Z")!
        let items = try await QueryService(dbManager: try database()).fetchBills(
            filter: .all, sortMode: .maxInterestFree, today: today
        )
        // fixed 25 = 账单月次月 25 日还款：
        // c1/c2 账单日 10 已过 → 今天刷卡进 11-10 账单 → 还款 2026-12-25 → 63 天
        // c3 账单日 24 未到 → 今天刷卡进 10-24 账单 → 还款 2026-11-25 → 33 天
        // 免息序与「距当前还款日」序（b3 只有 3 天，压力最大）相反，证明不参与分组。
        #expect(items.map(\.bill.id).last == "b3")
        #expect(Set(items.map(\.bill.id).prefix(2)) == Set(["b1", "b2"]))
        let rank = Dictionary(uniqueKeysWithValues: items.map { ($0.bill.id, $0.interestFreeDaysToday) })
        #expect(rank["b1"] == 63)
        #expect(rank["b2"] == 63)
        #expect(rank["b3"] == 33)
    }

    @Test("nearest due keeps urgency grouping with soonest-due order inside groups")
    func nearestDueSort() async throws {
        let today = ISO8601DateFormatter().date(from: "2026-10-23T04:00:00Z")!
        let items = try await QueryService(dbManager: try database()).fetchBills(
            filter: .all, sortMode: .nearestDue, today: today
        )
        #expect(items.map(\.bill.id) == ["b1", "b3", "b2"])
    }

    @Test("default fetch keeps nearest-due order without specifying sortMode")
    func defaultSortIsNearestDue() async throws {
        let today = ISO8601DateFormatter().date(from: "2026-10-23T04:00:00Z")!
        let items = try await QueryService(dbManager: try database()).fetchBills(
            filter: .all, today: today
        )
        #expect(items.map(\.bill.id) == ["b1", "b3", "b2"])
    }
}
