import Foundation
import Testing
import GRDB
import UserNotifications
@testable import WorldCreditCore

private final class NotificationCenterSpy: NotificationCenterProtocol, @unchecked Sendable {
    var requests: [UNNotificationRequest] = []

    func add(_ request: UNNotificationRequest) async throws {
        requests.append(request)
    }

    func removePendingNotificationRequests(withIdentifiers identifiers: [String]) {
        requests.removeAll { identifiers.contains($0.identifier) }
    }

    func removeAllPendingNotificationRequests() {
        requests.removeAll()
    }

    func pendingNotificationRequests() async -> [UNNotificationRequest] {
        requests
    }
}

@Suite("Notification center DTOs, remote RPCs and scheduler")
struct NotificationsCenterTests {
    private func response(_ request: URLRequest, _ json: String, status: Int = 200) -> (Data, URLResponse) {
        (Data(json.utf8), HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!)
    }

    private func instant(_ iso: String) -> Date {
        ISO8601DateFormatter().date(from: iso)!
    }

    @Test("DTOs tolerate unknown categories, missing switch keys, legacy reset fallback and structured metadata")
    func dtoDecoding() throws {
        let rawPrefs = """
        {
          "user_id": "u1",
          "reminder_config": {
            "remind_days_before": [3, 1],
            "opportunities": {
              "enabled": true,
              "web_push_enabled": false,
              "reset_enabled": false
            }
          }
        }
        """
        let envelope = try JSONDecoder().decode(ReminderPreferencesEnvelope.self, from: Data(rawPrefs.utf8))
        #expect(envelope.userId == "u1")
        #expect(envelope.reminderConfig.webPushChannelEnabled == false)
        #expect(envelope.reminderConfig.items.billDueToday == true)
        #expect(envelope.reminderConfig.items.payableDueToday == true)
        #expect(envelope.reminderConfig.items.gracePeriodLongest == true)
        #expect(envelope.reminderConfig.items.opportunityReset == false)
        #expect(envelope.reminderConfig.items.opportunityBooking == true)

        let notificationJson = """
        {
          "id": "n1",
          "user_id": "u1",
          "notification_key": "due_today_summary:2026-05-10",
          "category": "future_kind",
          "title": "今日待还",
          "body": "完整正文",
          "metadata_json": "{\\"kind\\":\\"due_today_summary\\",\\"totals_by_currency\\":{\\"CNY\\":1000},\\"bills\\":[{\\"id\\":\\"b1\\",\\"subject\\":\\"招行\\",\\"remaining\\":600,\\"currency\\":\\"CNY\\",\\"due_date\\":\\"2026-05-10\\"}],\\"payables\\":[{\\"id\\":\\"p1\\",\\"name\\":\\"房租\\",\\"category\\":\\"房租\\",\\"remaining\\":400,\\"currency\\":\\"CNY\\",\\"due_date\\":\\"2026-05-10\\"}]}",
          "sent_at": "2026-05-10T01:00:00Z",
          "status": "skipped",
          "read_at": null
        }
        """
        let item = try JSONDecoder().decode(UserNotificationItem.self, from: Data(notificationJson.utf8))
        #expect(item.category == .unknown("future_kind"))
        #expect(item.category.label == "future_kind")
        #expect(item.isUnread == true)
        #expect(item.parsedMetadata?.totalsByCurrency == ["CNY": 1000])
        #expect(item.parsedMetadata?.bills?.first?.remaining == 600)
        #expect(item.parsedMetadata?.payables?.first?.name == "房租")

        let missingJson = """
        {
          "id": "n2",
          "user_id": "u1",
          "notification_key": "bill_missing_statement:c1:2026-10:2026-11-15",
          "category": "bill_missing_statement",
          "title": "未收到账单",
          "metadata_json": "{\\"kind\\":\\"bill_missing_statement\\",\\"missing_statements\\":[{\\"card_id\\":\\"c1\\",\\"subject\\":\\"招行\\",\\"bill_month\\":\\"2026-10\\",\\"expected_statement_date\\":\\"2026-11-10\\",\\"days_past\\":5,\\"is_merged\\":false}]}",
          "sent_at": "2026-11-15T01:00:00Z",
          "status": "sent"
        }
        """
        let missingItem = try JSONDecoder().decode(UserNotificationItem.self, from: Data(missingJson.utf8))
        #expect(missingItem.category == .billMissingStatement)
        #expect(missingItem.category.label == "未收账单")
        #expect(missingItem.category.tone == .gold)
        #expect(missingItem.parsedMetadata?.missingStatements?.first?.billMonth == "2026-10")
        #expect(missingItem.parsedMetadata?.missingStatements?.first?.daysPast == 5)
    }

    @Test("NotificationsRemoteService sends exact RPC paths and arguments across all 8 operations")
    func remoteContracts() async throws {
        let sampleNotification = """
        {
          "id": "n1",
          "user_id": "alice",
          "notification_key": "k1",
          "category": "bill_due_today",
          "title": "标题",
          "body": "正文",
          "sent_at": "2026-05-10T01:00:00Z",
          "status": "sent"
        }
        """

        let session = MockNetworkSession { request in
            let requestBody = try #require(request.httpBody)
            let body = try #require(JSONSerialization.jsonObject(with: requestBody) as? [String: Any])
            let args = try #require(body["args"] as? [Any])
            switch request.url?.path {
            case "/api/rpc/notifications/getNotifications":
                let opts = try #require(args.last as? [String: Any])
                #expect(opts["filter"] as? String == "unread")
                return response(request, #"{"data":{"items":[\#(sampleNotification)],"unread_count":1,"total_count":2},"error":null}"#)
            case "/api/rpc/notifications/getUnreadNotificationCount":
                #expect(args.count == 1)
                return response(request, #"{"data":3,"error":null}"#)
            case "/api/rpc/notifications/markNotificationRead":
                #expect(args.last as? String == "n1")
                return response(request, #"{"data":{"updated":true,"unread_count":2},"error":null}"#)
            case "/api/rpc/notifications/markAllNotificationsRead":
                return response(request, #"{"data":{"updated_count":2,"unread_count":0},"error":null}"#)
            case "/api/rpc/notifications/deleteNotification":
                #expect(args.last as? String == "n1")
                return response(request, #"{"data":{"deleted":true,"unread_count":0},"error":null}"#)
            case "/api/rpc/notifications/deleteAllNotifications":
                return response(request, #"{"data":{"deleted_count":2,"unread_count":0},"error":null}"#)
            case "/api/rpc/preferences/getUserPreferences":
                #expect(args as? [String] == ["alice"])
                return response(request, #"{"data":{"user_id":"alice","reminder_config":{"remind_days_before":[5,1],"items":{"grace_period_longest":false}}},"error":null}"#)
            case "/api/rpc/preferences/updateUserPreferences":
                #expect(args.first as? String == "alice")
                let patch = try #require(args.last as? [String: Any])
                let reminder = try #require(patch["reminder_config"] as? [String: Any])
                let items = try #require(reminder["items"] as? [String: Any])
                #expect(items["payable_due_today"] as? Bool == false)
                return response(request, #"{"data":{"user_id":"alice","reminder_config":{"remind_days_before":[5,1],"items":{"payable_due_today":false}}},"error":null}"#)
            default:
                Issue.record("Unexpected RPC path \(request.url?.path ?? "")")
                throw URLError(.badURL)
            }
        }

        let client = ApiClient(baseURL: URL(string: "https://test.local")!, session: session, token: "tok", useKeychain: false)
        let service = NotificationsRemoteService(apiClient: client)

        let page = try await service.fetchNotifications(filter: "unread")
        #expect(page.items.count == 1)
        #expect(page.unreadCount == 1)
        #expect(try await service.fetchUnreadCount() == 3)
        #expect(try await service.markRead(notificationId: "n1").updated == true)
        #expect(try await service.markAllRead().updatedCount == 2)
        #expect(try await service.delete(notificationId: "n1").deleted == true)
        #expect(try await service.deleteAll().deletedCount == 2)

        var prefs = try await service.fetchReminderPreferences(userId: "alice")
        #expect(prefs.remindDaysBefore == [5, 1])
        #expect(prefs.items.gracePeriodLongest == false)

        prefs.items.payableDueToday = false
        let updated = try await service.updateReminderPreferences(userId: "alice", config: prefs)
        #expect(updated.items.payableDueToday == false)
    }

    @Test("NotificationScheduler enforces switches, schedules payables, clamps Feb 28->Mar 1 grace period and excludes loans")
    func schedulerSwitchesAndGracePeriod() async throws {
        let manager = try DatabaseManager.inMemory()
        try await manager.dbWriter.write { db in
            try db.execute(sql: """
                INSERT INTO banks (id, name) VALUES ('bank', '招行');
                INSERT INTO card_products (id, bank_id, bank_name, card_name, payment_due_type, payment_due_value)
                VALUES ('product', 'bank', '招行', '经典白', 'after_billing', 20);
                INSERT INTO card_holders (id, created_by, managed_by, name) VALUES ('holder', 'user', 'user', '测试');
                INSERT INTO credit_cards (id, holder_id, card_product_id, card_number_last4, billing_day, status, card_type)
                VALUES ('card-eom', 'holder', 'product', '3131', 31, 'active', 'credit');
                INSERT INTO credit_cards (id, holder_id, card_product_id, card_number_last4, billing_day, status, card_type)
                VALUES ('card-loan', 'holder', 'product', '9999', 28, 'active', 'loan');
                INSERT INTO credit_cards (id, holder_id, card_product_id, card_number_last4, billing_day, status, card_type)
                VALUES ('card-frozen', 'holder', 'product', '0000', 28, 'frozen', 'credit');
                INSERT INTO bills (id, card_id, bill_month, bill_amount, due_date)
                VALUES ('bill-1', 'card-eom', '2026-03', 1000, '2026-03-05');
                """)
        }

        let payables = [
            PayableItem(
                id: "pay-open", createdBy: "user", name: "房租", category: .rent,
                amount: 3000, currency: "CNY", dueDay: 5, holderId: "holder",
                period: "2026-03", dueDate: "2026-03-05", daysUntilDue: 6, paidAmount: 0, status: .unpaid
            ),
            PayableItem(
                id: "pay-paid", createdBy: "user", name: "网费", category: .utility,
                amount: 100, currency: "CNY", dueDay: 5, holderId: "holder",
                period: "2026-03", dueDate: "2026-03-05", daysUntilDue: 6, paidAmount: 100, status: .paid
            ),
        ]

        // 2026-02-27 Asia/Shanghai 08:00 = 2026-02-27T00:00:00Z
        let today = instant("2026-02-27T00:00:00Z")
        let center = NotificationCenterSpy()
        let scheduler = NotificationScheduler(dbManager: manager, center: center)

        let prefs = UserReminderPreferences(
            remindDaysBefore: [2, 0],
            items: NotificationItemSwitches(
                billDueToday: false,
                payableDueToday: true,
                billDueAdvance: true,
                payableDueAdvance: true,
                gracePeriodLongest: true
            )
        )

        try await scheduler.rescheduleAll(today: today, payables: payables, preferences: prefs)
        let ids = center.requests.map(\.identifier)
        #expect(!ids.contains("bill-due-bill-1"))
        #expect(ids.contains("bill-2d-bill-1"))
        #expect(ids.contains("payable-due-pay-open"))
        #expect(ids.contains("payable-2d-pay-open"))
        #expect(!ids.contains("payable-due-pay-paid"))
        #expect(ids.contains("grace-longest-card-eom-2026-03-01"))
        #expect(!ids.contains(where: { $0.contains("card-loan") || $0.contains("card-frozen") }))

        // 关闭 gracePeriodLongest 后不再调度免息期提醒
        var noGrace = prefs
        noGrace.items.gracePeriodLongest = false
        try await scheduler.rescheduleAll(today: today, payables: payables, preferences: noGrace)
        #expect(!center.requests.map(\.identifier).contains(where: { $0.hasPrefix("grace-longest-") }))
    }
}
