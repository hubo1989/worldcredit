import Foundation
import UIKit
import UserNotifications
import WorldCreditCore

@MainActor
public final class PushNotificationManager: NSObject {
    public static let shared = PushNotificationManager()

    private weak var appState: AppState?

    private override init() {
        super.init()
    }

    public func configure(appState: AppState) {
        self.appState = appState
        UNUserNotificationCenter.current().delegate = self
    }

    /// 请求系统通知授权并向 APNs 注册
    public func requestAuthorizationAndRegister() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { granted, error in
            if granted {
                DispatchQueue.main.async {
                    UIApplication.shared.registerForRemoteNotifications()
                }
            } else if let error {
                print("[APNs] Authorization error: \(error.localizedDescription)")
            }
        }
    }

    /// 处理获取到的 APNs Device Token
    public func handleDeviceToken(_ deviceToken: Data) {
        let tokenString = deviceToken.map { String(format: "%02.2hhx", $0) }.joined()
        UserDefaults.standard.set(tokenString, forKey: "worldcredit_apns_token")

        guard let appState = self.appState, appState.isLoggedIn else { return }

        Task {
            do {
                try await appState.apiClient.registerDeviceToken(
                    token: tokenString,
                    platform: "ios",
                    appVersion: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String
                )
                print("[APNs] Device token registered with backend successfully.")
            } catch {
                print("[APNs] Failed to register token with backend: \(error.localizedDescription)")
            }
        }
    }

    /// 用户登出时注销 Token
    public func unregisterCurrentToken() {
        guard let tokenString = UserDefaults.standard.string(forKey: "worldcredit_apns_token"),
              let appState = self.appState else { return }

        Task {
            try? await appState.apiClient.unregisterDeviceToken(token: tokenString)
            UserDefaults.standard.removeObject(forKey: "worldcredit_apns_token")
        }
    }

    /// 处理接收到的远程静默推送
    public func handleRemoteNotification(
        userInfo: [AnyHashable: Any]
    ) async -> UIBackgroundFetchResult {
        guard let appState = self.appState else { return .noData }

        let isSilentSync = (userInfo["type"] as? String) == "sync" ||
            ((userInfo["aps"] as? [String: Any])?["content-available"] as? Int) == 1

        if isSilentSync {
            do {
                try await appState.syncEngine.sync()
                await appState.reloadData()
                return .newData
            } catch {
                return .failed
            }
        }

        return .noData
    }
}

extension PushNotificationManager: UNUserNotificationCenterDelegate {
    public nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .badge, .sound, .list])
    }
}
