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

    public struct EffectiveFireTime: Equatable, Sendable {
        public let hour: Int
        public let minute: Int
        public let dayOffset: Int

        public init(hour: Int, minute: Int, dayOffset: Int) {
            self.hour = hour
            self.minute = minute
            self.dayOffset = dayOffset
        }
    }

    /// 解析每日推送时间并在命中免打扰区间时顺延至免打扰结束时刻（支持跨午夜区间，如 22:00–08:00）。
    public static func resolveEffectiveFireTime(
        localTime: String?,
        quietStart: String?,
        quietEnd: String?
    ) -> EffectiveFireTime {
        let parsedLocal = parseHHMM(localTime) ?? (hour: 9, minute: 0)
        guard let start = parseHHMM(quietStart), let end = parseHHMM(quietEnd) else {
            return EffectiveFireTime(hour: parsedLocal.hour, minute: parsedLocal.minute, dayOffset: 0)
        }
        let tMin = parsedLocal.hour * 60 + parsedLocal.minute
        let sMin = start.hour * 60 + start.minute
        let eMin = end.hour * 60 + end.minute
        if sMin == eMin {
            return EffectiveFireTime(hour: parsedLocal.hour, minute: parsedLocal.minute, dayOffset: 0)
        }
        if sMin > eMin {
            if tMin >= sMin {
                return EffectiveFireTime(hour: end.hour, minute: end.minute, dayOffset: 1)
            }
            if tMin < eMin {
                return EffectiveFireTime(hour: end.hour, minute: end.minute, dayOffset: 0)
            }
        } else if tMin >= sMin && tMin < eMin {
            return EffectiveFireTime(hour: end.hour, minute: end.minute, dayOffset: 0)
        }
        return EffectiveFireTime(hour: parsedLocal.hour, minute: parsedLocal.minute, dayOffset: 0)
    }

    private static func parseHHMM(_ raw: String?) -> (hour: Int, minute: Int)? {
        guard let raw else { return nil }
        let parts = raw.trimmingCharacters(in: .whitespacesAndNewlines).split(separator: ":")
        guard parts.count == 2,
              let hour = Int(parts[0]), (0...23).contains(hour),
              let minute = Int(parts[1]), (0...59).contains(minute) else {
            return nil
        }
        return (hour, minute)
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
        if let preferences, !preferences.webPushChannelEnabled {
            center.removeAllPendingNotificationRequests()
            return
        }

        let resolvedTimeZone: TimeZone = {
            if let tzId = preferences?.opportunities.timeZone,
               !tzId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
               let tz = TimeZone(identifier: tzId) {
                return tz
            }
            return calendar.timeZone
        }()
        var effectiveCalendar = calendar
        effectiveCalendar.timeZone = resolvedTimeZone

        let effectiveFire = Self.resolveEffectiveFireTime(
            localTime: preferences?.opportunities.localTime,
            quietStart: preferences?.quietHoursStart,
            quietEnd: preferences?.quietHoursEnd
        )

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
            billsWithCards: [(Bill, CreditCard, CardProduct?, Bank?, Double)],
            graceCards: [(CreditCard, CardProduct, Bank?)]
        ) = try await dbManager.dbWriter.read { db in
            let bills = try Bill.filter(Column("status") != "paid").fetchAll(db)
            let totals = try Row.fetchAll(db, sql: "SELECT bill_id, SUM(amount) AS total_paid FROM payments GROUP BY bill_id")
            var paidByBill: [String: Double] = [:]
            for row in totals {
                paidByBill[row["bill_id"]] = row["total_paid"]
            }
            var billRows: [(Bill, CreditCard, CardProduct?, Bank?, Double)] = []
            for bill in bills {
                guard let card = try CreditCard.fetchOne(db, id: bill.cardId) else { continue }
                let product = try CardProduct.fetchOne(db, id: card.cardProductId)
                let bank: Bank?
                if let product, let bankId = product.bankId {
                    bank = try Bank.fetchOne(db, id: bankId)
                } else {
                    bank = nil
                }
                billRows.append((bill, card, product, bank, paidByBill[bill.id] ?? 0))
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
        df.timeZone = resolvedTimeZone
        var candidates: [(fireDate: Date, request: UNNotificationRequest)] = []

        func makeFireComponents(for date: Date) -> DateComponents {
            let shiftedDate = effectiveFire.dayOffset == 0
                ? date
                : (effectiveCalendar.date(byAdding: .day, value: effectiveFire.dayOffset, to: date) ?? date)
            var comp = effectiveCalendar.dateComponents([.year, .month, .day], from: shiftedDate)
            comp.calendar = effectiveCalendar
            comp.timeZone = resolvedTimeZone
            comp.hour = effectiveFire.hour
            comp.minute = effectiveFire.minute
            comp.second = 0
            return comp
        }

        if billDueToday || billDueAdvance {
            var billOffsets: [Int] = []
            if billDueToday { billOffsets.append(0) }
            if billDueAdvance { billOffsets.append(contentsOf: advanceDays) }

            for (bill, card, product, bank, totalPaid) in snapshot.billsWithCards {
                let effectiveDueDate = bill.effectiveDueDate
                guard let dueDate = df.date(from: effectiveDueDate) else { continue }
                let remaining = bill.effectiveAmount - totalPaid
                guard remaining > 0.01 else { continue }
                let cardName = card.nameOverride ?? bank?.shortName ?? bank?.name ?? "信用卡"
                let last4 = card.cardNumberLast4.map { "(\($0))" } ?? ""
                let billCurrency = product?.currency ?? "CNY"
                let amountLabel = DashboardMoney.format(remaining, currency: billCurrency)

                for daysBefore in billOffsets {
                    guard let day = effectiveCalendar.date(byAdding: .day, value: -daysBefore, to: dueDate) else { continue }
                    let comp = makeFireComponents(for: day)
                    guard let fireDate = effectiveCalendar.date(from: comp), fireDate > today else { continue }

                    let content = UNMutableNotificationContent()
                    let identifier: String
                    if daysBefore == 0 {
                        identifier = "bill-due-\(bill.id)"
                        content.title = "还款日提醒"
                        content.body = "\(cardName)\(last4) 今日到期，剩余应还 \(amountLabel)"
                    } else {
                        identifier = "bill-\(daysBefore)d-\(bill.id)"
                        content.title = "还款提醒"
                        content.body = "\(cardName)\(last4) 将在 \(daysBefore) 天后（\(effectiveDueDate)）到期，剩余应还 \(amountLabel)"
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
                    guard let day = effectiveCalendar.date(byAdding: .day, value: -daysBefore, to: dueDate) else { continue }
                    let comp = makeFireComponents(for: day)
                    guard let fireDate = effectiveCalendar.date(from: comp), fireDate > today else { continue }

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
            var todayFirstOfMonthComp = effectiveCalendar.dateComponents([.year, .month], from: today)
            todayFirstOfMonthComp.day = 1
            let todayFirstOfMonth = effectiveCalendar.date(from: todayFirstOfMonthComp) ?? today

            for (card, product, bank) in snapshot.graceCards {
                let rawBillingDay = card.overrideBillingDay ?? card.billingDay
                let clampedBillingDay = max(1, min(rawBillingDay, 31))
                let cardName = card.nameOverride ?? bank?.shortName ?? bank?.name ?? "信用卡"
                let last4 = card.cardNumberLast4.map { "(\($0))" } ?? ""

                var matchedFireDate: Date?
                var matchedComp: DateComponents?
                for monthOffset in 0...2 {
                    guard let monthStart = effectiveCalendar.date(byAdding: .month, value: monthOffset, to: todayFirstOfMonth),
                          let monthRange = effectiveCalendar.range(of: .day, in: .month, for: monthStart) else { continue }
                    var billingComp = effectiveCalendar.dateComponents([.year, .month], from: monthStart)
                    billingComp.day = min(clampedBillingDay, monthRange.count)
                    billingComp.hour = 9
                    billingComp.minute = 0
                    billingComp.second = 0
                    billingComp.calendar = effectiveCalendar
                    billingComp.timeZone = resolvedTimeZone
                    guard let billingDate = effectiveCalendar.date(from: billingComp),
                          let dayAfter = effectiveCalendar.date(byAdding: .day, value: 1, to: billingDate) else { continue }
                    let fireComp = makeFireComponents(for: dayAfter)
                    guard let fireDate = effectiveCalendar.date(from: fireComp), fireDate > today else { continue }
                    matchedFireDate = fireDate
                    matchedComp = fireComp
                    break
                }

                guard let fireDate = matchedFireDate, let fireComp = matchedComp else { continue }
                let grace = BillingDateCalculator.calculateCardGracePeriod(
                    card: card,
                    cardProduct: product,
                    today: effectiveCalendar.startOfDay(for: fireDate)
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
