import SwiftUI
import WorldCreditCore

struct CardsView: View {
    @Environment(AppState.self) private var appState

    @State private var selectedSegment: AccountSegment = .credit
    @State private var creditViewMode: CreditViewMode = .pool
    @State private var selectedHolderFilterId: String?
    @State private var navigationPath = NavigationPath()

    @State private var editingCard: CardDisplayItem?
    @State private var editingCreditAccount: CreditAccount?
    @State private var showingCreateCardSheet: Bool = false
    @State private var showingMergeWizard: Bool = false
    @State private var showingCreateHolderAlert: Bool = false
    @State private var newHolderName: String = ""
    @State private var holderCreateError: String?

    enum AccountSegment: String, CaseIterable, Identifiable {
        case credit = "信用卡"
        case loans = "贷款"
        case holders = "持卡人"

        var id: String { rawValue }
    }

    enum CreditViewMode: String, CaseIterable, Identifiable {
        case pool = "账户池"
        case single = "单卡"

        var id: String { rawValue }
    }

    // MARK: - Derived Collections

    private var allCreditCards: [CardDisplayItem] {
        appState.cards.filter { $0.card.cardType != "loan" }
    }

    private var filteredCreditCards: [CardDisplayItem] {
        guard let holderId = selectedHolderFilterId else { return allCreditCards }
        return allCreditCards.filter { $0.card.holderId == holderId }
    }

    private var filteredAccountGroups: [CreditAccountGroup] {
        appState.creditAccountGroups.filter { group in
            let matchesHolder = selectedHolderFilterId == nil || group.account.holderId == selectedHolderFilterId
            let hasCreditCard = group.cards.contains { $0.card.cardType != "loan" }
            return matchesHolder && hasCreditCard
        }
    }

    private var ungroupedCreditCards: [CardDisplayItem] {
        let groupedIds = Set(filteredAccountGroups.flatMap { $0.cards.map(\.id) })
        return filteredCreditCards.filter { !groupedIds.contains($0.id) }
    }

    private var loanCards: [CardDisplayItem] {
        appState.cards.filter { $0.card.cardType == "loan" }
    }

    private var loanPayables: [PayableItem] {
        appState.payables.filter { $0.category == .loan }
    }

    private var creditTotals: (limit: Double, unpaid: Double, available: Double, unconverted: [String]) {
        var limitEntries: [(amount: Double, currency: String)] = []
        var unpaidEntries: [(amount: Double, currency: String)] = []

        for group in filteredAccountGroups {
            let cur = group.account.currency
            if group.creditLimit > 0 {
                limitEntries.append((group.creditLimit, cur))
            }
            if group.unpaidAmount > 0.01 {
                unpaidEntries.append((group.unpaidAmount, cur))
            }
        }

        for card in ungroupedCreditCards {
            let cur = card.product?.currency ?? "CNY"
            if card.card.effectiveCreditLimit > 0 {
                limitEntries.append((card.card.effectiveCreditLimit, cur))
            }
            if card.remainingAmount > 0.01 {
                unpaidEntries.append((card.remainingAmount, cur))
            }
        }

        let target = appState.dashboardCurrency
        let rates = appState.dashboardRates

        var totalLimit = 0.0
        var totalUnpaid = 0.0
        var unconverted = Set<String>()

        for entry in limitEntries {
            if let converted = DashboardFx.convert(entry.amount, from: entry.currency, to: target, rates: rates) {
                totalLimit += converted
            } else {
                unconverted.insert(entry.currency)
            }
        }
        for entry in unpaidEntries {
            if let converted = DashboardFx.convert(entry.amount, from: entry.currency, to: target, rates: rates) {
                totalUnpaid += converted
            } else {
                unconverted.insert(entry.currency)
            }
        }

        return (totalLimit, totalUnpaid, max(0.0, totalLimit - totalUnpaid), unconverted.sorted())
    }

    // MARK: - Body

    var body: some View {
        NavigationStack(path: $navigationPath) {
            VStack(spacing: 0) {
                Picker("账户分类", selection: $selectedSegment) {
                    ForEach(AccountSegment.allCases) { seg in
                        Text(seg.rawValue).tag(seg)
                    }
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
                .accessibilityIdentifier("accounts.segmentPicker")

                List {
                    switch selectedSegment {
                    case .credit:
                        creditSegmentContent
                    case .loans:
                        loansSegmentContent
                    case .holders:
                        holdersSegmentContent
                    }
                }
                .listStyle(.insetGrouped)
                .refreshable {
                    await appState.sync()
                    await appState.refreshPayables()
                }
            }
            .navigationTitle("账户")
            .navigationDestination(for: CardDetailRoute.self) { route in
                CardDetailView(cardId: route.cardId)
            }
            .navigationDestination(for: BillDetailRoute.self) { route in
                BillDetailView(item: route.item)
            }
            .toolbar {
                ToolbarItemGroup(placement: .primaryAction) {
                    if selectedSegment == .credit {
                        Button {
                            HapticManager.impactLight()
                            showingMergeWizard = true
                        } label: {
                            Image(systemName: "arrow.triangle.merge")
                        }
                        .accessibilityLabel("合并账户")
                        .accessibilityIdentifier("cards.mergeWizard")
                    }

                    Button {
                        HapticManager.impactLight()
                        showingCreateCardSheet = true
                    } label: {
                        Image(systemName: "plus")
                    }
                    .accessibilityLabel("新增卡片")
                    .accessibilityIdentifier("cards.addCard")
                }
            }
            .onAppear {
                if appState.showingCreateCardSheet {
                    appState.showingCreateCardSheet = false
                    showingCreateCardSheet = true
                }
            }
            .onChange(of: appState.showingCreateCardSheet) { _, newValue in
                if newValue {
                    appState.showingCreateCardSheet = false
                    showingCreateCardSheet = true
                }
            }
            .onChange(of: selectedSegment) { _, _ in
                HapticManager.selection()
            }
            .sheet(item: $editingCard) { card in
                CardEditSheetView(card: card) { input in
                    try await appState.updateCard(cardId: card.id, input: input)
                }
            }
            .sheet(item: $editingCreditAccount) { account in
                CreditAccountEditSheet(account: account) { input in
                    _ = try await appState.updateCreditAccount(accountId: account.id, input: input)
                }
            }
            .sheet(isPresented: $showingCreateCardSheet) {
                CardCreateSheetView()
            }
            .sheet(isPresented: $showingMergeWizard) {
                AccountMergeWizardSheet()
            }
            .alert("新建持卡人", isPresented: $showingCreateHolderAlert) {
                TextField("输入持卡人姓名", text: $newHolderName)
                Button("创建") {
                    createNewHolder()
                }
                Button("取消", role: .cancel) {
                    newHolderName = ""
                }
            } message: {
                Text("创建家庭成员或本人持卡人档案，用于归集卡片与账单。")
            }
            .alert("创建持卡人失败", isPresented: Binding(
                get: { holderCreateError != nil },
                set: { if !$0 { holderCreateError = nil } }
            )) {
                Button("好", role: .cancel) {}
            } message: {
                if let holderCreateError {
                    Text(holderCreateError)
                }
            }
        }
    }

    // MARK: - 1. 信用卡分段

    @ViewBuilder
    private var creditSegmentContent: some View {
        // 视图双切换 + 合并入口
        Section {
            VStack(spacing: 10) {
                HStack(spacing: 10) {
                    Picker("信用卡视图", selection: $creditViewMode) {
                        ForEach(CreditViewMode.allCases) { mode in
                            Text(mode.rawValue).tag(mode)
                        }
                    }
                    .pickerStyle(.segmented)
                    .accessibilityIdentifier("accounts.creditViewPicker")

                    Button {
                        HapticManager.impactLight()
                        showingMergeWizard = true
                    } label: {
                        Label("合并账户", systemImage: "arrow.triangle.merge")
                            .font(.caption.bold())
                    }
                    .buttonStyle(.bordered)
                    .disabled(allCreditCards.count < 2)
                    .accessibilityIdentifier("accounts.mergeButton")
                }

                if appState.dashboardHolders.count > 1 {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            holderFilterChip("全部", selected: selectedHolderFilterId == nil) {
                                selectedHolderFilterId = nil
                            }
                            ForEach(appState.dashboardHolders) { holder in
                                holderFilterChip(holder.name, selected: selectedHolderFilterId == holder.id) {
                                    selectedHolderFilterId = holder.id
                                }
                            }
                        }
                    }
                }
            }
            .padding(.vertical, 2)
        }

        if filteredCreditCards.isEmpty {
            Section {
                ContentUnavailableView {
                    Label("暂无信用卡", systemImage: "creditcard")
                } description: {
                    Text("点击右上角或下方按钮新增信用卡，也可下拉同步最新数据")
                } actions: {
                    Button("新增卡片") {
                        showingCreateCardSheet = true
                    }
                    .buttonStyle(.borderedProminent)
                    .accessibilityIdentifier("cards.emptyAddCard")
                }
            }
        } else {
            // 授信总览（按账户池去重）
            Section {
                creditSummaryBanner
            }

            if creditViewMode == .pool {
                ForEach(filteredAccountGroups) { group in
                    accountPoolSection(group)
                }

                if !ungroupedCreditCards.isEmpty {
                    Section(filteredAccountGroups.isEmpty ? "全部信用卡" : "未归属账户池卡片") {
                        ForEach(ungroupedCreditCards) { card in
                            cardNavigationRow(card)
                        }
                    }
                }
            } else {
                Section("全部信用卡（\(filteredCreditCards.count) 张）") {
                    ForEach(filteredCreditCards) { card in
                        cardNavigationRow(card)
                    }
                }
            }
        }
    }

    private func holderFilterChip(_ title: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button {
            HapticManager.selection()
            action()
        } label: {
            Text(title)
                .font(.caption.bold())
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(selected ? WCColors.primaryAccent : WCColors.subtle, in: Capsule())
                .foregroundStyle(selected ? Color.white : WCColors.textPrimary)
        }
        .buttonStyle(.plain)
    }

    private var creditSummaryBanner: some View {
        let totals = creditTotals
        let poolCount = filteredAccountGroups.count + ungroupedCreditCards.count
        return VStack(alignment: .leading, spacing: 10) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("授信总览（按账户池去重）")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text("\(poolCount) 个账户池 · \(filteredCreditCards.count) 张信用卡")
                        .font(.subheadline.bold())
                }
                Spacer()
                Text(appState.dashboardCurrency)
                    .font(.caption2.bold())
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(WCColors.subtle, in: Capsule())
                    .foregroundStyle(WCColors.primaryAccent)
            }

            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("总额度").font(.caption2).foregroundStyle(.secondary)
                    Text(DashboardMoney.format(totals.limit, currency: appState.dashboardCurrency))
                        .font(.subheadline.bold())
                        .blur(radius: appState.dashboardPrivacy ? 5 : 0)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                VStack(alignment: .center, spacing: 2) {
                    Text("当前待还").font(.caption2).foregroundStyle(.secondary)
                    Text(DashboardMoney.format(totals.unpaid, currency: appState.dashboardCurrency))
                        .font(.subheadline.bold())
                        .foregroundStyle(totals.unpaid > 0.01 ? WCColors.warningInk : .secondary)
                        .blur(radius: appState.dashboardPrivacy ? 5 : 0)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                }
                .frame(maxWidth: .infinity)

                VStack(alignment: .trailing, spacing: 2) {
                    Text("估算可用").font(.caption2).foregroundStyle(.secondary)
                    Text(DashboardMoney.format(totals.available, currency: appState.dashboardCurrency))
                        .font(.subheadline.bold())
                        .foregroundStyle(WCColors.successInk)
                        .blur(radius: appState.dashboardPrivacy ? 5 : 0)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                }
                .frame(maxWidth: .infinity, alignment: .trailing)
            }

            if !totals.unconverted.isEmpty {
                Text("汇率暂不可用，未含：\(totals.unconverted.joined(separator: "、"))")
                    .font(.caption2)
                    .foregroundStyle(WCColors.warningInk)
            }
        }
        .padding(.vertical, 4)
    }

    private func accountPoolSection(_ group: CreditAccountGroup) -> some View {
        let bankTitle = group.bank?.shortName ?? group.bank?.name ?? group.account.bankName
        let poolTitle = (group.account.label?.isEmpty == false)
            ? group.account.label!
            : (group.cards.count > 1 || group.isMergedStatement ? "\(bankTitle)共享账户" : "\(bankTitle)账户")
        let currency = group.account.currency

        return Section {
            // 账户池聚合头部摘要
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 6) {
                            Text(poolTitle)
                                .font(.headline)
                            if let holderName = group.holder?.name {
                                Text(holderName)
                                    .font(.caption2.bold())
                                    .padding(.horizontal, 6)
                                    .padding(.vertical, 2)
                                    .background(WCColors.subtle, in: Capsule())
                                    .foregroundStyle(WCColors.textSecondary)
                            }
                        }

                        HStack(spacing: 6) {
                            Text(group.isSharedQuota ? "共享额度池" : "独立额度")
                                .font(.caption2.bold())
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(group.isSharedQuota ? WCColors.primaryAccent.opacity(0.14) : WCColors.subtle, in: Capsule())
                                .foregroundStyle(group.isSharedQuota ? WCColors.primaryAccent : WCColors.textSecondary)

                            Text(group.isMergedStatement ? "合并账单" : "独立账单")
                                .font(.caption2.bold())
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(group.isMergedStatement ? WCColors.warningSoft : WCColors.subtle, in: Capsule())
                                .foregroundStyle(group.isMergedStatement ? WCColors.warningInk : WCColors.textSecondary)

                            Text("\(group.cards.count) 张卡")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }

                    Spacer()

                    Button("管理") {
                        editingCreditAccount = group.account
                    }
                    .font(.caption.bold())
                    .buttonStyle(.bordered)
                }

                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("账户额度").font(.caption2).foregroundStyle(.secondary)
                        Text(group.creditLimit > 0 ? DashboardMoney.format(group.creditLimit, currency: currency) : "未设置")
                            .font(.footnote.bold())
                            .blur(radius: appState.dashboardPrivacy ? 5 : 0)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)

                    VStack(alignment: .center, spacing: 2) {
                        Text("待还金额").font(.caption2).foregroundStyle(.secondary)
                        Text(DashboardMoney.format(group.unpaidAmount, currency: currency))
                            .font(.footnote.bold())
                            .foregroundStyle(group.unpaidAmount > 0.01 ? WCColors.warningInk : .secondary)
                            .blur(radius: appState.dashboardPrivacy ? 5 : 0)
                    }
                    .frame(maxWidth: .infinity)

                    VStack(alignment: .trailing, spacing: 2) {
                        Text("可用额度").font(.caption2).foregroundStyle(.secondary)
                        Text(group.creditLimit > 0 ? DashboardMoney.format(group.availableLimit, currency: currency) : "—")
                            .font(.footnote.bold())
                            .foregroundStyle(WCColors.successInk)
                            .blur(radius: appState.dashboardPrivacy ? 5 : 0)
                    }
                    .frame(maxWidth: .infinity, alignment: .trailing)
                }
            }
            .padding(.vertical, 4)

            // 账户池内成员卡列表
            ForEach(group.cards.filter { $0.card.cardType != "loan" }) { card in
                let isPrimary = group.cards.count > 1 && group.account.primaryCardId == card.id
                NavigationLink(value: CardDetailRoute(cardId: card.id)) {
                    HStack(spacing: 10) {
                        VStack(alignment: .leading, spacing: 3) {
                            HStack(spacing: 6) {
                                Text(card.displayName)
                                    .font(.subheadline.bold())
                                if appState.displayConfig.showCardLast4 && !card.last4.isEmpty {
                                    Text("(\(card.last4))")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                if isPrimary {
                                    Text("主卡")
                                        .font(.caption2.bold())
                                        .padding(.horizontal, 6)
                                        .padding(.vertical, 1)
                                        .background(WCColors.primaryAccent.opacity(0.15), in: Capsule())
                                        .foregroundStyle(WCColors.primaryAccent)
                                }
                            }
                            let billingDay = card.card.overrideBillingDay ?? card.card.billingDay
                            Text("每月 \(billingDay) 日出账 · 今日刷卡免息 \(card.interestFreeDaysToday) 天")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        if !group.isSharedQuota {
                            Text(DashboardMoney.format(card.card.effectiveCreditLimit, currency: currency))
                                .font(.caption.bold())
                                .foregroundStyle(.secondary)
                                .blur(radius: appState.dashboardPrivacy ? 5 : 0)
                        }
                    }
                    .padding(.vertical, 2)
                }
                .accessibilityIdentifier("card.row.\(card.id)")
                .contextMenu {
                    cardContextMenu(card)
                }
            }
        }
    }

    private func cardNavigationRow(_ card: CardDisplayItem) -> some View {
        NavigationLink(value: CardDetailRoute(cardId: card.id)) {
            CardRowView(card: card)
        }
        .accessibilityIdentifier("card.row.\(card.id)")
        .contextMenu {
            cardContextMenu(card)
        }
    }

    @ViewBuilder
    private func cardContextMenu(_ card: CardDisplayItem) -> some View {
        Button {
            navigationPath.append(CardDetailRoute(cardId: card.id))
        } label: {
            Label("查看详情", systemImage: "creditcard")
        }

        Button {
            editingCard = card
        } label: {
            Label("编辑卡片", systemImage: "pencil")
        }
    }

    // MARK: - 2. 贷款分段

    @ViewBuilder
    private var loansSegmentContent: some View {
        Section {
            VStack(alignment: .leading, spacing: 6) {
                Label("Phase 3 独立贷款合同即将上线", systemImage: "sparkles")
                    .font(.subheadline.bold())
                    .foregroundStyle(WCColors.primaryAccent)
                Text("后续版本将提供完整贷款合同管理（房贷组合贷、LPR+BP 分段重算、等额本息/本金期表与提前还款试算器）。当前为您展示已录入贷款卡与贷款类固定支出。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .padding(.vertical, 4)
        }

        if loanCards.isEmpty && loanPayables.isEmpty {
            Section {
                ContentUnavailableView {
                    Label("暂无贷款记录", systemImage: "banknote")
                } description: {
                    Text("您可以在「账单」页添加贷款类固定支出，或等待 Phase 3 独立贷款合同上线。")
                } actions: {
                    Button("前往账单页") {
                        appState.selectedTab = 1
                    }
                    .buttonStyle(.bordered)
                }
            }
        } else {
            if !loanCards.isEmpty {
                Section("贷款类卡片（只读概览 · \(loanCards.count) 笔）") {
                    ForEach(loanCards) { card in
                        NavigationLink(value: CardDetailRoute(cardId: card.id)) {
                            HStack {
                                VStack(alignment: .leading, spacing: 3) {
                                    HStack(spacing: 6) {
                                        Text("\(card.bankName) · \(card.displayName)")
                                            .font(.subheadline.bold())
                                        if !card.holderName.isEmpty {
                                            Text(card.holderName)
                                                .font(.caption2)
                                                .padding(.horizontal, 6)
                                                .padding(.vertical, 2)
                                                .background(WCColors.subtle, in: Capsule())
                                                .foregroundStyle(.secondary)
                                        }
                                    }
                                    let dueDay = card.card.loanDueDay ?? card.card.overrideBillingDay ?? card.card.billingDay
                                    Text("每月 \(dueDay) 日还款 · 授信/本金 \(DashboardMoney.format(card.card.effectiveCreditLimit, currency: card.product?.currency ?? "CNY"))")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                Spacer()
                                Text(DashboardMoney.format(card.remainingAmount, currency: card.product?.currency ?? "CNY"))
                                    .font(.subheadline.bold())
                                    .foregroundStyle(card.remainingAmount > 0.01 ? WCColors.warningInk : .secondary)
                                    .blur(radius: appState.dashboardPrivacy ? 5 : 0)
                            }
                            .padding(.vertical, 2)
                        }
                        .accessibilityIdentifier("loan.card.\(card.id)")
                    }
                }
            }

            if !loanPayables.isEmpty {
                Section {
                    ForEach(loanPayables) { payable in
                        HStack {
                            VStack(alignment: .leading, spacing: 3) {
                                HStack(spacing: 6) {
                                    Text(payable.name)
                                        .font(.subheadline.bold())
                                    if let bank = payable.bankName, !bank.isEmpty {
                                        Text(bank)
                                            .font(.caption2)
                                            .padding(.horizontal, 6)
                                            .padding(.vertical, 2)
                                            .background(WCColors.subtle, in: Capsule())
                                            .foregroundStyle(.secondary)
                                    }
                                }
                                Text("\(payable.cycleDisplayLabel) · 到期 \(payable.dueDate) · \(payable.distanceLabel)")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            VStack(alignment: .trailing, spacing: 2) {
                                Text(DashboardMoney.format(payable.amount, currency: payable.currency))
                                    .font(.subheadline.bold())
                                    .blur(radius: appState.dashboardPrivacy ? 5 : 0)
                                Text(payable.displayStatus)
                                    .font(.caption2.bold())
                                    .foregroundStyle(
                                        payable.status == .paid ? WCColors.successInk :
                                            (payable.status == .overdue ? WCColors.dangerInk : WCColors.warningInk)
                                    )
                            }
                        }
                        .padding(.vertical, 2)
                        .accessibilityIdentifier("loan.payable.\(payable.id)")
                    }
                } header: {
                    HStack {
                        Text("贷款类固定支出（\(loanPayables.count) 项）")
                        Spacer()
                        Button("去账单页处理") {
                            appState.selectedTab = 1
                        }
                        .font(.caption)
                    }
                }
            }
        }
    }

    // MARK: - 3. 持卡人分段

    @ViewBuilder
    private var holdersSegmentContent: some View {
        Section {
            HStack(spacing: 10) {
                Button {
                    HapticManager.impactLight()
                    newHolderName = ""
                    showingCreateHolderAlert = true
                } label: {
                    Label("新建持卡人", systemImage: "person.badge.plus")
                        .font(.subheadline.bold())
                        .frame(maxWidth: .infinity, minHeight: 38)
                }
                .buttonStyle(.bordered)
                .accessibilityIdentifier("holders.createHolder")

                Button {
                    HapticManager.impactLight()
                    showingCreateCardSheet = true
                } label: {
                    Label("新增卡片", systemImage: "creditcard.and.123")
                        .font(.subheadline.bold())
                        .frame(maxWidth: .infinity, minHeight: 38)
                }
                .buttonStyle(.borderedProminent)
                .accessibilityIdentifier("holders.addCard")
            }
            .listRowInsets(EdgeInsets(top: 6, leading: 12, bottom: 6, trailing: 12))
        }

        if appState.dashboardHolders.isEmpty {
            Section {
                ContentUnavailableView {
                    Label("暂无持卡人", systemImage: "person.2")
                } description: {
                    Text("点击上方「新建持卡人」创建本人或家庭成员档案")
                }
            }
        } else {
            Section("家庭持卡人（\(appState.dashboardHolders.count) 位）") {
                ForEach(appState.dashboardHolders) { holder in
                    let stats = holderStats(for: holder)
                    Button {
                        HapticManager.selection()
                        selectedHolderFilterId = holder.id
                        selectedSegment = .credit
                    } label: {
                        HStack(spacing: 12) {
                            Text(holderInitial(holder.name))
                                .font(.headline)
                                .foregroundStyle(.white)
                                .frame(width: 42, height: 42)
                                .background(WCColors.primaryAccent, in: Circle())

                            VStack(alignment: .leading, spacing: 4) {
                                HStack(spacing: 6) {
                                    Text(holder.name)
                                        .font(.headline)
                                        .foregroundStyle(WCColors.textPrimary)
                                    Text("\(stats.cardCount) 张卡")
                                        .font(.caption2.bold())
                                        .padding(.horizontal, 6)
                                        .padding(.vertical, 2)
                                        .background(WCColors.subtle, in: Capsule())
                                        .foregroundStyle(WCColors.primaryAccent)
                                }

                                HStack(spacing: 12) {
                                    Text("待还 \(DashboardMoney.format(stats.unpaid, currency: appState.dashboardCurrency))")
                                        .font(.caption)
                                        .foregroundStyle(stats.unpaid > 0.01 ? WCColors.warningInk : .secondary)
                                        .blur(radius: appState.dashboardPrivacy ? 5 : 0)

                                    if stats.limit > 0 {
                                        Text("额度 \(DashboardMoney.format(stats.limit, currency: appState.dashboardCurrency))")
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                            .blur(radius: appState.dashboardPrivacy ? 5 : 0)
                                    }
                                }
                            }

                            Spacer()

                            Image(systemName: "chevron.right")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        .padding(.vertical, 4)
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("holder.row.\(holder.id)")
                }
            }
        }
    }

    private func holderStats(for holder: CardHolder) -> (cardCount: Int, unpaid: Double, limit: Double) {
        let holderCards = appState.cards.filter { $0.card.holderId == holder.id }
        let holderBills = appState.dashboardBills.filter { $0.card.holderId == holder.id && $0.remainingAmount > 0.01 }
        let target = appState.dashboardCurrency
        let rates = appState.dashboardRates

        var unpaid = 0.0
        for bill in holderBills {
            if let converted = DashboardFx.convert(bill.remainingAmount, from: bill.currency, to: target, rates: rates) {
                unpaid += converted
            }
        }

        // 授信按账户池去重计算
        let holderGroups = appState.creditAccountGroups.filter { $0.account.holderId == holder.id }
        let groupedIds = Set(holderGroups.flatMap { $0.cards.map(\.id) })
        var limit = 0.0
        for group in holderGroups where group.creditLimit > 0 {
            if let converted = DashboardFx.convert(group.creditLimit, from: group.account.currency, to: target, rates: rates) {
                limit += converted
            }
        }
        for card in holderCards where !groupedIds.contains(card.id) && card.card.effectiveCreditLimit > 0 {
            let cur = card.product?.currency ?? "CNY"
            if let converted = DashboardFx.convert(card.card.effectiveCreditLimit, from: cur, to: target, rates: rates) {
                limit += converted
            }
        }

        return (holderCards.count, unpaid, limit)
    }

    private func holderInitial(_ name: String) -> String {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? "?" : trimmed.prefix(1).uppercased()
    }

    private func createNewHolder() {
        let trimmed = newHolderName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        newHolderName = ""
        Task {
            do {
                _ = try await appState.createHolder(name: trimmed)
                HapticManager.success()
            } catch {
                holderCreateError = error.localizedDescription
                HapticManager.error()
            }
        }
    }
}

struct CardRowView: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(AppState.self) private var appState
    let card: CardDisplayItem

    var body: some View {
        let currency = card.product?.currency ?? "CNY"
        let effectiveLimit = card.card.effectiveCreditLimit

        VStack(alignment: .leading, spacing: 10) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(card.bankName)
                            .font(.caption)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(Color.secondary.opacity(0.12))
                            .clipShape(RoundedRectangle(cornerRadius: 4))

                        Text(card.displayName)
                            .font(.headline)
                    }

                    HStack(spacing: 6) {
                        Text(card.holderName)
                        if appState.displayConfig.showCardLast4 && !card.last4.isEmpty {
                            Text("(\(card.last4))")
                        }
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }

                Spacer()

                // 免息期标签
                VStack(alignment: .trailing, spacing: 2) {
                    Text("\(card.interestFreeDaysToday) 天")
                        .font(.title3.bold())
                        .foregroundStyle(.tint)
                    Text("今日刷卡免息")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }

            Divider()

            let useVerticalMetrics = dynamicTypeSize.isAccessibilitySize
            let metricsLayout = useVerticalMetrics
                ? AnyLayout(VStackLayout(alignment: .leading, spacing: 12))
                : AnyLayout(HStackLayout(alignment: .top, spacing: 12))
            metricsLayout {
                VStack(alignment: .leading, spacing: 2) {
                    Text("信用额度")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    Text(DashboardMoney.format(effectiveLimit, currency: currency))
                        .font(.footnote.bold())
                        .lineLimit(1)
                        .minimumScaleFactor(0.75)
                        .blur(radius: appState.dashboardPrivacy ? 5 : 0)
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                VStack(alignment: useVerticalMetrics ? .leading : .center, spacing: 2) {
                    let billingDay = card.card.overrideBillingDay ?? card.card.billingDay
                    Text("账单日")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    Text("每月 \(billingDay) 日")
                        .font(.footnote.bold())
                        .lineLimit(1)
                        .minimumScaleFactor(0.75)
                }
                .frame(maxWidth: .infinity, alignment: useVerticalMetrics ? .leading : .center)

                VStack(alignment: useVerticalMetrics ? .leading : .trailing, spacing: 2) {
                    Text("未还账款")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    Text(DashboardMoney.format(card.remainingAmount, currency: currency))
                        .font(.footnote.bold())
                        .foregroundStyle(card.remainingAmount > 0.01 ? .primary : .secondary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.75)
                        .blur(radius: appState.dashboardPrivacy ? 5 : 0)
                }
                .frame(maxWidth: .infinity, alignment: useVerticalMetrics ? .leading : .trailing)
            }

            if appState.displayConfig.showAnnualFee,
               let annualFee = card.card.annualFeeOverride ?? card.product?.annualFee {
                HStack {
                    Text("年费参考")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    Spacer()
                    Text(annualFee > 0 ? DashboardMoney.format(annualFee, currency: currency) : "免年费")
                        .font(.caption2.bold())
                        .foregroundStyle(.secondary)
                        .blur(radius: appState.dashboardPrivacy ? 5 : 0)
                }
            }
        }
        .padding(.vertical, 4)
    }
}
