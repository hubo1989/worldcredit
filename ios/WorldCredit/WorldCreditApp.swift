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

    private var shouldShowPrivacyShield: Bool {
        scenePhase != .active
            && appState.isLoggedIn
            && (appState.isBiometricsEnabled || appState.displayConfig.privacyMode)
            && !appState.isLocked
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

                if shouldShowPrivacyShield {
                    PrivacyShieldView()
                        .transition(.opacity)
                        .zIndex(100)
                }
            }
            .preferredColorScheme(appState.themeMode == .light ? .light : (appState.themeMode == .dark ? .dark : nil))
            .animation(.easeInOut(duration: 0.25), value: appState.isLocked)
            .animation(.easeInOut(duration: 0.2), value: shouldShowPrivacyShield)
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
            .onOpenURL { url in
                if GIDSignIn.sharedInstance.handle(url) { return }
                appState.handleIncomingURL(url)
            }
        }
    }
}

/// 退入多任务切换/后台瞬间覆盖全屏防截屏隐私遮罩，回到前台平滑移除。
private struct PrivacyShieldView: View {
    var body: some View {
        ZStack {
            WCColors.canvas.opacity(0.65)
                .ignoresSafeArea()
            Rectangle()
                .fill(.ultraThinMaterial)
                .ignoresSafeArea()

            VStack(spacing: 16) {
                ZStack {
                    Circle()
                        .fill(WCColors.surface)
                        .frame(width: 84, height: 84)
                        .overlay(
                            Circle()
                                .stroke(WCColors.border, lineWidth: 1)
                        )

                    Image(systemName: "lock.shield.fill")
                        .font(.system(size: 38))
                        .foregroundStyle(Color(red: 0.85, green: 0.65, blue: 0.25))
                }

                Text("WorldCredit")
                    .font(.title3.bold())
                    .foregroundStyle(WCColors.textPrimary)

                Text("隐私保护中 · 切回应用后恢复显示")
                    .font(.footnote)
                    .foregroundStyle(WCColors.textSecondary)
            }
        }
        .accessibilityIdentifier("app.privacyShield")
    }
}
