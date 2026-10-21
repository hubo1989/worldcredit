import Foundation
import GRDB

public enum BillFilter: String, CaseIterable, Identifiable, Sendable {
    case unpaid = "待还"
    case paid = "已还"
    case all = "全部"

    public var id: String { rawValue }
}

public struct BillDisplayItem: Identifiable, Sendable {
    public let bill: Bill
    public let card: CreditCard
    public let product: CardProduct?
    public let bank: Bank?
    public let holder: CardHolder?
    public let totalPaid: Double
    public let remainingAmount: Double
    public let daysUntilDue: Int
    public let isOverdue: Bool
    public let distanceLabel: String

    public var id: String { bill.id }

    public var cardTitle: String {
        card.nameOverride ?? product?.cardName ?? bank?.shortName ?? bank?.name ?? "信用卡"
    }

    public var bankName: String {
        bank?.shortName ?? bank?.name ?? product?.bankName ?? ""
    }

    public var holderName: String {
        holder?.name ?? ""
    }

    public var last4: String {
        card.cardNumberLast4 ?? ""
    }

    public var displayStatus: String {
        if remainingAmount <= 0.01 || bill.status == "paid" {
            return "已结清"
        }
        if isOverdue {
            return "已逾期"
        }
        if totalPaid > 0 {
            return "部分还款"
        }
        return "未还"
    }

    public init(
        bill: Bill,
        card: CreditCard,
        product: CardProduct?,
        bank: Bank?,
        holder: CardHolder?,
        totalPaid: Double,
        remainingAmount: Double,
        daysUntilDue: Int,
        isOverdue: Bool,
        distanceLabel: String
    ) {
        self.bill = bill
        self.card = card
        self.product = product
        self.bank = bank
        self.holder = holder
        self.totalPaid = totalPaid
        self.remainingAmount = remainingAmount
        self.daysUntilDue = daysUntilDue
        self.isOverdue = isOverdue
        self.distanceLabel = distanceLabel
    }
}

public struct CardDisplayItem: Identifiable, Sendable {
    public let card: CreditCard
    public let product: CardProduct?
    public let bank: Bank?
    public let holder: CardHolder?
    public let latestBill: Bill?
    public let remainingAmount: Double
    public let interestFreeDaysToday: Int
    public let nextDueDate: Date

    public var id: String { card.id }

    public var displayName: String {
        card.nameOverride ?? product?.cardName ?? bank?.shortName ?? bank?.name ?? "信用卡"
    }

    public var bankName: String {
        bank?.shortName ?? bank?.name ?? product?.bankName ?? ""
    }

    public var holderName: String {
        holder?.name ?? ""
    }

    public var last4: String {
        card.cardNumberLast4 ?? ""
    }

    public init(
        card: CreditCard,
        product: CardProduct?,
        bank: Bank?,
        holder: CardHolder?,
        latestBill: Bill?,
        remainingAmount: Double,
        interestFreeDaysToday: Int,
        nextDueDate: Date
    ) {
        self.card = card
        self.product = product
        self.bank = bank
        self.holder = holder
        self.latestBill = latestBill
        self.remainingAmount = remainingAmount
        self.interestFreeDaysToday = interestFreeDaysToday
        self.nextDueDate = nextDueDate
    }
}

public struct DashboardSummary: Sendable {
    public let totalDebt: Double
    public let overdueAmount: Double
    public let overdueCount: Int
    public let urgentBills: [BillDisplayItem]
    public let nextDueBill: BillDisplayItem?
    public let totalCreditLimit: Double
    public let totalUtilized: Double

    public init(
        totalDebt: Double,
        overdueAmount: Double,
        overdueCount: Int,
        urgentBills: [BillDisplayItem],
        nextDueBill: BillDisplayItem?,
        totalCreditLimit: Double,
        totalUtilized: Double
    ) {
        self.totalDebt = totalDebt
        self.overdueAmount = overdueAmount
        self.overdueCount = overdueCount
        self.urgentBills = urgentBills
        self.nextDueBill = nextDueBill
        self.totalCreditLimit = totalCreditLimit
        self.totalUtilized = totalUtilized
    }
}

public final class QueryService: Sendable {
    public let dbManager: DatabaseManager

    public init(dbManager: DatabaseManager) {
        self.dbManager = dbManager
    }

    /// 查询账单列表
    public func fetchBills(filter: BillFilter = .unpaid, today: Date = Date()) async throws -> [BillDisplayItem] {
        try await dbManager.dbWriter.read { db in
            let billsQuery: [Bill]
            switch filter {
            case .unpaid:
                billsQuery = try Bill.filter(Column("status") != "paid").fetchAll(db)
            case .paid:
                billsQuery = try Bill.filter(Column("status") == "paid").fetchAll(db)
            case .all:
                billsQuery = try Bill.fetchAll(db)
            }

            var items: [BillDisplayItem] = []
            let df = DateFormatter()
            df.dateFormat = "yyyy-MM-dd"
            df.timeZone = TimeZone(identifier: "Asia/Shanghai") ?? .current

            for bill in billsQuery {
                guard let card = try CreditCard.fetchOne(db, id: bill.cardId) else { continue }
                let holder = try CardHolder.fetchOne(db, id: card.holderId)
                let product = try CardProduct.fetchOne(db, id: card.cardProductId)
                let bank: Bank? = if let bankId = product?.bankId {
                    try Bank.fetchOne(db, id: bankId)
                } else {
                    nil
                }

                let payments = try Payment.filter(Column("bill_id") == bill.id).fetchAll(db)
                let totalPaid = payments.reduce(0.0) { $0 + $1.amount }
                let remaining = max(0.0, bill.effectiveAmount - totalPaid)

                // Skip if filter is unpaid but actually settled
                if filter == .unpaid && remaining <= 0.01 {
                    continue
                }
                // Skip if filter is paid but has remaining
                if filter == .paid && remaining > 0.01 {
                    continue
                }

                let dueDate = df.date(from: bill.dueDate) ?? today
                let days = BillingDateCalculator.diffInCalendarDays(target: dueDate, today: today)
                let isOverdue = days < 0 && remaining > 0.01
                let label = BillingDateCalculator.dueDistanceLabel(days: days)

                items.append(BillDisplayItem(
                    bill: bill,
                    card: card,
                    product: product,
                    bank: bank,
                    holder: holder,
                    totalPaid: totalPaid,
                    remainingAmount: remaining,
                    daysUntilDue: days,
                    isOverdue: isOverdue,
                    distanceLabel: label
                ))
            }

            // Sort: Overdue first (most overdue first), then soonest due, then settled
            items.sort { a, b in
                if a.isOverdue != b.isOverdue {
                    return a.isOverdue // Overdue first
                }
                if a.isOverdue && b.isOverdue {
                    return a.daysUntilDue < b.daysUntilDue // -5 days before -2 days
                }
                if (a.remainingAmount > 0.01) != (b.remainingAmount > 0.01) {
                    return a.remainingAmount > 0.01 // Unpaid before paid
                }
                return a.daysUntilDue < b.daysUntilDue // Soonest due first
            }

            return items
        }
    }

    /// 查询首页概览汇总信息
    public func fetchDashboardSummary(today: Date = Date()) async throws -> DashboardSummary {
        let unpaidBills = try await fetchBills(filter: .unpaid, today: today)

        var totalDebt = 0.0
        var overdueAmount = 0.0
        var overdueCount = 0

        for item in unpaidBills {
            totalDebt += item.remainingAmount
            if item.isOverdue {
                overdueAmount += item.remainingAmount
                overdueCount += 1
            }
        }

        let urgentBills = unpaidBills.filter { $0.isOverdue || $0.daysUntilDue <= 7 }
        let nextDueBill = unpaidBills.first

        // Total credit limit & utilization
        let totalLimit = try await dbManager.dbWriter.read { db in
            let cards = try CreditCard.filter(Column("status") == "active").fetchAll(db)
            return cards.reduce(0.0) { $0 + $1.creditLimit }
        }

        return DashboardSummary(
            totalDebt: totalDebt,
            overdueAmount: overdueAmount,
            overdueCount: overdueCount,
            urgentBills: urgentBills,
            nextDueBill: nextDueBill,
            totalCreditLimit: totalLimit,
            totalUtilized: totalDebt
        )
    }

    /// 查询卡片列表（包含免息期与账单摘要）
    public func fetchCards(today: Date = Date()) async throws -> [CardDisplayItem] {
        try await dbManager.dbWriter.read { db in
            let cards = try CreditCard.filter(Column("status") == "active").fetchAll(db)
            var items: [CardDisplayItem] = []

            for card in cards {
                let holder = try CardHolder.fetchOne(db, id: card.holderId)
                let product = try CardProduct.fetchOne(db, id: card.cardProductId)
                let bank: Bank? = if let bankId = product?.bankId {
                    try Bank.fetchOne(db, id: bankId)
                } else {
                    nil
                }

                // Latest bill
                let latestBill = try Bill.filter(Column("card_id") == card.id)
                    .order(Column("bill_month").desc)
                    .fetchOne(db)

                let remaining: Double
                if let latestBill {
                    let payments = try Payment.filter(Column("bill_id") == latestBill.id).fetchAll(db)
                    let totalPaid = payments.reduce(0.0) { $0 + $1.amount }
                    remaining = max(0.0, latestBill.effectiveAmount - totalPaid)
                } else {
                    remaining = 0.0
                }

                let grace = BillingDateCalculator.calculateCardGracePeriod(card: card, cardProduct: product, today: today)

                items.append(CardDisplayItem(
                    card: card,
                    product: product,
                    bank: bank,
                    holder: holder,
                    latestBill: latestBill,
                    remainingAmount: remaining,
                    interestFreeDaysToday: grace.graceDays,
                    nextDueDate: grace.nextDueDate
                ))
            }

            // Default sort: highest interest free days first
            items.sort { $0.interestFreeDaysToday > $1.interestFreeDaysToday }
            return items
        }
    }
}
