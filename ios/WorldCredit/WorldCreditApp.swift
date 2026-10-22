import SwiftUI
import WorldCreditCore

@main
struct WorldCreditApp: App {
    @State private var appState = AppState()

    init() {
        // App-wide configuration
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(appState)
                .onAppear {
                    WatchSyncCoordinator.shared.configure(appState: appState)
                    if CommandLine.arguments.contains("--demo-mode") {
                        Task {
                            await appState.loadDemoData()
                        }
                    }
                }
        }
    }
}
