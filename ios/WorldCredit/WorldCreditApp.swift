import SwiftUI
import UIKit
import GoogleSignIn
import WorldCreditCore

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        Task { @MainActor in
            PushNotificationManager.shared.handleDeviceToken(deviceToken)
        }
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        print("[APNs] Failed to register: \(error.localizedDescription)")
    }

    func application(
        _ application: UIApplication,
        didReceiveRemoteNotification userInfo: [AnyHashable: Any],
        fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void
    ) {
        Task { @MainActor in
            let result = await PushNotificationManager.shared.handleRemoteNotification(userInfo: userInfo)
            completionHandler(result)
        }
    }
}

@main
struct WorldCreditApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    @Environment(\.scenePhase) private var scenePhase
    @State private var appState = AppState()

    init() {
        // App-wide configuration
        // 登出时同步清除 GoogleSignIn SDK 保存的身份；SDK 依赖留在 App 入口，AppState 不链接它。
        appState.sessionIdentityCleanup = { GIDSignIn.sharedInstance.signOut() }
    }

    var body: some Scene {
        WindowGroup {
            ZStack {
                ContentView()
                    .environment(appState)

                if appState.isLocked {
                    LockScreenView()
                        .environment(appState)
                        .transition(.opacity)
                }
            }
            .animation(.easeInOut(duration: 0.25), value: appState.isLocked)
            .onChange(of: appState.isLoggedIn) { _, isLoggedIn in
                if isLoggedIn {
                    PushNotificationManager.shared.requestAuthorizationAndRegister()
                }
            }
            .onAppear {
                WatchSyncCoordinator.shared.configure(appState: appState)
                PushNotificationManager.shared.configure(appState: appState)

                #if DEBUG
                if UITestConfiguration.isEnabled {
                    Task {
                        await appState.loadDemoData(onlyIfNeeded: true)
                        await UITestConfiguration.requestLocalNotificationPermissionIfNeeded()
                    }
                } else if CommandLine.arguments.contains("--demo-mode") {
                    Task {
                        await appState.loadDemoData()
                        PushNotificationManager.shared.requestAuthorizationAndRegister()
                    }
                } else if appState.isLoggedIn {
                    PushNotificationManager.shared.requestAuthorizationAndRegister()
                }
                #else
                if appState.isLoggedIn {
                    PushNotificationManager.shared.requestAuthorizationAndRegister()
                }
                #endif

                if CommandLine.arguments.contains("--lock") {
                    appState.isLocked = true
                }
            }
            .onChange(of: scenePhase) { _, newPhase in
                if newPhase == .background {
                    appState.lock()
                }
            }
        }
    }
}
