import SwiftUI
import WorldCreditCore

@main
struct WorldCreditWatchApp: App {
    var body: some Scene {
        WindowGroup {
            NavigationStack {
                WatchHomeView()
            }
        }
    }
}

struct WatchHomeView: View {
    var body: some View {
        VStack(spacing: 8) {
            Text("WorldCredit")
                .font(.headline)
            Text("下一笔还款")
                .font(.caption2)
                .foregroundStyle(.secondary)
            Text("¥3,200.00")
                .font(.title3.bold())
            Text("3 天后")
                .font(.caption2.bold())
                .foregroundStyle(.orange)
        }
    }
}
