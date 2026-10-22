import SwiftUI
import UIKit
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
            .onAppear {
                WatchSyncCoordinator.shared.configure(appState: appState)
                PushNotificationManager.shared.configure(appState: appState)

                if CommandLine.arguments.contains("--demo-mode") {
                    Task {
                        await appState.loadDemoData()
                        PushNotificationManager.shared.requestAuthorizationAndRegister()
                    }
                } else if appState.isLoggedIn {
                    PushNotificationManager.shared.requestAuthorizationAndRegister()
                }

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
