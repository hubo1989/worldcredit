import Foundation
import UserNotifications
import WorldCreditCore

enum UITestConfiguration {
    static var isEnabled: Bool {
        #if DEBUG
        CommandLine.arguments.contains("--ui-testing")
        #else
        false
        #endif
    }

    #if DEBUG
    static var databaseURL: URL {
        guard let identifier = ProcessInfo.processInfo.environment["WORLDCREDIT_UI_TEST_ID"],
              let id = UUID(uuidString: identifier) else {
            preconditionFailure("UI tests require a UUID in WORLDCREDIT_UI_TEST_ID")
        }
        let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        return documents.appendingPathComponent("UITests/\(id.uuidString)/worldcredit.sqlite")
    }

    static func recordMetadata() async {
        guard isEnabled else { return }
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        let groupURL = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: WatchSnapshotManager.appGroupId)
        let snapshotCopyURL = databaseURL.deletingLastPathComponent().appendingPathComponent("watch_snapshot.json")
        let metadata: [String: Any] = [
            "database_path": databaseURL.path,
            "snapshot_path": WatchSnapshotManager.shared.snapshotURL?.path ?? "",
            "snapshot_copy_path": snapshotCopyURL.path,
            "app_group_path": groupURL?.path ?? "",
            "notification_authorization": settings.authorizationStatus.rawValue,
            "network": "blocked",
            "apns_registration": "disabled",
            "watch_connectivity": "disabled",
        ]
        do {
            guard let snapshotURL = WatchSnapshotManager.shared.snapshotURL else {
                throw NSError(domain: "WorldCredit.UITest", code: 1,
                              userInfo: [NSLocalizedDescriptionKey: "Watch snapshot URL is unavailable"])
            }
            // Keep each scenario's final evidence after later scenarios replace the shared file.
            let snapshotData = try Data(contentsOf: snapshotURL)
            try snapshotData.write(to: snapshotCopyURL, options: .atomic)
            let data = try JSONSerialization.data(withJSONObject: metadata, options: [.prettyPrinted, .sortedKeys])
            try data.write(to: databaseURL.deletingLastPathComponent().appendingPathComponent("ui-test-metadata.json"), options: .atomic)
        } catch {
            preconditionFailure("UI test snapshot/metadata evidence could not be saved: \(error)")
        }
    }

    static func requestLocalNotificationPermissionIfNeeded() async {
        guard isEnabled, CommandLine.arguments.contains("--ui-test-request-notifications") else { return }
        do {
            _ = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound])
        } catch {
            print("[UI Test] Notification authorization request failed: \(error)")
        }
        await recordMetadata()
    }
    #endif
}

#if DEBUG
struct OfflineUITestNetworkSession: NetworkSession {
    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        // 唯一例外：设置页的 Gmail 连接状态。离线基线是未连接；UI 测试可用
        // WORLDCREDIT_UI_TEST_GMAIL=connected 注入已连接契约样例验证另一套布局。
        if request.url?.path == "/api/gmail/status", request.httpMethod == "GET" {
            let connected = ProcessInfo.processInfo.environment["WORLDCREDIT_UI_TEST_GMAIL"] == "connected"
            let json = connected
                ? #"{"connected":true,"email":"hubo@20160325.xyz","status":"active","last_sync_at":"2026-10-28 12:57:32","last_sync_summary":"扫描 5｜落账单 2｜草稿 1｜跳过 2｜失败 0","last_error":null}"#
                : #"{"connected":false,"email":null,"status":null,"last_sync_at":null,"last_sync_summary":null,"last_error":null}"#
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
            return (Data(json.utf8), response)
        }
        // No URLSession exists in this fixture, including when an unexpected URL is passed.
        throw URLError(.notConnectedToInternet)
    }
}
#endif
