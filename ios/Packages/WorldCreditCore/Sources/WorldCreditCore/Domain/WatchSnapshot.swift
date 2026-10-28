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
        minPayment: Double? = nil
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
        interestFreeDaysToday: Int
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
    }
}

public struct WatchCalendarEvent: Codable, Identifiable, Sendable {
    public let id: String
    public let date: String // YYYY-MM-DD
    public let type: String // "due" or "billing"
    public let title: String
    public let subtitle: String
    public let amount: Double?

    public init(id: String, date: String, type: String, title: String, subtitle: String, amount: Double? = nil) {
        self.id = id
        self.date = date
        self.type = type
        self.title = title
        self.subtitle = subtitle
        self.amount = amount
    }
}

public struct WatchSnapshot: Codable, Sendable {
    public let generatedAt: String // ISO8601
    public let totalDebt: Double
    public let overdueCount: Int
    public let overdueAmount: Double
    public let totalCreditLimit: Double
    public let bills: [WatchBillItem]
    public let cards: [WatchCardItem]
    public let calendarEvents: [WatchCalendarEvent]

    public init(
        generatedAt: String = ISO8601DateFormatter().string(from: Date()),
        totalDebt: Double,
        overdueCount: Int,
        overdueAmount: Double,
        totalCreditLimit: Double,
        bills: [WatchBillItem],
        cards: [WatchCardItem],
        calendarEvents: [WatchCalendarEvent]
    ) {
        self.generatedAt = generatedAt
        self.totalDebt = totalDebt
        self.overdueCount = overdueCount
        self.overdueAmount = overdueAmount
        self.totalCreditLimit = totalCreditLimit
        self.bills = bills
        self.cards = cards
        self.calendarEvents = calendarEvents
    }

    public var nextDueBill: WatchBillItem? {
        bills.first
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
    public func buildSnapshot(dbManager: DatabaseManager, today: Date = Date()) async throws -> WatchSnapshot {
        let queryService = QueryService(dbManager: dbManager)
        let summary = try await queryService.fetchDashboardSummary(today: today)
        let bills = try await queryService.fetchBills(filter: .unpaid, today: today)
        let cards = try await queryService.fetchCards(today: today)
        return buildSnapshot(summary: summary, bills: bills, cards: cards, today: today)
    }

    /// 用已取好的 dashboard 摘要/账单/卡片数据直接拼装手表快照。
    ///
    /// 纯映射，不触碰数据库；`buildSnapshot(dbManager:today:)` 转调本方法。
    /// 调用方应在同一次查询结果上组装，避免重复读库。
    public func buildSnapshot(
        summary: DashboardSummary,
        bills: [BillDisplayItem],
        cards: [CardDisplayItem],
        today: Date = Date()
    ) -> WatchSnapshot {
        let watchBills = bills.map { item in
            WatchBillItem(
                id: item.bill.id,
                bankName: item.bankName,
                cardTitle: item.cardTitle,
                last4: item.last4,
                holderName: item.holderName,
                dueDate: item.bill.dueDate,
                statementDate: item.bill.statementDate,
                billAmount: item.bill.effectiveAmount,
                remainingAmount: item.remainingAmount,
                minPayment: item.bill.minPayment
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
                creditLimit: item.card.creditLimit,
                billingDay: billingDay,
                nextDueDate: df.string(from: item.nextDueDate),
                unpaidAmount: item.remainingAmount,
                interestFreeDaysToday: item.interestFreeDaysToday
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
                subtitle: "\(b.cardTitle) ¥\(String(format: "%.2f", b.remainingAmount))",
                amount: b.remainingAmount
            ))
        }

        // Sort events by date ascending
        events.sort { $0.date < $1.date }

        return WatchSnapshot(
            generatedAt: ISO8601DateFormatter().string(from: today),
            totalDebt: summary.totalDebt,
            overdueCount: summary.overdueCount,
            overdueAmount: summary.overdueAmount,
            totalCreditLimit: summary.totalCreditLimit,
            bills: watchBills,
            cards: watchCards,
            calendarEvents: events
        )
    }
}
