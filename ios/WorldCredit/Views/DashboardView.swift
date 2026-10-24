import SwiftUI
import WorldCreditCore

struct DashboardView: View {
    @Environment(AppState.self) private var appState
    @State private var payingItem: BillDisplayItem?
    @State private var holderFilter: String?
    @State private var futureDays = 7
    @State private var debtExpanded = false
    @State private var showPayAllConfirm = false
    @State private var webDestination: DashboardWebDestination?

    private let futureOptions = [7, 14, 30]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    summaryCard
                    overdueBanner
                    holderFilterRow
                    metricsGrid
                    dueTodaySection
                    promoEntry
                    remindersSection
                    accountsSection
                    quickActionsRow
                    overdueDetailSection
                    urgentBillsSection
                }
                .padding()
            }
            .navigationTitle("概览")
            .navigationDestination(for: BillDetailRoute.self) { route in
                BillDetailView(item: route.item)
            }
            .refreshable { await appState.refreshDashboard() }
            .task { await appState.refreshDashboard() }
            .sheet(item: $payingItem) { item in
                PaymentSheetView(item: item) { amount, date, channel, note in
                    try await appState.recordPayment(
                        billId: item.bill.id, amount: amount,
                        paidAt: date, channel: channel, note: note
                    )
                }
            }
            .sheet(item: $webDestination) { destination in
                // 会话 cookie 需要真实 token；未登录时不打开内嵌页面，避免注入空会话。
                if let token = appState.apiClient.token {
                    DashboardWebView(destination: destination, sessionToken: token) {
                        webDestination = nil
                        Task { await appState.refreshDashboard() }
                    }
                }
            }
            .confirmationDialog(
                "一键结清 \(metrics.overdueBills.count) 笔逾期账单？",
                isPresented: $showPayAllConfirm, titleVisibility: .visible
            ) {
                Button("全部结清", role: .destructive) {
                    let ids = metrics.overdueBills.map(\.id)
                    Task {
                        do {
                            _ = try await appState.payDashboardBills(ids)
                        } catch {
                            appState.lastSyncError = error.localizedDescription
                        }
                    }
                }
                Button("取消", role: .cancel) {}
            }
        }
    }

    /// 所有金额、列表与 CTA 同源于这一份过滤快照，避免区块间口径漂移。
    private var metrics: DashboardMetrics {
        DashboardMetrics.compute(
            bills: appState.dashboardBills,
            cards: appState.cards,
            holderId: holderFilter,
            futureDays: futureDays,
            displayCurrency: appState.dashboardCurrency,
            rates: appState.dashboardRates
        )
    }

    private var currency: String { appState.dashboardCurrency }

    // MARK: - 金额

    private func money(_ amount: Double, billCurrency: String? = nil) -> some View {
        Text(DashboardMoney.format(amount, currency: billCurrency ?? currency))
            .privacy(appState.dashboardPrivacy)
    }

    // MARK: - 页头 + 汇总

    private var summaryCard: some View {
        VStack(spacing: 14) {
            HStack(spacing: 12) {
                Text(initial)
                    .font(.subheadline.bold())
                    .foregroundStyle(.white)
                    .frame(width: 40, height: 40)
                    .background(Color.accentColor, in: Circle())
                VStack(alignment: .leading, spacing: 2) {
                    Text("概览")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text(displayName)
                        .font(.headline)
                }
                Spacer()
                Button {
                    Task { await appState.setDashboardPrivacy(!appState.dashboardPrivacy) }
                } label: {
                    Image(systemName: appState.dashboardPrivacy ? "eye.slash" : "eye")
                        .font(.title3)
                        .frame(width: 44, height: 44)
                        .background(Color(uiColor: .secondarySystemGroupedBackground), in: Circle())
                }
                .accessibilityLabel(appState.dashboardPrivacy ? "显示金额" : "隐匿金额")
                .accessibilityIdentifier("dashboard.privacy")
            }

            Text("总待还款")
                .font(.subheadline)
                .foregroundStyle(.secondary)
            money(metrics.totalPending)
                .font(.system(size: 36, weight: .bold, design: .rounded))
                .accessibilityIdentifier("dashboard.totalDebt")

            HStack(spacing: 24) {
                VStack(spacing: 2) {
                    Text("含逾期").font(.caption).foregroundStyle(.secondary)
                    money(metrics.overdueAmount)
                        .font(.subheadline.bold())
                        .foregroundStyle(.red)
                }
                VStack(spacing: 2) {
                    Text("未来 \(futureDays) 天").font(.caption).foregroundStyle(.secondary)
                    money(metrics.futureAmount)
                        .font(.subheadline.bold())
                        .foregroundStyle(.orange)
                }
            }

            if !metrics.unconvertedCurrencies.isEmpty {
                Text("未含汇率：\(metrics.unconvertedCurrencies.joined(separator: "、")) 未计入合计")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("dashboard.unconverted")
            }

            Divider()

            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("总信用额度").font(.caption).foregroundStyle(.secondary)
                    money(metrics.totalCreditLimit).font(.subheadline.bold())
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 4) {
                    Text("额度使用率").font(.caption).foregroundStyle(.secondary)
                    let pct = metrics.totalCreditLimit > 0
                        ? (metrics.totalPending / metrics.totalCreditLimit) * 100 : 0
                    Text(String(format: "%.1f%%", pct))
                        .font(.subheadline.bold())
                        .foregroundStyle(pct > 70 ? .red : (pct > 50 ? .orange : .primary))
                }
            }
        }
        .padding()
        .background(Color(uiColor: .secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }

    private var initial: String {
        let name = appState.currentUser?.name ?? appState.currentUser?.email ?? "我"
        let first = name.trimmingCharacters(in: .whitespaces).prefix(1)
        return first.isEmpty ? "我" : first.uppercased().description
    }

    private var displayName: String {
        if let name = appState.currentUser?.name, !name.isEmpty { return name }
        return appState.currentUser?.email ?? "我"
    }

    // MARK: - 逾期横幅

    private var overdueBanner: some View {
        Group {
            if !metrics.overdueBills.isEmpty {
                HStack(spacing: 12) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundStyle(.red).font(.title3)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("\(metrics.overdueBills.count) 笔账单已逾期")
                            .font(.subheadline.bold()).foregroundStyle(.red)
                        Text("建议今日处理，避免逾期费用")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button("一键全部还款") { showPayAllConfirm = true }
                        .font(.caption.bold())
                        .buttonStyle(.borderedProminent)
                        .tint(.red)
                        .accessibilityIdentifier("dashboard.payAllOverdue")
                }
                .padding()
                .background(Color.red.opacity(0.1))
                .clipShape(RoundedRectangle(cornerRadius: 12))
            }
        }
    }

    // MARK: - 持卡人筛选

    private var holderFilterRow: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                filterPill("全部", selected: holderFilter == nil) { holderFilter = nil }
                ForEach(appState.dashboardHolders) { holder in
                    filterPill(holderInitial(holder.name), selected: holderFilter == holder.id) {
                        holderFilter = holder.id
                    }
                }
            }
        }
    }

    private func filterPill(_ title: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.caption.bold())
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background(selected ? Color.accentColor : Color(uiColor: .secondarySystemGroupedBackground))
                .foregroundStyle(selected ? .white : .primary)
                .clipShape(Capsule())
        }
        .accessibilityIdentifier("dashboard.holder.\(title)")
    }

    private func holderInitial(_ name: String) -> String {
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        return trimmed.isEmpty ? "?" : trimmed.prefix(1).uppercased().description
    }

    // MARK: - 指标 2x2

    private var metricsGrid: some View {
        LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)], spacing: 12) {
            metricCard("已逾期", value: metrics.overdueAmount,
                       caption: metrics.overdueAmount > 0
                           ? "\(metrics.overdueBills.count) 笔待处理" : "暂无逾期",
                       accent: metrics.overdueAmount > 0 ? .red : .green) {
                appState.selectedTab = 1
            }
            futureCard
            debtCard
            metricCard("未出账单", value: nil, placeholder: "暂无数据",
                       caption: "邮件解析待接入", accent: .secondary, action: nil)
        }
    }

    private func metricCard(_ title: String, value: Double?, placeholder: String? = nil,
                            caption: String, accent: Color, action: (() -> Void)?) -> some View {
        Button {
            action?()
        } label: {
            VStack(alignment: .leading, spacing: 6) {
                Text(title).font(.caption).foregroundStyle(.secondary)
                if let placeholder {
                    Text(placeholder).font(.title3.bold()).foregroundStyle(accent)
                } else {
                    money(value ?? 0).font(.title3.bold()).foregroundStyle(accent)
                }
                Text(caption).font(.caption2).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding()
            .background(Color(uiColor: .secondarySystemGroupedBackground))
            .clipShape(RoundedRectangle(cornerRadius: 16))
        }
        .disabled(action == nil)
        .buttonStyle(.plain)
    }

    private var futureCard: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("未来待还").font(.caption).foregroundStyle(.secondary)
                Spacer()
                HStack(spacing: 4) {
                    ForEach(futureOptions, id: \.self) { option in
                        Button("\(option)天") { futureDays = option }
                            .font(.caption2.bold())
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background(futureDays == option ? Color.orange.opacity(0.2) : .clear)
                            .foregroundStyle(futureDays == option ? .orange : .secondary)
                            .clipShape(Capsule())
                            .accessibilityIdentifier("dashboard.future.\(option)")
                    }
                }
            }
            money(metrics.futureAmount).font(.title3.bold())
            Text("\(futureDays) 天内到期合计").font(.caption2).foregroundStyle(.secondary)
        }
        .padding()
        .background(Color(uiColor: .secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }

    private var debtCard: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("总欠款").font(.caption).foregroundStyle(.secondary)
                Spacer()
                Button(debtExpanded ? "收起" : "展开") { debtExpanded.toggle() }
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("dashboard.debt.expand")
            }
            money(metrics.plainOwed).font(.title3.bold())
            if debtExpanded {
                VStack(spacing: 3) {
                    debtRow("分期剩余本金", "暂未接入")
                    debtRow("贷款剩余本息", "暂未接入")
                    HStack {
                        Text("普通未还").font(.caption2).foregroundStyle(.secondary)
                        Spacer()
                        money(metrics.plainOwed).font(.caption2.bold())
                    }
                }
                .padding(.top, 4)
            }
        }
        .padding()
        .background(Color(uiColor: .secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }

    private func debtRow(_ title: String, _ value: String) -> some View {
        HStack {
            Text(title).font(.caption2).foregroundStyle(.secondary)
            Spacer()
            Text(value).font(.caption2).foregroundStyle(.secondary)
        }
    }

    // MARK: - 今天需还款

    private var dueTodaySection: some View {
        Group {
            if !metrics.dueTodayBills.isEmpty {
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Text("今天需还款").font(.headline)
                        Spacer()
                        Text("\(metrics.dueTodayBills.count) 笔")
                            .font(.caption.bold()).foregroundStyle(.orange)
                    }
                    ForEach(metrics.dueTodayBills) { item in
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("\(item.bankName) · 尾号 \(item.last4)")
                                    .font(.subheadline.bold())
                                HStack(spacing: 4) {
                                    Text("今日到期 ·")
                                        .font(.caption).foregroundStyle(.orange)
                                    money(item.remainingAmount, billCurrency: item.currency)
                                        .font(.caption.bold()).foregroundStyle(.orange)
                                }
                            }
                            Spacer()
                            Button("立即还款") { payingItem = item }
                                .font(.caption.bold())
                                .buttonStyle(.borderedProminent)
                                .tint(.orange)
                                .accessibilityIdentifier("dashboard.dueToday.pay.\(item.id)")
                        }
                        .padding()
                        .background(Color(uiColor: .secondarySystemGroupedBackground))
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                    }
                }
            }
        }
    }

    // MARK: - 优惠 / 权益

    private var promoEntry: some View {
        Button {
            webDestination = .promos
        } label: {
            HStack(spacing: 12) {
                Image(systemName: "percent")
                    .font(.title3).foregroundStyle(.orange)
                    .frame(width: 40, height: 40)
                    .background(Color.orange.opacity(0.12), in: RoundedRectangle(cornerRadius: 10))
                VStack(alignment: .leading, spacing: 2) {
                    Text("优惠活动").font(.subheadline.bold())
                    Text(appState.dashboardAvailableCount.map { "今天可用 \($0) 项" }
                         ?? "查看可用机会（暂无法获取数量）")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Image(systemName: "chevron.right").font(.caption).foregroundStyle(.secondary)
            }
            .padding()
            .background(Color(uiColor: .secondarySystemGroupedBackground))
            .clipShape(RoundedRectangle(cornerRadius: 16))
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("dashboard.promos")
    }

    private var remindersSection: some View {
        Group {
            if !appState.dashboardReminders.isEmpty {
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Text("权益待办").font(.headline)
                        Spacer()
                        Button("全部 ›") { webDestination = .benefitCalendar }
                            .font(.caption.bold())
                    }
                    ForEach(appState.dashboardReminders) { reminder in
                        Button { webDestination = .benefitCalendar } label: {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(reminder.title).font(.subheadline.bold())
                                    .lineLimit(1)
                                Text("\(reminder.localDateOn) · \(reminder.actionHint)")
                                    .font(.caption).foregroundStyle(.secondary)
                                    .lineLimit(1)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding()
                            .background(Color(uiColor: .secondarySystemGroupedBackground))
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    // MARK: - 账户

    private var accountsSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("账户").font(.headline)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    accountChip("全部 \(appState.cards.count) 张", selected: holderFilter == nil) {
                        holderFilter = nil
                    }
                    ForEach(appState.dashboardHolders) { holder in
                        let count = appState.cards.filter { $0.holder?.id == holder.id }.count
                        accountChip("\(holder.name) \(count) 张", selected: holderFilter == holder.id) {
                            holderFilter = holder.id
                        }
                    }
                }
            }
        }
    }

    private func accountChip(_ title: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.caption.bold())
                .padding(.horizontal, 12)
                .padding(.vertical, 7)
                .background(selected ? Color.accentColor : Color(uiColor: .secondarySystemGroupedBackground))
                .foregroundStyle(selected ? .white : .primary)
                .clipShape(Capsule())
        }
        .accessibilityIdentifier("dashboard.account.\(title)")
    }

    // MARK: - 金刚区

    private var quickActionsRow: some View {
        HStack(spacing: 10) {
            quickAction("记一笔", systemImage: "square.and.pencil") { webDestination = .createBill }
            quickAction("优惠", systemImage: "percent") { webDestination = .promos }
            quickAction("权益", systemImage: "gift") { webDestination = .benefits }
            quickAction("邮箱账单", systemImage: "envelope") { webDestination = .gmailLedger }
        }
    }

    private func quickAction(_ title: String, systemImage: String,
                             action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 6) {
                Image(systemName: systemImage).font(.title3)
                Text(title).font(.caption.bold())
            }
            .frame(maxWidth: .infinity, minHeight: 76)
            .background(Color(uiColor: .secondarySystemGroupedBackground))
            .clipShape(RoundedRectangle(cornerRadius: 16))
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("dashboard.quick.\(title)")
    }

    // MARK: - 逾期明细

    private var overdueDetailSection: some View {
        Group {
            if !metrics.overdueBills.isEmpty {
                VStack(alignment: .leading, spacing: 10) {
                    Text("逾期明细").font(.headline)
                    ForEach(metrics.overdueBills) { item in
                        VStack(alignment: .leading, spacing: 8) {
                            HStack {
                                Text(item.bankName).font(.subheadline.bold())
                                Spacer()
                                Text("逾期")
                                    .font(.caption2.bold()).foregroundStyle(.red)
                                    .padding(.horizontal, 6).padding(.vertical, 2)
                                    .background(Color.red.opacity(0.12), in: RoundedRectangle(cornerRadius: 6))
                            }
                            Text("\(item.cardTitle) · 尾号 \(item.last4)")
                                .font(.caption).foregroundStyle(.secondary)
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("待还金额").font(.caption2).foregroundStyle(.secondary)
                                    money(item.remainingAmount, billCurrency: item.currency)
                                        .font(.headline).foregroundStyle(.red)
                                }
                                Spacer()
                                Button("全额结清") { payingItem = item }
                                    .font(.caption.bold())
                                    .buttonStyle(.borderedProminent)
                                    .accessibilityIdentifier("dashboard.overdue.pay.\(item.id)")
                            }
                        }
                        .padding()
                        .background(Color(uiColor: .secondarySystemGroupedBackground))
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                    }
                }
            }
        }
    }

    // MARK: - 近期还款

    private var urgentBillsSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("近期还款").font(.headline)
                Spacer()
                Button("查看账单") { appState.selectedTab = 1 }
                    .font(.caption.bold())
                    .accessibilityIdentifier("dashboard.gotoBills")
            }
            if metrics.visibleBills.isEmpty {
                HStack {
                    Spacer()
                    Text("暂无待还账单")
                        .font(.subheadline).foregroundStyle(.secondary)
                        .padding(.vertical, 24)
                    Spacer()
                }
                .background(Color(uiColor: .secondarySystemGroupedBackground))
                .clipShape(RoundedRectangle(cornerRadius: 12))
            } else {
                ForEach(metrics.visibleBills.prefix(6)) { item in
                    NavigationLink(value: BillDetailRoute(item: item)) {
                        VStack(spacing: 8) {
                            HStack {
                                Text("\(item.bankName) · \(item.cardTitle)")
                                    .font(.headline)
                                Spacer()
                                money(item.remainingAmount, billCurrency: item.currency)
                                    .font(.headline)
                                    .foregroundStyle(item.isOverdue ? .red : .primary)
                            }
                            HStack {
                                Text("\(item.holderName) · 尾号 \(item.last4)")
                                    .font(.caption).foregroundStyle(.secondary)
                                Spacer()
                                Text(item.distanceLabel)
                                    .font(.caption.bold())
                                    .foregroundStyle(item.isOverdue ? .red : .orange)
                            }
                        }
                        .padding()
                        .background(Color(uiColor: .secondarySystemGroupedBackground))
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("dashboard.bill.\(item.id)")
                }
            }
        }
    }
}

private extension View {
    func privacy(_ hidden: Bool) -> some View {
        blur(radius: hidden ? 5 : 0)
    }
}
