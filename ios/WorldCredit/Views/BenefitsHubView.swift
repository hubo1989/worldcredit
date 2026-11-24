import SwiftUI
import WorldCreditCore

/// Tab 3「权益」总入口（Phase 2 全原生化，零 WebView）：
/// 顶部 4 分段「权益台账 | 权益日历 | 达标任务 | 优惠活动」。
struct BenefitsHubView: View {
    @Environment(AppState.self) private var appState

    enum Segment: Int, CaseIterable, Identifiable {
        case ledger = 0
        case calendar = 1
        case tasks = 2
        case promos = 3

        var id: Int { rawValue }

        var title: String {
            switch self {
            case .ledger: return "权益台账"
            case .calendar: return "权益日历"
            case .tasks: return "达标任务"
            case .promos: return "优惠活动"
            }
        }
    }

    @State private var selectedSegment: Segment = .ledger
    @State private var deepLinkedAccountId: String?

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                Picker("权益视图", selection: $selectedSegment) {
                    ForEach(Segment.allCases) { segment in
                        Text(segment.title).tag(segment)
                    }
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(WCColors.canvas)
                .accessibilityIdentifier("benefits.segmented")

                Group {
                    switch selectedSegment {
                    case .ledger:
                        OpportunityLedgerView(deepLinkedAccountId: $deepLinkedAccountId)
                    case .calendar:
                        OpportunityCalendarAndRemindersView()
                    case .tasks:
                        OpportunityTasksView()
                    case .promos:
                        PromosView()
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            .background(WCColors.canvas.ignoresSafeArea())
            .navigationTitle("权益")
            .navigationBarTitleDisplayMode(.large)
            .navigationDestination(for: String.self) { accountId in
                OpportunityDetailView(accountId: accountId)
            }
            .sensoryFeedback(.selection, trigger: selectedSegment)
            .onAppear {
                consumePendingRoute()
            }
            .onChange(of: appState.pendingBenefitsRoute) { _, _ in
                consumePendingRoute()
            }
        }
    }

    private func consumePendingRoute() {
        guard let route = appState.pendingBenefitsRoute else { return }
        appState.pendingBenefitsRoute = nil
        switch route {
        case .ledger(let accountId):
            selectedSegment = .ledger
            deepLinkedAccountId = accountId
        case .calendar:
            selectedSegment = .calendar
        case .tasks:
            selectedSegment = .tasks
        case .promos:
            selectedSegment = .promos
        }
    }
}
