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
