import SwiftUI
import WorldCreditCore

struct ContentView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        Group {
            if appState.isLoggedIn {
                TabView {
                    DashboardView()
                        .tabItem {
                            Label("概览", systemImage: "chart.pie.fill")
                        }

                    BillsView()
                        .tabItem {
                            Label("账单", systemImage: "doc.text.fill")
                        }

                    CardsView()
                        .tabItem {
                            Label("卡片", systemImage: "creditcard.fill")
                        }

                    SettingsView()
                        .tabItem {
                            Label("设置", systemImage: "gearshape.fill")
                        }
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
