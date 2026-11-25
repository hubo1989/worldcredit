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
    @State private var deepLinkedAccountAction: String?
    @State private var deepLinkedEventKey: String?
    @State private var deepLinkedTaskCycleId: String?
    @State private var showingRecommendationSheet: Bool = false

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
                        OpportunityLedgerView(
                            deepLinkedAccountId: $deepLinkedAccountId,
                            deepLinkedAction: $deepLinkedAccountAction
                        )
                    case .calendar:
                        OpportunityCalendarAndRemindersView(
                            deepLinkedEventKey: $deepLinkedEventKey
                        )
                    case .tasks:
                        OpportunityTasksView(
                            deepLinkedTaskCycleId: $deepLinkedTaskCycleId
                        )
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
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        HapticManager.impactLight()
                        showingRecommendationSheet = true
                    } label: {
                        Label("选卡助手", systemImage: "wand.and.stars")
                            .font(.subheadline.bold())
                    }
                    .accessibilityIdentifier("benefits.recommend")
                }
            }
            .sheet(isPresented: $showingRecommendationSheet) {
                CardRecommendationSheetView()
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
        let action = appState.pendingBenefitsAction
        appState.pendingBenefitsRoute = nil
        appState.pendingBenefitsAction = nil
        switch route {
        case .ledger(let accountId):
            selectedSegment = .ledger
            deepLinkedAccountId = accountId
            deepLinkedAccountAction = (accountId != nil) ? action : nil
        case .calendar(let eventKey):
            selectedSegment = .calendar
            deepLinkedEventKey = eventKey
        case .tasks(let taskCycleId):
            selectedSegment = .tasks
            deepLinkedTaskCycleId = taskCycleId
        case .promos:
            selectedSegment = .promos
        }
    }
}
