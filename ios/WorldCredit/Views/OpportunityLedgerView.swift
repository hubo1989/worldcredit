import SwiftUI
import WorldCreditCore

struct OpportunityLedgerView: View {
    @Environment(AppState.self) private var appState
    @Binding var deepLinkedAccountId: String?

    @State private var searchText: String = ""
    @State private var selectedHolderId: String?
    @State private var selectedCardId: String?
    @State private var selectedStatus: OpportunityAvailabilityStatus?

    @State private var items: [OpportunityLedgerItem] = []
    @State private var statusCounts: [String: Int] = [:]

    @State private var usageTarget: OpportunityLedgerItem?
    @State private var claimTarget: OpportunityLedgerItem?
    @State private var bookingTarget: OpportunityLedgerItem?
    @State private var accountSetupPresented: Bool = false
    @State private var navigatedAccountRoute: String?
    @State private var actionError: String?

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                if let err = actionError {
                    HStack(spacing: 8) {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .foregroundStyle(.red)
                        Text(err)
                            .font(.caption)
                            .foregroundStyle(.red)
                        Spacer()
                    }
                    .padding(12)
                    .background(Color.red.opacity(0.1), in: RoundedRectangle(cornerRadius: 12))
                }

                filterHeader

                if items.isEmpty {
                    ContentUnavailableView {
                        Label("暂无匹配权益", systemImage: "gift")
                    } description: {
                        Text(searchText.isEmpty && selectedStatus == nil ? "同步完成后可查看卡片对应的全部权益配额，也可点击右上角「+」新建权益账户。" : "可放宽筛选条件或清空搜索关键词。")
                    } actions: {
                        Button("新建权益账户") {
                            accountSetupPresented = true
                        }
                        .buttonStyle(.borderedProminent)
                    }
                    .padding(.vertical, 32)
                } else {
                    LazyVStack(spacing: 10) {
                        ForEach(items) { item in
                            NavigationLink(value: item.account.id) {
                                ledgerRowCard(item)
                            }
                            .buttonStyle(.plain)
                            .accessibilityIdentifier("benefits.ledger.row.\(item.account.id)")
                        }
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .padding(.bottom, 28)
        }
        .searchable(text: $searchText, prompt: "搜索权益名称")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    accountSetupPresented = true
                } label: {
                    Image(systemName: "plus")
                }
                .accessibilityIdentifier("benefits.ledger.addAccount")
            }
        }
        .refreshable {
            _ = await appState.sync()
            await reloadFiltered()
        }
        .task {
            await reloadFiltered()
            consumeDeepLink()
        }
        .onChange(of: deepLinkedAccountId) { _, _ in
            consumeDeepLink()
        }
        .onChange(of: searchText) { _, _ in Task { await reloadFiltered() } }
        .onChange(of: selectedHolderId) { _, _ in
            selectedCardId = nil
            Task { await reloadFiltered() }
        }
        .onChange(of: selectedCardId) { _, _ in Task { await reloadFiltered() } }
        .onChange(of: selectedStatus) { _, _ in Task { await reloadFiltered() } }
        .onChange(of: appState.opportunityLedger) { _, _ in Task { await reloadFiltered() } }
        .navigationDestination(item: $navigatedAccountRoute) { accountId in
            OpportunityDetailView(accountId: accountId)
        }
        .sheet(item: $usageTarget) { item in
            OpportunityUsageEditorSheet(item: item, editingUsage: nil) {
                await reloadFiltered()
            }
        }
        .sheet(item: $claimTarget) { item in
            OpportunityClaimSheet(item: item) {
                await reloadFiltered()
            }
        }
        .sheet(item: $bookingTarget) { item in
            OpportunityBookingSheet(item: item) {
                await reloadFiltered()
            }
        }
        .sheet(isPresented: $accountSetupPresented) {
            OpportunityAccountSetupSheet {
                await reloadFiltered()
            }
        }
    }

    private func consumeDeepLink() {
        guard let targetId = deepLinkedAccountId, !targetId.isEmpty else { return }
        deepLinkedAccountId = nil
        navigatedAccountRoute = targetId
    }

    private func reloadFiltered() async {
        do {
            let result = try await appState.opportunityQueryService.fetchLedger(
                userId: appState.currentUser?.id,
                holderId: selectedHolderId,
                cardId: selectedCardId,
                status: selectedStatus,
                query: searchText
            )
            items = result.items
            statusCounts = result.counts
        } catch {
            items = appState.opportunityLedger
            statusCounts = appState.opportunityLedgerCounts
        }
    }

    // MARK: - Filters

    private var filterHeader: some View {
        VStack(alignment: .leading, spacing: 10) {
            if !appState.dashboardHolders.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        filterChip("全部持卡人", selected: selectedHolderId == nil) {
                            selectedHolderId = nil
                        }
                        ForEach(appState.dashboardHolders) { holder in
                            filterChip(holder.name, selected: selectedHolderId == holder.id) {
                                selectedHolderId = holder.id
                            }
                        }
                    }
                }
            }

            let scopedCards = appState.cards.filter { card in
                selectedHolderId == nil || card.card.holderId == selectedHolderId
            }
            if !scopedCards.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        filterChip("全部卡片", selected: selectedCardId == nil) {
                            selectedCardId = nil
                        }
                        ForEach(scopedCards) { cardItem in
                            let tail = cardItem.last4.isEmpty ? "" : "(\(cardItem.last4))"
                            filterChip("\(cardItem.displayName)\(tail)", selected: selectedCardId == cardItem.id) {
                                selectedCardId = cardItem.id
                            }
                        }
                    }
                }
            }

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    filterChip("全部 \(totalStatusCount)", selected: selectedStatus == nil) {
                        selectedStatus = nil
                    }
                    ForEach(OpportunityAvailabilityStatus.allCases.sorted(by: { $0.sortRank < $1.sortRank })) { status in
                        let c = statusCounts[status.rawValue] ?? 0
                        filterChip("\(status.label) \(c)", selected: selectedStatus == status) {
                            selectedStatus = (selectedStatus == status) ? nil : status
                        }
                    }
                }
            }
        }
    }

    private var totalStatusCount: Int {
        statusCounts.values.reduce(0, +)
    }

    private func filterChip(_ title: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button {
            HapticManager.selection()
            action()
        } label: {
            Text(title)
                .font(.caption.bold())
                .padding(.horizontal, 12)
                .frame(minHeight: 36)
                .background(
                    selected ? WCColors.primaryAccent : Color(uiColor: .secondarySystemGroupedBackground),
                    in: Capsule()
                )
                .foregroundStyle(selected ? .white : .primary)
        }
        .buttonStyle(.plain)
    }

    // MARK: - Row Card

    private func ledgerRowCard(_ item: OpportunityLedgerItem) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 10) {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 6) {
                        statusPill(item.availability.status)
                        if let bank = item.bankName, !bank.isEmpty {
                            Text(bank)
                                .font(.caption2.bold())
                                .foregroundStyle(.secondary)
                        }
                        if !item.sharedText.isEmpty {
                            Text(item.sharedText)
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }
                    Text(item.rules.title)
                        .font(.headline)
                        .foregroundStyle(.primary)
                        .multilineTextAlignment(.leading)

                    let kindLabel = item.definition.kind == "benefit" ? "权益" : (item.definition.kind == "promo" ? "优惠" : "私人奖励")
                    Text("\(kindLabel) · \(item.holderName) · \(item.deadlineLabel)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Spacer()

                Button {
                    HapticManager.selection()
                    Task {
                        do {
                            try await appState.toggleOpportunityFollowed(item)
                        } catch {
                            actionError = error.localizedDescription
                        }
                    }
                } label: {
                    Image(systemName: item.followed ? "star.fill" : "star")
                        .font(.subheadline)
                        .foregroundStyle(item.followed ? Color.orange : Color.secondary)
                        .frame(width: 44, height: 44)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(item.followed ? "取消关注" : "关注权益")
            }

            HStack(alignment: .center, spacing: 10) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.balanceMain)
                        .font(.subheadline.bold())
                        .foregroundStyle(.primary)
                    if !item.balanceSub.isEmpty {
                        Text(item.balanceSub)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                    if let hint = item.reviewHint {
                        Text(hint)
                            .font(.caption2.bold())
                            .foregroundStyle(.orange)
                    }
                }

                Spacer()

                if item.availability.action == .recordUsage {
                    Button("记录使用") {
                        HapticManager.impactLight()
                        usageTarget = item
                    }
                    .font(.caption.bold())
                    .buttonStyle(.borderedProminent)
                    .controlSize(.small)
                    .accessibilityIdentifier("benefits.row.recordUsage.\(item.account.id)")
                } else if item.availability.action == .recordClaim {
                    Button("记录已领取") {
                        HapticManager.impactLight()
                        claimTarget = item
                    }
                    .font(.caption.bold())
                    .buttonStyle(.borderedProminent)
                    .controlSize(.small)
                    .accessibilityIdentifier("benefits.row.recordClaim.\(item.account.id)")
                } else if item.availability.action == .fixData {
                    Button("去核对") {
                        navigatedAccountRoute = item.account.id
                    }
                    .font(.caption.bold())
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                }
            }

            Text(item.availability.reason)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .padding(14)
        .background(Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16))
    }

    private func statusPill(_ status: OpportunityAvailabilityStatus) -> some View {
        let color: Color = switch status {
        case .availableToday: .green
        case .expiringSoon: .orange
        case .claimable: WCColors.primaryAccent
        case .needsConfirmation: .yellow
        case .exhausted, .notStarted, .expired: .secondary
        }
        return Text(status.label)
            .font(.caption2.bold())
            .foregroundStyle(color)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(color.opacity(0.14), in: Capsule())
    }
}
