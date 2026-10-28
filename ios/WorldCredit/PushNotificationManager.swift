import Foundation
import UIKit
import UserNotifications
import WorldCreditCore

@MainActor
public final class PushNotificationManager: NSObject {
    public static let shared = PushNotificationManager()

    private weak var appState: AppState?
    private var tokenUpdateTask: Task<Void, Never>?

    private override init() {
        super.init()
    }

    public func configure(appState: AppState) {
        self.appState = appState
        UNUserNotificationCenter.current().delegate = self
    }

    /// 请求系统通知授权并向 APNs 注册
    public func requestAuthorizationAndRegister() {
        guard !UITestConfiguration.isEnabled else { return }
        // A token may arrive before login; report it now using the authenticated session.
        registerCachedToken()
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { _, error in
            if let error {
                print("[APNs] Authorization error: \(error.localizedDescription)")
            }
            // Silent pushes do not require authorization to show alerts.
            DispatchQueue.main.async {
                UIApplication.shared.registerForRemoteNotifications()
            }
        }
    }

    /// 处理获取到的 APNs Device Token
    public func handleDeviceToken(_ deviceToken: Data) {
        guard !UITestConfiguration.isEnabled else { return }
        let tokenString = deviceToken.map { String(format: "%02.2hhx", $0) }.joined()
        UserDefaults.standard.set(tokenString, forKey: "worldcredit_apns_token")
        registerCachedToken()
    }

    private func registerCachedToken() {
        guard let appState, appState.isLoggedIn,
              let authToken = appState.apiClient.token,
              let tokenString = UserDefaults.standard.string(forKey: "worldcredit_apns_token") else { return }
        let previousUpdate = tokenUpdateTask

        tokenUpdateTask = Task {
            await previousUpdate?.value
            do {
                try await appState.apiClient.registerDeviceToken(
                    token: tokenString,
                    platform: "ios",
                    appVersion: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String,
                    authenticationToken: authToken
                )
                print("[APNs] Device token registered with backend successfully.")
            } catch {
                print("[APNs] Failed to register token with backend: \(error.localizedDescription)")
            }
        }
    }

    /// 用户登出时注销 Token
    public func unregisterCurrentToken() {
        guard !UITestConfiguration.isEnabled else { return }
        UIApplication.shared.unregisterForRemoteNotifications()
        guard let tokenString = UserDefaults.standard.string(forKey: "worldcredit_apns_token"),
              let appState,
              let authToken = appState.apiClient.token else { return }
        let previousUpdate = tokenUpdateTask

        // Capture credentials synchronously before AppState clears the session; keep token
        // updates ordered so an in-flight registration cannot undo this unregistration.
        tokenUpdateTask = Task {
            await previousUpdate?.value
            do {
                try await appState.apiClient.unregisterDeviceToken(token: tokenString, authenticationToken: authToken)
                print("[APNs] Device token unregistered with backend successfully.")
            } catch {
                // Retain the cached device token for reconciliation on the next login.
                // Session credentials are never persisted outside Keychain for a retry.
                print("[APNs] Backend unregistration failed; cached token retained: \(error.localizedDescription)")
            }
        }
    }

    /// 处理接收到的远程静默推送
    public func handleRemoteNotification(
        userInfo: [AnyHashable: Any]
    ) async -> UIBackgroundFetchResult {
        guard let appState, appState.isLoggedIn else { return .noData }

        let isSilentSync = (userInfo["type"] as? String) == "sync" ||
            ((userInfo["aps"] as? [String: Any])?["content-available"] as? Int) == 1

        if isSilentSync {
            // Reuse foreground sync, reminder scheduling and Watch refresh, and wait for
            // an already running cycle rather than incorrectly reporting early success.
            return await appState.sync() ? .newData : .failed
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
