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

    @Test("two list styles share a snapshot without changing status or currency semantics")
    func presentationModes() async throws {
        let bills = try await allBills()
        let payable = PayableItem(id: "rent", createdBy: "user", name: "测试房租", category: .rent,
                                  amount: 200, currency: "CNY", dueDay: 25, period: "2026-10",
                                  dueDate: "2026-10-25", daysUntilDue: 2, paidAmount: 50, status: .unpaid)
        let result = BillsPresentation(bills: bills, cards: [], payables: [payable], rates: nil,
                                       filter: BillsPresentationFilter(), today: testDay)
        #expect(result.entries.map(\.id) == ["bill-b1", "payable-rent", "bill-b3", "bill-b2"])
        #expect(result.interestRows.count == 3)
        #expect(result.interestRows.first(where: { $0.id == "c1" })?.item.id == "b1")
        #expect(result.unpaidBillCount == 3)
        #expect(result.currencyTotals["CNY"] == 500)
        #expect(result.currencyTotals["USD"] == 100)
        #expect(result.convertedSummary.totalAmount == 500)
        #expect(result.convertedSummary.unconvertedCurrencies == ["USD"])
        #expect(result.overdueSummary.totalAmount == 300)
        #expect(result.dueSoonSummary.totalAmount == 200)

        let paid = BillsPresentation(bills: bills, cards: [], payables: [payable], rates: nil,
                                     filter: BillsPresentationFilter(status: .paid), today: testDay)
        #expect(paid.entries.map(\.id) == ["bill-b4"])
        #expect(paid.interestRows.count == 3, "免息模式不受账单状态筛选影响")
        #expect(paid.interestRows.first(where: { $0.id == "c1" })?.item.id == "b1")

        let bank = BillsPresentation(bills: bills, cards: [], payables: [payable], rates: nil,
                                     filter: BillsPresentationFilter(bankName: "测试银行"), today: testDay)
        #expect(!bank.entries.contains { $0.id == "payable-rent" })
        let holder = BillsPresentation(bills: bills, cards: [], payables: [payable], rates: nil,
                                       filter: BillsPresentationFilter(holderId: "h2"), today: testDay)
        #expect(holder.entries.map(\.id) == ["bill-b2"])
        #expect(holder.interestRows.map(\.id) == ["c2"])
    }

    @Test("presentation cache reuses both styles and invalidates for source, filter and business day")
    func presentationCache() async throws {
        let bills = try await allBills()
        var cache = BillsPresentationCache()
        var builds = 0
        func build(_ bills: [BillDisplayItem], filter: BillsPresentationFilter) -> BillsPresentation {
            builds += 1
            return BillsPresentation(bills: bills, cards: [], payables: [], rates: nil,
                                     filter: filter, today: testDay)
        }
        let filter = BillsPresentationFilter()
        let first = cache.value(for: filter, today: testDay) { build(bills, filter: filter) }
        for _ in 0..<20 {
            let cached = cache.value(for: filter, today: testDay.addingTimeInterval(1)) {
                build([], filter: filter)
            }
            #expect(cached.entries.map(\.id) == first.entries.map(\.id))
            #expect(cached.interestRows.map(\.id) == first.interestRows.map(\.id))
        }
        #expect(builds == 1)
        cache.invalidate()
        let cleared = cache.value(for: filter, today: testDay) { build([], filter: filter) }
        #expect(cleared.entries.isEmpty)
        #expect(cleared.interestRows.isEmpty, "账户清理后不可保留旧卡片")
        #expect(builds == 2)
        let paid = BillsPresentationFilter(status: .paid)
        _ = cache.value(for: paid, today: testDay) { build(bills, filter: paid) }
        #expect(builds == 3)
        _ = cache.value(for: paid, today: testDay.addingTimeInterval(86_400)) { build(bills, filter: paid) }
        #expect(builds == 4)
    }

    @Test("payment and FX updates produce fresh totals after cache invalidation")
    func presentationAfterPayment() async throws {
        let db = try database()
        let query = QueryService(dbManager: db)
        let bills = try await query.fetchBills(filter: .all, today: testDay)
        var cache = BillsPresentationCache()
        let filter = BillsPresentationFilter()
        let before = cache.value(for: filter, today: testDay) {
            BillsPresentation(bills: bills, cards: [], payables: [], rates: nil, filter: filter, today: testDay)
        }
        #expect(before.overdueBills.map(\.id) == ["b1"])
        _ = try await PaymentService(dbManager: db).recordPayment(
            billId: "b1", amount: 300, paidAt: "2026-10-23", idempotencyKey: "settle-b1"
        )
        let updated = try await query.fetchBills(filter: .all, today: testDay)
        let rates = FxRates(base: "USD", rates: ["USD": 1, "CNY": 7.1], timestamp: 0, fetchedAt: 0)
        cache.invalidate()
        let after = cache.value(for: filter, today: testDay) {
            BillsPresentation(bills: updated, cards: [], payables: [], rates: rates, filter: filter, today: testDay)
        }
        #expect(after.overdueBills.isEmpty)
        #expect(after.entries.map(\.id) == ["bill-b3", "bill-b2"])
        #expect(after.interestRows.count == 3)
        #expect(abs(after.convertedSummary.totalAmount - 760) < 0.001)
        #expect(after.convertedSummary.unconvertedCurrencies.isEmpty)
    }

    @Test("RMB remains a CNY alias and settled stale payable status never creates overdue debt")
    func presentationPayableCompatibility() {
        let payable = PayableItem(id: "rmb", createdBy: "user", name: "人民币支出", category: .other,
                                  amount: 100, currency: "RMB", dueDay: 25, period: "2026-10",
                                  dueDate: "2026-10-25", daysUntilDue: 2, paidAmount: 0, status: .unpaid)
        let settled = PayableItem(id: "settled", createdBy: "user", name: "已结清支出", category: .other,
                                  amount: 200, currency: "CNY", dueDay: 20, period: "2026-10",
                                  dueDate: "2026-10-20", daysUntilDue: -3, paidAmount: 200, status: .overdue)
        let result = BillsPresentation(bills: [], cards: [], payables: [payable, settled], rates: nil,
                                       filter: BillsPresentationFilter(status: .all), today: testDay)
        #expect(result.currencyTotals["CNY"] == 100)
        #expect(result.convertedSummary.totalAmount == 100)
        #expect(result.convertedSummary.unconvertedCurrencies.isEmpty)
        #expect(result.overdueSummary.totalAmount == 0)
        #expect(result.entries.map(\.id) == ["payable-rmb", "payable-settled"])
    }

    @Test("Shanghai business day rollover refreshes date-derived bill and summary status")
    func businessDayRollover() async throws {
        let iso = ISO8601DateFormatter()
        let beforeMidnight = iso.date(from: "2026-10-25T15:59:59Z")!
        let sameDayLater = iso.date(from: "2026-10-25T15:30:00Z")!
        let afterMidnight = iso.date(from: "2026-10-26T16:00:01Z")!
        let loadedDay = BillingDateCalculator.businessDayStart(for: beforeMidnight)
        #expect(BillingDateCalculator.needsBusinessDayRefresh(lastLoadedDay: nil, now: beforeMidnight))
        #expect(!BillingDateCalculator.needsBusinessDayRefresh(lastLoadedDay: loadedDay, now: sameDayLater))
        #expect(BillingDateCalculator.needsBusinessDayRefresh(lastLoadedDay: loadedDay, now: afterMidnight))

        let query = QueryService(dbManager: try database())
        let dayOneBills = try await query.fetchBills(filter: .all, today: beforeMidnight)
        let dayTwoBills = try await query.fetchBills(filter: .all, today: afterMidnight)
        let b3Before = try #require(dayOneBills.first(where: { $0.id == "b3" }))
        let b3After = try #require(dayTwoBills.first(where: { $0.id == "b3" }))
        #expect(!b3Before.isOverdue)
        #expect(b3Before.daysUntilDue == 1)
        #expect(b3After.isOverdue)
        #expect(b3After.daysUntilDue == -1)

        var cache = BillsPresentationCache()
        let filter = BillsPresentationFilter()
        let first = cache.value(for: filter, today: beforeMidnight) {
            BillsPresentation(bills: dayOneBills, cards: [], payables: [], rates: nil,
                              filter: filter, today: beforeMidnight)
        }
        #expect(first.overdueBills.map(\.id) == ["b1"])
        cache.invalidate()
        let second = cache.value(for: filter, today: afterMidnight) {
            BillsPresentation(bills: dayTwoBills, cards: [], payables: [], rates: nil,
                              filter: filter, today: afterMidnight)
        }
        #expect(Set(second.overdueBills.map(\.id)) == Set(["b1", "b3"]))
    }

    @Test("next billing countdown clamps short months and stays in the business timezone")
    func nextBillingCountdown() {
        let iso = ISO8601DateFormatter()
        #expect(BillingDateCalculator.daysUntilNextBilling(billingDay: 31,
                today: iso.date(from: "2026-02-27T16:00:00Z")!) == 0)
        #expect(BillingDateCalculator.daysUntilNextBilling(billingDay: 10,
                today: iso.date(from: "2026-10-09T16:00:00Z")!) == 31)
        #expect(BillingDateCalculator.daysUntilNextBilling(billingDay: 30,
                today: iso.date(from: "2026-01-30T04:00:00Z")!) == 29)
        #expect(BillingDateCalculator.daysUntilNextBilling(billingDay: 31,
                today: iso.date(from: "2026-01-31T04:00:00Z")!) == 28)
        #expect(BillingDateCalculator.daysUntilNextBilling(billingDay: 1,
                today: iso.date(from: "2026-12-30T16:00:00Z")!) == 1)
    }

    private var testDay: Date {
        ISO8601DateFormatter().date(from: "2026-10-23T04:00:00Z")!
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
