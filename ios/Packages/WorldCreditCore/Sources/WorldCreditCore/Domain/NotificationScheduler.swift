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

    /// 重新排布待还账单的本地提醒（按实际触发时间取最早 64 条）。
    public func rescheduleAll(today: Date = Date(), calendar: Calendar = {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "Asia/Shanghai")!
        return cal
    }()) async throws {
        // Bills, reference data and payment totals must come from one read snapshot.
        let billsWithCards: [(Bill, CreditCard, Bank?, Double)] = try await dbManager.dbWriter.read { db in
            let bills = try Bill.filter(Column("status") != "paid").fetchAll(db)
            let totals = try Row.fetchAll(db, sql: "SELECT bill_id, SUM(amount) AS total_paid FROM payments GROUP BY bill_id")
            var paidByBill: [String: Double] = [:]
            for row in totals {
                paidByBill[row["bill_id"]] = row["total_paid"]
            }
            var result: [(Bill, CreditCard, Bank?, Double)] = []
            for bill in bills {
                guard let card = try CreditCard.fetchOne(db, id: bill.cardId) else { continue }
                let bank: Bank?
                if let product = try CardProduct.fetchOne(db, id: card.cardProductId),
                   let bankId = product.bankId {
                    bank = try Bank.fetchOne(db, id: bankId)
                } else {
                    bank = nil
                }
                result.append((bill, card, bank, paidByBill[bill.id] ?? 0))
            }
            return result
        }

        let df = DateFormatter()
        df.locale = Locale(identifier: "en_US_POSIX")
        df.dateFormat = "yyyy-MM-dd"
        df.timeZone = calendar.timeZone
        var candidates: [(fireDate: Date, request: UNNotificationRequest)] = []

        for (bill, card, bank, totalPaid) in billsWithCards {
            guard let dueDate = df.date(from: bill.dueDate) else { continue }
            let remaining = bill.effectiveAmount - totalPaid
            guard remaining > 0.01 else { continue }
            let cardName = card.nameOverride ?? bank?.shortName ?? bank?.name ?? "信用卡"
            let last4 = card.cardNumberLast4.map { "(\($0))" } ?? ""

            for daysBefore in [0, 3] {
                guard let day = calendar.date(byAdding: .day, value: -daysBefore, to: dueDate) else { continue }
                var comp = calendar.dateComponents([.year, .month, .day], from: day)
                comp.calendar = calendar
                comp.timeZone = calendar.timeZone
                comp.hour = 9
                comp.minute = 0
                comp.second = 0
                guard let fireDate = calendar.date(from: comp), fireDate > today else { continue }

                let content = UNMutableNotificationContent()
                let identifier: String
                if daysBefore == 0 {
                    identifier = "bill-due-\(bill.id)"
                    content.title = "还款日提醒"
                    content.body = "\(cardName)\(last4) 今日到期，剩余应还 ¥\(String(format: "%.2f", remaining))"
                } else {
                    identifier = "bill-3d-\(bill.id)"
                    content.title = "还款提醒"
                    content.body = "\(cardName)\(last4) 将在 3 天后（\(bill.dueDate)）到期，剩余应还 ¥\(String(format: "%.2f", remaining))"
                }
                content.sound = .default
                let trigger = UNCalendarNotificationTrigger(dateMatching: comp, repeats: false)
                let request = UNNotificationRequest(identifier: identifier, content: content, trigger: trigger)
                candidates.append((fireDate, request))
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
