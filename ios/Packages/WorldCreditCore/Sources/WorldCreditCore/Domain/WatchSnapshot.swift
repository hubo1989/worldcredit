import Foundation
import GRDB

public struct WatchBillItem: Codable, Identifiable, Sendable {
    public let id: String
    public let bankName: String
    public let cardTitle: String
    public let last4: String
    public let holderName: String
    public let dueDate: String // YYYY-MM-DD
    public let statementDate: String?
    public let billAmount: Double
    public let remainingAmount: Double
    public let minPayment: Double?
    public let currency: String

    public init(
        id: String,
        bankName: String,
        cardTitle: String,
        last4: String,
        holderName: String,
        dueDate: String,
        statementDate: String? = nil,
        billAmount: Double,
        remainingAmount: Double,
        minPayment: Double? = nil,
        currency: String = "CNY"
    ) {
        self.id = id
        self.bankName = bankName
        self.cardTitle = cardTitle
        self.last4 = last4
        self.holderName = holderName
        self.dueDate = dueDate
        self.statementDate = statementDate
        self.billAmount = billAmount
        self.remainingAmount = remainingAmount
        self.minPayment = minPayment
        self.currency = DashboardFx.normalizeCurrencyOrDefault(currency, "CNY")
    }

    enum CodingKeys: String, CodingKey {
        case id, bankName, cardTitle, last4, holderName, dueDate, statementDate
        case billAmount, remainingAmount, minPayment, currency
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        bankName = try c.decode(String.self, forKey: .bankName)
        cardTitle = try c.decode(String.self, forKey: .cardTitle)
        last4 = try c.decode(String.self, forKey: .last4)
        holderName = try c.decode(String.self, forKey: .holderName)
        dueDate = try c.decode(String.self, forKey: .dueDate)
        statementDate = try c.decodeIfPresent(String.self, forKey: .statementDate)
        billAmount = try c.decode(Double.self, forKey: .billAmount)
        remainingAmount = try c.decode(Double.self, forKey: .remainingAmount)
        minPayment = try c.decodeIfPresent(Double.self, forKey: .minPayment)
        let rawCurrency = try c.decodeIfPresent(String.self, forKey: .currency)
        currency = DashboardFx.normalizeCurrencyOrDefault(rawCurrency, "CNY")
    }

    public func daysUntilDue(today: Date = Date(), calendar: Calendar = Calendar.current) -> Int {
        let df = DateFormatter()
        df.dateFormat = "yyyy-MM-dd"
        // Keep the calendar argument for source compatibility; dates use the business timezone.
        df.locale = Locale(identifier: "en_US_POSIX")
        df.timeZone = TimeZone(identifier: "Asia/Shanghai")!
        guard let due = df.date(from: dueDate) else { return 0 }
        return BillingDateCalculator.diffInCalendarDays(target: due, today: today)
    }

    public func isOverdue(today: Date = Date(), calendar: Calendar = Calendar.current) -> Bool {
        daysUntilDue(today: today, calendar: calendar) < 0 && remainingAmount > 0.01
    }

    public func distanceLabel(today: Date = Date(), calendar: Calendar = Calendar.current) -> String {
        let days = daysUntilDue(today: today, calendar: calendar)
        return BillingDateCalculator.dueDistanceLabel(days: days)
    }
}

public struct WatchCardItem: Codable, Identifiable, Sendable {
    public let id: String
    public let bankName: String
    public let cardTitle: String
    public let last4: String
    public let holderName: String
    public let creditLimit: Double
    public let billingDay: Int
    public let nextDueDate: String
    public let unpaidAmount: Double
    public let interestFreeDaysToday: Int
    public let currency: String

    public init(
        id: String,
        bankName: String,
        cardTitle: String,
        last4: String,
        holderName: String,
        creditLimit: Double,
        billingDay: Int,
        nextDueDate: String,
        unpaidAmount: Double,
        interestFreeDaysToday: Int,
        currency: String = "CNY"
    ) {
        self.id = id
        self.bankName = bankName
        self.cardTitle = cardTitle
        self.last4 = last4
        self.holderName = holderName
        self.creditLimit = creditLimit
        self.billingDay = billingDay
        self.nextDueDate = nextDueDate
        self.unpaidAmount = unpaidAmount
        self.interestFreeDaysToday = interestFreeDaysToday
        self.currency = DashboardFx.normalizeCurrencyOrDefault(currency, "CNY")
    }

    enum CodingKeys: String, CodingKey {
        case id, bankName, cardTitle, last4, holderName, creditLimit, billingDay
        case nextDueDate, unpaidAmount, interestFreeDaysToday, currency
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        bankName = try c.decode(String.self, forKey: .bankName)
        cardTitle = try c.decode(String.self, forKey: .cardTitle)
        last4 = try c.decode(String.self, forKey: .last4)
        holderName = try c.decode(String.self, forKey: .holderName)
        creditLimit = try c.decode(Double.self, forKey: .creditLimit)
        billingDay = try c.decode(Int.self, forKey: .billingDay)
        nextDueDate = try c.decode(String.self, forKey: .nextDueDate)
        unpaidAmount = try c.decode(Double.self, forKey: .unpaidAmount)
        interestFreeDaysToday = try c.decode(Int.self, forKey: .interestFreeDaysToday)
        let rawCurrency = try c.decodeIfPresent(String.self, forKey: .currency)
        currency = DashboardFx.normalizeCurrencyOrDefault(rawCurrency, "CNY")
    }
}

public struct WatchCalendarEvent: Codable, Identifiable, Sendable {
    public let id: String
    public let date: String // YYYY-MM-DD
    public let type: String // "due" or "billing"
    public let title: String
    public let subtitle: String
    public let amount: Double?
    public let currency: String?

    public init(
        id: String,
        date: String,
        type: String,
        title: String,
        subtitle: String,
        amount: Double? = nil,
        currency: String? = nil
    ) {
        self.id = id
        self.date = date
        self.type = type
        self.title = title
        self.subtitle = subtitle
        self.amount = amount
        self.currency = currency.flatMap { DashboardFx.normalizeCurrency($0) }
    }
}

public struct WatchSnapshot: Codable, Sendable {
    public let generatedAt: String // ISO8601
    public let displayCurrency: String
    public let totalDebt: Double
    public let debtByCurrency: [String: Double]
    public let overdueCount: Int
    public let overdueAmount: Double
    public let overdueByCurrency: [String: Double]
    public let totalCreditLimit: Double
    public let creditLimitByCurrency: [String: Double]
    public let unconvertedCurrencies: [String]
    public let missingLimitCurrencies: [String]
    public let ratesAvailable: Bool
    public let mixed: Bool
    public let rates: FxRates?
    public let bills: [WatchBillItem]
    public let cards: [WatchCardItem]
    public let calendarEvents: [WatchCalendarEvent]

    public init(
        generatedAt: String = ISO8601DateFormatter().string(from: Date()),
        displayCurrency: String = "CNY",
        totalDebt: Double,
        debtByCurrency: [String: Double] = [:],
        overdueCount: Int,
        overdueAmount: Double,
        overdueByCurrency: [String: Double] = [:],
        totalCreditLimit: Double,
        creditLimitByCurrency: [String: Double] = [:],
        unconvertedCurrencies: [String] = [],
        missingLimitCurrencies: [String] = [],
        ratesAvailable: Bool = true,
        mixed: Bool = false,
        rates: FxRates? = nil,
        bills: [WatchBillItem],
        cards: [WatchCardItem],
        calendarEvents: [WatchCalendarEvent]
    ) {
        self.generatedAt = generatedAt
        self.displayCurrency = DashboardFx.normalizeCurrencyOrDefault(displayCurrency, "CNY")
        self.totalDebt = totalDebt
        self.debtByCurrency = debtByCurrency
        self.overdueCount = overdueCount
        self.overdueAmount = overdueAmount
        self.overdueByCurrency = overdueByCurrency
        self.totalCreditLimit = totalCreditLimit
        self.creditLimitByCurrency = creditLimitByCurrency
        self.unconvertedCurrencies = unconvertedCurrencies
        self.missingLimitCurrencies = missingLimitCurrencies
        self.ratesAvailable = ratesAvailable
        self.mixed = mixed
        self.rates = rates
        self.bills = bills
        self.cards = cards
        self.calendarEvents = calendarEvents
    }

    enum CodingKeys: String, CodingKey {
        case generatedAt, displayCurrency, totalDebt, debtByCurrency
        case overdueCount, overdueAmount, overdueByCurrency
        case totalCreditLimit, creditLimitByCurrency
        case unconvertedCurrencies, missingLimitCurrencies
        case ratesAvailable, mixed, rates
        case bills, cards, calendarEvents
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        generatedAt = try c.decode(String.self, forKey: .generatedAt)
        let rawDisplayCurrency = try c.decodeIfPresent(String.self, forKey: .displayCurrency)
        displayCurrency = DashboardFx.normalizeCurrencyOrDefault(rawDisplayCurrency, "CNY")
        totalDebt = try c.decode(Double.self, forKey: .totalDebt)
        debtByCurrency = try c.decodeIfPresent([String: Double].self, forKey: .debtByCurrency) ?? [:]
        overdueCount = try c.decode(Int.self, forKey: .overdueCount)
        overdueAmount = try c.decode(Double.self, forKey: .overdueAmount)
        overdueByCurrency = try c.decodeIfPresent([String: Double].self, forKey: .overdueByCurrency) ?? [:]
        totalCreditLimit = try c.decode(Double.self, forKey: .totalCreditLimit)
        creditLimitByCurrency = try c.decodeIfPresent([String: Double].self, forKey: .creditLimitByCurrency) ?? [:]
        unconvertedCurrencies = try c.decodeIfPresent([String].self, forKey: .unconvertedCurrencies) ?? []
        missingLimitCurrencies = try c.decodeIfPresent([String].self, forKey: .missingLimitCurrencies) ?? []
        ratesAvailable = try c.decodeIfPresent(Bool.self, forKey: .ratesAvailable) ?? true
        mixed = try c.decodeIfPresent(Bool.self, forKey: .mixed) ?? false
        rates = try c.decodeIfPresent(FxRates.self, forKey: .rates)
        bills = try c.decode([WatchBillItem].self, forKey: .bills)
        cards = try c.decode([WatchCardItem].self, forKey: .cards)
        calendarEvents = try c.decode([WatchCalendarEvent].self, forKey: .calendarEvents)
    }

    public var nextDueBill: WatchBillItem? {
        bills.first
    }

    /// 汇总金额展示：若汇率完整则按 `displayCurrency` 折算合计；缺汇率时分币种原币拼接（绝不静默 1:1 混加）。
    public func formattedTotalDebt(compact: Bool = false) -> String {
        Self.formatAggregate(
            convertedTotal: totalDebt,
            byCurrency: debtByCurrency,
            displayCurrency: displayCurrency,
            unconverted: unconvertedCurrencies,
            compact: compact
        )
    }

    /// 已逾期汇总展示（支持分币种降级）。
    public func formattedOverdueAmount(compact: Bool = false) -> String {
        Self.formatAggregate(
            convertedTotal: overdueAmount,
            byCurrency: overdueByCurrency,
            displayCurrency: displayCurrency,
            unconverted: unconvertedCurrencies.filter { (overdueByCurrency[$0] ?? 0) > 0 },
            compact: compact
        )
    }

    /// 多币种分项明细（如 `US$1,000 + ¥500`），仅当存在多币种或缺失汇率时有展示价值。
    public func debtBreakdownText(compact: Bool = false) -> String? {
        guard debtByCurrency.count > 1 || !unconvertedCurrencies.isEmpty else { return nil }
        return Self.joinByCurrency(debtByCurrency, compact: compact)
    }

    public static func formatAggregate(
        convertedTotal: Double,
        byCurrency: [String: Double],
        displayCurrency: String,
        unconverted: [String],
        compact: Bool = false
    ) -> String {
        if unconverted.isEmpty {
            return compact
                ? DashboardMoney.formatCompact(convertedTotal, currency: displayCurrency)
                : DashboardMoney.format(convertedTotal, currency: displayCurrency)
        }
        let nonZero = byCurrency.filter { abs($0.value) > 0.005 }
        if !nonZero.isEmpty {
            return joinByCurrency(nonZero, compact: compact)
        }
        return compact
            ? DashboardMoney.formatCompact(convertedTotal, currency: displayCurrency)
            : DashboardMoney.format(convertedTotal, currency: displayCurrency)
    }

    public static func joinByCurrency(_ byCurrency: [String: Double], compact: Bool = false) -> String {
        byCurrency
            .filter { abs($0.value) > 0.005 }
            .sorted { $0.key < $1.key }
            .map { pair in
                compact
                    ? DashboardMoney.formatCompact(pair.value, currency: pair.key)
                    : DashboardMoney.format(pair.value, currency: pair.key)
            }
            .joined(separator: " · ")
    }
}

public final class WatchSnapshotManager: Sendable {
    public static let shared = WatchSnapshotManager()
    public static let appGroupId = "group.com.chunfenshijie.worldcredit"
    public static let snapshotFileName = "watch_snapshot.json"

    public init() {}

    public var snapshotURL: URL? {
        let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: Self.appGroupId)
            ?? FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first
        return container?.appendingPathComponent(Self.snapshotFileName)
    }

    public func save(_ snapshot: WatchSnapshot) throws {
        guard let url = snapshotURL else { return }
        let data = try JSONEncoder().encode(snapshot)
        try data.write(to: url, options: .atomic)
    }

    public func load() -> WatchSnapshot? {
        guard let url = snapshotURL, let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(WatchSnapshot.self, from: data)
    }

    public func clear() {
        guard let url = snapshotURL else { return }
        try? FileManager.default.removeItem(at: url)
    }

    /// 从本地 SQLite 数据库生成手表快照。
    ///
    /// 内部会重新查询 dashboard/bills/cards；若调用方已持有同一批数据，
    /// 请改用 `buildSnapshot(summary:bills:cards:today:)` 避免重复查询。
    public func buildSnapshot(
        dbManager: DatabaseManager,
        today: Date = Date(),
        displayCurrency: String? = nil,
        rates: FxRates? = nil,
        payables: [PayableItem] = []
    ) async throws -> WatchSnapshot {
        let queryService = QueryService(dbManager: dbManager)
        let summary = try await queryService.fetchDashboardSummary(today: today)
        let bills = try await queryService.fetchBills(filter: .unpaid, today: today)
        let cards = try await queryService.fetchCards(today: today)
        let (creditAccounts, prefCurrency) = try await dbManager.dbWriter.read { db in
            let accounts = try CreditAccount.fetchAll(db)
            let pref = try UserPreferenceRecord.fetchOne(db)
            let cfg = pref.flatMap { try? UserDisplayConfig.decode(fromJsonString: $0.displayConfig) }
            return (accounts, cfg?.defaultCurrency ?? "CNY")
        }
        return buildSnapshot(
            summary: summary,
            bills: bills,
            cards: cards,
            today: today,
            displayCurrency: displayCurrency ?? prefCurrency,
            rates: rates,
            payables: payables,
            creditAccounts: creditAccounts
        )
    }

    /// 用已取好的 dashboard 摘要/账单/卡片数据直接拼装手表快照（基于 `DashboardMetrics.compute` 完整多币种口径）。
    public func buildSnapshot(
        summary: DashboardSummary,
        bills: [BillDisplayItem],
        cards: [CardDisplayItem],
        today: Date = Date(),
        displayCurrency: String = "CNY",
        rates: FxRates? = nil,
        payables: [PayableItem] = [],
        creditAccounts: [CreditAccount] = []
    ) -> WatchSnapshot {
        let resolvedCurrency = DashboardFx.normalizeCurrencyOrDefault(displayCurrency, "CNY")
        let metrics = DashboardMetrics.compute(
            bills: bills,
            cards: cards,
            holderId: nil,
            futureDays: 7,
            displayCurrency: resolvedCurrency,
            rates: rates,
            payables: payables,
            creditAccounts: creditAccounts
        )
        let overdueByCurrency = DashboardFx.sumByCurrency(
            metrics.overdueBills.map { ($0.remainingAmount, $0.currency) },
            target: resolvedCurrency,
            rates: rates
        ).byCurrency

        let watchBills = bills.map { item in
            WatchBillItem(
                id: item.bill.id,
                bankName: item.bankName,
                cardTitle: item.cardTitle,
                last4: item.last4,
                holderName: item.holderName,
                dueDate: item.bill.effectiveDueDate,
                statementDate: item.bill.effectiveStatementDate,
                billAmount: item.bill.effectiveAmount,
                remainingAmount: item.remainingAmount,
                minPayment: item.bill.effectiveMinPayment,
                currency: item.currency
            )
        }

        let df = DateFormatter()
        df.dateFormat = "yyyy-MM-dd"
        df.timeZone = TimeZone(identifier: "Asia/Shanghai") ?? .current

        let watchCards = cards.map { item in
            let billingDay = item.card.overrideBillingDay ?? item.card.billingDay
            return WatchCardItem(
                id: item.card.id,
                bankName: item.bankName,
                cardTitle: item.displayName,
                last4: item.last4,
                holderName: item.holderName,
                creditLimit: item.card.effectiveCreditLimit,
                billingDay: billingDay,
                nextDueDate: df.string(from: item.nextDueDate),
                unpaidAmount: item.remainingAmount,
                interestFreeDaysToday: item.interestFreeDaysToday,
                currency: item.product?.currency ?? resolvedCurrency
            )
        }

        // Repayment calendar mirrors all outstanding bills, including overdue ones.
        // Billing-day projections and a rolling time window are not part of this view.
        var events: [WatchCalendarEvent] = []

        // 1. Due dates from active bills
        for b in watchBills {
            events.append(WatchCalendarEvent(
                id: "due-\(b.id)",
                date: b.dueDate,
                type: "due",
                title: "\(b.bankName) 还款日",
                subtitle: "\(b.cardTitle) \(DashboardMoney.format(b.remainingAmount, currency: b.currency))",
                amount: b.remainingAmount,
                currency: b.currency
            ))
        }

        // Sort events by date ascending
        events.sort { $0.date < $1.date }

        let hasMixedCurrencies = metrics.mixed
            || metrics.pendingByCurrency.count > 1
            || overdueByCurrency.count > 1
            || metrics.creditLimitByCurrency.count > 1

        return WatchSnapshot(
            generatedAt: ISO8601DateFormatter().string(from: today),
            displayCurrency: resolvedCurrency,
            totalDebt: metrics.totalPending,
            debtByCurrency: metrics.pendingByCurrency,
            overdueCount: metrics.overdueBills.count,
            overdueAmount: metrics.overdueAmount,
            overdueByCurrency: overdueByCurrency,
            totalCreditLimit: metrics.totalCreditLimit,
            creditLimitByCurrency: metrics.creditLimitByCurrency,
            unconvertedCurrencies: metrics.unconvertedCurrencies,
            missingLimitCurrencies: metrics.missingLimitCurrencies,
            ratesAvailable: metrics.ratesAvailable,
            mixed: hasMixedCurrencies,
            rates: rates,
            bills: watchBills,
            cards: watchCards,
            calendarEvents: events
        )
    }
}
