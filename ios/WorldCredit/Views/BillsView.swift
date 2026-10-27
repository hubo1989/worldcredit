import SwiftUI
import WorldCreditCore

struct BillsView: View {
    @Environment(AppState.self) private var appState
    @State private var payingItem: BillDisplayItem?
    @State private var adjustingItem: BillDisplayItem?
    @State private var editingPayable: PayableItem?
    @State private var creatingPayable = false
    @State private var payingPayable: PayableItem?
    @State private var payablePayAmount = ""
    @State private var showPayAllConfirm = false
    @State private var isPayingAll = false
    @State private var payAllError: String?
    // 单维度筛选（与 Web 口径一致）：选持卡人时清除银行选择，反之亦然。
    @State private var holderFilterId: String?
    @State private var bankFilterName: String?

    /// 列表数据源：最近需还款走状态过滤后的账单；最大免息期是选卡视角，
    /// 从全量账单取（已结清卡的免息期同样参与排序），持卡人/银行筛选仍然生效。
    private var listBills: [BillDisplayItem] {
        let source = appState.billsSortMode == .maxInterestFree ? appState.allBills : appState.bills
        return source.filter { item in
            (holderFilterId == nil || item.holderId == holderFilterId)
                && (bankFilterName == nil || item.bankName == bankFilterName)
        }
    }

    private var filteredBills: [BillDisplayItem] {
        appState.bills.filter { item in
            (holderFilterId == nil || item.holderId == holderFilterId)
                && (bankFilterName == nil || item.bankName == bankFilterName)
        }
    }

    private var visibleGroups: [CardBillsGroup] {
        BillsGrouping.sorted(
            BillsGrouping.groups(from: listBills),
            by: appState.billsSortMode
        )
    }

    private var overdueItems: [BillDisplayItem] {
        filteredBills.filter(\.isOverdue)
    }

    /// 逾期合计按币种折算到展示币种；缺汇率的币种不计入并明确提示。
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

    /// 筛选选项从全部活跃卡推导（appState.cards），不从当前 tab 的账单推导——
    /// 否则「待还」tab 下，只有已还账单的持卡人/银行会整组从筛选里消失。
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

    private var convertedTotal: BillsTotal? {
        guard !visibleGroups.isEmpty else { return nil }
        return BillsGrouping.total(
            of: visibleGroups,
            rates: appState.dashboardRates,
            displayCurrency: appState.dashboardCurrency
        )
    }

    /// 缺账单提醒的最新期基线：必须取全量账单（allBills），
    /// 「待还」tab 里被过滤掉的已还最新期不能让基线退期、造成误报。
    private var latestBillMonthByCard: [String: String] {
        var map: [String: String] = [:]
        for item in appState.allBills {
            let month = item.bill.billMonth
            if (map[item.card.id] ?? "") < month {
                map[item.card.id] = month
            }
        }
        return map
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // 排序双 tab（对齐 Web 快捷切换栏）：最近需还款 / 最大免息期
                sortTabs
                    .padding(.horizontal)
                    .padding(.top, 8)
                    .padding(.bottom, 4)

                // 筛选（状态 + 持卡人/银行统一收进菜单，状态切换不再占据独立分段控件）
                HStack(spacing: 16) {
                    Menu {
                        Picker("账单状态", selection: Binding(
                            get: { appState.selectedBillFilter },
                            set: { newFilter in
                                appState.selectedBillFilter = newFilter
                                Task { await appState.reloadData() }
                            }
                        )) {
                            ForEach(BillFilter.allCases) { filter in
                                Text(filter.rawValue).tag(filter)
                            }
                        }
                        Divider()
                        Picker("持卡人", selection: Binding(
                            get: { holderFilterId },
                            set: { newValue in
                                holderFilterId = newValue
                                bankFilterName = nil
                            }
                        )) {
                            Text("全部").tag(String?.none)
                            ForEach(holderOptions, id: \.id) { option in
                                Text(option.name).tag(String?.some(option.id))
                            }
                        }
                        Picker("银行", selection: Binding(
                            get: { bankFilterName },
                            set: { newValue in
                                bankFilterName = newValue
                                holderFilterId = nil
                            }
                        )) {
                            Text("全部").tag(String?.none)
                            ForEach(bankOptions, id: \.self) { name in
                                Text(name).tag(String?.some(name))
                            }
                        }
                    } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "line.3.horizontal.decrease.circle")
                            Text(filterSummary)
                        }
                        .font(.footnote)
                        .foregroundStyle(
                            holderFilterId == nil && bankFilterName == nil
                                && appState.selectedBillFilter == .unpaid
                                ? Color.secondary : Color.blue
                        )
                    }
                    .accessibilityIdentifier("bills.holderBankFilter")

                    Spacer()
                }
                .padding(.horizontal)
                .padding(.bottom, 4)

                // 多币种合计（按展示币种折算；缺汇率的币种不计入并提示）
                if let total = convertedTotal {
                    HStack {
                        Text("待还合计（\(appState.dashboardCurrency)）")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                        Spacer()
                        if total.unconvertedCurrencies.isEmpty {
                            Text(DashboardMoney.format(total.amount, currency: appState.dashboardCurrency))
                                .font(.footnote.bold())
                        } else {
                            VStack(alignment: .trailing, spacing: 1) {
                                Text(DashboardMoney.format(total.amount, currency: appState.dashboardCurrency))
                                    .font(.footnote.bold())
                                Text("\(total.unconvertedCurrencies.joined(separator: "、")) 未折算")
                                    .font(.caption2)
                                    .foregroundStyle(.orange)
                            }
                        }
                    }
                    .padding(.horizontal)
                    .padding(.bottom, 4)
                    .accessibilityIdentifier("bills.total")
                }

                overdueBanner

                billsList
            }
            .navigationTitle("账单")
            .navigationDestination(for: BillDetailRoute.self) { route in
                BillDetailView(item: route.item)
            }
            .refreshable {
                await appState.sync()
                await appState.refreshPayables()
            }
            .task {
                await appState.refreshPayables()
            }
            .sheet(item: $payingItem) { item in
                PaymentSheetView(item: item) { amount, date, channel, note in
                    try await appState.recordPayment(
                        billId: item.bill.id,
                        amount: amount,
                        paidAt: date,
                        channel: channel,
                        note: note
                    )
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
                "一键结清 \(overdueItems.count) 笔逾期账单？",
                isPresented: $showPayAllConfirm,
                titleVisibility: .visible
            ) {
                // 与首页一键结清一致：dialog 按钮按 label 定位（identifier 会匹配到多个元素）
                Button("一键结清", role: .destructive) {
                    Task { await payAllOverdue() }
                }
                Button("取消", role: .cancel) {}
            } message: {
                Text("按原币种全额结清，待还合计 \(overdueTotalLabel)")
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

    // MARK: - 排序双 tab（Web 快捷切换栏同款语义）

    private var sortTabs: some View {
        HStack(spacing: 4) {
            sortTab(.nearestDue, label: "最近需还款", identifier: "bills.sort.nearestDue")
            sortTab(.maxInterestFree, label: "最大免息期", identifier: "bills.sort.maxInterestFree")
        }
        .padding(4)
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
        // 注意：容器上不能加 accessibilityIdentifier——SwiftUI 会把它下传并覆盖
        // 子按钮自己的标识符（bills.sort.*），UI 测试将无法定位。
    }

    private func sortTab(_ mode: BillsSortMode, label: String, identifier: String) -> some View {
        let selected = appState.billsSortMode == mode
        return Button {
            setSortMode(mode)
        } label: {
            Text(label)
                .font(.footnote.weight(.semibold))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 7)
        }
        .buttonStyle(.plain)
        .foregroundStyle(selected ? Color.white : Color.secondary)
        .background(
            selected ? Color.accentColor : Color.clear,
            in: RoundedRectangle(cornerRadius: 9)
        )
        .accessibilityIdentifier(identifier)
        .accessibilityAddTraits(selected ? [.isSelected] : [])
    }

    // MARK: - 逾期横幅

    @ViewBuilder
    private var overdueBanner: some View {
        if !overdueItems.isEmpty {
            VStack(spacing: 4) {
                HStack(spacing: 10) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundStyle(.red)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("存在 \(overdueItems.count) 笔逾期账单未结清")
                            .font(.footnote.weight(.semibold))
                        Text("待还合计 \(overdueTotalLabel)")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 8)
                    Button("一键还清") {
                        showPayAllConfirm = true
                    }
                    .font(.caption.bold())
                    .buttonStyle(.borderedProminent)
                    .tint(.red)
                    .controlSize(.small)
                    .disabled(isPayingAll)
                    .accessibilityIdentifier("bills.payAllOverdue")
                }
                if let payAllError {
                    Text(payAllError)
                        .font(.caption2)
                        .foregroundStyle(.red)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .padding(10)
            .background(Color.red.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
            // 容器不加 accessibilityIdentifier：会覆盖子按钮的 bills.payAllOverdue（见 sortTabs 注释）。
            .padding(.horizontal)
            .padding(.bottom, 4)
        }
    }

    private func payAllOverdue() async {
        guard !overdueItems.isEmpty else { return }
        isPayingAll = true
        payAllError = nil
        do {
            // recordFullPayments 事务内逐笔重读余额，幂等且整批回滚（与首页一键结清同一服务）
            _ = try await appState.payDashboardBills(overdueItems.map { $0.bill.id })
        } catch {
            payAllError = "一键结清失败：\(error.localizedDescription)"
        }
        isPayingAll = false
    }

    // MARK: - 列表

    @ViewBuilder
    private var billsList: some View {
        // 固定支出是在线数据且独立于账单 tab：只要它还有内容/错误要展示，
        // 就不用整页空态把它挡住。
        // 最大免息期回答「现在刷哪张卡最划算」，固定支出无免息概念，不出现在该排序里。
        let payablesVisible = appState.billsSortMode != .maxInterestFree
            && (!appState.payables.isEmpty || appState.payablesError != nil)
        if appState.bills.isEmpty && !payablesVisible {
            ContentUnavailableView(
                "没有\(appState.selectedBillFilter.rawValue)账单",
                systemImage: "doc.text",
                description: Text("下拉可同步最新账单数据")
            )
        } else {
            List {
                if appState.billsSortMode != .maxInterestFree {
                    payablesSection
                }

                if filteredBills.isEmpty {
                    Section {
                        Label(
                            appState.bills.isEmpty
                                ? "没有\(appState.selectedBillFilter.rawValue)账单，下拉可同步最新数据"
                                : "没有\(appState.selectedBillFilter.rawValue)账单，换个筛选条件试试",
                            systemImage: "line.3.horizontal.decrease.circle"
                        )
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    }
                }

                ForEach(visibleGroups) { group in
                    Section {
                        // 一张卡的所有账单信息收进同一张自绘卡片（组头 + 各期 + 周期 footer），
                        // 对齐 Web 聚合卡；不用 Section header/footer 拆层。
                        BillCardView(
                            group: group,
                            showsInterestFree: appState.billsSortMode == .maxInterestFree,
                            latestBillMonth: latestBillMonthByCard[group.cardId],
                            onOpenPayment: { payingItem = $0 },
                            onAdjustAmount: { adjustingItem = $0 }
                        )
                        .listRowInsets(EdgeInsets())
                        .listRowSeparator(.hidden)
                        // 容器不能加 accessibilityIdentifier：会下传覆盖行内 bill.row.* 标识符
                    }
                }
            }
            .listStyle(.insetGrouped)
        }
    }

    @ViewBuilder
    private var payablesSection: some View {
        Section("固定支出") {
            if let error = appState.payablesError {
                Label(error, systemImage: "wifi.exclamationmark")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            } else if appState.payables.isEmpty {
                Button {
                    creatingPayable = true
                } label: {
                    Label("添加固定支出（房租/贷款等）", systemImage: "plus.circle")
                        .font(.footnote)
                }
            } else {
                ForEach(appState.payables) { payable in
                    PayableRowView(item: payable) {
                        payingPayable = payable
                        payablePayAmount = String(format: "%.2f", payable.remainingAmount)
                    } onEdit: {
                        editingPayable = payable
                    }
                }
                Button {
                    creatingPayable = true
                } label: {
                    Label("添加固定支出", systemImage: "plus.circle")
                        .font(.footnote)
                }
            }
        }
    }

    private func setSortMode(_ mode: BillsSortMode) {
        guard appState.billsSortMode != mode else { return }
        appState.billsSortMode = mode
        Task { await appState.reloadData() }
    }
}

// MARK: - 单卡聚合卡片（组头 + 各期账单 + 周期 footer 同卡展示，对齐 Web BillCard）

struct BillCardView: View {
    let group: CardBillsGroup
    let showsInterestFree: Bool
    let latestBillMonth: String?
    var onOpenPayment: (BillDisplayItem) -> Void
    var onAdjustAmount: (BillDisplayItem) -> Void

    /// 展示的账单期次：免息模式只看当前期（bill_month 最新的一期），
    /// 历史账单对选卡是噪音；其余模式按原样全展示。
    private var displayBills: [BillDisplayItem] {
        guard showsInterestFree else { return group.bills }
        guard let latest = group.bills.max(by: { $0.bill.billMonth < $1.bill.billMonth }) else {
            return []
        }
        return [latest]
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            // 卡头：银行 + 卡名 + 期数 + 待还合计
            HStack(alignment: .firstTextBaseline) {
                HStack(spacing: 6) {
                    Text(group.bankName)
                        .font(.caption2)
                        .padding(.horizontal, 5)
                        .padding(.vertical, 1)
                        .background(Color.secondary.opacity(0.12))
                        .clipShape(RoundedRectangle(cornerRadius: 4))
                    Text(group.cardTitle)
                        .font(.subheadline.weight(.semibold))
                    // 免息模式只展示当前期，不再报历史期数
                    Text(showsInterestFree
                         ? group.holderName
                         : "\(group.holderName) · \(group.bills.count) 期")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                if group.unpaidAmount > 0.01 {
                    Text(DashboardMoney.format(group.unpaidAmount, currency: group.currency))
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(group.hasOverdue ? .red : .primary)
                } else {
                    Text("已结清")
                        .font(.caption2)
                        .foregroundStyle(.green)
                }
            }

            // 各期账单（免息模式仅当前期）
            VStack(spacing: 8) {
                ForEach(displayBills) { item in
                    billRow(item)
                }
            }

            // 周期 footer：下期账单日/还款日 + 缺账提醒
            CardGroupFooterView(group: group, latestBillMonth: latestBillMonth)
        }
        .padding(14)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 14))
    }

    @ViewBuilder
    private func billRow(_ item: BillDisplayItem) -> some View {
        // 整行为 NavigationLink（标识符解析为 button，UI 测试按 bill.row.* 查找）；
        // 行内「还款」按钮嵌在 label 里，与旧结构一致。
        NavigationLink(value: BillDetailRoute(item: item)) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("\(item.bill.billMonth) 期账单")
                        .font(.subheadline.weight(.semibold))
                    Text("到期日 \(item.bill.dueDate)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text(rowCaption(item))
                        .font(.caption.weight(.medium))
                        .foregroundStyle(rowCaptionColor(item))
                }

                Spacer(minLength: 8)

                VStack(alignment: .trailing, spacing: 5) {
                    Text(DashboardMoney.format(item.remainingAmount, currency: item.currency))
                        .font(.subheadline.weight(.bold))
                        .foregroundStyle(item.isOverdue ? .red : .primary)
                    if item.totalPaid > 0 && item.remainingAmount > 0.01 {
                        Text("已还 " + DashboardMoney.format(item.totalPaid, currency: item.currency))
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                    if item.remainingAmount > 0.01 {
                        Button("还款") {
                            onOpenPayment(item)
                        }
                        .font(.caption.bold())
                        .buttonStyle(.bordered)
                        .controlSize(.mini)
                        .accessibilityIdentifier("bill.row.pay.\(item.bill.id)")
                    }
                }
            }
        }
        .padding(10)
        .background(Color(.tertiarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 10))
        .contextMenu {
            if item.remainingAmount > 0.01 {
                Button {
                    onOpenPayment(item)
                } label: {
                    Label("登记还款", systemImage: "yensign.circle")
                }
            }
            Button {
                onAdjustAmount(item)
            } label: {
                Label("调整账单金额", systemImage: "pencil")
            }
        }
        .accessibilityIdentifier("bill.row.\(item.id)")
    }

    private func rowCaption(_ item: BillDisplayItem) -> String {
        showsInterestFree ? "今日刷卡免息 \(group.interestFreeDaysToday) 日" : item.distanceLabel
    }

    private func rowCaptionColor(_ item: BillDisplayItem) -> Color {
        if showsInterestFree { return .green }
        return item.isOverdue ? .red : (item.daysUntilDue <= 3 ? .orange : .secondary)
    }
}

// MARK: - 卡组 footer：下期周期信息 + 缺账单提醒（对齐 Web 卡片周期块）

struct CardGroupFooterView: View {
    let group: CardBillsGroup
    let latestBillMonth: String?

    private static let mmdd: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "MM-dd"
        formatter.timeZone = TimeZone(identifier: "Asia/Shanghai")
        return formatter
    }()

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            if let nextBilling = group.nextBillingDate(today: Date()),
               let nextDue = group.nextDueDate(today: Date()) {
                Text("下期账单日 \(Self.mmdd.string(from: nextBilling)) · 下期还款日 \(Self.mmdd.string(from: nextDue))")
            }
            if let missing = group.missingStatementDays(
                latestBillMonth: latestBillMonth, today: Date()
            ) {
                Text("已过账单日 \(missing) 日，未接收到新的账单，请检查")
                    .foregroundStyle(.orange)
            }
        }
        .font(.caption2)
        .foregroundStyle(.secondary)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - 固定支出行

struct PayableRowView: View {
    let item: PayableItem
    let onPay: () -> Void
    let onEdit: () -> Void

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(item.name)
                        .font(.subheadline.weight(.medium))
                    Text(item.category.label)
                        .font(.caption2)
                        .padding(.horizontal, 5)
                        .padding(.vertical, 1)
                        .background(Color.secondary.opacity(0.12))
                        .clipShape(RoundedRectangle(cornerRadius: 4))
                }
                Text(item.distanceLabel)
                    .font(.caption)
                    .foregroundStyle(distanceColor)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 4) {
                Text("\(item.currency) \(item.amount, format: .number.precision(.fractionLength(2)))")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(item.status == .overdue ? .red : .primary)
                if item.status != .paid {
                    Button("登记付款", action: onPay)
                        .font(.caption.bold())
                        .buttonStyle(.bordered)
                        .controlSize(.mini)
                }
            }
        }
        .contentShape(Rectangle())
        .onTapGesture(perform: onEdit)
        .accessibilityIdentifier("payable.row.\(item.id)")
    }

    private var distanceColor: Color {
        switch item.status {
        case .paid: return .secondary
        case .overdue: return .red
        case .unpaid: return item.daysUntilDue <= 3 ? .orange : .secondary
        }
    }
}

// MARK: - 平铺行（兼容旧 UI 测试与首页近期列表）

struct BillRowView: View {
    let item: BillDisplayItem
    let showsInterestFree: Bool
    let onQuickPay: () -> Void

    init(item: BillDisplayItem, showsInterestFree: Bool = false, onQuickPay: @escaping () -> Void) {
        self.item = item
        self.showsInterestFree = showsInterestFree
        self.onQuickPay = onQuickPay
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(item.bankName)
                            .font(.caption)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(Color.secondary.opacity(0.12))
                            .clipShape(RoundedRectangle(cornerRadius: 4))

                        Text(item.cardTitle)
                            .font(.headline)
                    }

                    HStack(spacing: 6) {
                        Text(item.holderName)
                        if !item.last4.isEmpty {
                            Text("(\(item.last4))")
                        }
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }

                Spacer()

                VStack(alignment: .trailing, spacing: 2) {
                    Text(DashboardMoney.format(item.remainingAmount, currency: item.currency))
                        .font(.headline)
                        .foregroundStyle(item.isOverdue ? .red : .primary)

                    if item.totalPaid > 0 && item.remainingAmount > 0.01 {
                        Text("已还 " + DashboardMoney.format(item.totalPaid, currency: item.currency))
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
            }

            HStack {
                if showsInterestFree {
                    Text("今日刷卡免息 \(item.interestFreeDaysToday) 日")
                        .font(.footnote)
                        .foregroundStyle(.green)
                } else {
                    Text(item.distanceLabel)
                        .font(.footnote)
                        .foregroundStyle(item.isOverdue ? .red : (item.daysUntilDue <= 3 ? .orange : .secondary))
                }

                Spacer()

                Text(item.displayStatus)
                    .font(.caption2.bold())
                    .padding(.horizontal, 8)
                    .padding(.vertical, 2)
                    .background(
                        item.remainingAmount <= 0.01 ? Color.green.opacity(0.12) :
                        (item.isOverdue ? Color.red.opacity(0.12) : Color.blue.opacity(0.12))
                    )
                    .foregroundStyle(
                        item.remainingAmount <= 0.01 ? .green :
                        (item.isOverdue ? .red : .blue)
                    )
                    .clipShape(Capsule())
            }
        }
        .padding(.vertical, 4)
    }
}
