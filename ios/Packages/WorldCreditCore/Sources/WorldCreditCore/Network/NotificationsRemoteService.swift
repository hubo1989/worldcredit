import Foundation

/// 通知中心与提醒偏好的远程服务：走 `/api/rpc/notifications/*` 与 `/api/rpc/preferences/*`。
public actor NotificationsRemoteService {
    private let apiClient: ApiClient

    public init(apiClient: ApiClient) {
        self.apiClient = apiClient
    }

    public func fetchNotifications(
        filter: String = "all",
        category: NotificationCategory? = nil,
        limit: Int = 50,
        offset: Int = 0,
        syncToday: Bool = true
    ) async throws -> NotificationsPageResult {
        var options: [String: Any] = [
            "filter": filter == "unread" ? "unread" : "all",
            "limit": limit,
            "offset": offset,
            "syncToday": syncToday,
        ]
        if let category {
            options["category"] = category.rawValue
        }
        return try await apiClient.rpc(
            module: "notifications",
            function: "getNotifications",
            args: [AnyCodable(""), AnyCodable(options)]
        )
    }

    public func fetchUnreadCount() async throws -> Int {
        try await apiClient.rpc(
            module: "notifications",
            function: "getUnreadNotificationCount",
            args: [AnyCodable("")]
        )
    }

    @discardableResult
    public func markRead(notificationId: String) async throws -> NotificationReadResult {
        try await apiClient.rpc(
            module: "notifications",
            function: "markNotificationRead",
            args: [AnyCodable(""), AnyCodable(notificationId)]
        )
    }

    @discardableResult
    public func markAllRead() async throws -> NotificationBulkReadResult {
        try await apiClient.rpc(
            module: "notifications",
            function: "markAllNotificationsRead",
            args: [AnyCodable("")]
        )
    }

    @discardableResult
    public func delete(notificationId: String) async throws -> NotificationDeleteResult {
        try await apiClient.rpc(
            module: "notifications",
            function: "deleteNotification",
            args: [AnyCodable(""), AnyCodable(notificationId)]
        )
    }

    @discardableResult
    public func deleteAll() async throws -> NotificationBulkDeleteResult {
        try await apiClient.rpc(
            module: "notifications",
            function: "deleteAllNotifications",
            args: [AnyCodable("")]
        )
    }

    public func fetchReminderPreferences(userId: String) async throws -> UserReminderPreferences {
        let trimmed = userId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw URLError(.userAuthenticationRequired) }
        let envelope: ReminderPreferencesEnvelope = try await apiClient.rpc(
            module: "preferences",
            function: "getUserPreferences",
            args: [AnyCodable(trimmed)]
        )
        guard envelope.userId == trimmed else { throw URLError(.badServerResponse) }
        return envelope.reminderConfig
    }

    @discardableResult
    public func updateReminderPreferences(
        userId: String,
        config: UserReminderPreferences
    ) async throws -> UserReminderPreferences {
        let trimmed = userId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw URLError(.userAuthenticationRequired) }
        let encodedConfig = try jsonValue(config)
        let payload = AnyCodable(["reminder_config": encodedConfig.value])
        let envelope: ReminderPreferencesEnvelope = try await apiClient.rpc(
            module: "preferences",
            function: "updateUserPreferences",
            args: [AnyCodable(trimmed), payload]
        )
        guard envelope.userId == trimmed else { throw URLError(.badServerResponse) }
        return envelope.reminderConfig
    }

    private func jsonValue<T: Encodable>(_ value: T) throws -> AnyCodable {
        let data = try JSONEncoder().encode(value)
        let object = try JSONSerialization.jsonObject(with: data)
        return AnyCodable(object)
    }
}
