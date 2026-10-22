import SwiftUI
import WorldCreditCore

struct ContentView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.scenePhase) private var scenePhase
    @State private var selectedTab: Int = {
        if CommandLine.arguments.contains("--tab=bills") { return 1 }
        if CommandLine.arguments.contains("--tab=cards") { return 2 }
        if CommandLine.arguments.contains("--tab=settings") { return 3 }
        return 0
    }()

    var body: some View {
        Group {
            if appState.isLoggedIn {
                TabView(selection: $selectedTab) {
                    DashboardView()
                        .tabItem {
                            Label("概览", systemImage: "chart.pie.fill")
                        }
                        .tag(0)

                    BillsView()
                        .tabItem {
                            Label("账单", systemImage: "doc.text.fill")
                        }
                        .tag(1)

                    CardsView()
                        .tabItem {
                            Label("卡片", systemImage: "creditcard.fill")
                        }
                        .tag(2)

                    SettingsView()
                        .tabItem {
                            Label("设置", systemImage: "gearshape.fill")
                        }
                        .tag(3)
                }
            } else {
                LoginView()
            }
        }
        .task {
            await appState.reloadData()
            if appState.isLoggedIn {
                await appState.sync()
            }
        }
        .onChange(of: scenePhase) { _, newPhase in
            if newPhase == .active && appState.isLoggedIn {
                Task {
                    await appState.sync()
                }
            }
        }
    }
}
