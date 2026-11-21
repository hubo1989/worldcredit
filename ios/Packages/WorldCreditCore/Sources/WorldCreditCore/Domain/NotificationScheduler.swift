import Foundation
import UserNotifications
import GRDB

public protocol NotificationCenterProtocol: Sendable {
    func add(_ request: UNNotificationRequest) async throws
    func removePendingNotificationRequests(withIdentifiers identifiers: [String])
    func removeAllPendingNotificationRequests()
    func pendingNotificationRequests() async -> [UNNotificationRequest]
}

extension UNUserNotificationCenter: NotificationCenterProtocol {}

public final class NotificationScheduler: Sendable {
    public let dbManager: DatabaseManager
    public let center: NotificationCenterProtocol

    public init(dbManager: DatabaseManager, center: NotificationCenterProtocol = UNUserNotificationCenter.current()) {
        self.dbManager = dbManager
        self.center = center
    }

    /// 重新排布待还账单、固定支出与最长免息期卡牌的本地提醒（按实际触发时间取最早 64 条）。
    public func rescheduleAll(
        today: Date = Date(),
        calendar: Calendar = {
            var cal = Calendar(identifier: .gregorian)
            cal.timeZone = TimeZone(identifier: "Asia/Shanghai")!
            return cal
        }(),
        payables: [PayableItem] = [],
        preferences: UserReminderPreferences? = nil
    ) async throws {
        let billDueToday = preferences?.items.billDueToday ?? true
        let billDueAdvance = preferences?.items.billDueAdvance ?? true
        let payableDueToday = preferences?.items.payableDueToday ?? true
        let payableDueAdvance = preferences?.items.payableDueAdvance ?? true
        let gracePeriodLongest = preferences?.items.gracePeriodLongest ?? false
        let advanceDays: [Int] = {
            if let configured = preferences?.remindDaysBefore {
                return Array(Set(configured.filter { $0 > 0 })).sorted()
            }
            return [3]
        }()

        // Bills, cards, reference data and payment totals must come from one read snapshot.
        let snapshot: (
            billsWithCards: [(Bill, CreditCard, Bank?, Double)],
            graceCards: [(CreditCard, CardProduct, Bank?)]
        ) = try await dbManager.dbWriter.read { db in
            let bills = try Bill.filter(Column("status") != "paid").fetchAll(db)
            let totals = try Row.fetchAll(db, sql: "SELECT bill_id, SUM(amount) AS total_paid FROM payments GROUP BY bill_id")
            var paidByBill: [String: Double] = [:]
            for row in totals {
                paidByBill[row["bill_id"]] = row["total_paid"]
            }
            var billRows: [(Bill, CreditCard, Bank?, Double)] = []
            for bill in bills {
                guard let card = try CreditCard.fetchOne(db, id: bill.cardId) else { continue }
                let bank: Bank?
                if let product = try CardProduct.fetchOne(db, id: card.cardProductId),
                   let bankId = product.bankId {
                    bank = try Bank.fetchOne(db, id: bankId)
                } else {
                    bank = nil
                }
                billRows.append((bill, card, bank, paidByBill[bill.id] ?? 0))
            }

            var graceRows: [(CreditCard, CardProduct, Bank?)] = []
            if gracePeriodLongest {
                let activeCards = try CreditCard
                    .filter(Column("status") == "active" && Column("card_type") != "loan")
                    .fetchAll(db)
                for card in activeCards {
                    guard let product = try CardProduct.fetchOne(db, id: card.cardProductId) else { continue }
                    let bank: Bank?
                    if let bankId = product.bankId {
                        bank = try Bank.fetchOne(db, id: bankId)
                    } else {
                        bank = nil
                    }
                    graceRows.append((card, product, bank))
                }
            }
            return (billRows, graceRows)
        }

        let df = DateFormatter()
        df.locale = Locale(identifier: "en_US_POSIX")
        df.dateFormat = "yyyy-MM-dd"
        df.timeZone = calendar.timeZone
        var candidates: [(fireDate: Date, request: UNNotificationRequest)] = []

        func makeNineAMComponents(for date: Date) -> DateComponents {
            var comp = calendar.dateComponents([.year, .month, .day], from: date)
            comp.calendar = calendar
            comp.timeZone = calendar.timeZone
            comp.hour = 9
            comp.minute = 0
            comp.second = 0
            return comp
        }

        if billDueToday || billDueAdvance {
            var billOffsets: [Int] = []
            if billDueToday { billOffsets.append(0) }
            if billDueAdvance { billOffsets.append(contentsOf: advanceDays) }

            for (bill, card, bank, totalPaid) in snapshot.billsWithCards {
                let effectiveDueDate = bill.effectiveDueDate
                guard let dueDate = df.date(from: effectiveDueDate) else { continue }
                let remaining = bill.effectiveAmount - totalPaid
                guard remaining > 0.01 else { continue }
                let cardName = card.nameOverride ?? bank?.shortName ?? bank?.name ?? "信用卡"
                let last4 = card.cardNumberLast4.map { "(\($0))" } ?? ""

                for daysBefore in billOffsets {
                    guard let day = calendar.date(byAdding: .day, value: -daysBefore, to: dueDate) else { continue }
                    let comp = makeNineAMComponents(for: day)
                    guard let fireDate = calendar.date(from: comp), fireDate > today else { continue }

                    let content = UNMutableNotificationContent()
                    let identifier: String
                    if daysBefore == 0 {
                        identifier = "bill-due-\(bill.id)"
                        content.title = "还款日提醒"
                        content.body = "\(cardName)\(last4) 今日到期，剩余应还 ¥\(String(format: "%.2f", remaining))"
                    } else {
                        identifier = "bill-\(daysBefore)d-\(bill.id)"
                        content.title = "还款提醒"
                        content.body = "\(cardName)\(last4) 将在 \(daysBefore) 天后（\(effectiveDueDate)）到期，剩余应还 ¥\(String(format: "%.2f", remaining))"
                    }
                    content.sound = .default
                    let trigger = UNCalendarNotificationTrigger(dateMatching: comp, repeats: false)
                    candidates.append((fireDate, UNNotificationRequest(identifier: identifier, content: content, trigger: trigger)))
                }
            }
        }

        if payableDueToday || payableDueAdvance {
            var payableOffsets: [Int] = []
            if payableDueToday { payableOffsets.append(0) }
            if payableDueAdvance { payableOffsets.append(contentsOf: advanceDays) }

            for payable in payables {
                guard !payable.isSettled, payable.status != .paid, payable.remainingAmount > 0.01 else { continue }
                guard let dueDate = df.date(from: payable.dueDate) else { continue }
                let amountLabel = DashboardMoney.format(payable.remainingAmount, currency: payable.currency)

                for daysBefore in payableOffsets {
                    guard let day = calendar.date(byAdding: .day, value: -daysBefore, to: dueDate) else { continue }
                    let comp = makeNineAMComponents(for: day)
                    guard let fireDate = calendar.date(from: comp), fireDate > today else { continue }

                    let content = UNMutableNotificationContent()
                    let identifier: String
                    if daysBefore == 0 {
                        identifier = "payable-due-\(payable.id)"
                        content.title = "固定支出今日到期"
                        content.body = "\(payable.name)（\(payable.category.label)）今日到期，剩余应付 \(amountLabel)"
                    } else {
                        identifier = "payable-\(daysBefore)d-\(payable.id)"
                        content.title = "固定支出提醒"
                        content.body = "\(payable.name)（\(payable.category.label)）将在 \(daysBefore) 天后（\(payable.dueDate)）到期，剩余应付 \(amountLabel)"
                    }
                    content.sound = .default
                    let trigger = UNCalendarNotificationTrigger(dateMatching: comp, repeats: false)
                    candidates.append((fireDate, UNNotificationRequest(identifier: identifier, content: content, trigger: trigger)))
                }
            }
        }

        if gracePeriodLongest {
            var todayFirstOfMonthComp = calendar.dateComponents([.year, .month], from: today)
            todayFirstOfMonthComp.day = 1
            let todayFirstOfMonth = calendar.date(from: todayFirstOfMonthComp) ?? today

            for (card, product, bank) in snapshot.graceCards {
                let rawBillingDay = card.overrideBillingDay ?? card.billingDay
                let clampedBillingDay = max(1, min(rawBillingDay, 31))
                let cardName = card.nameOverride ?? bank?.shortName ?? bank?.name ?? "信用卡"
                let last4 = card.cardNumberLast4.map { "(\($0))" } ?? ""

                var matchedFireDate: Date?
                var matchedComp: DateComponents?
                for monthOffset in 0...2 {
                    guard let monthStart = calendar.date(byAdding: .month, value: monthOffset, to: todayFirstOfMonth),
                          let monthRange = calendar.range(of: .day, in: .month, for: monthStart) else { continue }
                    var billingComp = calendar.dateComponents([.year, .month], from: monthStart)
                    billingComp.day = min(clampedBillingDay, monthRange.count)
                    billingComp.hour = 9
                    billingComp.minute = 0
                    billingComp.second = 0
                    billingComp.calendar = calendar
                    billingComp.timeZone = calendar.timeZone
                    guard let billingDate = calendar.date(from: billingComp),
                          let dayAfter = calendar.date(byAdding: .day, value: 1, to: billingDate) else { continue }
                    let fireComp = makeNineAMComponents(for: dayAfter)
                    guard let fireDate = calendar.date(from: fireComp), fireDate > today else { continue }
                    matchedFireDate = fireDate
                    matchedComp = fireComp
                    break
                }

                guard let fireDate = matchedFireDate, let fireComp = matchedComp else { continue }
                let grace = BillingDateCalculator.calculateCardGracePeriod(
                    card: card,
                    cardProduct: product,
                    today: calendar.startOfDay(for: fireDate)
                )
                let content = UNMutableNotificationContent()
                content.title = "今日最长免息期：\(cardName)\(last4)"
                content.body = "昨日为账单日，今日刷卡可享本轮最长 \(grace.graceDays) 天免息期（最晚还款日 \(df.string(from: grace.nextDueDate))）。"
                content.sound = .default
                let identifier = "grace-longest-\(card.id)-\(df.string(from: fireDate))"
                let trigger = UNCalendarNotificationTrigger(dateMatching: fireComp, repeats: false)
                candidates.append((fireDate, UNNotificationRequest(identifier: identifier, content: content, trigger: trigger)))
            }
        }

        candidates.sort {
            if $0.fireDate != $1.fireDate { return $0.fireDate < $1.fireDate }
            return $0.request.identifier < $1.request.identifier
        }
        // A DB/planning failure must not erase the previously scheduled reminders.
        center.removeAllPendingNotificationRequests()
        var firstError: (any Error)?
        for candidate in candidates.prefix(64) {
            do {
                try await center.add(candidate.request)
            } catch {
                // Try the remaining reminders, then report failure to the caller.
                if firstError == nil { firstError = error }
            }
        }
        if let firstError { throw firstError }
    }
}
