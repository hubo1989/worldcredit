import SwiftUI
import WorldCreditCore

struct CardRecommendationSheetView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppState.self) private var appState

    @State private var amountText: String = "500"
    @State private var currency: String = "CNY"
    @State private var selectedCategory: RecommendationCategory? = nil
    @State private var optimizeFor: OptimizeForMode = .balanced
    @State private var selectedHolderId: String = "all"
    @State private var merchantKeyword: String = ""
    @State private var showAdvanced: Bool = false

    @State private var isLoading: Bool = false
    @State private var isOfflineFallback: Bool = false
    @State private var validationError: String?
    @State private var output: RecommendationEngineOutput?
    @State private var expandedCardIds: Set<String> = []
    @State private var showOthers: Bool = false

    private let currencies = ["CNY", "USD", "HKD", "JPY", "EUR", "GBP"]

    var body: some View {
        NavigationStack {
            List {
                inputSection

                if let output {
                    bannersSection(output)

                    if output.topRecommendations.isEmpty {
                        emptySection(output)
                    } else {
                        Section("Top 3 推荐卡片") {
                            ForEach(output.topRecommendations) { item in
                                recommendationRow(item)
                            }
                        }
                    }

                    if !output.otherCandidates.isEmpty || !output.excludedCards.isEmpty {
                        Section {
                            DisclosureGroup("全部候选与不可用原因（\(output.otherCandidates.count + output.excludedCards.count) 张）", isExpanded: $showOthers) {
                                ForEach(output.otherCandidates) { item in
                                    recommendationRow(item)
                                }
                                ForEach(output.excludedCards) { ex in
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text("\(ex.bankName) · \(ex.cardName)")
                                            .font(.subheadline.bold())
                                        Text(ex.reason)
                                            .font(.caption)
                                            .foregroundStyle(WCColors.dangerInk)
                                    }
                                    .padding(.vertical, 4)
                                }
                            }
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("消费前选卡助手")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("关闭") { dismiss() }
                }
            }
            .task {
                currency = appState.dashboardCurrency
                if appState.currentUser?.role != "admin",
                   let firstHolder = appState.dashboardHolders.first {
                    selectedHolderId = firstHolder.id
                }
                await runRecommendation()
            }
        }
    }

    private var inputSection: some View {
        Section("消费参数") {
            HStack {
                Text("消费金额 (\(DashboardMoney.currencySymbol(currency)))")
                Spacer()
                TextField("500", text: $amountText)
                    .keyboardType(.decimalPad)
                    .multilineTextAlignment(.trailing)
                    .accessibilityIdentifier("recommend.amount")
            }

            Picker("消费币种", selection: $currency) {
                ForEach(currencies, id: \.self) { code in
                    Text(code).tag(code)
                }
            }

            Picker("消费类目", selection: $selectedCategory) {
                Text("不限 / 通用").tag(Optional<RecommendationCategory>.none)
                ForEach(RecommendationCategory.allCases) { cat in
                    Text(cat.label).tag(Optional(cat))
                }
            }

            DisclosureGroup("偏好与更多条件", isExpanded: $showAdvanced) {
                Picker("排序偏好", selection: $optimizeFor) {
                    ForEach(OptimizeForMode.allCases) { mode in
                        Text(mode.label).tag(mode)
                    }
                }

                if appState.currentUser?.role == "admin" {
                    Picker("持卡人", selection: $selectedHolderId) {
                        Text("全部家庭成员").tag("all")
                        ForEach(appState.dashboardHolders) { holder in
                            Text(holder.name).tag(holder.id)
                        }
                    }
                }

                HStack {
                    Text("商户关键词")
                    Spacer()
                    TextField("如 星巴克", text: $merchantKeyword)
                        .multilineTextAlignment(.trailing)
                }
            }

            if let validationError {
                Text(validationError)
                    .font(.caption)
                    .foregroundStyle(WCColors.dangerInk)
            }

            Button {
                Task { await runRecommendation() }
            } label: {
                HStack {
                    Spacer()
                    if isLoading {
                        ProgressView()
                    } else {
                        Text("计算最优刷卡建议")
                            .font(.subheadline.bold())
                    }
                    Spacer()
                }
            }
            .disabled(isLoading)
            .accessibilityIdentifier("recommend.submit")
        }
    }

    @ViewBuilder
    private func bannersSection(_ out: RecommendationEngineOutput) -> some View {
        if isOfflineFallback || out.allCardsUnconfigured || !out.fxAvailable || !out.bannerWarnings.isEmpty {
            Section("提示说明") {
                if out.allCardsUnconfigured {
                    Text("名下卡片暂未配置结构化返现规则，当前优先按本币、最长免息期与待完成任务推荐。")
                        .font(.caption)
                        .foregroundStyle(WCColors.primaryAccent)
                }
                if !out.fxAvailable {
                    Text("部分币种汇率暂不可用，跨币种卡额度校验与折算净收益已暂停。")
                        .font(.caption)
                        .foregroundStyle(WCColors.warningInk)
                }
                ForEach(out.bannerWarnings, id: \.self) { w in
                    Text(w)
                        .font(.caption)
                        .foregroundStyle(WCColors.warningInk)
                }
            }
        }
    }

    private func emptySection(_ out: RecommendationEngineOutput) -> some View {
        Section {
            ContentUnavailableView {
                Label("暂无可用推荐卡", systemImage: "creditcard.trianglebadge.exclamationmark")
            } description: {
                Text(out.emptyReason == "no_credit_cards"
                     ? "当前名下暂无信用卡。"
                     : "名下卡片额度不足或已冻结/注销，可展开下方原因查看详情。")
            }
        }
    }

    private func recommendationRow(_ item: CardRecommendationItem) -> some View {
        let isExpanded = Binding<Bool>(
            get: { expandedCardIds.contains(item.id) || item.rank == 1 },
            set: { next in
                if next { expandedCardIds.insert(item.id) }
                else { expandedCardIds.remove(item.id) }
            }
        )

        return VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Text(item.rank == 1 ? "Top 1 · 最佳推荐" : "Top \(item.rank)")
                            .font(.caption2.bold())
                            .padding(.horizontal, 7)
                            .padding(.vertical, 2)
                            .background(item.rank == 1 ? WCColors.warningSoft : WCColors.subtle, in: Capsule())
                            .foregroundStyle(item.rank == 1 ? WCColors.warningInk : WCColors.textSecondary)

                        Text(item.cardCurrency)
                            .font(.caption2.bold())
                            .foregroundStyle(.secondary)

                        if item.ruleCompleteness == "none" {
                            Text("0%兜底")
                                .font(.caption2.bold())
                                .foregroundStyle(WCColors.warningInk)
                        }
                    }

                    Text("\(item.bankName) · \(item.cardName)")
                        .font(.headline)
                    Text("\(item.holderName) · 免息 \(item.graceDays) 天 · 还款 \(item.nextDueDate)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    Text(DashboardMoney.format(item.estimatedNetRewardPurchaseCcy, currency: currency))
                        .font(.headline)
                        .foregroundStyle(WCColors.primaryAccent)
                    Text(String(format: "净 %.2f%% · %.2f分", item.netRatePct, item.totalScore))
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }

            ForEach(item.warnings, id: \.self) { warning in
                Text(warning)
                    .font(.caption2)
                    .foregroundStyle(WCColors.warningInk)
            }

            DisclosureGroup("得分拆解（\(item.scoreBreakdown.count) 项）", isExpanded: isExpanded) {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(item.scoreBreakdown) { bd in
                        HStack(alignment: .top) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(bd.label)
                                    .font(.caption.weight(.medium))
                                Text(bd.ruleSource)
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            Text(String(format: bd.score > 0 ? "+%.2f" : "%.2f", bd.score))
                                .font(.caption.bold())
                                .foregroundStyle(bd.score > 0 ? WCColors.successInk : (bd.score < 0 ? WCColors.dangerInk : .secondary))
                        }
                    }
                }
                .padding(.top, 4)
            }
            .font(.caption.bold())
        }
        .padding(.vertical, 4)
    }

    private func runRecommendation() async {
        guard let amount = Double(amountText.trimmingCharacters(in: .whitespacesAndNewlines)),
              amount.isFinite, amount > 0 else {
            validationError = "请输入大于 0 的消费金额"
            return
        }
        validationError = nil
        isLoading = true
        let holderArg: String? = appState.currentUser?.role == "admin"
            ? (selectedHolderId == "all" ? nil : selectedHolderId)
            : appState.dashboardHolders.first?.id

        let input = PurchaseRecommendationInput(
            amount: amount,
            currency: currency,
            category: selectedCategory?.rawValue,
            holderId: holderArg,
            merchantKeyword: merchantKeyword.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : merchantKeyword,
            optimizeFor: optimizeFor.rawValue,
            displayCurrency: appState.dashboardCurrency
        )
        let res = await appState.recommendCards(input: input)
        output = res.output
        isOfflineFallback = res.isOfflineFallback
        if let first = res.output.topRecommendations.first {
            expandedCardIds.insert(first.id)
        }
        isLoading = false
    }
}
