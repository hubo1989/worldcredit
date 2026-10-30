import SwiftUI
import WorldCreditCore

/// 渲染路径共享的 DateFormatter（DateFormatter 创建成本高，body 内不新建；
/// 统一 Asia/Shanghai 业务时区，日期口径与 diffInCalendarDays 一致）
enum BillsFormatters {
    static let mmdd: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "MM/dd"
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "Asia/Shanghai") ?? .current
        return f
    }()

    static let yyyymmdd: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "Asia/Shanghai") ?? .current
        return f
    }()

    static let mmddCn: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "MM月dd日"
        f.locale = Locale(identifier: "zh_CN")
        f.timeZone = TimeZone(identifier: "Asia/Shanghai") ?? .current
        return f
    }()
}

struct BillsView: View {
    @Environment(AppState.self) private var appState

    @State private var payingItem: BillDisplayItem?
    @State private var viewingHistoryItem: BillDisplayItem?
    @State private var adjustingItem: BillDisplayItem?
    @State private var editingPayable: PayableItem?
    @State private var creatingPayable = false
    @State private var payingPayable: PayableItem?
    @State private var payablePayAmount = ""
    @State private var showPayAllConfirm = false
    @State private var isPayingAll = false
    @State private var payAllError: String?
    @State private var selectedCardForEdit: CardDisplayItem?

    // 筛选光环凝聚与拽出面板动画
    @State private var isFilterAuraCondensing: Bool = false
    @State private var filterHaloScale: CGFloat = 1.0
    @State private var filterHaloOpacity: Double = 0.0

    // 单维度筛选（持卡人与银行互斥）
    @State private var holderFilterId: String?
    @State private var bankFilterName: String?
    @State private var isFilterDrawerPresented: Bool = false

    private var presentation: BillsPresentation {
        appState.billsPresentation(holderId: holderFilterId, bankName: bankFilterName)
    }

    private var overdueItems: [BillDisplayItem] { presentation.overdueBills }
    private var convertedSummary: BillsAmountSummary { presentation.convertedSummary }
    private var convertedTotalAmount: Double { convertedSummary.totalAmount }
    private var overdueConvertedSummary: BillsAmountSummary { presentation.overdueSummary }
    private var overdueTotalAmount: Double { overdueConvertedSummary.totalAmount }
    private var dueSoonConvertedSummary: BillsAmountSummary { presentation.dueSoonSummary }
    private var dueSoonTotalAmount: Double { dueSoonConvertedSummary.totalAmount }
    private var cnyUnpaidTotal: Double { presentation.currencyTotals["CNY", default: 0] }
    private var hkdUnpaidTotal: Double { presentation.currencyTotals["HKD", default: 0] }
    private var usdUnpaidTotal: Double { presentation.currencyTotals["USD", default: 0] }

    private var overdueTotalLabel: String {
        let total = BillsGrouping.total(
            of: BillsGrouping.groups(from: overdueItems),
            rates: appState.dashboardRates,
            displayCurrency: appState.dashboardCurrency
        )
        var label = DashboardMoney.format(total.amount, currency: appState.dashboardCurrency)
        if !total.unconvertedCurrencies.isEmpty {
            label += "（\(total.unconvertedCurrencies.joined(separator: "、")) 未折算）"
        }
        return label
    }

    private var holderOptions: [(id: String, name: String)] {
        var seen = Set<String>()
        return appState.cards.compactMap { card in
            let holderId = card.card.holderId
            guard !holderId.isEmpty, seen.insert(holderId).inserted else { return nil }
            return (holderId, card.holderName)
        }
    }

    private var bankOptions: [String] {
        var seen = Set<String>()
        return appState.cards.compactMap { card in
            guard !card.bankName.isEmpty, seen.insert(card.bankName).inserted else { return nil }
            return card.bankName
        }
    }

    private var filterSummary: String {
        if let holderFilterId {
            return holderOptions.first(where: { $0.id == holderFilterId })?.name ?? "持卡人"
        }
        if let bankFilterName {
            return bankFilterName
        }
        if appState.selectedBillFilter != .unpaid {
            return appState.selectedBillFilter.rawValue
        }
        return "筛选"
    }

    var body: some View {
        NavigationStack {
            ZStack {
                WCColors.canvas
                    .ignoresSafeArea()

                VStack(spacing: 0) {
                    pageHeader
                        .padding(.horizontal, 16)
                        .padding(.top, 8)
                        .padding(.bottom, 6)

                    if appState.billsSortMode == .nearestDue {
                        heroSummary
                            .padding(.horizontal, 16)
                            .padding(.bottom, 10)
                    }

                    sortTabs
                        .padding(.horizontal, 16)
                        .padding(.bottom, 10)

                    overdueBanner

                    ScrollView {
                        LazyVStack(spacing: 14) {
                            if let error = appState.payablesError {
                                HStack(spacing: 8) {
                                    Image(systemName: "wifi.exclamationmark")
                                        .foregroundStyle(WCColors.warningInk)
                                    Text("固定支出同步异常：\(error)")
                                        .font(.caption)
                                        .foregroundStyle(WCColors.textSecondary)
                                    Spacer()
                                    Button("重试") {
                                        Task { await appState.refreshPayables() }
                                    }
                                    .font(.caption.bold())
                                    .foregroundStyle(WCColors.primaryAccent)
                                }
                                .padding(10)
                                .background(WCColors.warningSoft, in: RoundedRectangle(cornerRadius: 8))
                                .padding(.horizontal, 16)
                            }

                            if appState.billsSortMode == .nearestDue {
                                listHeading
                                    .padding(.horizontal, 16)

                                cardsListView
                                    .padding(.horizontal, 16)
                            } else {
                                interestExplanationHeader
                                    .padding(.horizontal, 16)

                                interestCardsList
                                    .padding(.horizontal, 16)

                                interestDisclaimer
                                    .padding(.horizontal, 16)
                                    .padding(.top, 4)
                            }
                        }
                        .padding(.bottom, 32)
                    }
                    .refreshable {
                        await appState.sync()
                        await appState.refreshPayables()
                        await appState.refreshDashboardRemote()
                    }
                }

                // 右侧筛选抽屉
                if isFilterDrawerPresented {
                    BillsFilterDrawerView(
                        isPresented: $isFilterDrawerPresented,
                        currentFilter: appState.selectedBillFilter,
                        currentHolderId: holderFilterId,
                        currentBankName: bankFilterName,
                        holderOptions: holderOptions,
                        bankOptions: bankOptions
                    ) { newFilter, newHolderId, newBankName in
                        appState.selectedBillFilter = newFilter
                        holderFilterId = newHolderId
                        bankFilterName = newBankName
                    }
                    .transition(.asymmetric(
                        insertion: .move(edge: .trailing).combined(with: .opacity),
                        removal: .move(edge: .trailing)
                    ))
                    .zIndex(100)
                }
            }
            .animation(.spring(response: 0.35, dampingFraction: 0.78), value: isFilterDrawerPresented)
            .navigationDestination(for: BillDetailRoute.self) { route in
                BillDetailView(item: route.item)
            }
            .sheet(item: $selectedCardForEdit) { card in
                CardEditSheetView(card: card) { input in
                    try await appState.updateCard(cardId: card.id, input: input)
                    await appState.reloadData()
                }
            }
            .sheet(item: $payingItem) { item in
                RecordPaymentView(item: item) { amount, date, channel, note in
                    try await appState.recordPayment(
                        billId: item.bill.id,
                        amount: amount,
                        paidAt: date,
                        channel: channel,
                        note: note
                    )
                    await appState.reloadData()
                }
            }
            .sheet(item: $viewingHistoryItem) { item in
                PaymentHistoryView(item: item) {
                    payingItem = item
                }
            }
            .sheet(isPresented: $creatingPayable) {
                PayableFormView(existing: nil)
            }
            .sheet(item: $editingPayable) { payable in
                PayableFormView(existing: payable)
            }
            .sheet(item: $adjustingItem) { item in
                BillAmountOverrideSheetView(item: item) { newAmount in
                    try await appState.setBillAmountOverride(billId: item.bill.id, amount: newAmount)
                }
            }
            .confirmationDialog(
                "一键结清 \(overdueItems.count) 笔逾期信用卡账单？",
                isPresented: $showPayAllConfirm,
                titleVisibility: .visible
            ) {
                Button("一键结清", role: .destructive) {
                    Task { await payAllOverdue() }
                }
                Button("取消", role: .cancel) {}
            } message: {
                // 口径说明：hero 区逾期标签含固定支出，此处一键结清仅覆盖信用卡账单；
                // 固定支出请在固定支出条目上单独登记还款。
                Text("按原币种全额结清信用卡逾期账单，待还合计 \(overdueTotalLabel)。固定支出请单独登记。")
            }
            .alert("登记固定支出还款", isPresented: Binding(
                get: { payingPayable != nil },
                set: { if !$0 { payingPayable = nil } }
            )) {
                TextField("金额", text: $payablePayAmount)
                    .keyboardType(.decimalPad)
                Button("登记") {
                    if let payable = payingPayable,
                       let amount = Double(payablePayAmount), amount > 0 {
                        Task {
                            try? await appState.payPayable(payable, amount: amount)
                        }
                    }
                    payingPayable = nil
                }
                Button("取消", role: .cancel) { payingPayable = nil }
            } message: {
                if let payable = payingPayable {
                    Text("\(payable.name) · 本期应付 \(payable.currency) \(payable.amount, format: .number.precision(.fractionLength(2)))")
                }
            }
        }
    }

    // MARK: - Page Header
    private var pageHeader: some View {
        HStack(alignment: .center, spacing: 8) {
            Text("账单")
                .font(.system(size: 28, weight: .bold))
                .foregroundStyle(WCColors.textPrimary)

            Spacer()

            if appState.billsSortMode == .nearestDue {
                Button(action: {
                    creatingPayable = true
                }) {
                    HStack(spacing: 4) {
                        Image(systemName: "plus.circle")
                            .font(.footnote.weight(.semibold))
                        Text("固定支出")
                            .font(.footnote.weight(.medium))
                    }
                    .foregroundStyle(WCColors.primaryAccent)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(WCColors.surface, in: Capsule())
                    .overlay(
                        Capsule()
                            .stroke(WCColors.border, lineWidth: 1)
                    )
                }
                .accessibilityIdentifier("bills.addPayable")
            }

            Button(action: {
                openFilterDrawerWithAnimation()
            }) {
                HStack(spacing: 6) {
                    Image(systemName: "line.3.horizontal.decrease.circle")
                        .font(.subheadline)
                    Text(filterSummary)
                        .font(.footnote.weight(.medium))
                }
                .foregroundStyle(
                    holderFilterId == nil && bankFilterName == nil && appState.selectedBillFilter == .unpaid
                        ? WCColors.textSecondary : WCColors.primaryAccent
                )
                .padding(.horizontal, 10)
                .padding(.vertical, 7)
                .background(WCColors.surface, in: Capsule())
                .overlay(
                    Capsule()
                        .stroke(WCColors.border, lineWidth: 1)
                )
                .overlay(
                    // 按钮本身光环凝聚动效：凝聚聚敛至按钮中心，随后拖拽面板滑出
                    Capsule()
                        .stroke(WCColors.primaryAccent, lineWidth: 2)
                        .scaleEffect(filterHaloScale)
                        .opacity(filterHaloOpacity)
                )
            }
            .accessibilityIdentifier("bills.holderBankFilter")
        }
    }

    // MARK: - Hero Summary
    private var heroSummary: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("待还汇总")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(WCColors.textSecondary)
                Spacer()
                Text("折算基准 · 人民币 (CNY)")
                    .font(.caption2)
                    .foregroundStyle(WCColors.textSecondary)
            }

            VStack(alignment: .leading, spacing: 2) {
                Text("折算人民币总额")
                    .font(.caption2)
                    .foregroundStyle(WCColors.textSecondary)
                Text(DashboardMoney.format(convertedTotalAmount, currency: "CNY"))
                    .font(.system(size: 32, weight: .bold, design: .rounded))
                    .foregroundStyle(WCColors.textPrimary)
                    .accessibilityIdentifier("bills.total")
                if convertedSummary.hasUnconverted {
                    Text("（另有 \(convertedSummary.unconvertedCurrencies.joined(separator: "、")) 币种暂无汇率未折算）")
                        .font(.caption2)
                        .foregroundStyle(WCColors.textSecondary)
                }
            }

            Divider()
                .background(WCColors.border)

            // 三大币种待还：人民币、港币、美元
            HStack(alignment: .top, spacing: 8) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("人民币 (CNY)")
                        .font(.caption2)
                        .foregroundStyle(WCColors.textSecondary)
                    Text(DashboardMoney.format(cnyUnpaidTotal, currency: "CNY"))
                        .font(.system(size: 15, weight: .bold, design: .rounded))
                        .foregroundStyle(WCColors.textPrimary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.75)
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                VStack(alignment: .leading, spacing: 3) {
                    Text("港币 (HKD)")
                        .font(.caption2)
                        .foregroundStyle(WCColors.textSecondary)
                    Text(DashboardMoney.format(hkdUnpaidTotal, currency: "HKD"))
                        .font(.system(size: 15, weight: .bold, design: .rounded))
                        .foregroundStyle(WCColors.textPrimary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.75)
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                VStack(alignment: .leading, spacing: 3) {
                    Text("美元 (USD)")
                        .font(.caption2)
                        .foregroundStyle(WCColors.textSecondary)
                    Text(DashboardMoney.format(usdUnpaidTotal, currency: "USD"))
                        .font(.system(size: 15, weight: .bold, design: .rounded))
                        .foregroundStyle(WCColors.textPrimary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.75)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            if overdueTotalAmount > 0.01 || dueSoonTotalAmount > 0.01 || overdueConvertedSummary.hasUnconverted {
                HStack(spacing: 8) {
                    if overdueTotalAmount > 0.01 || overdueConvertedSummary.hasUnconverted {
                        HStack(spacing: 4) {
                            Image(systemName: "exclamationmark.circle.fill")
                                .font(.caption2)
                            Text("逾期折算 \(DashboardMoney.format(overdueTotalAmount, currency: "CNY"))\(overdueConvertedSummary.hasUnconverted ? " *" : "")")
                                .font(.caption.bold())
                        }
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(WCColors.dangerSoft, in: Capsule())
                        .foregroundStyle(WCColors.dangerInk)
                    }

                    if dueSoonTotalAmount > 0.01 || dueSoonConvertedSummary.hasUnconverted {
                        HStack(spacing: 4) {
                            Image(systemName: "clock.fill")
                                .font(.caption2)
                            Text("3天内折算 \(DashboardMoney.format(dueSoonTotalAmount, currency: "CNY"))\(dueSoonConvertedSummary.hasUnconverted ? " *" : "")")
                                .font(.caption.bold())
                        }
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(WCColors.warningSoft, in: Capsule())
                        .foregroundStyle(WCColors.warningInk)
                    }

                    Spacer()
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

    // MARK: - Sort Tabs
    private var sortTabs: some View {
        BillsSortTabs(selection: Binding(
            get: { appState.billsSortMode },
            set: { appState.billsSortMode = $0 }
        ))
    }

    // MARK: - Overdue Banner
    @ViewBuilder
    private var overdueBanner: some View {
        if !overdueItems.isEmpty && appState.billsSortMode == .nearestDue {
            VStack(spacing: 4) {
                HStack(spacing: 10) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundStyle(WCColors.dangerInk)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("存在 \(overdueItems.count) 笔逾期账单未结清")
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(WCColors.textPrimary)
                        Text("待还合计 \(overdueTotalLabel)")
                            .font(.caption2)
                            .foregroundStyle(WCColors.textSecondary)
                    }
                    Spacer(minLength: 8)
                    Button("一键还清") {
                        showPayAllConfirm = true
                    }
                    .font(.caption.bold())
                    .foregroundStyle(Color.white)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(WCColors.dangerInk, in: RoundedRectangle(cornerRadius: 6))
                    .disabled(isPayingAll)
                    .accessibilityIdentifier("bills.payAllOverdue")
                }
                if let payAllError {
                    Text(payAllError)
                        .font(.caption2)
                        .foregroundStyle(WCColors.dangerInk)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .padding(12)
            .background(WCColors.dangerSoft, in: RoundedRectangle(cornerRadius: 12))
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(WCColors.dangerInk.opacity(0.3), lineWidth: 1)
            )
            .padding(.horizontal, 16)
            .padding(.bottom, 6)
        }
    }

    private func payAllOverdue() async {
        guard !overdueItems.isEmpty else { return }
        isPayingAll = true
        payAllError = nil
        do {
            _ = try await appState.payDashboardBills(overdueItems.map { $0.bill.id })
        } catch {
            payAllError = "一键结清失败：\(error.localizedDescription)"
        }
        isPayingAll = false
    }

    // MARK: - List Heading
    private var listHeading: some View {
        HStack {
            Text("信用卡账单")
                .font(.subheadline.bold())
                .foregroundStyle(WCColors.textPrimary)
            Spacer()
            Text(appState.selectedBillFilter == .unpaid ? "待还状态 · 按到期日" : "\(appState.selectedBillFilter.rawValue) · 按到期日")
                .font(.caption)
                .foregroundStyle(WCColors.textSecondary)
        }
    }

    // MARK: - Cards List View
    @ViewBuilder
    private var cardsListView: some View {
        if presentation.entries.isEmpty {
            VStack(spacing: 12) {
                // 固定支出是在线数据：刷新失败且无缓存时明确降级提示，避免固定支出凭空消失无解释
                if let payablesError = appState.payablesError {
                    Label(payablesError, systemImage: "wifi.exclamationmark")
                        .font(.footnote)
                        .foregroundStyle(WCColors.warningInk)
                        .padding(.horizontal, 12)
                }
                Image(systemName: "line.3.horizontal.decrease.circle")
                    .font(.largeTitle)
                    .foregroundStyle(WCColors.textSecondary)
                Text("没有\(appState.selectedBillFilter.rawValue)账单或应付")
                    .font(.subheadline)
                    .foregroundStyle(WCColors.textSecondary)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 36)
            .background(WCColors.surface, in: RoundedRectangle(cornerRadius: 16))
        } else {
            LazyVStack(spacing: 12) {
                ForEach(presentation.missingStatements) { missing in
                    missingStatementCard(group: missing.group, missingDays: missing.days)
                }

                // 账单与固定支出统一混合展示（按还款日排序）
                ForEach(presentation.entries) { entry in
                    switch entry {
                    case .cardBill(let item, let group):
                        billCard(item: item, group: group)
                    case .payable(let payable):
                        payableCard(payable)
                    case .unbilledCard(let card):
                        unbilledCardView(card)
                    }
                }
            }
        }
    }

    // MARK: - Bill Card
    private func billCard(item: BillDisplayItem, group: CardBillsGroup) -> some View {
        NavigationLink(value: BillDetailRoute(item: item)) {
            VStack(alignment: .leading, spacing: 10) {
                // Card Identity Row
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 6) {
                            Text(group.bankName)
                                .font(.headline.bold())
                                .foregroundStyle(WCColors.textPrimary)
                            Text(group.holderName)
                                .font(.subheadline)
                                .foregroundStyle(WCColors.textSecondary)
                        }

                        HStack(spacing: 6) {
                            Text(group.cardTitle)
                                .font(.subheadline.weight(.medium))
                                .foregroundStyle(WCColors.textSecondary)
                            Image(systemName: "chevron.right")
                                .font(.caption2.bold())
                                .foregroundStyle(WCColors.textSecondary)
                            Text("· \(item.bill.billMonth)期账单")
                                .font(.caption)
                                .foregroundStyle(WCColors.textSecondary)
                        }
                    }

                    Spacer()

                    billStatusBadge(item: item)
                }

                // Payment Row
                HStack(alignment: .center) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("剩余应还")
                            .font(.caption2)
                            .foregroundStyle(WCColors.textSecondary)
                        Text(DashboardMoney.format(item.remainingAmount, currency: item.currency))
                            .font(.system(size: 24, weight: .bold, design: .rounded))
                            .foregroundStyle(
                                item.remainingAmount <= 0.01 ? WCColors.successInk :
                                    (item.isOverdue ? WCColors.dangerInk : (item.daysUntilDue <= 3 ? WCColors.warningInk : WCColors.textPrimary))
                            )
                    }

                    Spacer()

                    if item.remainingAmount > 0.01 {
                        Button(action: {
                            payingItem = item
                        }) {
                            HStack(spacing: 4) {
                                Image(systemName: "pencil.line")
                                    .font(.caption.bold())
                                Text("登记还款")
                                    .font(.caption.bold())
                            }
                            .foregroundStyle(item.isOverdue ? Color.white : WCColors.primaryAccent)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 8)
                            .background(
                                item.isOverdue ? WCColors.primaryAccent : WCColors.subtle,
                                in: RoundedRectangle(cornerRadius: 8)
                            )
                        }
                        .buttonStyle(.borderless)
                        .accessibilityIdentifier("bill.row.pay.\(item.bill.id)")
                    } else {
                        Button(action: {
                            viewingHistoryItem = item
                        }) {
                            HStack(spacing: 4) {
                                Image(systemName: "doc.text")
                                    .font(.caption)
                                Text("查看记录")
                                    .font(.caption.bold())
                            }
                            .foregroundStyle(WCColors.primaryAccent)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 8)
                            .background(WCColors.subtle, in: RoundedRectangle(cornerRadius: 8))
                        }
                        .buttonStyle(.borderless)
                        .accessibilityIdentifier("bill.row.pay.\(item.bill.id)")
                    }
                }

                // Payment Amounts Row
                HStack(spacing: 16) {
                    Text("应还 \(DashboardMoney.format(item.bill.effectiveAmount, currency: item.currency))")
                        .font(.caption)
                        .foregroundStyle(WCColors.textSecondary)

                    if item.totalPaid > 0 {
                        Text("已还 \(DashboardMoney.format(item.totalPaid, currency: item.currency))")
                            .font(.caption.bold())
                            .foregroundStyle(WCColors.successInk)
                    }
                    Spacer()
                }

                Divider()
                    .background(WCColors.border)

                // Cycle Footer Row
                HStack {
                    Text("\(item.bill.dueDate)到期 · \(item.distanceLabel)")
                        .font(.caption2.weight(.medium))
                        .foregroundStyle(rowCaptionColor(item))

                    Spacer()

                    if let nextBilling = group.nextBillingDate(today: Date()),
                       let nextDue = group.nextDueDate(today: Date()) {
                        let f = BillsFormatters.mmdd
                        Text("下期账单 \(f.string(from: nextBilling)) · 还款 \(f.string(from: nextDue))")
                            .font(.caption2)
                            .foregroundStyle(WCColors.textSecondary)
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
        .buttonStyle(.plain)
        .accessibilityIdentifier("bill.row.\(item.id)")
    }

    private func billStatusBadge(item: BillDisplayItem) -> some View {
        HStack(spacing: 4) {
            if item.remainingAmount <= 0.01 {
                Image(systemName: "checkmark.circle.fill")
                    .font(.caption2)
                Text("已结清")
                    .font(.caption.bold())
            } else if item.isOverdue {
                Image(systemName: "exclamationmark.circle.fill")
                    .font(.caption2)
                Text(item.daysUntilDue < 0 ? "逾期 \(-item.daysUntilDue) 天" : "逾期")
                    .font(.caption.bold())
            } else if item.daysUntilDue <= 3 {
                Image(systemName: "clock.fill")
                    .font(.caption2)
                Text(item.daysUntilDue == 0 ? "今天到期" : "\(item.daysUntilDue)天后到期")
                    .font(.caption.bold())
            } else {
                Image(systemName: "clock.fill")
                    .font(.caption2)
                Text("\(item.daysUntilDue)天后到期")
                    .font(.caption.weight(.medium))
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(
            item.remainingAmount <= 0.01 ? WCColors.successSoft :
                (item.isOverdue ? WCColors.dangerSoft : (item.daysUntilDue <= 3 ? WCColors.warningSoft : WCColors.subtle)),
            in: Capsule()
        )
        .foregroundStyle(
            item.remainingAmount <= 0.01 ? WCColors.successInk :
                (item.isOverdue ? WCColors.dangerInk : (item.daysUntilDue <= 3 ? WCColors.warningInk : WCColors.textSecondary))
        )
    }

    private func rowCaptionColor(_ item: BillDisplayItem) -> Color {
        if item.remainingAmount <= 0.01 { return WCColors.successInk }
        return item.isOverdue ? WCColors.dangerInk : (item.daysUntilDue <= 3 ? WCColors.warningInk : WCColors.textSecondary)
    }

    // MARK: - Missing Statement Card
    private func missingStatementCard(group: CardBillsGroup, missingDays: Int) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 6) {
                        Text(group.bankName)
                            .font(.headline.bold())
                            .foregroundStyle(WCColors.textPrimary)
                        Text(group.holderName)
                            .font(.subheadline)
                            .foregroundStyle(WCColors.textSecondary)
                    }
                    Text("\(group.cardTitle) · 信用卡")
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(WCColors.textSecondary)
                }
                Spacer()
                HStack(spacing: 4) {
                    Image(systemName: "exclamationmark.circle.fill")
                        .font(.caption2)
                    Text("缺账单")
                        .font(.caption.bold())
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(WCColors.warningSoft, in: Capsule())
                .foregroundStyle(WCColors.warningInk)
            }

            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    Text("账单日已过 \(missingDays) 天，仍未收到新账单")
                        .font(.subheadline.bold())
                        .foregroundStyle(WCColors.warningInk)
                    Text("金额待确认 · 不计入待还合计")
                        .font(.caption2)
                        .foregroundStyle(WCColors.textSecondary)
                }
                Spacer()
                Button(action: {
                    // 缺账单的场景需要真正检查邮箱：走 Gmail 拉取流程（含本地账单刷新），
                    // 而非仅触发原生 SyncEngine 同步。isGmailSyncing 防连点重入。
                    Task { await appState.syncGmailBills() }
                }) {
                    HStack(spacing: 4) {
                        if appState.isGmailSyncing {
                            ProgressView().controlSize(.mini)
                        }
                        Text(appState.isGmailSyncing ? "同步中…" : "查看邮箱")
                        .font(.caption.bold())
                        .foregroundStyle(Color.white)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(WCColors.primaryAccent, in: RoundedRectangle(cornerRadius: 8))
                    }
                }
                .disabled(appState.isGmailSyncing)
                .accessibilityIdentifier("bills.checkMailbox")
            }
        }
        .padding(16)
        .background(WCColors.surface, in: RoundedRectangle(cornerRadius: 16))
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(WCColors.warningInk.opacity(0.4), lineWidth: 1)
        )
    }

    // MARK: - Payable Card (固定支出卡片)
    private func payableCard(_ payable: PayableItem) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            // Identity Row: Name + Category & Status badge
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 6) {
                        Text(payable.name)
                            .font(.headline.bold())
                            .foregroundStyle(WCColors.textPrimary)
                        Text(payable.category.label)
                            .font(.caption2.weight(.medium))
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(WCColors.subtle, in: RoundedRectangle(cornerRadius: 4))
                            .foregroundStyle(WCColors.textSecondary)
                    }

                    HStack(spacing: 6) {
                        if let bankAccount = payable.bankAccount, !bankAccount.isEmpty {
                            Text(bankAccount)
                                .font(.subheadline.weight(.medium))
                                .foregroundStyle(WCColors.textSecondary)
                        } else {
                            Text("固定支出 · 周期应付")
                                .font(.subheadline.weight(.medium))
                                .foregroundStyle(WCColors.textSecondary)
                        }
                        Text("· \(payable.period)期")
                            .font(.caption)
                            .foregroundStyle(WCColors.textSecondary)
                    }
                }

                Spacer()

                payableStatusBadge(payable)
            }

            // Payment Row: Remaining Amount & Action Button
            HStack(alignment: .center) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("剩余应付")
                        .font(.caption2)
                        .foregroundStyle(WCColors.textSecondary)
                    Text(DashboardMoney.format(payable.remainingAmount, currency: payable.currency))
                        .font(.system(size: 24, weight: .bold, design: .rounded))
                        .foregroundStyle(
                            payable.isSettled ? WCColors.successInk :
                                (payable.status == .overdue || (payable.daysUntilDue < 0 && payable.remainingAmount > 0.01) ? WCColors.dangerInk : (payable.daysUntilDue <= 3 ? WCColors.warningInk : WCColors.textPrimary))
                        )
                }

                Spacer()

                if !payable.isSettled && payable.remainingAmount > 0.01 {
                    Button(action: {
                        payingPayable = payable
                        payablePayAmount = String(format: "%.2f", payable.remainingAmount)
                    }) {
                        HStack(spacing: 4) {
                            Image(systemName: "pencil.line")
                                .font(.caption.bold())
                            Text("登记还款")
                                .font(.caption.bold())
                        }
                        .foregroundStyle(payable.status == .overdue ? Color.white : WCColors.primaryAccent)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 8)
                        .background(
                            payable.status == .overdue ? WCColors.primaryAccent : WCColors.subtle,
                            in: RoundedRectangle(cornerRadius: 8)
                        )
                    }
                    .buttonStyle(.borderless)
                    .accessibilityIdentifier("bills.payable.pay.\(payable.id)")
                } else {
                    HStack(spacing: 4) {
                        Image(systemName: "checkmark.circle")
                            .font(.caption)
                        Text("已结清")
                            .font(.caption.bold())
                    }
                    .foregroundStyle(WCColors.successInk)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(WCColors.successSoft, in: RoundedRectangle(cornerRadius: 8))
                }
            }

            // Payment Amounts Row
            HStack(spacing: 16) {
                Text("本期应付 \(DashboardMoney.format(payable.amount, currency: payable.currency))")
                    .font(.caption)
                    .foregroundStyle(WCColors.textSecondary)

                if payable.paidAmount > 0 {
                    Text("已付 \(DashboardMoney.format(payable.paidAmount, currency: payable.currency))")
                        .font(.caption.bold())
                        .foregroundStyle(WCColors.successInk)
                }
                Spacer()
            }

            Divider()
                .background(WCColors.border)

            // Cycle Footer Row
            HStack {
                Text("\(payable.dueDate)到期 · \(payable.distanceLabel)")
                    .font(.caption2.weight(.medium))
                    .foregroundStyle(payableCaptionColor(payable))

                Spacer()

                if let note = payable.note, !note.isEmpty {
                    Text(note)
                        .font(.caption2)
                        .foregroundStyle(WCColors.textSecondary)
                        .lineLimit(1)
                } else {
                    Text("每月\(payable.dueDay)日到期")
                        .font(.caption2)
                        .foregroundStyle(WCColors.textSecondary)
                }
            }
        }
        .padding(16)
        .background(WCColors.surface, in: RoundedRectangle(cornerRadius: 16))
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(WCColors.border, lineWidth: 1)
        )
        // 补回重构丢失的编辑入口：iOS 端唯一的固定支出编辑路径（PayableFormView(existing:)），
        // 与 Web bills 页 onEditPayable 对齐；「编辑」不与登记还款按钮争抢点击区。
        .contextMenu {
            Button {
                editingPayable = payable
            } label: {
                Label("编辑固定支出", systemImage: "pencil")
            }
        }
        .accessibilityIdentifier("bills.payable.row.\(payable.id)")
    }

    private func payableStatusBadge(_ payable: PayableItem) -> some View {
        HStack(spacing: 4) {
            if payable.isSettled || payable.remainingAmount <= 0.01 {
                Image(systemName: "checkmark.circle.fill")
                    .font(.caption2)
                Text("已结清")
                    .font(.caption.bold())
            } else if payable.status == .overdue || (payable.daysUntilDue < 0 && payable.remainingAmount > 0.01) {
                Image(systemName: "exclamationmark.circle.fill")
                    .font(.caption2)
                Text(payable.daysUntilDue < 0 ? "逾期 \(-payable.daysUntilDue) 天" : "逾期")
                    .font(.caption.bold())
            } else if payable.daysUntilDue <= 3 {
                Image(systemName: "clock.fill")
                    .font(.caption2)
                Text(payable.daysUntilDue == 0 ? "今天到期" : "\(payable.daysUntilDue)天后到期")
                    .font(.caption.bold())
            } else {
                Image(systemName: "clock.fill")
                    .font(.caption2)
                Text("\(payable.daysUntilDue)天后到期")
                    .font(.caption.weight(.medium))
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(
            (payable.isSettled || payable.remainingAmount <= 0.01) ? WCColors.successSoft :
                (payable.status == .overdue || (payable.daysUntilDue < 0 && payable.remainingAmount > 0.01) ? WCColors.dangerSoft : (payable.daysUntilDue <= 3 ? WCColors.warningSoft : WCColors.subtle)),
            in: Capsule()
        )
        .foregroundStyle(
            (payable.isSettled || payable.remainingAmount <= 0.01) ? WCColors.successInk :
                (payable.status == .overdue || (payable.daysUntilDue < 0 && payable.remainingAmount > 0.01) ? WCColors.dangerInk : (payable.daysUntilDue <= 3 ? WCColors.warningInk : WCColors.textSecondary))
        )
    }

    private func payableCaptionColor(_ payable: PayableItem) -> Color {
        if payable.isSettled || payable.remainingAmount <= 0.01 { return WCColors.successInk }
        return (payable.status == .overdue || (payable.daysUntilDue < 0 && payable.remainingAmount > 0.01)) ? WCColors.dangerInk : (payable.daysUntilDue <= 3 ? WCColors.warningInk : WCColors.textSecondary)
    }

    // MARK: - Max Interest Free Mode Views
    private var interestExplanationHeader: some View {
        HStack {
            Text("今日消费，多久后还款？")
                .font(.title3.bold())
                .foregroundStyle(WCColors.textPrimary)
            Spacer()
            HStack(spacing: 4) {
                Text("\(BillsFormatters.mmddCn.string(from: Date())) · 估算")
                    .font(.caption.bold())
                    .foregroundStyle(WCColors.primaryAccent)
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(WCColors.subtle, in: Capsule())
        }
    }

    private var interestCardsList: some View {
        LazyVStack(spacing: 12) {
            ForEach(presentation.interestRows) { row in
                interestCard(group: row.group, item: row.item)
            }
        }
    }

    private func interestCard(group: CardBillsGroup, item: BillDisplayItem) -> some View {
        NavigationLink(value: BillDetailRoute(item: item)) {
            VStack(alignment: .leading, spacing: 10) {
                // Identity & duration
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 6) {
                            Text(group.bankName)
                                .font(.headline.bold())
                                .foregroundStyle(WCColors.textPrimary)
                            Text(group.holderName)
                                .font(.subheadline)
                                .foregroundStyle(WCColors.textSecondary)
                        }
                        HStack(spacing: 6) {
                            Text(group.cardTitle)
                                .font(.subheadline.weight(.medium))
                                .foregroundStyle(WCColors.textSecondary)
                            Image(systemName: "chevron.right")
                                .font(.caption2.bold())
                                .foregroundStyle(WCColors.textSecondary)
                        }
                    }
                    Spacer()
                    VStack(alignment: .trailing, spacing: 2) {
                        Text("\(group.interestFreeDaysToday) 天")
                            .font(.system(size: 26, weight: .bold, design: .rounded))
                            .foregroundStyle(WCColors.primaryAccent)
                        Text("今日刷卡免息 \(group.interestFreeDaysToday) 日")
                            .font(.caption2)
                            .foregroundStyle(WCColors.textSecondary)
                    }
                }

                Divider()
                    .background(WCColors.border)

                // Purchase to repayment flow；缺还款规则（无产品/无 loanDueDay）时
                // nextDueDate 返回 nil，不拿今天充当预计还款日编造财务数据
                let today = Date()
                let nextDue = group.nextDueDate(today: today)
                let f = BillsFormatters.mmddCn

                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("今日消费")
                            .font(.caption2)
                            .foregroundStyle(WCColors.textSecondary)
                        Text(f.string(from: today))
                            .font(.subheadline.bold())
                            .foregroundStyle(WCColors.textPrimary)
                    }

                    Image(systemName: "arrow.right")
                        .font(.subheadline.bold())
                        .foregroundStyle(WCColors.primaryAccent)
                        .padding(.horizontal, 4)

                    if let nextDue {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("预计还款日")
                                .font(.caption2)
                                .foregroundStyle(WCColors.textSecondary)
                            Text(f.string(from: nextDue))
                                .font(.subheadline.bold())
                                .foregroundStyle(WCColors.textPrimary)
                        }
                    }

                    Spacer()
                }
                .padding(10)
                .background(WCColors.subtle, in: RoundedRectangle(cornerRadius: 10))

                // Next billing and debt status
                HStack {
                    if let nextBilling = group.nextBillingDate(today: today) {
                        Text("下次出账 \(BillsFormatters.mmdd.string(from: nextBilling)) · 新消费还款日")
                            .font(.caption2)
                            .foregroundStyle(WCColors.textSecondary)
                    }
                    Spacer()
                    if group.unpaidAmount <= 0.01 {
                        Text("已结清")
                            .font(.caption2.bold())
                            .foregroundStyle(WCColors.successInk)
                    } else {
                        Text("本期待还 \(DashboardMoney.format(group.unpaidAmount, currency: group.currency))")
                            .font(.caption2.bold())
                            .foregroundStyle(WCColors.textPrimary)
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
        .buttonStyle(.plain)
        .accessibilityIdentifier("bill.row.\(item.id)")
    }

    private var interestDisclaimer: some View {
        Text("按当前账单周期估算；实际免息期以银行出账为准。")
            .font(.caption2)
            .foregroundStyle(WCColors.textSecondary)
            .frame(maxWidth: .infinity, alignment: .center)
    }

    // MARK: - Unbilled Card View (未出账单卡片)
    private func unbilledCardView(_ card: CardDisplayItem) -> some View {
        Button(action: {
            selectedCardForEdit = card
        }) {
            VStack(alignment: .leading, spacing: 10) {
                // Card Identity Row
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 6) {
                            Text(card.bankName)
                                .font(.headline.bold())
                                .foregroundStyle(WCColors.textPrimary)
                            Text(card.holderName)
                                .font(.subheadline)
                                .foregroundStyle(WCColors.textSecondary)
                        }

                        HStack(spacing: 6) {
                            Text(card.displayName)
                                .font(.subheadline.weight(.medium))
                                .foregroundStyle(WCColors.textSecondary)
                            if !card.last4.isEmpty {
                                Text("(\(card.last4))")
                                    .font(.caption)
                                    .foregroundStyle(WCColors.textSecondary)
                            }
                        }
                    }

                    Spacer()

                    Text("未出账单")
                        .font(.caption2.bold())
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(WCColors.subtle, in: Capsule())
                        .foregroundStyle(WCColors.textSecondary)
                }

                // Amount Row
                HStack(alignment: .center) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("当前待还")
                            .font(.caption2)
                            .foregroundStyle(WCColors.textSecondary)
                        Text(DashboardMoney.format(0.0, currency: card.product?.currency ?? "CNY"))
                            .font(.system(size: 24, weight: .bold, design: .rounded))
                            .foregroundStyle(WCColors.textSecondary)
                    }

                    Spacer()

                    HStack(spacing: 4) {
                        Text("卡片详情")
                            .font(.caption.bold())
                        Image(systemName: "chevron.right")
                            .font(.caption2.bold())
                    }
                    .foregroundStyle(WCColors.primaryAccent)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(WCColors.subtle, in: RoundedRectangle(cornerRadius: 8))
                }

                let effectiveBillingDay = card.card.overrideBillingDay ?? card.card.billingDay
                let daysToBilling = BillingDateCalculator.daysUntilNextBilling(billingDay: effectiveBillingDay)

                Divider()
                    .background(WCColors.border)

                // Footer Row
                HStack {
                    Text("距账单日 \(daysToBilling) 天 · 每月 \(effectiveBillingDay) 日出账")
                        .font(.caption2.weight(.medium))
                        .foregroundStyle(WCColors.textSecondary)

                    Spacer()

                    Text("今日免息 \(card.interestFreeDaysToday) 天")
                        .font(.caption2.bold())
                        .foregroundStyle(WCColors.primaryAccent)
                }
            }
            .padding(16)
            .background(WCColors.surface, in: RoundedRectangle(cornerRadius: 16))
            .overlay(
                RoundedRectangle(cornerRadius: 16)
                    .stroke(WCColors.border, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("card.unbilled.row.\(card.id)")
    }

    // MARK: - Filter Animation

    /// 筛选按钮光环凝聚动效，凝聚后拽着面板滑出
    private func openFilterDrawerWithAnimation() {
        guard !isFilterDrawerPresented else { return }
        isFilterAuraCondensing = true
        filterHaloScale = 1.6
        filterHaloOpacity = 0.85

        withAnimation(.easeOut(duration: 0.15)) {
            filterHaloScale = 0.85
            filterHaloOpacity = 0.0
        }

        DispatchQueue.main.asyncAfter(deadline: .now() + 0.10) {
            withAnimation(.spring(response: 0.36, dampingFraction: 0.76)) {
                isFilterDrawerPresented = true
            }
        }

        DispatchQueue.main.asyncAfter(deadline: .now() + 0.30) {
            isFilterAuraCondensing = false
            filterHaloScale = 1.0
            filterHaloOpacity = 0.0
        }
    }
}

/// 动画状态留在按钮内，凝聚和回弹不会使列表重新求值。
private struct BillsSortTabs: View {
    @Binding var selection: BillsSortMode

    var body: some View {
        HStack(spacing: 6) {
            BillsSortButton(selection: $selection, mode: .nearestDue,
                            label: "最近需还款", identifier: "bills.sort.nearestDue")
            BillsSortButton(selection: $selection, mode: .maxInterestFree,
                            label: "最大免息期", identifier: "bills.sort.maxInterestFree")
        }
        .frame(height: 44)
        .padding(4)
        .background(WCColors.subtle, in: RoundedRectangle(cornerRadius: 12))
    }
}

private struct BillsSortButton: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Binding var selection: BillsSortMode
    let mode: BillsSortMode
    let label: String
    let identifier: String
    @State private var isCondensed = false
    @State private var animationTask: Task<Void, Never>?

    var body: some View {
        let isSelected = selection == mode
        Button {
            guard selection != mode else { return }
            animationTask?.cancel()
            // 先提交内容样式，不让装饰动画 transaction 传到列表与汇总布局。
            var transaction = Transaction()
            transaction.disablesAnimations = true
            withTransaction(transaction) { selection = mode }
            guard !reduceMotion else { return }
            withAnimation(.easeIn(duration: 0.08)) { isCondensed = true }
            animationTask = Task { @MainActor in
                do { try await Task.sleep(for: .milliseconds(80)) }
                catch { return }
                withAnimation(.spring(response: 0.30, dampingFraction: 0.72)) {
                    isCondensed = false
                }
            }
        } label: {
            ZStack {
                if isSelected {
                    RoundedRectangle(cornerRadius: isCondensed ? 16 : 8)
                        .fill(WCColors.primaryAccent)
                        .frame(width: isCondensed ? 32 : nil, height: isCondensed ? 32 : nil)
                        .shadow(color: WCColors.primaryAccent.opacity(isCondensed ? 0.45 : 0), radius: 6)
                }
                Text(label)
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(isSelected ? WCColors.onDark : WCColors.textSecondary)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(identifier)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
        .onChange(of: selection) { _, value in
            if value != mode {
                animationTask?.cancel()
                isCondensed = false
            }
        }
        .onDisappear {
            animationTask?.cancel()
            animationTask = nil
            isCondensed = false
        }
    }
}
