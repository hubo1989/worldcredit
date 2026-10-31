import Foundation

public struct BillsPresentationFilter: Hashable, Sendable {
    public let status: BillFilter
    public let holderId: String?
    public let bankName: String?

    public init(status: BillFilter = .unpaid, holderId: String? = nil, bankName: String? = nil) {
        self.status = status
        self.holderId = holderId
        self.bankName = bankName
    }
}

public enum BillsListEntry: Identifiable, Sendable {
    case cardBill(item: BillDisplayItem, group: CardBillsGroup)
    case payable(PayableItem)
    case unbilledCard(CardDisplayItem)

    public var id: String {
        switch self {
        case .cardBill(let item, _): "bill-\(item.id)"
        case .payable(let payable): "payable-\(payable.id)"
        case .unbilledCard(let card): "unbilled-card-\(card.id)"
        }
    }

    private var tier: Int {
        switch self {
        case .cardBill(let item, _):
            item.isOverdue ? 0 : (item.remainingAmount > 0.01 ? 1 : 2)
        case .payable(let payable):
            payable.isSettled || payable.remainingAmount <= 0.01 ? 2
                : (payable.status == .overdue || payable.daysUntilDue < 0 ? 0 : 1)
        case .unbilledCard:
            2
        }
    }

    private func daysUntilDue(today: Date) -> Int {
        switch self {
        case .cardBill(let item, _): item.daysUntilDue
        case .payable(let payable): payable.daysUntilDue
        case .unbilledCard(let card):
            BillingDateCalculator.daysUntilNextBilling(
                billingDay: card.card.overrideBillingDay ?? card.card.billingDay, today: today
            )
        }
    }

    fileprivate static func sorted(_ entries: [Self], today: Date) -> [Self] {
        // 日期只计算一次，不能在 O(n log n) 次比较中反复创建日历。
        entries.map { (entry: $0, tier: $0.tier, days: $0.daysUntilDue(today: today)) }
            .sorted {
                if $0.tier != $1.tier { return $0.tier < $1.tier }
                if $0.days != $1.days { return $0.days < $1.days }
                return $0.entry.id < $1.entry.id
            }
            .map(\.entry)
    }
}

public struct BillsAmountSummary: Equatable, Sendable {
    public let totalAmount: Double
    public let unconvertedCurrencies: [String]
    public var hasUnconverted: Bool { !unconvertedCurrencies.isEmpty }

    fileprivate init(items: [(Double, String)], rates: FxRates?) {
        var total = 0.0
        var unconverted = Set<String>()
        for (amount, currency) in items {
            let normalized = DashboardFx.normalizeCurrencyOrDefault(currency, "CNY")
            let code = normalized == "RMB" ? "CNY" : normalized
            if let converted = DashboardFx.convert(amount, from: code, to: "CNY", rates: rates) {
                total += converted
            } else {
                unconverted.insert(code)
            }
        }
        totalAmount = total
        unconvertedCurrencies = unconverted.sorted()
    }
}

public struct BillsMissingStatement: Identifiable, Sendable {
    public let group: CardBillsGroup
    public let days: Int
    public var id: String { group.id }
}

public struct BillsInterestRow: Identifiable, Sendable {
    public let group: CardBillsGroup
    public let item: BillDisplayItem
    public var id: String { group.id }
}

/// 同一份内存快照同时准备两种展示模式，切换模式无需失效或重新读库。
public struct BillsPresentation: Sendable {
    public let entries: [BillsListEntry]
    public let interestRows: [BillsInterestRow]
    public let unbilledCards: [CardDisplayItem]
    public let missingStatements: [BillsMissingStatement]
    public let overdueBills: [BillDisplayItem]
    public let unpaidBillCount: Int
    public let currencyTotals: [String: Double]
    public let convertedSummary: BillsAmountSummary
    public let overdueSummary: BillsAmountSummary
    public let dueSoonSummary: BillsAmountSummary

    public init(
        bills: [BillDisplayItem], cards: [CardDisplayItem], payables: [PayableItem],
        rates: FxRates?, filter: BillsPresentationFilter, today: Date = Date()
    ) {
        let holderBills = bills.filter {
            (filter.holderId == nil || $0.holderId == filter.holderId)
                && (filter.bankName == nil || $0.bankName == filter.bankName)
        }
        let filteredBills = holderBills.filter { Self.includes($0, status: filter.status) }
        let filteredPayables = payables.filter {
            guard filter.bankName == nil,
                  filter.holderId == nil || $0.holderId == filter.holderId else { return false }
            switch filter.status {
            case .unpaid: return $0.remainingAmount > 0.01 && !$0.isSettled
            case .paid: return $0.remainingAmount <= 0.01 || $0.isSettled
            case .all: return true
            }
        }
        let groups = BillsGrouping.sorted(BillsGrouping.groups(from: filteredBills), by: .nearestDue)
        let interestGroups = BillsGrouping.sorted(BillsGrouping.groups(from: holderBills), by: .maxInterestFree)
        interestRows = interestGroups.compactMap { group in
            guard let latest = group.bills.max(by: { $0.bill.billMonth < $1.bill.billMonth }) else { return nil }
            return BillsInterestRow(group: group, item: latest)
        }
        let billedCardIds = Set(bills.map(\.card.id))
        unbilledCards = cards.filter {
            !billedCardIds.contains($0.id)
                && (filter.holderId == nil || $0.card.holderId == filter.holderId)
                && (filter.bankName == nil || $0.bankName == filter.bankName)
        }.sorted {
            if $0.interestFreeDaysToday != $1.interestFreeDaysToday {
                return $0.interestFreeDaysToday > $1.interestFreeDaysToday
            }
            return $0.id < $1.id
        }
        var entries = groups.flatMap { group in
            group.bills.map { BillsListEntry.cardBill(item: $0, group: group) }
        }
        entries += filteredPayables.map(BillsListEntry.payable)
        entries += unbilledCards.map(BillsListEntry.unbilledCard)
        self.entries = BillsListEntry.sorted(entries, today: today)

        let latestMonths = Dictionary(grouping: bills, by: \.card.id)
            .compactMapValues { BillsGrouping.latestBillMonth(of: $0) }
        missingStatements = groups.compactMap { group in
            guard let days = group.missingStatementDays(latestBillMonth: latestMonths[group.id], today: today) else {
                return nil
            }
            return BillsMissingStatement(group: group, days: days)
        }
        overdueBills = filteredBills.filter(\.isOverdue)
        let unpaidBills = filteredBills.filter { $0.remainingAmount > 0.01 }
        let unpaidPayables = filteredPayables.filter { $0.remainingAmount > 0.01 && !$0.isSettled }
        unpaidBillCount = unpaidBills.count
        let amounts = unpaidBills.map { ($0.remainingAmount, $0.currency) }
            + unpaidPayables.map { ($0.remainingAmount, $0.currency) }
        currencyTotals = amounts.reduce(into: [:]) { totals, item in
            let normalized = DashboardFx.normalizeCurrencyOrDefault(item.1, "CNY")
            let code = normalized == "RMB" ? "CNY" : normalized
            totals[code, default: 0] += item.0
        }
        convertedSummary = BillsAmountSummary(items: amounts, rates: rates)
        overdueSummary = BillsAmountSummary(
            items: overdueBills.map { ($0.remainingAmount, $0.currency) }
                + unpaidPayables.filter { $0.status == .overdue || $0.daysUntilDue < 0 }
                    .map { ($0.remainingAmount, $0.currency) },
            rates: rates
        )
        dueSoonSummary = BillsAmountSummary(
            items: unpaidBills.filter { !$0.isOverdue && $0.daysUntilDue <= 3 }
                .map { ($0.remainingAmount, $0.currency) }
                + unpaidPayables.filter { $0.status != .overdue && (0...3).contains($0.daysUntilDue) }
                    .map { ($0.remainingAmount, $0.currency) },
            rates: rates
        )
    }

    private static func includes(_ item: BillDisplayItem, status: BillFilter) -> Bool {
        switch status {
        case .unpaid: item.bill.status != "paid" && item.remainingAmount > 0.01
        case .paid: item.bill.status == "paid" && item.remainingAmount <= 0.01
        case .all: true
        }
    }
}

/// 缓存只保留当前筛选的双模式结果；源数据变化由持有者显式失效。
public struct BillsPresentationCache {
    private var filter: BillsPresentationFilter?
    private var day: Date?
    private var presentation: BillsPresentation?

    public init() {}

    public mutating func invalidate() {
        filter = nil
        day = nil
        presentation = nil
    }

    public mutating func value(
        for filter: BillsPresentationFilter, today: Date = Date(),
        build: () -> BillsPresentation
    ) -> BillsPresentation {
        let day = BillingDateCalculator.businessCalendar.startOfDay(for: today)
        if self.filter == filter, self.day == day, let presentation { return presentation }
        let result = build()
        self.filter = filter
        self.day = day
        presentation = result
        return result
    }
}
