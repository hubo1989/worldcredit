import Foundation

/// 通知分类视觉色调（与 Web 端 `NOTIFICATION_CATEGORY_META` 对齐）。
public enum NotificationCategoryTone: String, Equatable, Hashable, Sendable {
    case danger
    case gold
    case accent
    case muted
}

/// 通知中心分类枚举，保留 `.unknown(String)` 以兼容未来服务端新增分类。
public enum NotificationCategory: Codable, Equatable, Hashable, Sendable {
    case billDueToday
    case payableDueToday
    case billDueAdvance
    case payableDueAdvance
    case billOverdue
    case billMissingStatement
    case gracePeriodLongest
    case opportunityExpiry
    case opportunityClaim
    case opportunityActivity
    case opportunityTask
    case opportunityReset
    case opportunityBooking
    case system
    case unknown(String)

    public init(rawValue: String) {
        switch rawValue {
        case "bill_due_today": self = .billDueToday
        case "payable_due_today": self = .payableDueToday
        case "bill_due_advance": self = .billDueAdvance
        case "payable_due_advance": self = .payableDueAdvance
        case "bill_overdue": self = .billOverdue
        case "bill_missing_statement": self = .billMissingStatement
        case "grace_period_longest": self = .gracePeriodLongest
        case "opportunity_expiry": self = .opportunityExpiry
        case "opportunity_claim": self = .opportunityClaim
        case "opportunity_activity": self = .opportunityActivity
        case "opportunity_task": self = .opportunityTask
        case "opportunity_reset": self = .opportunityReset
        case "opportunity_booking": self = .opportunityBooking
        case "system": self = .system
        default: self = .unknown(rawValue)
        }
    }

    public var rawValue: String {
        switch self {
        case .billDueToday: return "bill_due_today"
        case .payableDueToday: return "payable_due_today"
        case .billDueAdvance: return "bill_due_advance"
        case .payableDueAdvance: return "payable_due_advance"
        case .billOverdue: return "bill_overdue"
        case .billMissingStatement: return "bill_missing_statement"
        case .gracePeriodLongest: return "grace_period_longest"
        case .opportunityExpiry: return "opportunity_expiry"
        case .opportunityClaim: return "opportunity_claim"
        case .opportunityActivity: return "opportunity_activity"
        case .opportunityTask: return "opportunity_task"
        case .opportunityReset: return "opportunity_reset"
        case .opportunityBooking: return "opportunity_booking"
        case .system: return "system"
        case .unknown(let value): return value
        }
    }

    public var label: String {
        switch self {
        case .billDueToday: return "当日待还"
        case .payableDueToday: return "固定支出"
        case .billDueAdvance: return "即将到期"
        case .payableDueAdvance: return "支出提醒"
        case .billOverdue: return "已逾期"
        case .billMissingStatement: return "未收账单"
        case .gracePeriodLongest: return "最长免息期"
        case .opportunityExpiry: return "权益到期"
        case .opportunityClaim: return "权益领取"
        case .opportunityActivity: return "优惠活动"
        case .opportunityTask: return "达标任务"
        case .opportunityReset: return "周期重置"
        case .opportunityBooking: return "预约服务"
        case .system: return "系统通知"
        case .unknown(let value): return value.isEmpty ? "系统通知" : value
        }
    }

    public var tone: NotificationCategoryTone {
        switch self {
        case .billOverdue:
            return .danger
        case .billDueToday, .payableDueToday, .billMissingStatement, .gracePeriodLongest, .opportunityExpiry:
            return .gold
        case .billDueAdvance, .payableDueAdvance, .opportunityClaim, .opportunityActivity,
             .opportunityTask, .opportunityReset, .opportunityBooking:
            return .accent
        case .system, .unknown:
            return .muted
        }
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        let raw = try container.decode(String.self)
        self = NotificationCategory(rawValue: raw)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }
}

public struct NotificationBillBreakdown: Codable, Equatable, Sendable, Identifiable {
    public let id: String
    public let subject: String
    public let remaining: Double
    public let currency: String
    public let dueDate: String

    public init(id: String, subject: String, remaining: Double, currency: String, dueDate: String) {
        self.id = id
        self.subject = subject
        self.remaining = remaining
        self.currency = currency
        self.dueDate = dueDate
    }

    enum CodingKeys: String, CodingKey {
        case id, subject, remaining, currency
        case dueDate = "due_date"
    }
}

public struct NotificationPayableBreakdown: Codable, Equatable, Sendable, Identifiable {
    public let id: String
    public let name: String
    public let category: String
    public let remaining: Double
    public let currency: String
    public let dueDate: String

    public init(id: String, name: String, category: String, remaining: Double, currency: String, dueDate: String) {
        self.id = id
        self.name = name
        self.category = category
        self.remaining = remaining
        self.currency = currency
        self.dueDate = dueDate
    }

    enum CodingKeys: String, CodingKey {
        case id, name, category, remaining, currency
        case dueDate = "due_date"
    }
}

public struct NotificationGraceCardBreakdown: Codable, Equatable, Sendable, Identifiable {
    public let cardId: String
    public let label: String
    public let graceDays: Int
    public let nextBillingDate: String
    public let nextDueDate: String

    public var id: String { cardId }

    public init(
        cardId: String,
        label: String,
        graceDays: Int,
        nextBillingDate: String,
        nextDueDate: String
    ) {
        self.cardId = cardId
        self.label = label
        self.graceDays = graceDays
        self.nextBillingDate = nextBillingDate
        self.nextDueDate = nextDueDate
    }
}

public struct NotificationMissingStatementBreakdown: Codable, Equatable, Sendable, Identifiable {
    public let cardId: String
    public let accountId: String?
    public let subject: String
    public let billMonth: String
    public let expectedStatementDate: String
    public let daysPast: Int
    public let isMerged: Bool?

    public var id: String { "\(cardId)-\(billMonth)" }

    public init(
        cardId: String,
        accountId: String? = nil,
        subject: String,
        billMonth: String,
        expectedStatementDate: String,
        daysPast: Int,
        isMerged: Bool? = nil
    ) {
        self.cardId = cardId
        self.accountId = accountId
        self.subject = subject
        self.billMonth = billMonth
        self.expectedStatementDate = expectedStatementDate
        self.daysPast = daysPast
        self.isMerged = isMerged
    }

    enum CodingKeys: String, CodingKey {
        case cardId = "card_id"
        case accountId = "account_id"
        case subject
        case billMonth = "bill_month"
        case expectedStatementDate = "expected_statement_date"
        case daysPast = "days_past"
        case isMerged = "is_merged"
    }
}

public struct NotificationMetadata: Codable, Equatable, Sendable {
    public let kind: String?
    public let totalsByCurrency: [String: Double]?
    public let bills: [NotificationBillBreakdown]?
    public let payables: [NotificationPayableBreakdown]?
    public let cards: [NotificationGraceCardBreakdown]?
    public let missingStatements: [NotificationMissingStatementBreakdown]?

    public init(
        kind: String? = nil,
        totalsByCurrency: [String: Double]? = nil,
        bills: [NotificationBillBreakdown]? = nil,
        payables: [NotificationPayableBreakdown]? = nil,
        cards: [NotificationGraceCardBreakdown]? = nil,
        missingStatements: [NotificationMissingStatementBreakdown]? = nil
    ) {
        self.kind = kind
        self.totalsByCurrency = totalsByCurrency
        self.bills = bills
        self.payables = payables
        self.cards = cards
        self.missingStatements = missingStatements
    }

    enum CodingKeys: String, CodingKey {
        case kind
        case totalsByCurrency = "totals_by_currency"
        case bills, payables, cards
        case missingStatements = "missing_statements"
    }
}

public struct UserNotificationItem: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let userId: String
    public let notificationKey: String
    public let category: NotificationCategory
    public let title: String
    public let body: String?
    public let targetUrl: String?
    public let metadataJson: String?
    public let sentAt: String
    public let status: String
    public let error: String?
    public let readAt: String?
    public let deletedAt: String?
    public let pushSentAt: String?

    public init(
        id: String,
        userId: String,
        notificationKey: String,
        category: NotificationCategory,
        title: String,
        body: String? = nil,
        targetUrl: String? = nil,
        metadataJson: String? = nil,
        sentAt: String,
        status: String = "skipped",
        error: String? = nil,
        readAt: String? = nil,
        deletedAt: String? = nil,
        pushSentAt: String? = nil
    ) {
        self.id = id
        self.userId = userId
        self.notificationKey = notificationKey
        self.category = category
        self.title = title
        self.body = body
        self.targetUrl = targetUrl
        self.metadataJson = metadataJson
        self.sentAt = sentAt
        self.status = status
        self.error = error
        self.readAt = readAt
        self.deletedAt = deletedAt
        self.pushSentAt = pushSentAt
    }

    enum CodingKeys: String, CodingKey {
        case id
        case userId = "user_id"
        case notificationKey = "notification_key"
        case category, title, body
        case targetUrl = "target_url"
        case metadataJson = "metadata_json"
        case sentAt = "sent_at"
        case status, error
        case readAt = "read_at"
        case deletedAt = "deleted_at"
        case pushSentAt = "push_sent_at"
    }

    public var isUnread: Bool {
        readAt == nil
    }

    public var parsedMetadata: NotificationMetadata? {
        guard let metadataJson, let data = metadataJson.data(using: .utf8) else {
            return nil
        }
        return try? JSONDecoder().decode(NotificationMetadata.self, from: data)
    }

    /// 返回附加已读时间戳的副本，供乐观 UI 更新使用。
    public func markingRead(at readAt: String) -> UserNotificationItem {
        UserNotificationItem(
            id: id,
            userId: userId,
            notificationKey: notificationKey,
            category: category,
            title: title,
            body: body,
            targetUrl: targetUrl,
            metadataJson: metadataJson,
            sentAt: sentAt,
            status: status,
            error: error,
            readAt: self.readAt ?? readAt,
            deletedAt: deletedAt,
            pushSentAt: pushSentAt
        )
    }
}

public struct NotificationsPageResult: Codable, Equatable, Sendable {
    public let items: [UserNotificationItem]
    public let unreadCount: Int
    public let totalCount: Int

    public init(items: [UserNotificationItem], unreadCount: Int, totalCount: Int) {
        self.items = items
        self.unreadCount = unreadCount
        self.totalCount = totalCount
    }

    enum CodingKeys: String, CodingKey {
        case items
        case unreadCount = "unread_count"
        case totalCount = "total_count"
    }
}

public struct NotificationReadResult: Codable, Equatable, Sendable {
    public let updated: Bool
    public let unreadCount: Int

    enum CodingKeys: String, CodingKey {
        case updated
        case unreadCount = "unread_count"
    }
}

public struct NotificationBulkReadResult: Codable, Equatable, Sendable {
    public let updatedCount: Int
    public let unreadCount: Int

    enum CodingKeys: String, CodingKey {
        case updatedCount = "updated_count"
        case unreadCount = "unread_count"
    }
}

public struct NotificationDeleteResult: Codable, Equatable, Sendable {
    public let deleted: Bool
    public let unreadCount: Int

    enum CodingKeys: String, CodingKey {
        case deleted
        case unreadCount = "unread_count"
    }
}

public struct NotificationBulkDeleteResult: Codable, Equatable, Sendable {
    public let deletedCount: Int
    public let unreadCount: Int

    enum CodingKeys: String, CodingKey {
        case deletedCount = "deleted_count"
        case unreadCount = "unread_count"
    }
}

/// 通知细粒度独立开关（缺省全开，兼容存量配置）。
public struct NotificationItemSwitches: Codable, Equatable, Sendable {
    public var billDueToday: Bool
    public var payableDueToday: Bool
    public var billDueAdvance: Bool
    public var payableDueAdvance: Bool
    public var billOverdue: Bool
    public var billMissingStatement: Bool
    public var gracePeriodLongest: Bool
    public var opportunityExpiry: Bool
    public var opportunityClaim: Bool
    public var opportunityActivity: Bool
    public var opportunityTask: Bool
    public var opportunityReset: Bool
    public var opportunityBooking: Bool

    public init(
        billDueToday: Bool = true,
        payableDueToday: Bool = true,
        billDueAdvance: Bool = true,
        payableDueAdvance: Bool = true,
        billOverdue: Bool = true,
        billMissingStatement: Bool = true,
        gracePeriodLongest: Bool = true,
        opportunityExpiry: Bool = true,
        opportunityClaim: Bool = true,
        opportunityActivity: Bool = true,
        opportunityTask: Bool = true,
        opportunityReset: Bool = true,
        opportunityBooking: Bool = true
    ) {
        self.billDueToday = billDueToday
        self.payableDueToday = payableDueToday
        self.billDueAdvance = billDueAdvance
        self.payableDueAdvance = payableDueAdvance
        self.billOverdue = billOverdue
        self.billMissingStatement = billMissingStatement
        self.gracePeriodLongest = gracePeriodLongest
        self.opportunityExpiry = opportunityExpiry
        self.opportunityClaim = opportunityClaim
        self.opportunityActivity = opportunityActivity
        self.opportunityTask = opportunityTask
        self.opportunityReset = opportunityReset
        self.opportunityBooking = opportunityBooking
    }

    enum CodingKeys: String, CodingKey {
        case billDueToday = "bill_due_today"
        case payableDueToday = "payable_due_today"
        case billDueAdvance = "bill_due_advance"
        case payableDueAdvance = "payable_due_advance"
        case billOverdue = "bill_overdue"
        case billMissingStatement = "bill_missing_statement"
        case gracePeriodLongest = "grace_period_longest"
        case opportunityExpiry = "opportunity_expiry"
        case opportunityClaim = "opportunity_claim"
        case opportunityActivity = "opportunity_activity"
        case opportunityTask = "opportunity_task"
        case opportunityReset = "opportunity_reset"
        case opportunityBooking = "opportunity_booking"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        billDueToday = try c.decodeIfPresent(Bool.self, forKey: .billDueToday) ?? true
        payableDueToday = try c.decodeIfPresent(Bool.self, forKey: .payableDueToday) ?? true
        billDueAdvance = try c.decodeIfPresent(Bool.self, forKey: .billDueAdvance) ?? true
        payableDueAdvance = try c.decodeIfPresent(Bool.self, forKey: .payableDueAdvance) ?? true
        billOverdue = try c.decodeIfPresent(Bool.self, forKey: .billOverdue) ?? true
        billMissingStatement = try c.decodeIfPresent(Bool.self, forKey: .billMissingStatement) ?? true
        gracePeriodLongest = try c.decodeIfPresent(Bool.self, forKey: .gracePeriodLongest) ?? true
        opportunityExpiry = try c.decodeIfPresent(Bool.self, forKey: .opportunityExpiry) ?? true
        opportunityClaim = try c.decodeIfPresent(Bool.self, forKey: .opportunityClaim) ?? true
        opportunityActivity = try c.decodeIfPresent(Bool.self, forKey: .opportunityActivity) ?? true
        opportunityTask = try c.decodeIfPresent(Bool.self, forKey: .opportunityTask) ?? true
        opportunityReset = try c.decodeIfPresent(Bool.self, forKey: .opportunityReset) ?? true
        opportunityBooking = try c.decodeIfPresent(Bool.self, forKey: .opportunityBooking) ?? true
    }
}

public struct OpportunityReminderPreferences: Codable, Equatable, Sendable {
    public var enabled: Bool
    public var webPushEnabled: Bool
    public var timeZone: String
    public var localTime: String
    public var expiryDaysBefore: [Int]
    public var activityDaysBefore: [Int]
    public var claimDaysBefore: [Int]
    public var taskDaysBefore: [Int]
    public var resetEnabled: Bool
    public var bookingEnabled: Bool

    public init(
        enabled: Bool = true,
        webPushEnabled: Bool = true,
        timeZone: String = "Asia/Shanghai",
        localTime: String = "09:00",
        expiryDaysBefore: [Int] = [3, 1, 0],
        activityDaysBefore: [Int] = [7, 3, 1],
        claimDaysBefore: [Int] = [3, 1, 0],
        taskDaysBefore: [Int] = [3, 1, 0],
        resetEnabled: Bool = true,
        bookingEnabled: Bool = true
    ) {
        self.enabled = enabled
        self.webPushEnabled = webPushEnabled
        self.timeZone = timeZone
        self.localTime = localTime
        self.expiryDaysBefore = expiryDaysBefore
        self.activityDaysBefore = activityDaysBefore
        self.claimDaysBefore = claimDaysBefore
        self.taskDaysBefore = taskDaysBefore
        self.resetEnabled = resetEnabled
        self.bookingEnabled = bookingEnabled
    }

    enum CodingKeys: String, CodingKey {
        case enabled
        case webPushEnabled = "web_push_enabled"
        case timeZone = "time_zone"
        case localTime = "local_time"
        case expiryDaysBefore = "expiry_days_before"
        case activityDaysBefore = "activity_days_before"
        case claimDaysBefore = "claim_days_before"
        case taskDaysBefore = "task_days_before"
        case resetEnabled = "reset_enabled"
        case bookingEnabled = "booking_enabled"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        enabled = try c.decodeIfPresent(Bool.self, forKey: .enabled) ?? true
        webPushEnabled = try c.decodeIfPresent(Bool.self, forKey: .webPushEnabled) ?? true
        timeZone = try c.decodeIfPresent(String.self, forKey: .timeZone) ?? "Asia/Shanghai"
        localTime = try c.decodeIfPresent(String.self, forKey: .localTime) ?? "09:00"
        expiryDaysBefore = try c.decodeIfPresent([Int].self, forKey: .expiryDaysBefore) ?? [3, 1, 0]
        activityDaysBefore = try c.decodeIfPresent([Int].self, forKey: .activityDaysBefore) ?? [7, 3, 1]
        claimDaysBefore = try c.decodeIfPresent([Int].self, forKey: .claimDaysBefore) ?? [3, 1, 0]
        taskDaysBefore = try c.decodeIfPresent([Int].self, forKey: .taskDaysBefore) ?? [3, 1, 0]
        resetEnabled = try c.decodeIfPresent(Bool.self, forKey: .resetEnabled) ?? true
        bookingEnabled = try c.decodeIfPresent(Bool.self, forKey: .bookingEnabled) ?? true
    }
}

public struct UserReminderPreferences: Codable, Equatable, Sendable {
    public var remindDaysBefore: [Int]
    public var quietHoursStart: String?
    public var quietHoursEnd: String?
    public var enabledChannels: [String]
    public var customReminderEmail: String?
    public var missingStatementGraceDays: Int
    public var items: NotificationItemSwitches
    public var opportunities: OpportunityReminderPreferences

    public init(
        remindDaysBefore: [Int] = [3, 1, 0],
        quietHoursStart: String? = "22:00",
        quietHoursEnd: String? = "08:00",
        enabledChannels: [String] = ["web_push"],
        customReminderEmail: String? = nil,
        missingStatementGraceDays: Int = 3,
        items: NotificationItemSwitches = NotificationItemSwitches(),
        opportunities: OpportunityReminderPreferences = OpportunityReminderPreferences()
    ) {
        self.remindDaysBefore = remindDaysBefore
        self.quietHoursStart = quietHoursStart
        self.quietHoursEnd = quietHoursEnd
        self.enabledChannels = enabledChannels
        self.customReminderEmail = customReminderEmail
        self.missingStatementGraceDays = (0...15).contains(missingStatementGraceDays) ? missingStatementGraceDays : 3
        self.items = items
        self.opportunities = opportunities
    }

    public var webPushChannelEnabled: Bool {
        enabledChannels.contains("web_push")
    }

    enum CodingKeys: String, CodingKey {
        case remindDaysBefore = "remind_days_before"
        case quietHoursStart = "quiet_hours_start"
        case quietHoursEnd = "quiet_hours_end"
        case enabledChannels = "enabled_channels"
        case customReminderEmail = "custom_reminder_email"
        case missingStatementGraceDays = "missing_statement_grace_days"
        case items
        case opportunities
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        remindDaysBefore = try c.decodeIfPresent([Int].self, forKey: .remindDaysBefore) ?? [3, 1, 0]
        quietHoursStart = try c.decodeIfPresent(String.self, forKey: .quietHoursStart) ?? "22:00"
        quietHoursEnd = try c.decodeIfPresent(String.self, forKey: .quietHoursEnd) ?? "08:00"
        customReminderEmail = try c.decodeIfPresent(String.self, forKey: .customReminderEmail)
        let rawGrace = try c.decodeIfPresent(Int.self, forKey: .missingStatementGraceDays)
        missingStatementGraceDays = (rawGrace.map { (0...15).contains($0) ? $0 : 3 }) ?? 3
        let decodedOpp = try c.decodeIfPresent(OpportunityReminderPreferences.self, forKey: .opportunities)
            ?? OpportunityReminderPreferences()
        opportunities = decodedOpp

        if let channels = try c.decodeIfPresent([String].self, forKey: .enabledChannels) {
            enabledChannels = channels
        } else {
            enabledChannels = decodedOpp.webPushEnabled ? ["web_push"] : []
        }

        let rawItemsMap = try c.decodeIfPresent([String: Bool].self, forKey: .items)
        var resolvedItems = try c.decodeIfPresent(NotificationItemSwitches.self, forKey: .items)
            ?? NotificationItemSwitches()
        if rawItemsMap?["opportunity_reset"] == nil {
            resolvedItems.opportunityReset = decodedOpp.resetEnabled
        }
        if rawItemsMap?["opportunity_booking"] == nil {
            resolvedItems.opportunityBooking = decodedOpp.bookingEnabled
        }
        items = resolvedItems
    }
}

public struct ReminderPreferencesEnvelope: Codable, Equatable, Sendable {
    public let userId: String
    public let reminderConfig: UserReminderPreferences

    enum CodingKeys: String, CodingKey {
        case userId = "user_id"
        case reminderConfig = "reminder_config"
    }
}
