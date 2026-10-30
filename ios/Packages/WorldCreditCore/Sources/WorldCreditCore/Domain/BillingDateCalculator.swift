import Foundation

public struct DueConfig: Equatable, Sendable {
    public var type: PaymentDueType
    public var value: Int

    public init(type: PaymentDueType, value: Int) {
        self.type = type
        self.value = value
    }
}

public enum BillingDateCalculator {
    /// 统一业务时区（Asia/Shanghai）的公历日历，供上层复用同一口径。
    public static var businessCalendar: Calendar {
        calendar
    }

    public static func businessDayStart(for date: Date = Date()) -> Date {
        calendar.startOfDay(for: date)
    }

    public static func needsBusinessDayRefresh(lastLoadedDay: Date?, now: Date = Date()) -> Bool {
        guard let lastLoadedDay else { return true }
        return businessDayStart(for: lastLoadedDay) != businessDayStart(for: now)
    }

    public static func secondsUntilNextBusinessMidnight(from now: Date = Date()) -> TimeInterval {
        guard let midnight = calendar.date(byAdding: .day, value: 1, to: businessDayStart(for: now)) else {
            return 60
        }
        return max(1, midnight.timeIntervalSince(now))
    }

    private static var calendar: Calendar {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "Asia/Shanghai")!
        return cal
    }

    public static func getActualBillingDate(billingDay: Int, month: Date) -> Date {
        let cal = calendar
        guard let range = cal.range(of: .day, in: .month, for: month) else {
            return month
        }
        let lastDay = range.count
        let actualDay = min(billingDay, lastDay)
        var components = cal.dateComponents([.year, .month], from: month)
        components.day = actualDay
        components.hour = 0
        components.minute = 0
        components.second = 0
        return cal.date(from: components) ?? month
    }

    /// 今天恰为账单日时取下一期；小月账单日钳制到月底。
    public static func daysUntilNextBilling(billingDay: Int, today: Date = Date()) -> Int {
        let cal = calendar
        let currentDay = cal.component(.day, from: today)
        var month = today
        if currentDay >= billingDay {
            // 从当月 1 号加月，避免 1 月 30/31 日 +1 月滚到 3 月。
            var anchor = cal.dateComponents([.year, .month], from: today)
            anchor.day = 1
            let firstOfMonth = cal.date(from: anchor) ?? today
            month = cal.date(byAdding: .month, value: 1, to: firstOfMonth) ?? today
        }
        let target = getActualBillingDate(billingDay: billingDay, month: month)
        return max(0, diffInCalendarDays(target: target, today: today))
    }

    public static func getEffectiveBillingDay(card: CreditCard) -> Int {
        card.overrideBillingDay ?? card.billingDay
    }

    public static func getEffectiveDueConfig(card: CreditCard, cardProduct: CardProduct) -> DueConfig {
        if let type = card.overrideDueType, let value = card.overrideDueValue {
            return DueConfig(type: type, value: value)
        }
        return DueConfig(type: cardProduct.paymentDueType, value: cardProduct.paymentDueValue)
    }

    public static func getDueDate(card: CreditCard, cardProduct: CardProduct, billMonth: Date) -> Date {
        let cal = calendar
        let config = getEffectiveDueConfig(card: card, cardProduct: cardProduct)
        let effectiveBillingDay = getEffectiveBillingDay(card: card)

        switch config.type {
        case .fixed:
            guard let nextMonth = cal.date(byAdding: .month, value: 1, to: billMonth),
                  let range = cal.range(of: .day, in: .month, for: nextMonth) else {
                return billMonth
            }
            let actualDay = min(config.value, range.count)
            var components = cal.dateComponents([.year, .month], from: nextMonth)
            components.day = actualDay
            components.hour = 0
            components.minute = 0
            components.second = 0
            return cal.date(from: components) ?? nextMonth

        case .fixedBeforeBilling:
            guard let range = cal.range(of: .day, in: .month, for: billMonth) else {
                return billMonth
            }
            let actualDay = min(config.value, range.count)
            var components = cal.dateComponents([.year, .month], from: billMonth)
            components.day = actualDay
            components.hour = 0
            components.minute = 0
            components.second = 0
            return cal.date(from: components) ?? billMonth

        case .afterBilling:
            let billingDate = getActualBillingDate(billingDay: effectiveBillingDay, month: billMonth)
            return cal.date(byAdding: .day, value: config.value, to: billingDate) ?? billingDate
        }
    }

    public static func getLoanNextDueDate(loanDueDay: Int, today: Date = Date()) -> Date {
        let cal = calendar
        guard let thisMonthRange = cal.range(of: .day, in: .month, for: today) else {
            return today
        }
        let thisMonthDueDay = min(loanDueDay, thisMonthRange.count)
        var comp = cal.dateComponents([.year, .month], from: today)
        comp.day = thisMonthDueDay
        comp.hour = 0
        comp.minute = 0
        comp.second = 0
        let thisMonthDue = cal.date(from: comp) ?? today

        let todayDay = cal.component(.day, from: today)
        if todayDay <= thisMonthDueDay {
            return thisMonthDue
        }

        guard let nextMonth = cal.date(byAdding: .month, value: 1, to: today),
              let nextMonthRange = cal.range(of: .day, in: .month, for: nextMonth) else {
            return thisMonthDue
        }
        let nextMonthDueDay = min(loanDueDay, nextMonthRange.count)
        var nextComp = cal.dateComponents([.year, .month], from: nextMonth)
        nextComp.day = nextMonthDueDay
        nextComp.hour = 0
        nextComp.minute = 0
        nextComp.second = 0
        return cal.date(from: nextComp) ?? nextMonth
    }

    public static func diffInCalendarDays(target: Date, today: Date = Date()) -> Int {
        let cal = calendar
        let targetMidnight = cal.startOfDay(for: target)
        let todayMidnight = cal.startOfDay(for: today)
        let components = cal.dateComponents([.day], from: todayMidnight, to: targetMidnight)
        return components.day ?? 0
    }

    public static func dueDistanceLabel(days: Int) -> String {
        if days < 0 {
            return "逾期 \(-days) 日"
        } else if days == 0 {
            return "今天还款日"
        } else {
            return "距离还款日 \(days) 日"
        }
    }

    public static func calculateCardGracePeriod(
        card: CreditCard,
        cardProduct: CardProduct?,
        today: Date = Date()
    ) -> (nextBillingDate: Date, nextDueDate: Date, graceDays: Int) {
        let cal = calendar
        let d = cal.startOfDay(for: today)
        let billingDay = card.overrideBillingDay ?? card.billingDay

        if card.cardType == "loan", let loanDueDay = card.loanDueDay {
            let nextDueDate = getLoanNextDueDate(loanDueDay: loanDueDay, today: d)
            let diffDays = max(1, diffInCalendarDays(target: nextDueDate, today: d))
            return (nextDueDate, nextDueDate, diffDays)
        }

        guard let cardProduct else {
            return (d, d, 0)
        }

        let range = cal.range(of: .day, in: .month, for: d) ?? 1..<31
        let effectiveBillingDay = min(billingDay, range.count)

        var purchaseMonthComp = cal.dateComponents([.year, .month], from: d)
        purchaseMonthComp.day = 1
        var purchaseMonth = cal.date(from: purchaseMonthComp) ?? d

        let currentDay = cal.component(.day, from: d)
        if currentDay >= effectiveBillingDay {
            purchaseMonth = cal.date(byAdding: .month, value: 1, to: purchaseMonth) ?? purchaseMonth
        }

        var nextBillingComp = cal.dateComponents([.year, .month], from: purchaseMonth)
        let nextMonthRange = cal.range(of: .day, in: .month, for: purchaseMonth) ?? 1..<31
        nextBillingComp.day = min(effectiveBillingDay, nextMonthRange.count)
        let nextBillingDate = cal.date(from: nextBillingComp) ?? purchaseMonth

        let nextDueDate = getDueDate(card: card, cardProduct: cardProduct, billMonth: purchaseMonth)
        let diffDays = max(1, diffInCalendarDays(target: nextDueDate, today: d))

        return (nextBillingDate, nextDueDate, diffDays)
    }
}

/// 统一首载去重、跨自然日刷新与会话翻转清理，供 App 层和宿主无关单测共用。
@MainActor
public final class SessionDataRefreshState {
    public private(set) var sessionEpoch = UUID()
    public private(set) var loadedBusinessDay: Date?
    private var initialLoadEpoch: UUID?
    private var initialLoadTask: Task<Void, Never>?
    private var businessDayEpoch: UUID?
    private var businessDayTask: Task<Void, Never>?

    public init() {}

    @discardableResult
    public func advanceSession() -> UUID {
        initialLoadTask?.cancel()
        initialLoadTask = nil
        initialLoadEpoch = nil
        businessDayTask?.cancel()
        businessDayTask = nil
        businessDayEpoch = nil
        loadedBusinessDay = nil
        sessionEpoch = UUID()
        return sessionEpoch
    }

    public func isCurrent(_ epoch: UUID, isLoggedIn: Bool) -> Bool {
        isLoggedIn && sessionEpoch == epoch && !Task.isCancelled
    }

    public func markLoaded(today: Date) {
        loadedBusinessDay = BillingDateCalculator.businessDayStart(for: today)
    }

    public func loadInitialIfNeeded(
        isLoggedIn: @escaping @MainActor () -> Bool,
        now: Date = Date(),
        initialLoad: @escaping @MainActor (UUID) async -> Bool,
        dayRefresh: @escaping @MainActor (UUID, Date) async -> Void
    ) async {
        guard isLoggedIn(), !Task.isCancelled else { return }
        let epoch = sessionEpoch
        if initialLoadEpoch == epoch {
            await initialLoadTask?.value
            guard isCurrent(epoch, isLoggedIn: isLoggedIn()) else { return }
            await refreshBusinessDayIfNeeded(isLoggedIn: isLoggedIn, now: now, refresh: dayRefresh)
            return
        }
        initialLoadTask?.cancel()
        initialLoadEpoch = epoch
        let task = Task { @MainActor in
            guard isCurrent(epoch, isLoggedIn: isLoggedIn()) else { return }
            _ = await initialLoad(epoch)
        }
        initialLoadTask = task
        await task.value
        if sessionEpoch == epoch { initialLoadTask = nil }
    }

    public func refreshBusinessDayIfNeeded(
        isLoggedIn: @escaping @MainActor () -> Bool,
        now: Date = Date(),
        refresh: @escaping @MainActor (UUID, Date) async -> Void
    ) async {
        guard isLoggedIn(), !Task.isCancelled else { return }
        let epoch = sessionEpoch
        if initialLoadEpoch == epoch { await initialLoadTask?.value }
        guard isCurrent(epoch, isLoggedIn: isLoggedIn()),
              BillingDateCalculator.needsBusinessDayRefresh(lastLoadedDay: loadedBusinessDay, now: now)
        else { return }
        if businessDayEpoch == epoch, let businessDayTask {
            await businessDayTask.value
            return
        }
        businessDayTask?.cancel()
        businessDayEpoch = epoch
        let task = Task { @MainActor in
            guard isCurrent(epoch, isLoggedIn: isLoggedIn()) else { return }
            await refresh(epoch, now)
        }
        businessDayTask = task
        await task.value
        if sessionEpoch == epoch {
            businessDayTask = nil
            businessDayEpoch = nil
        }
    }
}
