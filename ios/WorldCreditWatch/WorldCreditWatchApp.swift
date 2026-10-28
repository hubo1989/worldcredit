import SwiftUI
import WorldCreditCore

@main
struct WorldCreditWatchApp: App {
    @State private var store = WatchStore()

    var body: some Scene {
        WindowGroup {
            NavigationStack {
                WatchHomeView()
                    .environment(store)
            }
        }
    }
}
