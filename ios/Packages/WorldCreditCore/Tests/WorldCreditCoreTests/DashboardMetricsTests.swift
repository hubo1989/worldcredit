import Foundation
import Testing
@testable import WorldCreditCore

@Suite("Dashboard money and metrics parity")
struct DashboardMetricsTests {
    private func item(_ id: String, currency: String = "CNY", holder: String = "h1", amount: Double = 100,
                      days: Int = 0, status: String = "unpaid", productMissing: Bool = false) -> BillDisplayItem {
        let product = CardProduct(id: id, cardName: "卡", currency: currency, paymentDueType: .fixed, paymentDueValue: 25)
        let card = CreditCard(id: id, holderId: holder, cardProductId: id, billingDay: 1, creditLimit: 1000)
        let bill = Bill(id: id, cardId: id, billMonth: "2026-10", billAmount: amount, dueDate: "2026-10-23", status: status)
        return BillDisplayItem(bill: bill, card: card, product: productMissing ? nil : product, bank: nil, holder: nil,
                               totalPaid: 0, remainingAmount: amount, daysUntilDue: days, isOverdue: days < 0, distanceLabel: "")
    }

    private func card(_ item: BillDisplayItem) -> CardDisplayItem {
        CardDisplayItem(card: item.card, product: item.product, bank: nil, holder: nil, latestBill: nil,
                        remainingAmount: 0, interestFreeDaysToday: 0, nextDueDate: Date(timeIntervalSince1970: 0))
    }

    @Test("FX wire format preserves seconds timestamp and milliseconds fetched_at")
    func wireFormat() throws {
        let data = Data(#"{"base":"USD","rates":{"USD":1,"CNY":7,"HKD":8},"timestamp":1792713600,"fetched_at":1792713600123}"#.utf8)
        let rates = try JSONDecoder().decode(FxRates.self, from: data)
        #expect(rates.timestamp == 1792713600)
        #expect(rates.fetchedAt == 1792713600123)
        let encoded = try #require(JSONSerialization.jsonObject(with: JSONEncoder().encode(rates)) as? [String: Any])
        #expect(encoded["fetched_at"] as? Double == 1792713600123)
        #expect(encoded["fetchedAt"] == nil)
    }

    @Test("Money uses Web symbols, grouping and at most two decimals")
    func money() {
        #expect(DashboardMoney.format(1234.5, currency: "CNY") == "¥1,234.5")
        #expect(DashboardMoney.format(1234, currency: "USD") == "US$1,234")
        #expect(DashboardMoney.format(1.236, currency: "HKD") == "HK$1.24")
        #expect(DashboardMoney.format(-12.5, currency: " usd ") == "US$-12.5")
        #expect(DashboardMoney.format(0, currency: "ZZZ") == "ZZZ0")
        #expect(item("missing", currency: "USD", productMissing: true).currency == "CNY")
    }

    @Test("Mixed currencies convert debt and limits; holder filter also scopes actions")
    func mixedAndHolder() {
        let bills = [item("cny", days: -1), item("usd", currency: "USD"), item("hkd", currency: "HKD", holder: "h2", days: 7)]
        let rates = FxRates(base: "USD", rates: ["USD": 1, "CNY": 7, "HKD": 8], timestamp: 0, fetchedAt: 0)
        let metrics = DashboardMetrics.compute(bills: bills, cards: bills.map(card), holderId: nil, futureDays: 7, displayCurrency: "CNY", rates: rates)
        #expect(metrics.totalPending == 887.5)
        #expect(metrics.plainOwed == metrics.totalPending)
        #expect(metrics.overdueAmount == 100)
        #expect(metrics.futureAmount == 787.5)
        #expect(metrics.totalCreditLimit == 8875)
        #expect(metrics.overdueBills.map(\.id) == ["cny"])
        #expect(metrics.dueTodayBills.map(\.id) == ["usd"])
        #expect(metrics.unconvertedCurrencies.isEmpty)
        let filtered = DashboardMetrics.compute(bills: bills, cards: bills.map(card), holderId: "h2", futureDays: 7, displayCurrency: "USD", rates: rates)
        #expect(filtered.totalPending == 12.5)
        #expect(filtered.totalCreditLimit == 125)
        #expect(filtered.visibleBills.map(\.id) == ["hkd"])
        #expect(filtered.overdueBills.isEmpty)
    }

    @Test("Missing and invalid rates exclude foreign money while preserving original buckets")
    func missingRates() {
        let bills = [item("cny"), item("usd", currency: "USD", days: -1), item("hkd", currency: "HKD", days: 7)]
        for rates in [nil, FxRates(base: "USD", rates: ["USD": 0, "CNY": 7, "HKD": .infinity], timestamp: 0, fetchedAt: 0)] as [FxRates?] {
            let metrics = DashboardMetrics.compute(bills: bills, cards: bills.map(card), holderId: nil, futureDays: 7, displayCurrency: "CNY", rates: rates)
            #expect(metrics.totalPending == 100)
            #expect(metrics.overdueAmount == 0)
            #expect(metrics.futureAmount == 100)
            #expect(metrics.unconvertedCurrencies == ["HKD", "USD"])
            #expect(metrics.missingLimitCurrencies == ["HKD", "USD"])
            #expect(metrics.totalCreditLimit == 1000)
            #expect(metrics.pendingByCurrency == ["CNY": 100, "USD": 100, "HKD": 100])
            #expect(metrics.creditLimitByCurrency == ["CNY": 1000, "USD": 1000, "HKD": 1000])
            #expect(metrics.overdueBills.first?.currency == "USD")
        }
    }

    @Test("Inclusive future ranges exclude paid and cent-tolerance settled bills", arguments: [7, 14, 30])
    func boundaries(days: Int) {
        let bills = [item("overdue", days: -1), item("today"), item("edge", days: days), item("outside", days: days + 1),
                     item("paid", status: "paid"), item("zero", amount: 0), item("cent", amount: 0.01)]
        let metrics = DashboardMetrics.compute(bills: bills, cards: [], holderId: nil, futureDays: days, displayCurrency: "CNY", rates: nil)
        #expect(metrics.totalPending == 400)
        #expect(metrics.futureAmount == 200)
        #expect(metrics.futureBills.map(\.id) == ["today", "edge"])
        #expect(metrics.dueTodayBills.map(\.id) == ["today"])
        #expect(metrics.visibleBills.count == 7)
        let empty = DashboardMetrics.compute(bills: bills, cards: [], holderId: "no-cards", futureDays: days, displayCurrency: "CNY", rates: nil)
        #expect(empty.totalPending == 0)
        #expect(empty.visibleBills.isEmpty)
    }
}
