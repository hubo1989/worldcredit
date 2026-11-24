import SwiftUI
import WorldCreditCore

struct OpportunityDetailView: View {
    @Environment(AppState.self) private var appState
    let accountId: String

    @State private var detail: OpportunityLedgerItem?
    @State private var cycles: [OpportunityCycleRecord] = []
    @State private var usages: [OpportunityUsageRecord] = []
    @State private var fulfillments: [OpportunityFulfillmentRecord] = []
    @State private var remoteEvents: [OpportunityUsageHistoryEventDTO] = []

    @State private var showingUsageCreate = false
    @State private var editingUsage: OpportunityUsageRecord?
    @State private var voidingUsage: OpportunityUsageRecord?
    @State private var showingClaim = false
    @State private var voidingClaim: OpportunityFulfillmentRecord?
    @State private var showingBooking = false
    @State private var settlingBooking: OpportunityFulfillmentRecord?
    @State private var showingEligibility = false
    @State private var showingOpeningBalance = false
    @State private var actionError: String?

    var body: some View {
        ScrollView {
            VStack(spacing: 14) {
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

                if let item = detail {
                    summarySection(item)
                    actionsSection(item)
                    if !item.activeBookings.isEmpty {
                        bookingsSection(item)
                    }
                    eligibilityAndBalanceSection(item)
                    usageHistorySection(item)
                } else {
                    ContentUnavailableView(
                        "未找到该权益详情",
                        systemImage: "gift",
                        description: Text("请下拉刷新或先在账户完成一次同步。")
                    )
                    .padding(.vertical, 40)
                }
            }
            .padding(16)
        }
        .background(WCColors.canvas.ignoresSafeArea())
        .navigationTitle(detail?.rules.title ?? "权益详情")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable {
            _ = await appState.sync()
            await loadDetail()
        }
        .task {
            await loadDetail()
        }
        .onChange(of: appState.opportunityLedger) { _, _ in
            Task { await loadDetail() }
        }
        .sheet(isPresented: $showingUsageCreate) {
            if let item = detail {
                OpportunityUsageEditorSheet(item: item, editingUsage: nil) {
                    await loadDetail()
                }
            }
        }
        .sheet(item: $editingUsage) { usage in
            if let item = detail {
                OpportunityUsageEditorSheet(item: item, editingUsage: usage) {
                    await loadDetail()
                }
            }
        }
        .sheet(item: $voidingUsage) { usage in
            OpportunityReasonSheet(
                title: "作废使用记录",
                message: "确认作废 \(usage.usedOn) 的使用记录并恢复对应周期配额吗？请填写原因。"
            ) { reason in
                try await appState.voidOpportunityUsage(
                    usageId: usage.id,
                    reason: reason,
                    expectedRevision: usage.revision
                )
                await loadDetail()
            }
        }
        .sheet(isPresented: $showingClaim) {
            if let item = detail {
                OpportunityClaimSheet(item: item) {
                    await loadDetail()
                }
            }
        }
        .sheet(item: $voidingClaim) { claim in
            OpportunityReasonSheet(
                title: "撤销已领取",
                message: "若本周期尚未使用或预约，撤销后将恢复为「待领取」状态。"
            ) { reason in
                try await appState.voidOpportunityClaim(
                    fulfillmentId: claim.id,
                    reason: reason,
                    expectedRevision: claim.revision
                )
                await loadDetail()
            }
        }
        .sheet(isPresented: $showingBooking) {
            if let item = detail {
                OpportunityBookingSheet(item: item) {
                    await loadDetail()
                }
            }
        }
        .sheet(item: $settlingBooking) { booking in
            OpportunityBookingSettlementSheet(booking: booking) {
                await loadDetail()
            }
        }
        .sheet(isPresented: $showingEligibility) {
            if let item = detail {
                OpportunityEligibilitySheet(item: item) {
                    await loadDetail()
                }
            }
        }
        .sheet(isPresented: $showingOpeningBalance) {
            if let item = detail, let cycle = item.currentCycle {
                OpportunityOpeningBalanceSheet(accountId: item.account.id, cycle: cycle) {
                    await loadDetail()
                }
            }
        }
    }

    private func loadDetail() async {
        do {
            if let loaded = try await appState.opportunityQueryService.fetchDetail(
                accountId: accountId,
                userId: appState.currentUser?.id
            ) {
                detail = loaded.item
                cycles = loaded.cycles
                usages = loaded.usages
                fulfillments = loaded.fulfillments
            }
            if let remote = try? await appState.fetchOpportunityUsageHistory(accountId: accountId) {
                remoteEvents = remote.events
            }
        } catch {
            actionError = error.localizedDescription
        }
    }

    // MARK: - Sections

    private func summarySection(_ item: OpportunityLedgerItem) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(item.availability.status.label)
                    .font(.caption.bold())
                    .foregroundStyle(WCColors.primaryAccent)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4)
                    .background(WCColors.primaryAccent.opacity(0.14), in: Capsule())

                Spacer()

                Button {
                    Task {
                        try? await appState.toggleOpportunityFollowed(item)
                        await loadDetail()
                    }
                } label: {
                    Label(item.followed ? "已关注" : "关注", systemImage: item.followed ? "star.fill" : "star")
                        .font(.caption.bold())
                }
                .buttonStyle(.bordered)
            }

            Text(item.rules.title)
                .font(.title3.bold())

            if let desc = item.rules.description, !desc.isEmpty {
                Text(desc)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            Divider()

            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("当期剩余")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    Text(item.balanceMain)
                        .font(.headline)
                    if !item.balanceSub.isEmpty {
                        Text(item.balanceSub)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    Text("期限")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    Text(item.deadlineLabel)
                        .font(.subheadline.bold())
                    Text(item.availability.reason)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }

            if !item.cardIds.isEmpty {
                let labels = item.cardIds.compactMap { cid -> String? in
                    guard let c = appState.cards.first(where: { $0.id == cid }) else { return cid }
                    return c.last4.isEmpty ? c.displayName : "\(c.displayName)(\(c.last4))"
                }
                Text("绑定卡片：\(labels.joined(separator: "、"))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(16)
        .background(Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16))
    }

    private func actionsSection(_ item: OpportunityLedgerItem) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("快捷操作")
                .font(.headline)

            HStack(spacing: 10) {
                if item.availability.status == .claimable {
                    Button {
                        showingClaim = true
                    } label: {
                        Label("记录已领取", systemImage: "checkmark.seal.fill")
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .buttonStyle(.borderedProminent)
                    .accessibilityIdentifier("benefits.detail.recordClaim")
                } else {
                    Button {
                        showingUsageCreate = true
                    } label: {
                        Label("记录使用", systemImage: "plus.circle.fill")
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(item.currentCycle == nil || item.availability.remainingCount == 0 || item.availability.remainingMinor == 0)
                    .accessibilityIdentifier("benefits.detail.recordUsage")
                }

                Button {
                    showingBooking = true
                } label: {
                    Label("记录预约", systemImage: "calendar.badge.plus")
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.bordered)
                .disabled(item.currentCycle == nil || item.currentCycle?.activationState != "active")
                .accessibilityIdentifier("benefits.detail.recordBooking")
            }

            if let claim = item.pendingClaimFulfillment,
               let cycle = item.currentCycle,
               cycle.usedCount == 0 && cycle.reservedCount == 0 && cycle.usedMinor == 0 && cycle.reservedMinor == 0 {
                Button("撤销已领取") {
                    voidingClaim = claim
                }
                .font(.caption.bold())
                .foregroundStyle(.orange)
            }
        }
        .padding(16)
        .background(Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16))
    }

    private func bookingsSection(_ item: OpportunityLedgerItem) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("预约记录 (\(item.activeBookings.count))")
                .font(.headline)

            ForEach(item.activeBookings) { booking in
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text(booking.status == "pending_settlement" ? "待结算确认" : "已预约")
                            .font(.caption2.bold())
                            .foregroundStyle(booking.status == "pending_settlement" ? .orange : WCColors.primaryAccent)
                        Spacer()
                        Text(String((booking.serviceAt ?? booking.recordedOn).prefix(16)).replacingOccurrences(of: "T", with: " "))
                            .font(.caption.bold())
                    }
                    Text("数量 \(booking.quantity)" + (booking.amountMinor > 0 ? " · \(OpportunityDomainEngine.formatMinorAmount(booking.amountMinor, currency: item.currentCycle?.currency))" : ""))
                        .font(.subheadline)
                    if let note = booking.note, !note.isEmpty {
                        Text(note)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    HStack(spacing: 10) {
                        if booking.status == "recorded" {
                            Button("完成使用") {
                                Task {
                                    do {
                                        try await appState.completeOpportunityBooking(
                                            fulfillmentId: booking.id,
                                            usedOn: OpportunityDates.localDateInZone(Date(), timeZone: item.rules.timeZone),
                                            expectedRevision: booking.revision
                                        )
                                        await loadDetail()
                                    } catch {
                                        actionError = error.localizedDescription
                                    }
                                }
                            }
                            .buttonStyle(.borderedProminent)
                            .controlSize(.small)
                        }
                        Button(booking.status == "pending_settlement" ? "更新结算结果" : "取消/退改") {
                            settlingBooking = booking
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                    }
                }
                .padding(12)
                .background(WCColors.canvas, in: RoundedRectangle(cornerRadius: 12))
            }
        }
        .padding(16)
        .background(Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16))
    }

    private func eligibilityAndBalanceSection(_ item: OpportunityLedgerItem) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("资格与期初核对（在线操作）")
                .font(.headline)

            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("个人资格状态")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    Text(eligibilityLabel(item.account.eligibility))
                        .font(.subheadline.bold())
                }
                Spacer()
                Button("确认资格") {
                    showingEligibility = true
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
            }

            if let cycle = item.currentCycle {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("本期期初余额")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                        Text(cycle.balanceVerified ? "已核对" : "尚未核对")
                            .font(.subheadline.bold())
                            .foregroundStyle(cycle.balanceVerified ? .green : .orange)
                    }
                    Spacer()
                    Button("核对期初余额") {
                        showingOpeningBalance = true
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                }
            }
        }
        .padding(16)
        .background(Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16))
    }

    private func usageHistorySection(_ item: OpportunityLedgerItem) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("使用历史 (\(usages.count))")
                .font(.headline)

            if usages.isEmpty {
                Text("暂无使用记录")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(usages) { usage in
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text(usage.usedOn)
                                .font(.subheadline.bold())
                            if usage.status == "voided" {
                                Text("已作废")
                                    .font(.caption2.bold())
                                    .foregroundStyle(.secondary)
                                    .padding(.horizontal, 6)
                                    .padding(.vertical, 2)
                                    .background(Color.secondary.opacity(0.15), in: Capsule())
                            }
                            Spacer()
                            if usage.amountMinor > 0 {
                                Text(OpportunityDomainEngine.formatMinorAmount(usage.amountMinor, currency: item.currentCycle?.currency))
                                    .font(.subheadline.bold())
                            } else {
                                Text("\(usage.quantity) \(item.rules.unitLabel)")
                                    .font(.subheadline.bold())
                            }
                        }

                        if let note = usage.note, !note.isEmpty {
                            Text(note)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }

                        if usage.status == "active" {
                            HStack(spacing: 12) {
                                Button("更正") {
                                    editingUsage = usage
                                }
                                .font(.caption.bold())
                                Button("作废", role: .destructive) {
                                    voidingUsage = usage
                                }
                                .font(.caption.bold())
                            }
                            .padding(.top, 2)
                        }
                    }
                    .padding(12)
                    .background(WCColors.canvas, in: RoundedRectangle(cornerRadius: 12))
                }
            }

            if !remoteEvents.isEmpty {
                DisclosureGroup("审计事件明细 (\(remoteEvents.count))") {
                    ForEach(remoteEvents) { ev in
                        HStack {
                            Text(ev.eventType)
                                .font(.caption2.bold())
                            Spacer()
                            Text(String(ev.createdAt.prefix(10)))
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                        .padding(.vertical, 2)
                    }
                }
                .font(.caption)
            }
        }
        .padding(16)
        .background(Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16))
    }

    private func eligibilityLabel(_ raw: String) -> String {
        switch raw {
        case "confirmed": return "已确认适用"
        case "ineligible": return "不适用"
        default: return "待确认"
        }
    }
}
