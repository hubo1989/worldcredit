import SwiftUI
import WorldCreditCore

/// Tab 3「权益」总入口：顶部 3 分段「优惠活动 | 权益台账 | 权益日历」。
/// - 优惠活动：纯原生离线 `PromosView()`；
/// - 权益台账 / 权益日历：展示原生汇总预览，并通过 `appState.openWebDestination(...)`
///   由 `ContentView` 唯一承载 `DashboardWebView` Sheet（Phase 2 全量原生化）。
struct BenefitsHubView: View {
    @Environment(AppState.self) private var appState

    enum Segment: Int, CaseIterable, Identifiable {
        case promos = 0
        case ledger = 1
        case calendar = 2

        var id: Int { rawValue }

        var title: String {
            switch self {
            case .promos: return "优惠活动"
            case .ledger: return "权益台账"
            case .calendar: return "权益日历"
            }
        }
    }

    @State private var selectedSegment: Segment = .promos
    @State private var hapticImpactTrigger: Int = 0
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
                    case .promos:
                        PromosView()
                    case .ledger:
                        ledgerPreviewView
                    case .calendar:
                        calendarPreviewView
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            .background(WCColors.canvas.ignoresSafeArea())
            .navigationTitle("权益")
            .navigationBarTitleDisplayMode(.large)
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
            .sensoryFeedback(.impact(weight: .medium), trigger: hapticImpactTrigger)
        }
    }

    // MARK: - 权益台账预览卡

    private var ledgerPreviewView: some View {
        ScrollView {
            VStack(spacing: 14) {
                statusHeroCard(
                    icon: "gift.fill",
                    iconBg: WCColors.primaryAccent.opacity(0.14),
                    iconColor: WCColors.primaryAccent,
                    title: "个人权益台账",
                    subtitle: "集中追踪持卡人名下机场贵宾厅、酒店礼遇、刷卡返现等权益配额与核销进度。",
                    primaryButtonTitle: "打开权益台账",
                    primaryIdentifier: "benefits.openLedger"
                ) {
                    hapticImpactTrigger += 1
                    appState.openWebDestination(.benefits)
                }

                availableCountCard
                remindersPreviewSection
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .padding(.bottom, 28)
        }
        .refreshable {
            await appState.refreshDashboardRemote()
        }
    }

    // MARK: - 权益日历预览卡

    private var calendarPreviewView: some View {
        ScrollView {
            VStack(spacing: 14) {
                statusHeroCard(
                    icon: "calendar.badge.clock",
                    iconBg: WCColors.warningSoft,
                    iconColor: WCColors.warningInk,
                    title: "权益与抢兑日历",
                    subtitle: "按月查看周期重置节点、临期未领权益与银行抢兑窗口提醒，不错过高价值权益。",
                    primaryButtonTitle: "打开权益日历",
                    primaryIdentifier: "benefits.openCalendar"
                ) {
                    hapticImpactTrigger += 1
                    appState.openWebDestination(.benefitCalendar)
                }

                remindersPreviewSection
                availableCountCard
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .padding(.bottom, 28)
        }
        .refreshable {
            await appState.refreshDashboardRemote()
        }
    }

    // MARK: - 共享预览组件

    private func statusHeroCard(
        icon: String,
        iconBg: Color,
        iconColor: Color,
        title: String,
        subtitle: String,
        primaryButtonTitle: String,
        primaryIdentifier: String,
        action: @escaping () -> Void
    ) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 12) {
                Image(systemName: icon)
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(iconColor)
                    .frame(width: 48, height: 48)
                    .background(iconBg, in: RoundedRectangle(cornerRadius: 12))

                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(.headline.bold())
                        .foregroundStyle(WCColors.textPrimary)
                    Text("支持登记核销、配额统计与提醒联动")
                        .font(.caption)
                        .foregroundStyle(WCColors.textSecondary)
                }
                Spacer()
            }

            Text(subtitle)
                .font(.subheadline)
                .foregroundStyle(WCColors.textSecondary)
                .fixedSize(horizontal: false, vertical: true)

            Button(action: action) {
                HStack {
                    Spacer()
                    Label(primaryButtonTitle, systemImage: "arrow.up.right.square")
                        .font(.subheadline.bold())
                    Spacer()
                }
                .foregroundStyle(Color.white)
                .padding(.vertical, 12)
                .background(WCColors.primaryAccent, in: RoundedRectangle(cornerRadius: 12))
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier(primaryIdentifier)
        }
        .padding(16)
        .background(WCColors.surface, in: RoundedRectangle(cornerRadius: 16))
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(WCColors.border, lineWidth: 1)
        )
    }

    private var availableCountCard: some View {
        HStack(spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                Text("当日可用权益 / 机会")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(WCColors.textSecondary)
                if let count = appState.dashboardAvailableCount {
                    Text("\(count) 项可用")
                        .font(.title2.bold())
                        .foregroundStyle(WCColors.primaryAccent)
                } else {
                    Text("下拉可刷新实时统计")
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(WCColors.textSecondary)
                }
            }
            Spacer()
            Button("刷新") {
                Task { await appState.refreshDashboardRemote() }
            }
            .font(.caption.bold())
            .foregroundStyle(WCColors.primaryAccent)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(WCColors.subtle, in: Capsule())
        }
        .padding(16)
        .background(WCColors.surface, in: RoundedRectangle(cornerRadius: 16))
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(WCColors.border, lineWidth: 1)
        )
    }

    private var remindersPreviewSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("即将提醒")
                    .font(.subheadline.bold())
                    .foregroundStyle(WCColors.textPrimary)
                Spacer()
                Text("\(appState.dashboardReminders.count) 条")
                    .font(.caption)
                    .foregroundStyle(WCColors.textSecondary)
            }

            if appState.dashboardReminders.isEmpty {
                Text("当前暂无临期权益或机会提醒；点击上方按钮可前往台账与日历完善权益配置。")
                    .font(.caption)
                    .foregroundStyle(WCColors.textSecondary)
                    .padding(.vertical, 6)
            } else {
                ForEach(appState.dashboardReminders) { reminder in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(alignment: .top) {
                            Text(reminder.title)
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(WCColors.textPrimary)
                            Spacer()
                            Text(reminder.localDateOn)
                                .font(.caption2.weight(.medium))
                                .padding(.horizontal, 7)
                                .padding(.vertical, 2)
                                .background(WCColors.subtle, in: Capsule())
                                .foregroundStyle(WCColors.textSecondary)
                        }
                        if !reminder.actionHint.isEmpty {
                            Text(reminder.actionHint)
                                .font(.caption)
                                .foregroundStyle(WCColors.textSecondary)
                        }
                        if reminder.event.needsReview {
                            Text("待核对")
                                .font(.caption2.bold())
                                .foregroundStyle(WCColors.warningInk)
                        }
                    }
                    .padding(12)
                    .background(WCColors.subtle, in: RoundedRectangle(cornerRadius: 10))
                }
            }
        }
        .padding(16)
        .background(WCColors.surface, in: RoundedRectangle(cornerRadius: 16))
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(WCColors.border, lineWidth: 1)
        )
    }
}
