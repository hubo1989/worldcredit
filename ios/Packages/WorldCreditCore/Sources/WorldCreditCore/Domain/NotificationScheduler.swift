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

    /// 重新排布待还账单的本地提醒（最多排 64 条）
    public func rescheduleAll(today: Date = Date(), calendar: Calendar = {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "Asia/Shanghai") ?? .current
        return cal
    }()) async throws {
        // Clear all existing pending bill notifications
        center.removeAllPendingNotificationRequests()

        let todayStr: String = {
            let df = DateFormatter()
            df.dateFormat = "yyyy-MM-dd"
            df.timeZone = calendar.timeZone
            return df.string(from: today)
        }()

        // Fetch all unpaid or partial bills
        let billsWithCards: [(Bill, CreditCard, Bank?)] = try await dbManager.dbWriter.read { db in
            let bills = try Bill.filter(Column("status") != "paid").fetchAll(db)
            var result: [(Bill, CreditCard, Bank?)] = []
            for bill in bills {
                guard let card = try CreditCard.fetchOne(db, id: bill.cardId) else { continue }
                let bank: Bank?
                if let product = try CardProduct.fetchOne(db, id: card.cardProductId),
                   let bankId = product.bankId {
                    bank = try Bank.fetchOne(db, id: bankId)
                } else {
                    bank = nil
                }
                result.append((bill, card, bank))
            }
            return result
        }

        var scheduledCount = 0
        let maxNotifications = 64

        let df = DateFormatter()
        df.dateFormat = "yyyy-MM-dd"
        df.timeZone = calendar.timeZone

        for (bill, card, bank) in billsWithCards {
            guard scheduledCount < maxNotifications else { break }

            guard let dueDate = df.date(from: bill.dueDate) else { continue }
            let cardName = card.nameOverride ?? bank?.shortName ?? bank?.name ?? "信用卡"
            let last4 = card.cardNumberLast4.map { "(\($0))" } ?? ""

            // Calculate remaining amount
            let totalPaid: Double = try await dbManager.dbWriter.read { db in
                let payments = try Payment.filter(Column("bill_id") == bill.id).fetchAll(db)
                return payments.reduce(0.0) { $0 + $1.amount }
            }
            let remaining = bill.effectiveAmount - totalPaid
            guard remaining > 0.01 else { continue }

            // 1. Due day reminder (09:00 AM on due_date)
            if bill.dueDate >= todayStr {
                var comp = calendar.dateComponents([.year, .month, .day], from: dueDate)
                comp.hour = 9
                comp.minute = 0
                comp.second = 0

                if let fireDate = calendar.date(from: comp), fireDate > today {
                    let content = UNMutableNotificationContent()
                    content.title = "还款日提醒"
                    content.body = "\(cardName)\(last4) 今日到期，剩余应还 ¥\(String(format: "%.2f", remaining))"
                    content.sound = .default

                    let trigger = UNCalendarNotificationTrigger(dateMatching: comp, repeats: false)
                    let req = UNNotificationRequest(identifier: "bill-due-\(bill.id)", content: content, trigger: trigger)
                    try await center.add(req)
                    scheduledCount += 1
                }
            }

            // 2. 3 days before reminder
            if scheduledCount < maxNotifications,
               let threeDaysBefore = calendar.date(byAdding: .day, value: -3, to: dueDate) {
                var comp = calendar.dateComponents([.year, .month, .day], from: threeDaysBefore)
                comp.hour = 9
                comp.minute = 0
                comp.second = 0

                if let fireDate = calendar.date(from: comp), fireDate > today {
                    let content = UNMutableNotificationContent()
                    content.title = "还款提醒"
                    content.body = "\(cardName)\(last4) 将在 3 天后（\(bill.dueDate)）到期，剩余应还 ¥\(String(format: "%.2f", remaining))"
                    content.sound = .default

                    let trigger = UNCalendarNotificationTrigger(dateMatching: comp, repeats: false)
                    let req = UNNotificationRequest(identifier: "bill-3d-\(bill.id)", content: content, trigger: trigger)
                    try await center.add(req)
                    scheduledCount += 1
                }
            }
        }
    }
}
