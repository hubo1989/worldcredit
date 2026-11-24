import SwiftUI
import WorldCreditCore

struct AnnualFeeRoiListView: View {
    @Environment(AppState.self) private var appState

    @State private var periodMode: String = "last_12m"
    @State private var selectedTagFilter: String = "all"
    @State private var board: FamilyAnnualFeeRoiBoard?
    @State private var isLoading: Bool = true
    @State private var errorMessage: String?

    var body: some View {
        List {
            Section {
                Picker("统计窗口", selection: $periodMode) {
                    Text("近 12 个月").tag("last_12m")
                    Text("各卡当前周期").tag("current_cycle")
                }
                .pickerStyle(.segmented)

                Picker("决策筛选", selection: $selectedTagFilter) {
                    Text("全部结论").tag("all")
                    ForEach(RoiDecisionTag.allCases, id: \.rawValue) { tag in
                        Text(tag.label).tag(tag.rawValue)
                    }
                }
            }

            if isLoading && board == nil {
                Section {
                    ProgressView("加载年费 ROI 复盘…")
                }
            } else if let errorMessage {
                Section {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(errorMessage)
                            .font(.footnote)
                            .foregroundStyle(WCColors.dangerInk)
                        Button("重试") {
                            Task { await loadBoard() }
                        }
                    }
                }
            } else if let board {
                if !board.fxAvailable || !board.unconvertedCurrencies.isEmpty {
                    Section {
                        Text("未含汇率：\(board.unconvertedCurrencies.joined(separator: "、")) 未计入合计")
                            .font(.caption)
                            .foregroundStyle(WCColors.warningInk)
                    }
                }

                Section("全家年费 ROI 汇总（\(board.displayCurrency)）") {
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("净收益")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Text(DashboardMoney.format(board.summary.netValue, currency: board.displayCurrency))
                                .font(.title2.bold())
                                .foregroundStyle(board.summary.netValue >= 0 ? WCColors.successInk : WCColors.dangerInk)
                        }
                        Spacer()
                        VStack(alignment: .trailing, spacing: 4) {
                            Text("30 天内待决策 \(board.summary.pendingDecision30dCount) 张")
                                .font(.caption.bold())
                                .foregroundStyle(WCColors.warningInk)
                            if let roi = board.summary.overallRoiPct {
                                Text(String(format: "整体 ROI %+.1f%%", roi))
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }

                    HStack(spacing: 12) {
                        summaryCell("年费成本", board.summary.totalAnnualFeeCost, board.displayCurrency)
                        summaryCell("权益估值", board.summary.totalRedeemedBenefitsValue, board.displayCurrency)
                        summaryCell("优惠返现", board.summary.totalPromoAndRewardValue, board.displayCurrency)
                    }
                }

                let filtered = selectedTagFilter == "all"
                    ? board.cards
                    : board.cards.filter { $0.decisionTag.rawValue == selectedTagFilter }

                Section("单卡 ROI 排行（\(filtered.count) 张）") {
                    if filtered.isEmpty {
                        Text("当前筛选下暂无信用卡")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(filtered) { card in
                            NavigationLink(value: CardDetailRoute(cardId: card.cardId, initialSection: "roi")) {
                                VStack(alignment: .leading, spacing: 6) {
                                    HStack {
                                        Text("\(card.bankName) · \(card.cardName)")
                                            .font(.subheadline.bold())
                                        Spacer()
                                        Text(DashboardMoney.format(card.netValue, currency: card.cardCurrency))
                                            .font(.subheadline.bold())
                                            .foregroundStyle(card.netValue >= 0 ? WCColors.successInk : WCColors.dangerInk)
                                    }

                                    HStack(spacing: 6) {
                                        Text(card.decisionTag.label)
                                            .font(.caption2.bold())
                                            .padding(.horizontal, 6)
                                            .padding(.vertical, 2)
                                            .background(WCColors.subtle, in: Capsule())
                                        if let days = card.daysUntilAnnualFee, days >= 0, days <= 30 {
                                            Text("距年费剩 \(days) 天")
                                                .font(.caption2.bold())
                                                .foregroundStyle(WCColors.dangerInk)
                                        }
                                        Spacer()
                                        if let roiPct = card.roiPct {
                                            Text(String(format: "ROI %+.1f%%", roiPct))
                                                .font(.caption2)
                                                .foregroundStyle(.secondary)
                                        } else {
                                            Text(card.costBasis == "waived" ? "已免年费" : "免年费")
                                                .font(.caption2)
                                                .foregroundStyle(.secondary)
                                        }
                                    }

                                    if card.unvaluedBenefitCount > 0 {
                                        Text("另有 \(card.unvaluedBenefitCount) 次已核销权益未设估值")
                                            .font(.caption2)
                                            .foregroundStyle(WCColors.warningInk)
                                    }
                                }
                                .padding(.vertical, 3)
                            }
                        }
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("年费 ROI 复盘")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: periodMode) {
            await loadBoard()
        }
        .refreshable {
            await loadBoard()
        }
    }

    private func summaryCell(_ title: String, _ amount: Double, _ currency: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.caption2).foregroundStyle(.secondary)
            Text(DashboardMoney.format(amount, currency: currency))
                .font(.subheadline.bold())
                .lineLimit(1)
                .minimumScaleFactor(0.75)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func loadBoard() async {
        isLoading = true
        errorMessage = nil
        do {
            let holderArg = appState.currentUser?.role == "admin" ? nil : appState.dashboardHolders.first?.id
            board = try await appState.recommendationsService.getFamilyAnnualFeeRoi(
                holderId: holderArg,
                periodMode: periodMode,
                displayCurrency: appState.dashboardCurrency
            )
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }
}
