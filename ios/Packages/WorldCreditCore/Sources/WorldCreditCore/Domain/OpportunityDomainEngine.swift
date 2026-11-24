import Foundation
import CryptoKit
import GRDB

// MARK: - Civil Date & Reminder Hash Utilities (matches lib/opportunities/dates.ts & reminders.ts)

public enum OpportunityDates {
    public static func daysInMonth(year: Int, month: Int) -> Int {
        let leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
        switch month {
        case 1, 3, 5, 7, 8, 10, 12: return 31
        case 4, 6, 9, 11: return 30
        case 2: return leap ? 29 : 28
        default: return 30
        }
    }

    public static func isValidCivilDate(_ value: String) -> Bool {
        let parts = value.split(separator: "-", omittingEmptySubsequences: false)
        guard parts.count == 3,
              parts[0].count == 4, parts[1].count == 2, parts[2].count == 2,
              let y = Int(parts[0]), let m = Int(parts[1]), let d = Int(parts[2]),
              (1...12).contains(m), d >= 1 else {
            return false
        }
        return d <= daysInMonth(year: y, month: m)
    }

    private static func parseCivilDate(_ value: String) -> (year: Int, month: Int, day: Int)? {
        guard isValidCivilDate(value) else { return nil }
        let parts = value.split(separator: "-")
        guard let y = Int(parts[0]), let m = Int(parts[1]), let d = Int(parts[2]) else { return nil }
        return (y, m, d)
    }

    public static func localDateInZone(_ date: Date, timeZone timeZoneId: String) -> String {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: timeZoneId) ?? TimeZone(identifier: "Asia/Shanghai")!
        let comps = cal.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", comps.year ?? 1970, comps.month ?? 1, comps.day ?? 1)
    }

    public static func addDays(_ dateOn: String, days: Int) -> String {
        guard let p = parseCivilDate(dateOn) else { return dateOn }
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(secondsFromGMT: 0)!
        let comps = DateComponents(calendar: cal, timeZone: cal.timeZone, year: p.year, month: p.month, day: p.day)
        guard let base = cal.date(from: comps),
              let shifted = cal.date(byAdding: .day, value: days, to: base) else { return dateOn }
        let out = cal.dateComponents([.year, .month, .day], from: shifted)
        return String(format: "%04d-%02d-%02d", out.year ?? p.year, out.month ?? p.month, out.day ?? p.day)
    }

    public static func daysBetween(_ from: String, _ to: String) -> Int {
        guard let a = parseCivilDate(from), let b = parseCivilDate(to) else { return 0 }
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(secondsFromGMT: 0)!
        let da = cal.date(from: DateComponents(calendar: cal, timeZone: cal.timeZone, year: a.year, month: a.month, day: a.day))!
        let db = cal.date(from: DateComponents(calendar: cal, timeZone: cal.timeZone, year: b.year, month: b.month, day: b.day))!
        return Int((db.timeIntervalSince1970 - da.timeIntervalSince1970).rounded() / 86_400)
    }

    /// ISO weekday: 1 = Monday ... 7 = Sunday
    public static func isoWeekday(of dateOn: String) -> Int {
        guard let p = parseCivilDate(dateOn) else { return 1 }
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(secondsFromGMT: 0)!
        let d = cal.date(from: DateComponents(calendar: cal, timeZone: cal.timeZone, year: p.year, month: p.month, day: p.day))!
        let wd = cal.component(.weekday, from: d) // 1=Sun, 2=Mon...7=Sat
        return wd == 1 ? 7 : wd - 1
    }

    private static func jsonString(_ str: String) -> String {
        var out = "\""
        for ch in str.unicodeScalars {
            switch ch {
            case "\"": out += "\\\""
            case "\\": out += "\\\\"
            case "\n": out += "\\n"
            case "\r": out += "\\r"
            case "\t": out += "\\t"
            default:
                if ch.value < 0x20 {
                    out += String(format: "\\u%04x", ch.value)
                } else {
                    out.unicodeScalars.append(ch)
                }
            }
        }
        out += "\""
        return out
    }

    public static func reminderEventKey(
        type: String,
        objectId: String,
        cycleOrGrantKey: String,
        deadlineBefore: String?,
        version: String
    ) -> String {
        let deadlinePart = deadlineBefore.map(jsonString) ?? "null"
        let canonical = "{\"deadline_before\":\(deadlinePart),\"version\":\(jsonString(version))}"
        let digest = SHA256.hash(data: Data(canonical.utf8))
        let hex = digest.map { String(format: "%02x", $0) }.joined()
        return "op:\(type):\(objectId):\(cycleOrGrantKey):\(String(hex.prefix(12)))"
    }
}

// MARK: - Availability State Machine (matches lib/opportunities/availability.ts & view-model.ts)

public enum OpportunityAvailabilityStatus: String, CaseIterable, Codable, Sendable, Identifiable {
    case availableToday = "available_today"
    case expiringSoon = "expiring_soon"
    case claimable = "claimable"
    case exhausted = "exhausted"
    case needsConfirmation = "needs_confirmation"
    case notStarted = "not_started"
    case expired = "expired"

    public var id: String { rawValue }

    public var label: String {
        switch self {
        case .availableToday: return "今天可用"
        case .expiringSoon: return "即将到期"
        case .claimable: return "待领取"
        case .exhausted: return "已用尽"
        case .needsConfirmation: return "需确认"
        case .notStarted: return "未开始"
        case .expired: return "已失效"
        }
    }

    public var sortRank: Int {
        switch self {
        case .expiringSoon: return 0
        case .availableToday: return 1
        case .claimable: return 2
        case .needsConfirmation: return 3
        case .exhausted: return 4
        case .notStarted: return 5
        case .expired: return 6
        }
    }
}

public enum OpportunityAvailabilityAction: String, Codable, Sendable {
    case recordUsage = "record_usage"
    case recordBooking = "record_booking"
    case recordClaim = "record_claim"
    case viewEntry = "view_entry"
    case fixData = "fix_data"
    case none = "none"

    public var label: String {
        switch self {
        case .recordUsage: return "记录使用"
        case .recordBooking: return "记录预约"
        case .recordClaim: return "记录已领取"
        case .viewEntry: return "查看参与方式"
        case .fixData: return "去核对"
        case .none: return "查看"
        }
    }
}

public struct OpportunityAvailabilityResult: Equatable, Sendable {
    public let status: OpportunityAvailabilityStatus
    public let action: OpportunityAvailabilityAction
    public let usableToday: Bool
    public let reason: String
    public let daysLeft: Int?
    public let needsReview: Bool
    public let remainingCount: Int?
    public let remainingMinor: Int?

    public init(
        status: OpportunityAvailabilityStatus,
        action: OpportunityAvailabilityAction,
        usableToday: Bool,
        reason: String,
        daysLeft: Int?,
        needsReview: Bool,
        remainingCount: Int?,
        remainingMinor: Int?
    ) {
        self.status = status
        self.action = action
        self.usableToday = usableToday
        self.reason = reason
        self.daysLeft = daysLeft
        self.needsReview = needsReview
        self.remainingCount = remainingCount
        self.remainingMinor = remainingMinor
    }
}

public enum OpportunityDomainEngine {
    public static let expiringWindowDays = 7
    public static let calendarMaxDays = 92
    public static let reminderHorizonDays = 30

    public static func computeAvailability(
        todayOn: String,
        weekday: Int,
        rules: RuleSnapshotV1,
        definitionStatus: String,
        terminatedAt: String?,
        accountStatus: String,
        eligibility: String,
        eligibleFromOn: String?,
        hasActiveLinkedCard: Bool,
        cycle: OpportunityCycleRecord?,
        balanceVerified: Bool
    ) -> OpportunityAvailabilityResult {
        let needsReview = !balanceVerified
        func daysLeft(_ endBefore: String?) -> Int? {
            endBefore.map { OpportunityDates.daysBetween(todayOn, $0) }
        }

        if definitionStatus == "archived" {
            return OpportunityAvailabilityResult(status: .expired, action: .viewEntry, usableToday: false, reason: "该权益定义已归档", daysLeft: nil, needsReview: needsReview, remainingCount: nil, remainingMinor: nil)
        }
        if terminatedAt != nil {
            return OpportunityAvailabilityResult(status: .expired, action: .viewEntry, usableToday: false, reason: "该规则已提前终止", daysLeft: nil, needsReview: needsReview, remainingCount: nil, remainingMinor: nil)
        }
        if accountStatus == "archived" {
            return OpportunityAvailabilityResult(status: .expired, action: .viewEntry, usableToday: false, reason: "该账户已归档，历史仍可查看", daysLeft: nil, needsReview: needsReview, remainingCount: nil, remainingMinor: nil)
        }
        if eligibility == "ineligible" {
            return OpportunityAvailabilityResult(status: .expired, action: .fixData, usableToday: false, reason: "资格已确认不适用", daysLeft: nil, needsReview: needsReview, remainingCount: nil, remainingMinor: nil)
        }
        if let validUntil = rules.validUntilBefore, todayOn >= validUntil {
            return OpportunityAvailabilityResult(status: .expired, action: .viewEntry, usableToday: false, reason: "使用期已结束", daysLeft: 0, needsReview: needsReview, remainingCount: nil, remainingMinor: nil)
        }
        if let validFrom = rules.validFrom, todayOn < validFrom {
            let left = daysLeft(validFrom).map { max($0, 0) }
            return OpportunityAvailabilityResult(status: .notStarted, action: .viewEntry, usableToday: false, reason: "使用期尚未开始", daysLeft: left, needsReview: needsReview, remainingCount: nil, remainingMinor: nil)
        }
        if !rules.openEnded && rules.validUntilBefore == nil {
            return OpportunityAvailabilityResult(status: .needsConfirmation, action: .fixData, usableToday: false, reason: "规则缺少截止日期，需先确认有效期", daysLeft: nil, needsReview: needsReview, remainingCount: nil, remainingMinor: nil)
        }
        if rules.requiresPersonalConfirmation && eligibility == "unknown" {
            return OpportunityAvailabilityResult(status: .needsConfirmation, action: .fixData, usableToday: false, reason: "该权益需要先确认个人资格", daysLeft: daysLeft(rules.validUntilBefore), needsReview: needsReview, remainingCount: nil, remainingMinor: nil)
        }
        if let eligibleFrom = eligibleFromOn, todayOn < eligibleFrom {
            return OpportunityAvailabilityResult(status: .notStarted, action: .viewEntry, usableToday: false, reason: "个人资格自该日起生效", daysLeft: daysLeft(eligibleFrom), needsReview: needsReview, remainingCount: nil, remainingMinor: nil)
        }
        if !hasActiveLinkedCard {
            return OpportunityAvailabilityResult(status: .needsConfirmation, action: .fixData, usableToday: false, reason: "没有可用的关联信用卡（冻结、注销或贷款卡不算）", daysLeft: daysLeft(rules.validUntilBefore), needsReview: needsReview, remainingCount: nil, remainingMinor: nil)
        }

        let weekdayOk = rules.weekdays.map { $0.contains(weekday) } ?? true

        if rules.allocation == "grant_only" {
            if let cycle, cycle.activationState == "active" {
                return finishWithBalance(todayOn: todayOn, rules: rules, cycle: cycle, weekdayOk: weekdayOk, needsReview: needsReview)
            }
            return OpportunityAvailabilityResult(status: .exhausted, action: .viewEntry, usableToday: false, reason: "奖励配额尚未到账", daysLeft: daysLeft(rules.validUntilBefore), needsReview: needsReview, remainingCount: nil, remainingMinor: nil)
        }

        guard let cycle else {
            return OpportunityAvailabilityResult(status: .needsConfirmation, action: .fixData, usableToday: false, reason: "未找到覆盖今天的周期，请核对周期规则", daysLeft: daysLeft(rules.validUntilBefore), needsReview: needsReview, remainingCount: nil, remainingMinor: nil)
        }

        if cycle.activationState == "voided" {
            return OpportunityAvailabilityResult(status: .expired, action: .viewEntry, usableToday: false, reason: "当前周期已作废", daysLeft: daysLeft(cycle.usableEndBefore), needsReview: needsReview, remainingCount: nil, remainingMinor: nil)
        }
        if todayOn < cycle.usableStartOn {
            return OpportunityAvailabilityResult(status: .notStarted, action: .viewEntry, usableToday: false, reason: "本期自 \(cycle.usableStartOn) 起可用", daysLeft: daysLeft(cycle.usableStartOn), needsReview: needsReview, remainingCount: nil, remainingMinor: nil)
        }
        if let usableEnd = cycle.usableEndBefore, todayOn >= usableEnd {
            return OpportunityAvailabilityResult(status: .expired, action: .viewEntry, usableToday: false, reason: "本期已结束", daysLeft: 0, needsReview: needsReview, remainingCount: nil, remainingMinor: nil)
        }

        if cycle.activationState == "pending_claim" {
            guard let window = rules.claimWindow else {
                return OpportunityAvailabilityResult(status: .claimable, action: .recordClaim, usableToday: false, reason: "本期尚未领取", daysLeft: daysLeft(cycle.usableEndBefore), needsReview: needsReview, remainingCount: nil, remainingMinor: nil)
            }
            if let starts = window.startsAt, todayOn < String(starts.prefix(10)) {
                return OpportunityAvailabilityResult(status: .notStarted, action: .viewEntry, usableToday: false, reason: "领取窗口尚未开启", daysLeft: daysLeft(String(starts.prefix(10))), needsReview: needsReview, remainingCount: nil, remainingMinor: nil)
            }
            if let ends = window.endsAt, todayOn > String(ends.prefix(10)) {
                return OpportunityAvailabilityResult(status: .needsConfirmation, action: .fixData, usableToday: false, reason: "领取窗口已关闭且本期未领取，请核对规则", daysLeft: daysLeft(cycle.usableEndBefore), needsReview: needsReview, remainingCount: nil, remainingMinor: nil)
            }
            return OpportunityAvailabilityResult(status: .claimable, action: .recordClaim, usableToday: false, reason: "领取窗口已开启，尚未记录领取", daysLeft: daysLeft(cycle.usableEndBefore), needsReview: needsReview, remainingCount: nil, remainingMinor: nil)
        }

        return finishWithBalance(todayOn: todayOn, rules: rules, cycle: cycle, weekdayOk: weekdayOk, needsReview: needsReview)
    }

    private static func finishWithBalance(
        todayOn: String,
        rules: RuleSnapshotV1,
        cycle: OpportunityCycleRecord,
        weekdayOk: Bool,
        needsReview: Bool
    ) -> OpportunityAvailabilityResult {
        let endBefore = cycle.usableEndBefore ?? rules.validUntilBefore
        let daysLeft = endBefore.map { OpportunityDates.daysBetween(todayOn, $0) }
        let remainingCount = cycle.countLimit.map {
            max($0 - cycle.openingUsedCount - cycle.usedCount - cycle.reservedCount, 0)
        }
        let remainingMinor = cycle.amountLimitMinor.map {
            max($0 - cycle.openingUsedMinor - cycle.usedMinor - cycle.reservedMinor, 0)
        }
        let exhausted = (remainingCount.map { $0 <= 0 } ?? false) || (remainingMinor.map { $0 <= 0 } ?? false)
        if exhausted {
            let reservedOnly = ((remainingCount ?? 1) <= 0 && cycle.reservedCount > 0)
                || ((remainingMinor ?? 1) <= 0 && cycle.reservedMinor > 0)
            return OpportunityAvailabilityResult(
                status: .exhausted,
                action: .viewEntry,
                usableToday: false,
                reason: reservedOnly ? "本期额度已被预约占用" : "本期额度已用完",
                daysLeft: daysLeft,
                needsReview: needsReview,
                remainingCount: remainingCount,
                remainingMinor: remainingMinor
            )
        }

        if !weekdayOk {
            let status: OpportunityAvailabilityStatus = (daysLeft != nil && daysLeft! <= expiringWindowDays) ? .expiringSoon : .availableToday
            return OpportunityAvailabilityResult(
                status: status,
                action: .recordUsage,
                usableToday: false,
                reason: "今天不在有效星期内",
                daysLeft: daysLeft,
                needsReview: needsReview,
                remainingCount: remainingCount,
                remainingMinor: remainingMinor
            )
        }

        if let left = daysLeft, left <= expiringWindowDays {
            return OpportunityAvailabilityResult(
                status: .expiringSoon,
                action: .recordUsage,
                usableToday: true,
                reason: left <= 0 ? "今天截止" : "\(left) 天内结束",
                daysLeft: left,
                needsReview: needsReview,
                remainingCount: remainingCount,
                remainingMinor: remainingMinor
            )
        }

        return OpportunityAvailabilityResult(
            status: .availableToday,
            action: .recordUsage,
            usableToday: true,
            reason: "今天可用",
            daysLeft: daysLeft,
            needsReview: needsReview,
            remainingCount: remainingCount,
            remainingMinor: remainingMinor
        )
    }

    // MARK: - Formatting Helpers (matches lib/opportunities/view-model.ts)

    public static func formatMinorAmount(_ minor: Int, currency: String?) -> String {
        let normalized = DashboardFx.normalizeCurrency(currency) ?? "CNY"
        return DashboardMoney.format(Double(minor) / 100.0, currency: normalized)
    }

    public static func formatBalance(
        cycle: OpportunityCycleRecord?,
        availability: OpportunityAvailabilityResult
    ) -> (main: String, sub: String) {
        guard let cycle else {
            return (availability.status == .needsConfirmation ? "待确认" : "—", "")
        }
        if let countLimit = cycle.countLimit {
            return ("剩余 \(availability.remainingCount ?? 0) 次", "共 \(countLimit) 次")
        }
        if let amountLimit = cycle.amountLimitMinor {
            return (
                "剩余 \(formatMinorAmount(availability.remainingMinor ?? 0, currency: cycle.currency))",
                "共 \(formatMinorAmount(amountLimit, currency: cycle.currency))"
            )
        }
        return ("不限次数", "")
    }

    public static func deadlineText(daysLeft: Int?, deadlineOn: String?) -> String {
        guard let deadlineOn else { return "无固定截止" }
        guard let daysLeft else { return "截止 \(deadlineOn)" }
        if daysLeft <= 0 { return "今天截止" }
        if daysLeft == 1 { return "明天截止" }
        return "\(daysLeft) 天后截止（\(deadlineOn)）"
    }

    // MARK: - Task Evaluation (matches lib/opportunities/tasks.ts)

    public struct EvaluatedTaskMetric: Equatable, Sendable, Identifiable {
        public let id: String
        public let kind: String
        public let targetMinor: Int?
        public let targetCount: Int?
        public let perTxnMinMinor: Int?
        public let label: String?
        public let currentValue: Double
        public let checked: Bool
        public let satisfied: Bool
        public let gap: Double?
    }

    public struct EvaluatedTaskGroup: Equatable, Sendable, Identifiable {
        public let id: String
        public let satisfied: Bool
        public let metrics: [EvaluatedTaskMetric]
    }

    public struct TaskEvaluationResult: Equatable, Sendable {
        public let satisfied: Bool
        public let groups: [EvaluatedTaskGroup]
    }

    public static func evaluateTask(rules: TaskConditionsV1, progress: ManualProgress) -> TaskEvaluationResult {
        var evaluatedGroups: [EvaluatedTaskGroup] = []
        for group in rules.groups {
            var metrics: [EvaluatedTaskMetric] = []
            for m in group.metrics {
                let rawVal = progress.metricValues[m.id]
                if m.kind == "check" {
                    let isChecked = rawVal?.boolValue ?? false
                    metrics.append(EvaluatedTaskMetric(
                        id: m.id,
                        kind: m.kind,
                        targetMinor: nil,
                        targetCount: nil,
                        perTxnMinMinor: nil,
                        label: m.label,
                        currentValue: isChecked ? 1 : 0,
                        checked: isChecked,
                        satisfied: isChecked,
                        gap: nil
                    ))
                } else {
                    let target = Double(m.kind == "amount" ? (m.targetMinor ?? 0) : (m.targetCount ?? 0))
                    let value = max(0.0, rawVal?.numericValue ?? 0.0)
                    let gap = max(0.0, target - value)
                    metrics.append(EvaluatedTaskMetric(
                        id: m.id,
                        kind: m.kind,
                        targetMinor: m.targetMinor,
                        targetCount: m.targetCount,
                        perTxnMinMinor: m.perTxnMinMinor,
                        label: m.label,
                        currentValue: value,
                        checked: false,
                        satisfied: gap == 0,
                        gap: gap
                    ))
                }
            }
            evaluatedGroups.append(EvaluatedTaskGroup(
                id: group.id,
                satisfied: metrics.allSatisfy(\.satisfied),
                metrics: metrics
            ))
        }
        return TaskEvaluationResult(satisfied: evaluatedGroups.contains(where: \.satisfied), groups: evaluatedGroups)
    }

    // MARK: - Calendar Events Builders (matches lib/opportunities/reminders.ts)

    public static func buildCycleCalendarEvents(
        accountId: String,
        cycleId: String?,
        title: String,
        timeZone: String,
        usableStartOn: String,
        usableEndBefore: String?,
        nextResetOn: String?,
        claimWindow: ClaimWindowSpec?,
        versionId: String,
        verification: String
    ) -> [OpportunityCalendarEventView] {
        var events: [OpportunityCalendarEventView] = []
        let needsReview = verification == "unverified"

        if let usableEndBefore, OpportunityDates.isValidCivilDate(usableEndBefore) {
            let lastUsableDay = OpportunityDates.addDays(usableEndBefore, days: -1)
            let expiryKey = OpportunityDates.reminderEventKey(
                type: "expiry",
                objectId: accountId,
                cycleOrGrantKey: cycleId ?? "nocycle",
                deadlineBefore: usableEndBefore,
                version: versionId
            )
            events.append(OpportunityCalendarEventView(
                eventKey: expiryKey,
                kind: "cycle_expiry",
                accountId: accountId,
                cycleId: cycleId,
                taskCycleId: nil,
                fulfillmentId: nil,
                title: title,
                localDateOn: lastUsableDay,
                timeZone: timeZone,
                deadlineBefore: usableEndBefore,
                actionHint: "本期权益将于次日失效",
                needsReview: needsReview
            ))

            if let nextResetOn, OpportunityDates.isValidCivilDate(nextResetOn) {
                let resetKey = OpportunityDates.reminderEventKey(
                    type: "reset",
                    objectId: accountId,
                    cycleOrGrantKey: cycleId ?? "nocycle",
                    deadlineBefore: usableEndBefore,
                    version: versionId
                )
                events.append(OpportunityCalendarEventView(
                    eventKey: resetKey,
                    kind: "cycle_reset",
                    accountId: accountId,
                    cycleId: cycleId,
                    taskCycleId: nil,
                    fulfillmentId: nil,
                    title: title,
                    localDateOn: nextResetOn,
                    timeZone: timeZone,
                    deadlineBefore: usableEndBefore,
                    actionHint: "新周期开始，额度重置",
                    needsReview: needsReview
                ))
            }
        }

        if let window = claimWindow {
            let endsDate = window.endsAt.map { String($0.prefix(10)) }
            let startsDate = window.startsAt.map { String($0.prefix(10)) }
            if let startsDate, OpportunityDates.isValidCivilDate(startsDate) {
                let validEnds = endsDate.flatMap { OpportunityDates.isValidCivilDate($0) ? $0 : nil }
                let openKey = OpportunityDates.reminderEventKey(
                    type: "claim_open",
                    objectId: accountId,
                    cycleOrGrantKey: cycleId ?? "nocycle",
                    deadlineBefore: validEnds,
                    version: versionId
                )
                events.append(OpportunityCalendarEventView(
                    eventKey: openKey,
                    kind: "claim_window_open",
                    accountId: accountId,
                    cycleId: cycleId,
                    taskCycleId: nil,
                    fulfillmentId: nil,
                    title: title,
                    localDateOn: startsDate,
                    timeZone: timeZone,
                    deadlineBefore: validEnds,
                    actionHint: "领取窗口开启",
                    needsReview: needsReview
                ))
            }
            if let endsDate, OpportunityDates.isValidCivilDate(endsDate) {
                let deadlineKey = OpportunityDates.reminderEventKey(
                    type: "claim_deadline",
                    objectId: accountId,
                    cycleOrGrantKey: cycleId ?? "nocycle",
                    deadlineBefore: endsDate,
                    version: versionId
                )
                events.append(OpportunityCalendarEventView(
                    eventKey: deadlineKey,
                    kind: "claim_window_deadline",
                    accountId: accountId,
                    cycleId: cycleId,
                    taskCycleId: nil,
                    fulfillmentId: nil,
                    title: title,
                    localDateOn: endsDate,
                    timeZone: timeZone,
                    deadlineBefore: endsDate,
                    actionHint: "领取窗口截止",
                    needsReview: needsReview
                ))
            }
        }
        return events
    }

    public static func buildTaskCalendarEvents(
        taskCycleId: String,
        title: String,
        deadlineAt: String,
        expectedFromOn: String?,
        expectedUntilBefore: String?,
        satisfied: Bool,
        version: String = "task"
    ) -> [OpportunityCalendarEventView] {
        var events: [OpportunityCalendarEventView] = []
        let deadlineDate = String(deadlineAt.prefix(10))
        if OpportunityDates.isValidCivilDate(deadlineDate) {
            let key = OpportunityDates.reminderEventKey(
                type: "task_deadline",
                objectId: taskCycleId,
                cycleOrGrantKey: taskCycleId,
                deadlineBefore: deadlineDate,
                version: version
            )
            events.append(OpportunityCalendarEventView(
                eventKey: key,
                kind: "task_deadline",
                accountId: nil,
                cycleId: nil,
                taskCycleId: taskCycleId,
                fulfillmentId: nil,
                title: title,
                localDateOn: deadlineDate,
                timeZone: "Asia/Shanghai",
                deadlineBefore: deadlineDate,
                actionHint: "任务统计截止",
                needsReview: false
            ))
        }
        if satisfied, let expectedFromOn, OpportunityDates.isValidCivilDate(expectedFromOn) {
            let key = OpportunityDates.reminderEventKey(
                type: "reward_window",
                objectId: taskCycleId,
                cycleOrGrantKey: taskCycleId,
                deadlineBefore: expectedUntilBefore,
                version: version
            )
            events.append(OpportunityCalendarEventView(
                eventKey: key,
                kind: "reward_window",
                accountId: nil,
                cycleId: nil,
                taskCycleId: taskCycleId,
                fulfillmentId: nil,
                title: title,
                localDateOn: expectedFromOn,
                timeZone: "Asia/Shanghai",
                deadlineBefore: expectedUntilBefore,
                actionHint: "奖励预计发放窗口（实际到账需手动记录）",
                needsReview: false
            ))
        }
        return events
    }

    public static func buildBookingCalendarEvents(
        fulfillmentId: String,
        accountId: String?,
        cycleId: String?,
        title: String,
        serviceAt: String,
        serviceTimeZone: String
    ) -> [OpportunityCalendarEventView] {
        let serviceDate = String(serviceAt.prefix(10))
        guard OpportunityDates.isValidCivilDate(serviceDate) else { return [] }
        let key = OpportunityDates.reminderEventKey(
            type: "booking_service",
            objectId: fulfillmentId,
            cycleOrGrantKey: fulfillmentId,
            deadlineBefore: serviceDate,
            version: serviceAt
        )
        return [
            OpportunityCalendarEventView(
                eventKey: key,
                kind: "booking_service",
                accountId: accountId,
                cycleId: cycleId,
                taskCycleId: nil,
                fulfillmentId: fulfillmentId,
                title: title,
                localDateOn: serviceDate,
                timeZone: serviceTimeZone,
                deadlineBefore: serviceDate,
                actionHint: "预约服务时间（完成或取消后在此记录结算）",
                needsReview: false
            )
        ]
    }
}

// MARK: - View Models for Native Opportunity UI

public struct OpportunityLedgerItem: Identifiable, Equatable, Sendable {
    public var id: String { account.id }
    public let account: OpportunityAccountRecord
    public let definition: OpportunityDefinitionRecord
    public let ruleVersion: OpportunityRuleVersionRecord
    public let rules: RuleSnapshotV1
    public let holderName: String
    public let bankName: String?
    public let cardIds: [String]
    public let currentCycle: OpportunityCycleRecord?
    public let todayOn: String
    public let availability: OpportunityAvailabilityResult
    public let balanceMain: String
    public let balanceSub: String
    public let deadlineLabel: String
    public let sharedText: String
    public let reviewHint: String?
    public let followed: Bool
    public let userStateRevision: Int
    public let pendingClaimFulfillment: OpportunityFulfillmentRecord?
    public let activeBookings: [OpportunityFulfillmentRecord]
    public let canBook: Bool
}

public struct OpportunityCalendarEventView: Identifiable, Equatable, Sendable {
    public var id: String { eventKey }
    public let eventKey: String
    public let kind: String
    public let accountId: String?
    public let cycleId: String?
    public let taskCycleId: String?
    public let fulfillmentId: String?
    public let title: String
    public let localDateOn: String
    public let timeZone: String
    public let deadlineBefore: String?
    public let actionHint: String
    public let needsReview: Bool
    public var dismissed: Bool
    public var snoozedUntil: String?
    public var readSteps: [String]
    public var stateRevision: Int

    public init(
        eventKey: String,
        kind: String,
        accountId: String?,
        cycleId: String?,
        taskCycleId: String?,
        fulfillmentId: String?,
        title: String,
        localDateOn: String,
        timeZone: String,
        deadlineBefore: String?,
        actionHint: String,
        needsReview: Bool,
        dismissed: Bool = false,
        snoozedUntil: String? = nil,
        readSteps: [String] = [],
        stateRevision: Int = 0
    ) {
        self.eventKey = eventKey
        self.kind = kind
        self.accountId = accountId
        self.cycleId = cycleId
        self.taskCycleId = taskCycleId
        self.fulfillmentId = fulfillmentId
        self.title = title
        self.localDateOn = localDateOn
        self.timeZone = timeZone
        self.deadlineBefore = deadlineBefore
        self.actionHint = actionHint
        self.needsReview = needsReview
        self.dismissed = dismissed
        self.snoozedUntil = snoozedUntil
        self.readSteps = readSteps
        self.stateRevision = stateRevision
    }

    public var kindLabel: String {
        switch kind {
        case "cycle_expiry": return "权益到期"
        case "cycle_reset": return "周期重置"
        case "claim_window_open": return "领取开启"
        case "claim_window_deadline": return "领取截止"
        case "task_deadline": return "任务截止"
        case "reward_window": return "奖励发放窗口"
        case "booking_service": return "预约服务"
        default: return "日程提醒"
        }
    }
}

public struct OpportunityTaskView: Identifiable, Equatable, Sendable {
    public var id: String { task.id }
    public let task: OpportunityTaskRecord
    public let cycle: OpportunityTaskCycleRecord
    public let holderName: String
    public let cardIds: [String]
    public let rules: TaskConditionsV1
    public let rewardPlan: TaskRewardPlan?
    public let progress: ManualProgress
    public let evaluation: OpportunityDomainEngine.TaskEvaluationResult
    public let rewardFulfillment: OpportunityFulfillmentRecord?
    public var rewardRecorded: Bool { rewardFulfillment != nil && rewardFulfillment?.status != "cancelled" }
}

// MARK: - GRDB Local Query Service

public struct OpportunityQueryService: Sendable {
    public let dbManager: DatabaseManager

    public init(dbManager: DatabaseManager) {
        self.dbManager = dbManager
    }

    public func fetchLedger(
        userId: String? = nil,
        holderId: String? = nil,
        cardId: String? = nil,
        bankId: String? = nil,
        category: String? = nil,
        kind: String? = nil,
        status: OpportunityAvailabilityStatus? = nil,
        query: String? = nil,
        today: Date = Date()
    ) async throws -> (items: [OpportunityLedgerItem], counts: [String: Int]) {
        try await dbManager.dbWriter.read { db in
            let accounts = try OpportunityAccountRecord.fetchAll(db)
            let definitions = Dictionary(uniqueKeysWithValues: try OpportunityDefinitionRecord.fetchAll(db).map { ($0.id, $0) })
            let versions = try OpportunityRuleVersionRecord.fetchAll(db)
            let holders = Dictionary(uniqueKeysWithValues: try CardHolder.fetchAll(db).map { ($0.id, $0) })
            let banks = Dictionary(uniqueKeysWithValues: try Bank.fetchAll(db).map { ($0.id, $0) })
            let cardsById = Dictionary(uniqueKeysWithValues: try CreditCard.fetchAll(db).map { ($0.id, $0) })
            let accountCards = try OpportunityAccountCardRecord.filter(Column("retired_at") == nil).fetchAll(db)
            let cycles = try OpportunityCycleRecord.fetchAll(db)
            let fulfillments = try OpportunityFulfillmentRecord.fetchAll(db)
            let userStates: [String: OpportunityUserStateRecord] = {
                let rows = (try? OpportunityUserStateRecord.fetchAll(db)) ?? []
                var map: [String: OpportunityUserStateRecord] = [:]
                for r in rows {
                    if let userId, !userId.isEmpty {
                        if r.userId == userId { map[r.accountId] = r }
                    } else if map[r.accountId] == nil {
                        map[r.accountId] = r
                    }
                }
                return map
            }()

            var latestVersionByDef: [String: OpportunityRuleVersionRecord] = [:]
            for v in versions {
                if let current = latestVersionByDef[v.definitionId] {
                    if v.version > current.version { latestVersionByDef[v.definitionId] = v }
                } else {
                    latestVersionByDef[v.definitionId] = v
                }
            }

            let linkedCardsByAcc = Dictionary(grouping: accountCards, by: \.accountId)
            let cyclesByAcc = Dictionary(grouping: cycles, by: \.accountId)
            let fulfillmentsByAcc = Dictionary(grouping: fulfillments.filter { $0.accountId != nil }, by: { $0.accountId! })

            let decoder = JSONDecoder()
            var allItems: [OpportunityLedgerItem] = []

            for account in accounts {
                if let holderId, account.holderId != holderId { continue }
                guard let def = definitions[account.definitionId],
                      let version = latestVersionByDef[def.id],
                      let rulesData = version.rulesJson.data(using: .utf8),
                      let rules = try? decoder.decode(RuleSnapshotV1.self, from: rulesData) else {
                    continue
                }
                if let kind, def.kind != kind { continue }
                if let bankId, rules.bankId != bankId { continue }
                if let category, rules.category != category { continue }
                if let q = query?.trimmingCharacters(in: .whitespacesAndNewlines), !q.isEmpty,
                   !rules.title.localizedCaseInsensitiveContains(q) {
                    continue
                }

                let linkedCardIds = (linkedCardsByAcc[account.id] ?? []).map(\.cardId).sorted()
                if let cardId, !linkedCardIds.contains(cardId) { continue }

                let hasActiveLinkedCard = linkedCardIds.contains { cid in
                    guard let c = cardsById[cid] else { return false }
                    return c.status == "active" && c.cardType != "loan"
                }

                let todayOn = OpportunityDates.localDateInZone(today, timeZone: rules.timeZone)
                let weekday = OpportunityDates.isoWeekday(of: todayOn)
                let accCycles = cyclesByAcc[account.id] ?? []
                let covering = accCycles
                    .filter { c in
                        todayOn >= c.usableStartOn && (c.usableEndBefore == nil || todayOn < c.usableEndBefore!)
                    }
                    .sorted { a, b in
                        if a.allocationKind != b.allocationKind {
                            return a.allocationKind == "regular"
                        }
                        return a.periodStartOn > b.periodStartOn
                    }
                    .first

                let availability = OpportunityDomainEngine.computeAvailability(
                    todayOn: todayOn,
                    weekday: weekday,
                    rules: rules,
                    definitionStatus: def.status,
                    terminatedAt: def.terminatedAt,
                    accountStatus: account.status,
                    eligibility: account.eligibility,
                    eligibleFromOn: account.eligibleFromOn,
                    hasActiveLinkedCard: hasActiveLinkedCard,
                    cycle: covering,
                    balanceVerified: covering?.balanceVerified ?? false
                )

                let (mainBal, subBal) = OpportunityDomainEngine.formatBalance(cycle: covering, availability: availability)
                let rawDeadlineOn: String? = {
                    if let usableEnd = covering?.usableEndBefore {
                        return OpportunityDates.addDays(usableEnd, days: -1)
                    }
                    if let validUntil = rules.validUntilBefore {
                        return OpportunityDates.addDays(validUntil, days: -1)
                    }
                    return nil
                }()
                let sharedText = (account.scopeKind == "holder" && linkedCardIds.count > 1)
                    ? "\(linkedCardIds.count) 张卡共享额度"
                    : ""
                let bankName = rules.bankId.flatMap { banks[$0]?.shortName ?? banks[$0]?.name }
                let accFulfillments = fulfillmentsByAcc[account.id] ?? []
                let pendingClaim = accFulfillments.first {
                    $0.kind == "claim" && $0.cycleId == covering?.id && $0.status == "recorded"
                }
                let activeBookings = accFulfillments
                    .filter { $0.kind == "booking" && ($0.status == "recorded" || $0.status == "pending_settlement") }
                    .sorted { ($0.serviceAt ?? "") < ($1.serviceAt ?? "") }
                let userState = userStates[account.id]

                allItems.append(OpportunityLedgerItem(
                    account: account,
                    definition: def,
                    ruleVersion: version,
                    rules: rules,
                    holderName: holders[account.holderId]?.name ?? "",
                    bankName: bankName,
                    cardIds: linkedCardIds,
                    currentCycle: covering,
                    todayOn: todayOn,
                    availability: availability,
                    balanceMain: mainBal,
                    balanceSub: subBal,
                    deadlineLabel: OpportunityDomainEngine.deadlineText(daysLeft: availability.daysLeft, deadlineOn: rawDeadlineOn),
                    sharedText: sharedText,
                    reviewHint: availability.needsReview ? "期初余额未核对" : nil,
                    followed: userState?.followed ?? false,
                    userStateRevision: userState?.revision ?? 0,
                    pendingClaimFulfillment: pendingClaim,
                    activeBookings: activeBookings,
                    canBook: rules.bookingWindow != nil || covering != nil && availability.status == .availableToday || availability.status == .expiringSoon
                ))
            }

            var counts: [String: Int] = [:]
            for s in OpportunityAvailabilityStatus.allCases { counts[s.rawValue] = 0 }
            for item in allItems {
                counts[item.availability.status.rawValue, default: 0] += 1
            }

            let filtered = allItems
                .filter { item in
                    guard let status else { return true }
                    return item.availability.status == status
                }
                .sorted { lhs, rhs in
                    if lhs.availability.status.sortRank != rhs.availability.status.sortRank {
                        return lhs.availability.status.sortRank < rhs.availability.status.sortRank
                    }
                    let ld = lhs.availability.daysLeft ?? Int.max
                    let rd = rhs.availability.daysLeft ?? Int.max
                    if ld != rd { return ld < rd }
                    return lhs.rules.title < rhs.rules.title
                }

            return (filtered, counts)
        }
    }

    public func fetchDetail(
        accountId: String,
        userId: String? = nil,
        today: Date = Date()
    ) async throws -> (
        item: OpportunityLedgerItem,
        cycles: [OpportunityCycleRecord],
        usages: [OpportunityUsageRecord],
        fulfillments: [OpportunityFulfillmentRecord]
    )? {
        let ledger = try await fetchLedger(userId: userId, today: today)
        guard let item = ledger.items.first(where: { $0.account.id == accountId }) else { return nil }
        return try await dbManager.dbWriter.read { db in
            let cycles = try OpportunityCycleRecord
                .filter(Column("account_id") == accountId)
                .order(Column("period_start_on").desc)
                .fetchAll(db)
            let usages = try OpportunityUsageRecord
                .filter(Column("account_id") == accountId)
                .order(Column("used_on").desc, Column("created_at").desc)
                .fetchAll(db)
            let fulfillments = try OpportunityFulfillmentRecord
                .filter(Column("account_id") == accountId)
                .order(Column("created_at").desc)
                .fetchAll(db)
            return (item, cycles, usages, fulfillments)
        }
    }

    public func fetchTodayAvailableCount(today: Date = Date()) async throws -> Int {
        let ledger = try await fetchLedger(today: today)
        let available = ledger.counts[OpportunityAvailabilityStatus.availableToday.rawValue] ?? 0
        let expiring = ledger.counts[OpportunityAvailabilityStatus.expiringSoon.rawValue] ?? 0
        let claimable = ledger.counts[OpportunityAvailabilityStatus.claimable.rawValue] ?? 0
        return available + expiring + claimable
    }

    public func fetchCalendar(
        fromOn: String,
        toBefore: String,
        holderId: String? = nil,
        cardId: String? = nil,
        userId: String? = nil,
        today: Date = Date()
    ) async throws -> [OpportunityCalendarEventView] {
        try await dbManager.dbWriter.read { db in
            let rawEvents = try loadAllRawCalendarEvents(
                in: db,
                holderId: holderId,
                cardId: cardId,
                today: today
            )
            let stateMap = try loadReminderStateMap(userId: userId, in: db)
            let decoder = JSONDecoder()

            return rawEvents
                .filter { $0.localDateOn >= fromOn && $0.localDateOn < toBefore }
                .sorted { lhs, rhs in
                    if lhs.localDateOn != rhs.localDateOn { return lhs.localDateOn < rhs.localDateOn }
                    return lhs.eventKey < rhs.eventKey
                }
                .map { event in
                    var e = event
                    if let st = stateMap[event.eventKey] {
                        e.dismissed = st.dismissedAt != nil
                        e.snoozedUntil = st.snoozeUntil
                        e.stateRevision = st.revision
                        if let data = st.readStepsJson.data(using: .utf8),
                           let steps = try? decoder.decode([String].self, from: data) {
                            e.readSteps = steps
                        }
                    }
                    return e
                }
        }
    }

    public func fetchReminders(
        userId: String? = nil,
        holderId: String? = nil,
        cardId: String? = nil,
        today: Date = Date()
    ) async throws -> [OpportunityCalendarEventView] {
        let todayOn = OpportunityDates.localDateInZone(today, timeZone: "Asia/Shanghai")
        let horizonEnd = OpportunityDates.addDays(todayOn, days: OpportunityDomainEngine.reminderHorizonDays)
        let nowIso = ISO8601DateFormatter().string(from: today)

        return try await dbManager.dbWriter.read { db in
            let rawEvents = try loadAllRawCalendarEvents(
                in: db,
                holderId: holderId,
                cardId: cardId,
                today: today
            )
            let stateMap = try loadReminderStateMap(userId: userId, in: db)
            let decoder = JSONDecoder()

            return rawEvents
                .filter { $0.localDateOn >= todayOn && $0.localDateOn <= horizonEnd && !$0.needsReview }
                .compactMap { event -> OpportunityCalendarEventView? in
                    var e = event
                    if let st = stateMap[event.eventKey] {
                        if st.dismissedAt != nil { return nil }
                        if let snooze = st.snoozeUntil, snooze > nowIso { return nil }
                        e.snoozedUntil = st.snoozeUntil
                        e.stateRevision = st.revision
                        if let data = st.readStepsJson.data(using: .utf8),
                           let steps = try? decoder.decode([String].self, from: data) {
                            e.readSteps = steps
                        }
                    }
                    return e
                }
                .sorted { lhs, rhs in
                    if lhs.localDateOn != rhs.localDateOn { return lhs.localDateOn < rhs.localDateOn }
                    return lhs.eventKey < rhs.eventKey
                }
        }
    }

    public func fetchTasks(
        holderId: String? = nil,
        cardId: String? = nil,
        status: String? = nil,
        today: Date = Date()
    ) async throws -> [OpportunityTaskView] {
        try await dbManager.dbWriter.read { db in
            let tasks = try OpportunityTaskRecord.order(Column("created_at").desc).fetchAll(db)
            let holders = Dictionary(uniqueKeysWithValues: try CardHolder.fetchAll(db).map { ($0.id, $0) })
            let allCycles = try OpportunityTaskCycleRecord.order(Column("period_start_on").desc).fetchAll(db)
            let cyclesByTask = Dictionary(grouping: allCycles, by: \.taskId)
            let taskResults = try OpportunityFulfillmentRecord
                .filter(Column("kind") == "task_result" || Column("kind") == "grant")
                .fetchAll(db)
            let rewardByTaskCycle = Dictionary(grouping: taskResults.filter { $0.taskCycleId != nil }, by: { $0.taskCycleId! })

            let decoder = JSONDecoder()
            let todayOn = OpportunityDates.localDateInZone(today, timeZone: "Asia/Shanghai")
            var views: [OpportunityTaskView] = []

            for task in tasks {
                if let holderId, task.holderId != holderId { continue }
                if let status, task.status != status { continue }
                let cardIds = (try? decoder.decode([String].self, from: Data(task.cardIdsJson.utf8))) ?? []
                if let cardId, !cardIds.contains(cardId) { continue }

                guard let taskCycles = cyclesByTask[task.id], !taskCycles.isEmpty else { continue }
                let cycle = taskCycles.first(where: { todayOn >= $0.periodStartOn && todayOn < $0.periodEndBefore }) ?? taskCycles[0]
                guard let rulesData = cycle.rulesSnapshotJson.data(using: .utf8),
                      let rules = try? decoder.decode(TaskConditionsV1.self, from: rulesData) else {
                    continue
                }
                let rewardPlan = cycle.rewardSnapshotJson.data(using: .utf8).flatMap {
                    try? decoder.decode(TaskRewardPlan.self, from: $0)
                }
                let progress: ManualProgress = {
                    if cycle.progressJson != "{}" && !cycle.progressJson.isEmpty,
                       let data = cycle.progressJson.data(using: .utf8),
                       let decoded = try? decoder.decode(ManualProgress.self, from: data) {
                        return decoded
                    }
                    return ManualProgress(asOfOn: todayOn, metricValues: [:], note: nil)
                }()
                let eval = OpportunityDomainEngine.evaluateTask(rules: rules, progress: progress)
                let rewardFulfillment = rewardByTaskCycle[cycle.id]?.first(where: { $0.status != "cancelled" })

                views.append(OpportunityTaskView(
                    task: task,
                    cycle: cycle,
                    holderName: holders[task.holderId]?.name ?? "",
                    cardIds: cardIds,
                    rules: rules,
                    rewardPlan: rewardPlan,
                    progress: progress,
                    evaluation: eval,
                    rewardFulfillment: rewardFulfillment
                ))
            }
            return views
        }
    }

    public func fetchLocalNotifications(
        category: String = "all",
        unreadOnly: Bool = false,
        limit: Int = 50,
        offset: Int = 0
    ) async throws -> NotificationsPageResult {
        try await dbManager.dbWriter.read { db in
            let activeRows = try NotificationHistoryRecord
                .filter(Column("deleted_at") == nil)
                .order(Column("sent_at").desc)
                .fetchAll(db)
            let unreadCount = activeRows.filter { $0.readAt == nil }.count
            let filtered = activeRows.filter { row in
                if category != "all" && row.category != category { return false }
                if unreadOnly && row.readAt != nil { return false }
                return true
            }
            let slice = filtered.dropFirst(max(0, offset)).prefix(max(1, limit))
            return NotificationsPageResult(
                items: slice.map { $0.toUserNotificationItem() },
                unreadCount: unreadCount,
                totalCount: filtered.count
            )
        }
    }

    private func loadReminderStateMap(
        userId: String?,
        in db: Database
    ) throws -> [String: OpportunityReminderStateRecord] {
        let rows = try OpportunityReminderStateRecord.fetchAll(db)
        var map: [String: OpportunityReminderStateRecord] = [:]
        for r in rows {
            if let userId, !userId.isEmpty {
                if r.userId == userId { map[r.eventKey] = r }
            } else if map[r.eventKey] == nil {
                map[r.eventKey] = r
            }
        }
        return map
    }

    private func loadAllRawCalendarEvents(
        in db: Database,
        holderId: String?,
        cardId: String?,
        today: Date
    ) throws -> [OpportunityCalendarEventView] {
        let definitions = Dictionary(uniqueKeysWithValues: try OpportunityDefinitionRecord.fetchAll(db).map { ($0.id, $0) })
        let versions = try OpportunityRuleVersionRecord.fetchAll(db)
        let accounts = try OpportunityAccountRecord.fetchAll(db)
        let accountCards = try OpportunityAccountCardRecord.filter(Column("retired_at") == nil).fetchAll(db)
        let cyclesByAcc = Dictionary(grouping: try OpportunityCycleRecord.fetchAll(db), by: \.accountId)
        let linkedCardsByAcc = Dictionary(grouping: accountCards, by: \.accountId)

        var latestVersionByDef: [String: OpportunityRuleVersionRecord] = [:]
        for v in versions {
            if let current = latestVersionByDef[v.definitionId] {
                if v.version > current.version { latestVersionByDef[v.definitionId] = v }
            } else {
                latestVersionByDef[v.definitionId] = v
            }
        }

        let decoder = JSONDecoder()
        var events: [OpportunityCalendarEventView] = []

        for acc in accounts {
            if let holderId, acc.holderId != holderId { continue }
            if let cardId {
                let accCardIds = (linkedCardsByAcc[acc.id] ?? []).map(\.cardId)
                if !accCardIds.contains(cardId) { continue }
            }
            guard let def = definitions[acc.definitionId], def.status == "active",
                  let ver = latestVersionByDef[def.id],
                  let rules = try? decoder.decode(RuleSnapshotV1.self, from: Data(ver.rulesJson.utf8)) else {
                continue
            }
            for cycle in cyclesByAcc[acc.id] ?? [] {
                events.append(contentsOf: OpportunityDomainEngine.buildCycleCalendarEvents(
                    accountId: acc.id,
                    cycleId: cycle.id,
                    title: rules.title,
                    timeZone: rules.timeZone,
                    usableStartOn: cycle.usableStartOn,
                    usableEndBefore: cycle.usableEndBefore,
                    nextResetOn: (cycle.allocationKind == "regular") ? cycle.usableEndBefore : nil,
                    claimWindow: rules.claimWindow,
                    versionId: ver.id,
                    verification: ver.verification
                ))
            }
        }

        let tasks = try OpportunityTaskRecord.filter(Column("status") == "active").fetchAll(db)
        let taskCyclesByTask = Dictionary(grouping: try OpportunityTaskCycleRecord.fetchAll(db), by: \.taskId)
        let todayOn = OpportunityDates.localDateInZone(today, timeZone: "Asia/Shanghai")

        for task in tasks {
            if let holderId, task.holderId != holderId { continue }
            let tCards = (try? decoder.decode([String].self, from: Data(task.cardIdsJson.utf8))) ?? []
            if let cardId, !tCards.contains(cardId) { continue }
            for tc in taskCyclesByTask[task.id] ?? [] {
                let satisfied: Bool = {
                    guard let rules = try? decoder.decode(TaskConditionsV1.self, from: Data(tc.rulesSnapshotJson.utf8)) else {
                        return false
                    }
                    let progress: ManualProgress = {
                        if tc.progressJson != "{}" && !tc.progressJson.isEmpty,
                           let p = try? decoder.decode(ManualProgress.self, from: Data(tc.progressJson.utf8)) {
                            return p
                        }
                        return ManualProgress(asOfOn: todayOn, metricValues: [:], note: nil)
                    }()
                    return OpportunityDomainEngine.evaluateTask(rules: rules, progress: progress).satisfied
                }()
                events.append(contentsOf: OpportunityDomainEngine.buildTaskCalendarEvents(
                    taskCycleId: tc.id,
                    title: task.title,
                    deadlineAt: tc.deadlineAt,
                    expectedFromOn: tc.expectedFromOn,
                    expectedUntilBefore: tc.expectedUntilBefore,
                    satisfied: satisfied
                ))
            }
        }

        let bookings = try OpportunityFulfillmentRecord
            .filter(Column("kind") == "booking" && Column("status") == "recorded")
            .fetchAll(db)
        for booking in bookings {
            if let holderId, booking.holderId != holderId { continue }
            if let cardId, booking.cardId != cardId { continue }
            guard let serviceAt = booking.serviceAt, let serviceTz = booking.serviceTimeZone else { continue }
            events.append(contentsOf: OpportunityDomainEngine.buildBookingCalendarEvents(
                fulfillmentId: booking.id,
                accountId: booking.accountId,
                cycleId: booking.cycleId,
                title: "预约服务",
                serviceAt: serviceAt,
                serviceTimeZone: serviceTz
            ))
        }

        return events
    }
}
