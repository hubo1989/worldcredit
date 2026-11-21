import Foundation
import GRDB

public struct NotificationPreferenceRecord: Codable, FetchableRecord, TableRecord, PersistableRecord, Sendable, Equatable {
    public static let databaseTableName = "notification_preferences"

    public var userId: String
    public var billDueEnabled: Bool
    public var overdueEnabled: Bool
    public var dueDaysBefore: Int
    public var notifyTime: String
    public var createdAt: String
    public var updatedAt: String

    public init(
        userId: String,
        billDueEnabled: Bool = true,
        overdueEnabled: Bool = true,
        dueDaysBefore: Int = 3,
        notifyTime: String = "09:00",
        createdAt: String = ISO8601DateFormatter().string(from: Date()),
        updatedAt: String = ISO8601DateFormatter().string(from: Date())
    ) {
        self.userId = userId
        self.billDueEnabled = billDueEnabled
        self.overdueEnabled = overdueEnabled
        self.dueDaysBefore = dueDaysBefore
        self.notifyTime = notifyTime
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    public init(from decoder: Decoder) throws {
        let row = try decoder.container(keyedBy: CodingKeys.self)
        userId = try row.decode(String.self, forKey: .userId)
        billDueEnabled = try row.decodeFlexibleBoolIfPresent(forKey: .billDueEnabled) ?? true
        overdueEnabled = try row.decodeFlexibleBoolIfPresent(forKey: .overdueEnabled) ?? true
        dueDaysBefore = try row.decodeIfPresent(Int.self, forKey: .dueDaysBefore) ?? 3
        notifyTime = try row.decodeIfPresent(String.self, forKey: .notifyTime) ?? "09:00"
        createdAt = try row.decodeIfPresent(String.self, forKey: .createdAt) ?? ""
        updatedAt = try row.decodeIfPresent(String.self, forKey: .updatedAt) ?? ""
    }

    enum CodingKeys: String, CodingKey {
        case userId = "user_id"
        case billDueEnabled = "bill_due_enabled"
        case overdueEnabled = "overdue_enabled"
        case dueDaysBefore = "due_days_before"
        case notifyTime = "notify_time"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}
