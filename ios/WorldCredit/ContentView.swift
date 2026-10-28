import SwiftUI
import WorldCreditCore

struct ContentView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.scenePhase) private var scenePhase
    // TabView 的 selection 必须绑定到稳定的本地 @State。
    // 若每次渲染都新建 Binding(get:set:) 并直读 @Observable 状态，
    // 切 tab 会触发 set → 重渲染 → 新 Binding → TabView 重新协商 selection 的循环，
    // 主线程永不空闲（UI 测试表现为 wait-for-idle 挂起、弹窗检测超时）。
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
                .onChange(of: selectedTab) { _, newValue in
                    // 单向同步：用户点 tab 写入本地状态后，再广播给 AppState
                    // 供首页「查看账单」等入口切页；外部改 selectedTab 不回写本地，
                    // 由下面的变更监听反向对齐。
                    if appState.selectedTab != newValue {
                        appState.selectedTab = newValue
                    }
                }
                .onChange(of: appState.selectedTab) { _, newValue in
                    if selectedTab != newValue {
                        selectedTab = newValue
                    }
                }
            } else {
                LoginView()
            }
        }
        // 监听登录态翻转：登录完成后必须重新加载/同步，否则首页停留在空数据
        .task(id: appState.isLoggedIn) {
            await appState.reloadData()
            if appState.isLoggedIn {
                await appState.sync()
            }
        }
        // 盘库退到内存库时的可恢复提示（数据不持久化）
        .overlay(alignment: .top) {
            if let warning = appState.dbInitWarning {
                Text(warning)
                    .font(.caption)
                    .foregroundStyle(.white)
                    .padding(8)
                    .frame(maxWidth: .infinity)
                    .background(Color.orange)
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
