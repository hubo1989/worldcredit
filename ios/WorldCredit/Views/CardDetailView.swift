import SwiftUI
import WorldCreditCore

struct CardDetailRoute: Hashable {
    let cardId: String
    var initialSection: String? = nil
}

struct CardDetailView: View {
    let cardId: String
    var initialSection: String? = nil

    @Environment(AppState.self) private var appState
    @State private var detail: LoadedCardDetail?
    @State private var isLoading: Bool = true
    @State private var showingDefinitionSheet: Bool = false
    @State private var showingRulesSheet: Bool = false
    @State private var showingMergeWizard: Bool = false
    @State private var editingCreditAccount: CreditAccount?
    @State private var showingSplitConfirm: Bool = false
    @State private var isSplitting: Bool = false
    @State private var actionError: String?
    @State private var roiDetail: CardAnnualFeeRoiDetail?
    @State private var isLoadingRoi: Bool = false
    @State private var roiPeriodMode: String = "current_cycle"
    @State private var showingManualRewardAlert: Bool = false
    @State private var manualRewardInputText: String = ""
    @State private var hasScrolledToRoi: Bool = false

    init(cardId: String, initialSection: String? = nil) {
        self.cardId = cardId
        self.initialSection = initialSection
    }

    private struct LoadedCardDetail {
        let card: CreditCard
        let product: CardProduct?
        let bank: Bank?
        let holder: CardHolder?
        let account: CreditAccount?
        let accountGroup: CreditAccountGroup?
        let siblingCards: [CreditCard]
        let bills: [BillDisplayItem]
        let graceDays: Int

        var bankName: String {
            bank?.shortName ?? bank?.name ?? product?.bankName ?? "银行卡"
        }

        var displayTitle: String {
            card.nameOverride ?? product?.cardName ?? bankName
        }
    }

    var body: some View {
        Group {
            if isLoading && detail == nil {
                ProgressView("加载卡片详情…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let detail {
                detailList(detail)
            } else {
                ContentUnavailableView {
                    Label("卡片不存在或已删除", systemImage: "creditcard.trianglebadge.exclamationmark")
                } description: {
                    Text("请返回账户列表并下拉同步最新数据。")
                }
            }
        }
        .navigationTitle(detail?.displayTitle ?? "卡片详情")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: cardId) {
            await loadDetails()
            await loadRoi()
        }
        .onChange(of: roiPeriodMode) { _, _ in
            Task { await loadRoi() }
        }
        .onChange(of: appState.isSyncing) { _, isSyncing in
            if !isSyncing {
                Task {
                    await loadDetails()
                    await loadRoi()
                }
            }
        }
        .refreshable {
            await appState.sync()
            await loadDetails()
            await loadRoi()
        }
        .sheet(isPresented: $showingDefinitionSheet) {
            if let detail {
                CardDefinitionEditSheet(
                    card: detail.card,
                    product: detail.product,
                    bank: detail.bank,
                    holder: detail.holder
                ) { input in
                    try await appState.updateCard(cardId: cardId, input: input)
                    await loadDetails()
                }
            }
        }
        .sheet(isPresented: $showingRulesSheet) {
            if let detail {
                CardRulesEditSheet(
                    card: detail.card,
                    product: detail.product
                ) { input in
                    try await appState.updateCard(cardId: cardId, input: input)
                    await loadDetails()
                }
            }
        }
        .sheet(isPresented: $showingMergeWizard) {
            AccountMergeWizardSheet(preselectedCardId: cardId) {
                Task { await loadDetails() }
            }
        }
        .sheet(item: $editingCreditAccount) { account in
            CreditAccountEditSheet(account: account) { input in
                _ = try await appState.updateCreditAccount(accountId: account.id, input: input)
                await loadDetails()
            }
        }
        .confirmationDialog(
            "将该卡从合并账户中拆出？",
            isPresented: $showingSplitConfirm,
            titleVisibility: .visible
        ) {
            Button("确认拆出为独立账户", role: .destructive) {
                performSplit()
            }
            Button("取消", role: .cancel) {}
        } message: {
            Text("拆出后，该卡将独立核算账单与额度池；原账户下剩余卡片不受影响。")
        }
        .alert("补录本周期返现 / 积分变现", isPresented: $showingManualRewardAlert) {
            TextField("金额", text: $manualRewardInputText)
                .keyboardType(.decimalPad)
            Button("保存") {
                saveManualReward()
            }
            Button("取消", role: .cancel) {}
        } message: {
            Text("填写未通过优惠活动台账核销的返现或积分兑换价值。")
        }
    }

    @ViewBuilder
    private func detailList(_ d: LoadedCardDetail) -> some View {
        let currency = d.product?.currency ?? d.account?.currency ?? "CNY"
        let effectiveLimit = d.card.effectiveCreditLimit
        let cardUnpaid = d.bills.filter { $0.remainingAmount > 0.01 }.reduce(0.0) { $0 + $1.remainingAmount }
        let displayLimit = (d.accountGroup?.isSharedQuota == true && (d.accountGroup?.creditLimit ?? 0) > 0)
            ? (d.accountGroup?.creditLimit ?? effectiveLimit)
            : effectiveLimit
        let displayUnpaid = d.accountGroup?.unpaidAmount ?? cardUnpaid
        let displayAvailable = displayLimit > 0 ? max(0.0, displayLimit - displayUnpaid) : 0.0

        ScrollViewReader { scrollProxy in
            List {
            if let actionError {
                Section {
                    Text(actionError)
                        .font(.footnote)
                        .foregroundStyle(WCColors.dangerInk)
                }
            }

            // 卡面摘要
            Section {
                cardHeroView(d, currency: currency)
                    .listRowInsets(EdgeInsets(top: 8, leading: 0, bottom: 8, trailing: 0))
                    .listRowBackground(Color.clear)
            }

            // 分离的两个编辑入口
            Section("快捷设置") {
                HStack(spacing: 10) {
                    Button {
                        HapticManager.impactLight()
                        showingDefinitionSheet = true
                    } label: {
                        Label("卡片定义设置", systemImage: "creditcard.and.123")
                            .font(.subheadline.bold())
                            .frame(maxWidth: .infinity, minHeight: 40)
                    }
                    .buttonStyle(.bordered)
                    .accessibilityIdentifier("card.detail.editDefinition")

                    Button {
                        HapticManager.impactLight()
                        showingRulesSheet = true
                    } label: {
                        Label("账户与账单规则", systemImage: "slider.horizontal.3")
                            .font(.subheadline.bold())
                            .frame(maxWidth: .infinity, minHeight: 40)
                    }
                    .buttonStyle(.borderedProminent)
                    .accessibilityIdentifier("card.detail.editRules")
                }
                .listRowInsets(EdgeInsets(top: 6, leading: 12, bottom: 6, trailing: 12))
            }

            // 有效额度与账户池说明
            Section("授信额度") {
                HStack(spacing: 12) {
                    limitMetricCell(
                        title: d.accountGroup?.isSharedQuota == true ? "共享池额度" : "有效额度",
                        value: displayLimit > 0 ? DashboardMoney.format(displayLimit, currency: currency) : "未设置",
                        badge: d.card.creditLimitOverride != nil ? "已覆盖" : nil,
                        color: WCColors.textPrimary
                    )
                    limitMetricCell(
                        title: d.accountGroup?.isMergedStatement == true ? "账户待还" : "待还金额",
                        value: DashboardMoney.format(displayUnpaid, currency: currency),
                        badge: nil,
                        color: displayUnpaid > 0.01 ? WCColors.warningInk : WCColors.textSecondary
                    )
                    limitMetricCell(
                        title: "估算可用",
                        value: displayLimit > 0 ? DashboardMoney.format(displayAvailable, currency: currency) : "—",
                        badge: nil,
                        color: WCColors.successInk
                    )
                }
                .padding(.vertical, 4)

                if d.card.creditLimitOverride != nil {
                    LabeledContent("单卡导入基线额度") {
                        Text(DashboardMoney.format(d.card.creditLimit, currency: currency))
                            .blur(radius: appState.dashboardPrivacy ? 5 : 0)
                            .foregroundStyle(.secondary)
                    }
                }

                if let group = d.accountGroup {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 6) {
                            Text(group.isSharedQuota ? "共享额度池" : "独立额度")
                                .font(.caption2.bold())
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(WCColors.subtle, in: Capsule())
                                .foregroundStyle(WCColors.primaryAccent)
                            Text(group.isMergedStatement ? "合并账单" : "独立账单")
                                .font(.caption2.bold())
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(group.isMergedStatement ? WCColors.warningSoft : WCColors.subtle, in: Capsule())
                                .foregroundStyle(group.isMergedStatement ? WCColors.warningInk : WCColors.textSecondary)
                            Text("同户 \(max(group.cards.count, d.siblingCards.count)) 张卡")
                                .font(.caption2)
                                .foregroundStyle(WCColors.textSecondary)
                        }
                        if group.isSharedQuota {
                            Text("该卡所属账户开启了共享额度池，多张卡共用总授信，概览汇总不会重复叠加。")
                                .font(.caption2)
                                .foregroundStyle(WCColors.textSecondary)
                        }
                    }
                    .padding(.vertical, 2)
                }
            }

            // 规则、年费与周期日期
            Section("规则与卡档") {
                let effectiveBillingDay = d.card.overrideBillingDay ?? d.card.billingDay
                LabeledContent("每月账单日", value: "每月 \(effectiveBillingDay) 日")

                LabeledContent("还款规则") {
                    HStack(spacing: 6) {
                        Text(dueRuleDescription(d.card, product: d.product))
                        if d.card.overrideDueType != nil {
                            Text("已自定义")
                                .font(.caption2.bold())
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(WCColors.subtle, in: Capsule())
                                .foregroundStyle(WCColors.primaryAccent)
                        }
                    }
                }

                LabeledContent("今日刷卡免息") {
                    Text("\(d.graceDays) 天")
                        .bold()
                        .foregroundStyle(WCColors.primaryAccent)
                }

                if appState.displayConfig.showAnnualFee {
                    let fee = d.card.annualFeeOverride ?? d.product?.annualFee
                    LabeledContent("年费参考") {
                        HStack(spacing: 6) {
                            if let fee {
                                Text(fee > 0 ? DashboardMoney.format(fee, currency: currency) : "免年费")
                                    .blur(radius: appState.dashboardPrivacy ? 5 : 0)
                            } else {
                                Text("未设置")
                                    .foregroundStyle(.secondary)
                            }
                            if d.card.annualFeeOverride != nil {
                                Text("已覆盖")
                                    .font(.caption2.bold())
                                    .padding(.horizontal, 6)
                                    .padding(.vertical, 2)
                                    .background(WCColors.subtle, in: Capsule())
                                    .foregroundStyle(WCColors.primaryAccent)
                            }
                        }
                    }
                }

                LabeledContent("发卡日期", value: d.card.issuedOn ?? "未设置")
                LabeledContent("激活日期", value: d.card.activatedOn ?? "未设置")
                LabeledContent("卡片状态") {
                    Text(statusDisplayLabel(d.card.status))
                        .font(.caption.bold())
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(d.card.status == "active" ? WCColors.successSoft : WCColors.dangerSoft, in: Capsule())
                        .foregroundStyle(d.card.status == "active" ? WCColors.successInk : WCColors.dangerInk)
                }
            }

            // 年费周期与免年费进度
            if d.card.cardType != "loan" {
                annualFeeSection(d, currency: currency)
                annualFeeRoiSection(d, currency: currency)
            }

            // 所属信用账户管理
            Section("所属信用账户管理") {
                if let account = d.account {
                    let accountTitle = account.label?.isEmpty == false ? account.label! : "\(d.bankName)信用账户"
                    LabeledContent("账户名称", value: accountTitle)
                    LabeledContent("账户类型", value: "\(account.statementMode == "merged" ? "合并账单" : "独立账单") · \(account.quotaMode == "shared" ? "共享额度" : "独立额度")")
                    if account.primaryCardId == d.card.id {
                        LabeledContent("账户角色", value: "主卡（锚点卡）")
                    } else if d.siblingCards.count > 1 {
                        LabeledContent("账户角色", value: "成员卡")
                    }

                    Button {
                        editingCreditAccount = account
                    } label: {
                        Label("编辑账户名称与模式", systemImage: "building.columns")
                    }
                    .accessibilityIdentifier("card.detail.editAccountPool")
                } else {
                    Text("尚未归属到独立信用账户池")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                Button {
                    showingMergeWizard = true
                } label: {
                    Label("合并同人同银行卡片", systemImage: "arrow.triangle.merge")
                }
                .accessibilityIdentifier("card.detail.mergeWizard")

                if d.account != nil && d.siblingCards.count > 1 {
                    Button(role: .destructive) {
                        showingSplitConfirm = true
                    } label: {
                        HStack {
                            Label("从合并账户中拆出", systemImage: "arrow.triangle.branch")
                            Spacer()
                            if isSplitting {
                                ProgressView()
                            }
                        }
                    }
                    .disabled(isSplitting)
                    .accessibilityIdentifier("card.detail.splitAccount")
                }
            }

            // 本期与历史账单
            Section("本期与历史账单（\(d.bills.count) 期）") {
                if d.bills.isEmpty {
                    Text("该卡片暂无账单记录")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(d.bills) { billItem in
                        NavigationLink(value: BillDetailRoute(item: billItem)) {
                            HStack {
                                VStack(alignment: .leading, spacing: 3) {
                                    HStack(spacing: 6) {
                                        Text(billItem.bill.billMonth)
                                            .font(.subheadline.bold())
                                        Text(billItem.displayStatus)
                                            .font(.caption2.bold())
                                            .padding(.horizontal, 6)
                                            .padding(.vertical, 2)
                                            .background(billStatusBackground(billItem), in: Capsule())
                                            .foregroundStyle(billStatusForeground(billItem))
                                    }
                                    Text("到期 \(billItem.bill.effectiveDueDate) · \(billItem.distanceLabel)")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                Spacer()
                                VStack(alignment: .trailing, spacing: 2) {
                                    Text(DashboardMoney.format(billItem.bill.effectiveAmount, currency: billItem.currency))
                                        .font(.subheadline.bold())
                                        .blur(radius: appState.dashboardPrivacy ? 5 : 0)
                                    if billItem.remainingAmount > 0.01 {
                                        Text("剩 \(DashboardMoney.format(billItem.remainingAmount, currency: billItem.currency))")
                                            .font(.caption2)
                                            .foregroundStyle(billItem.isOverdue ? WCColors.dangerInk : WCColors.warningInk)
                                            .blur(radius: appState.dashboardPrivacy ? 5 : 0)
                                    }
                                }
                            }
                            .padding(.vertical, 2)
                        }
                        .accessibilityIdentifier("card.detail.bill.\(billItem.id)")
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .onAppear {
            scrollToRoiIfNeeded(scrollProxy: scrollProxy)
        }
        .onChange(of: detail != nil) { _, loaded in
            if loaded {
                scrollToRoiIfNeeded(scrollProxy: scrollProxy)
            }
        }
        }
    }

    private func scrollToRoiIfNeeded(scrollProxy: ScrollViewProxy) {
        guard initialSection == "roi", !hasScrolledToRoi else { return }
        hasScrolledToRoi = true
        DispatchQueue.main.async {
            withAnimation {
                scrollProxy.scrollTo("roi-section", anchor: .top)
            }
        }
    }

    private func cardHeroView(_ d: LoadedCardDetail, currency: String) -> some View {
        ZStack(alignment: .topTrailing) {
            RoundedRectangle(cornerRadius: 18)
                .fill(
                    LinearGradient(
                        colors: [
                            Color(red: 0x0A / 255.0, green: 0x1F / 255.0, blue: 0x44 / 255.0),
                            Color(red: 0x18 / 255.0, green: 0x35 / 255.0, blue: 0x6A / 255.0),
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .overlay(
                    Circle()
                        .fill(Color(red: 0.85, green: 0.65, blue: 0.25).opacity(0.22))
                        .frame(width: 140, height: 140)
                        .offset(x: 45, y: -45),
                    alignment: .topTrailing
                )
                .clipShape(RoundedRectangle(cornerRadius: 18))

            VStack(alignment: .leading, spacing: 18) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(d.bankName)
                            .font(.caption)
                            .foregroundStyle(Color.white.opacity(0.75))

                        HStack(spacing: 6) {
                            Text(d.displayTitle)
                                .font(.title3.bold())
                                .foregroundStyle(.white)
                            if d.card.nameOverride != nil {
                                Text("已自定义")
                                    .font(.caption2.bold())
                                    .padding(.horizontal, 6)
                                    .padding(.vertical, 2)
                                    .background(Color.white.opacity(0.2), in: Capsule())
                                    .foregroundStyle(.white)
                            }
                        }
                    }

                    Spacer()

                    Text(currency)
                        .font(.caption.bold())
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(Color.white.opacity(0.16), in: Capsule())
                        .foregroundStyle(.white)
                }

                VStack(alignment: .leading, spacing: 6) {
                    let tail = appState.displayConfig.showCardLast4 ? (d.card.cardNumberLast4 ?? "----") : "••••"
                    Text("••••  ••••  ••••  \(tail.isEmpty ? "----" : tail)")
                        .font(.system(.headline, design: .monospaced))
                        .foregroundStyle(.white)

                    HStack {
                        Text("\(d.holder?.name ?? "未指定持卡人") · \(d.card.cardType == "loan" ? "贷款类" : "信用卡")")
                            .font(.caption)
                            .foregroundStyle(Color.white.opacity(0.85))
                        Spacer()
                        if let issued = d.card.issuedOn, !issued.isEmpty {
                            Text("发卡 \(issued)")
                                .font(.caption2)
                                .foregroundStyle(Color.white.opacity(0.7))
                        }
                    }
                }
            }
            .padding(18)
        }
        .frame(minHeight: 152)
    }

    private func limitMetricCell(title: String, value: String, badge: String?, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 4) {
                Text(title)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                if let badge {
                    Text(badge)
                        .font(.system(size: 9, weight: .semibold))
                        .padding(.horizontal, 4)
                        .padding(.vertical, 1)
                        .background(WCColors.subtle, in: Capsule())
                        .foregroundStyle(WCColors.primaryAccent)
                }
            }
            Text(value)
                .font(.subheadline.bold())
                .foregroundStyle(color)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .blur(radius: appState.dashboardPrivacy ? 5 : 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func dueRuleDescription(_ card: CreditCard, product: CardProduct?) -> String {
        let type = card.overrideDueType ?? product?.paymentDueType ?? .afterBilling
        let value = card.overrideDueValue ?? product?.paymentDueValue ?? 20
        switch type {
        case .afterBilling:
            return "账单日后 \(value) 天"
        case .fixed:
            return "次月固定 \(value) 日"
        case .fixedBeforeBilling:
            return "当月固定 \(value) 日"
        }
    }

    private func statusDisplayLabel(_ status: String) -> String {
        switch status {
        case "frozen": return "已冻结"
        case "cancelled": return "已注销"
        default: return "正常"
        }
    }

    private func billStatusBackground(_ item: BillDisplayItem) -> Color {
        if item.remainingAmount <= 0.01 || item.bill.status == "paid" {
            return WCColors.successSoft
        }
        if item.isOverdue { return WCColors.dangerSoft }
        if item.daysUntilDue <= 3 { return WCColors.warningSoft }
        return WCColors.subtle
    }

    private func billStatusForeground(_ item: BillDisplayItem) -> Color {
        if item.remainingAmount <= 0.01 || item.bill.status == "paid" {
            return WCColors.successInk
        }
        if item.isOverdue { return WCColors.dangerInk }
        if item.daysUntilDue <= 3 { return WCColors.warningInk }
        return WCColors.primaryAccent
    }

    private func loadDetails() async {
        isLoading = true
        defer { isLoading = false }

        do {
            let targetCardId = cardId
            let fetched: (CreditCard, CardProduct?, Bank?, CardHolder?, CreditAccount?, [CreditCard])? =
                try await appState.dbManager.dbWriter.read { db in
                    guard let card = try CreditCard.fetchOne(db, id: targetCardId) else { return nil }
                    let product = try CardProduct.fetchOne(db, id: card.cardProductId)
                    let bank: Bank? = if let bid = product?.bankId {
                        try Bank.fetchOne(db, id: bid)
                    } else {
                        nil
                    }
                    let holder = try CardHolder.fetchOne(db, id: card.holderId)
                    let account: CreditAccount? = if let aid = card.accountId {
                        try CreditAccount.fetchOne(db, id: aid)
                    } else {
                        nil
                    }
                    let siblings: [CreditCard] = if let aid = card.accountId {
                        try CreditCard.fetchAll(db).filter { $0.accountId == aid }
                    } else {
                        []
                    }
                    return (card, product, bank, holder, account, siblings)
                }

            guard let (card, product, bank, holder, account, siblings) = fetched else {
                detail = nil
                return
            }

            let allBills = try await appState.queryService.fetchBills(filter: .all)
            let cardBills = allBills.filter { billItem in
                if billItem.card.id == card.id { return true }
                if let accountId = card.accountId, !accountId.isEmpty {
                    return billItem.bill.accountId == accountId
                }
                return false
            }
            .sorted { $0.bill.billMonth > $1.bill.billMonth }

            let accountGroup = appState.creditAccountGroups.first(where: { $0.account.id == card.accountId })
            let grace = BillingDateCalculator.calculateCardGracePeriod(card: card, cardProduct: product)

            detail = LoadedCardDetail(
                card: card,
                product: product,
                bank: bank,
                holder: holder,
                account: account,
                accountGroup: accountGroup,
                siblingCards: siblings,
                bills: cardBills,
                graceDays: grace.graceDays
            )
        } catch {
            actionError = "加载卡片详情失败：\(error.localizedDescription)"
        }
    }

    private func performSplit() {
        isSplitting = true
        actionError = nil
        Task {
            do {
                _ = try await appState.splitCardFromAccount(cardId: cardId)
                HapticManager.success()
                await loadDetails()
            } catch {
                actionError = error.localizedDescription
                HapticManager.error()
            }
            isSplitting = false
        }
    }

    @ViewBuilder
    private func annualFeeSection(_ d: LoadedCardDetail, currency: String) -> some View {
        let df: DateFormatter = {
            let f = DateFormatter()
            f.locale = Locale(identifier: "en_US_POSIX")
            f.timeZone = BillingDateCalculator.businessCalendar.timeZone
            f.dateFormat = "yyyy-MM-dd"
            return f
        }()
        let todayStr = df.string(from: Date())
        let state = CardRecommendationEngine.resolveAnnualFeeCycleState(card: d.card, product: d.product, todayStr: todayStr)
        let waiverRule = CardRecommendationEngine.parseWaiverRules(d.product?.annualFeeWaiverRulesJson)
        let progress = CardRecommendationEngine.parseWaiverProgress(d.card.waiverProgressJson)

        Section("年费周期与免年费进度") {
            LabeledContent("有效年费") {
                Text(state.nominalFee > 0 ? DashboardMoney.format(state.nominalFee, currency: currency) : "免年费")
                    .bold()
                    .blur(radius: appState.dashboardPrivacy ? 5 : 0)
            }

            LabeledContent("年费周期", value: annualFeeCycleLabel(state.cycleType))

            LabeledContent("下次扣费日") {
                if let due = state.nextDueDate {
                    HStack(spacing: 6) {
                        Text(due)
                        if let days = state.daysUntilDue {
                            Text(days >= 0 ? "剩 \(days) 天" : "已过 \(-days) 天")
                                .font(.caption2.bold())
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(days <= 30 && days >= 0 ? WCColors.dangerSoft : WCColors.subtle, in: Capsule())
                                .foregroundStyle(days <= 30 && days >= 0 ? WCColors.dangerInk : WCColors.textSecondary)
                        }
                    }
                } else {
                    Text("未知")
                        .foregroundStyle(WCColors.warningInk)
                }
            }

            if state.nominalFee > 0 && state.cycleType != "none" && state.nextDueDate == nil {
                Text("年费到期日未知，请点击下方「账户与账单规则」补充发卡日或下次扣费日以开启前 30 天提醒。")
                    .font(.caption)
                    .foregroundStyle(WCColors.warningInk)
            }

            if let waiverRule {
                if let targetAmt = waiverRule.targetAmount, targetAmt > 0 {
                    let currAmt = progress?.amount ?? 0
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text("免年费消费额")
                            Spacer()
                            Text("\(DashboardMoney.format(currAmt, currency: waiverRule.targetCurrency ?? currency)) / \(DashboardMoney.format(targetAmt, currency: waiverRule.targetCurrency ?? currency))")
                                .font(.caption.bold())
                        }
                        ProgressView(value: min(1.0, currAmt / targetAmt))
                    }
                }
                if let targetCnt = waiverRule.targetCount, targetCnt > 0 {
                    let currCnt = progress?.count ?? 0
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text("免年费消费笔数")
                            Spacer()
                            Text("\(currCnt) / \(targetCnt) 笔")
                                .font(.caption.bold())
                        }
                        ProgressView(value: min(1.0, Double(currCnt) / Double(targetCnt)))
                    }
                }
            } else if let text = d.product?.annualFeeWaiver, !text.isEmpty {
                Text("免年费政策：\(text)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            if state.nominalFee > 0 && state.status != "waived" {
                Button("标记本周期已免年费") {
                    Task {
                        do {
                            var input = CardUpdateInput()
                            input.annualFeeStatus = "waived"
                            input.actualFeePaid = 0
                            _ = try await appState.updateCard(cardId: cardId, input: input)
                            await loadDetails()
                            await loadRoi()
                        } catch {
                            actionError = error.localizedDescription
                        }
                    }
                }
                .accessibilityIdentifier("card.annualFee.markWaived")
            }
        }
    }

    @ViewBuilder
    private func annualFeeRoiSection(_ d: LoadedCardDetail, currency: String) -> some View {
        Section("年度年费 ROI 复盘") {
            Picker("统计窗口", selection: $roiPeriodMode) {
                Text("本年费周期").tag("current_cycle")
                Text("近 12 个月").tag("last_12m")
            }
            .pickerStyle(.segmented)
            .id("roi-section")

            if isLoadingRoi && roiDetail == nil {
                ProgressView("加载年费 ROI…")
            } else if let roi = roiDetail {
                HStack {
                    Text(roi.decisionTag.label)
                        .font(.caption.bold())
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(WCColors.subtle, in: Capsule())
                        .foregroundStyle(roi.netValue >= 0 ? WCColors.successInk : WCColors.dangerInk)
                    Spacer()
                    Text(DashboardMoney.format(roi.netValue, currency: roi.cardCurrency))
                        .font(.headline)
                        .foregroundStyle(roi.netValue >= 0 ? WCColors.successInk : WCColors.dangerInk)
                }

                LabeledContent("年费成本", value: DashboardMoney.format(roi.annualFeeCost, currency: roi.cardCurrency))
                LabeledContent("权益估值", value: DashboardMoney.format(roi.redeemedBenefitsValue, currency: roi.cardCurrency))
                LabeledContent("优惠与返现", value: DashboardMoney.format(roi.promoAndRewardValue + roi.manualRewardValue, currency: roi.cardCurrency))
                LabeledContent("统计区间", value: "\(roi.periodStart) ~ \(roi.periodEndExclusive)")
                LabeledContent("净 ROI") {
                    if let roiPct = roi.roiPct {
                        Text(String(format: "%+.1f%%", roiPct))
                    } else {
                        Text(roi.costBasis == "waived" ? "已免年费" : "免年费")
                            .foregroundStyle(.secondary)
                    }
                }

                if roi.unvaluedBenefitCount > 0 {
                    Text("另有 \(roi.unvaluedBenefitCount) 次已核销权益未设估值，可前往 Web 端补填单次估值。")
                        .font(.caption)
                        .foregroundStyle(WCColors.warningInk)
                }
            } else {
                let nominalFee = max(0.0, d.card.annualFeeOverride ?? d.product?.annualFee ?? 0.0)
                let feeCost = d.card.annualFeeStatus == "waived" ? 0.0 : (d.card.actualFeePaid ?? nominalFee)
                let manualVal = d.card.manualRewardValue ?? 0.0
                LabeledContent("本地估算年费成本", value: DashboardMoney.format(feeCost, currency: currency))
                LabeledContent("已补录返现/变现", value: DashboardMoney.format(manualVal, currency: currency))
                Text("联网后可同步完整权益核销估值与优惠返现汇总。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Button("补录本周期返现 / 积分变现") {
                manualRewardInputText = d.card.manualRewardValue.map { String(format: "%.2f", $0) } ?? ""
                showingManualRewardAlert = true
            }

            NavigationLink {
                AnnualFeeRoiListView()
            } label: {
                Label("查看全家年费 ROI 看板", systemImage: "chart.bar.xaxis")
            }
        }
    }

    private func annualFeeCycleLabel(_ raw: String?) -> String {
        switch raw {
        case "none": return "终身免年费"
        case "anniversary_issued": return "发卡周年日"
        case "anniversary_activated": return "激活周年日"
        case "calendar_year": return "固定公历日"
        case "custom_date": return "自定义扣费日"
        default: return "未配置"
        }
    }

    private func loadRoi() async {
        guard appState.isLoggedIn, !UITestConfiguration.isEnabled, !CommandLine.arguments.contains("--demo-mode") else {
            return
        }
        isLoadingRoi = true
        defer { isLoadingRoi = false }
        roiDetail = try? await appState.recommendationsService.getCardAnnualFeeRoi(
            cardId: cardId,
            periodMode: roiPeriodMode
        )
    }

    private func saveManualReward() {
        let trimmed = manualRewardInputText.trimmingCharacters(in: .whitespacesAndNewlines)
        let val = trimmed.isEmpty ? 0.0 : (Double(trimmed) ?? -1.0)
        guard val >= 0 else {
            actionError = "返现/变现金额必须为非负数"
            return
        }
        Task {
            do {
                var input = CardUpdateInput()
                input.manualRewardValue = val
                _ = try await appState.updateCard(cardId: cardId, input: input)
                await loadDetails()
                await loadRoi()
            } catch {
                actionError = error.localizedDescription
            }
        }
    }
}

// MARK: - 弹窗 1：卡片定义设置（名称 / 卡产品 / 尾号 / 持卡人）

private struct CardDefinitionEditSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppState.self) private var appState

    let card: CreditCard
    let product: CardProduct?
    let bank: Bank?
    let holder: CardHolder?
    let onSave: (CardUpdateInput) async throws -> Void

    @State private var selectedBankId: String
    @State private var selectedProductId: String
    @State private var cardName: String
    @State private var cardNumberLast4: String
    @State private var selectedHolderId: String
    @State private var banks: [Bank] = []
    @State private var products: [CardProduct] = []
    @State private var isSubmitting: Bool = false
    @State private var errorMessage: String?

    init(
        card: CreditCard,
        product: CardProduct?,
        bank: Bank?,
        holder: CardHolder?,
        onSave: @escaping (CardUpdateInput) async throws -> Void
    ) {
        self.card = card
        self.product = product
        self.bank = bank
        self.holder = holder
        self.onSave = onSave

        _selectedBankId = State(initialValue: bank?.id ?? product?.bankId ?? "")
        _selectedProductId = State(initialValue: card.cardProductId)
        _cardName = State(initialValue: card.nameOverride ?? product?.cardName ?? "")
        _cardNumberLast4 = State(initialValue: card.cardNumberLast4 ?? "")
        _selectedHolderId = State(initialValue: card.holderId)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("卡种与名称") {
                    Picker("所属银行", selection: $selectedBankId) {
                        if selectedBankId.isEmpty {
                            Text("请选择银行").tag("")
                        }
                        ForEach(banks) { b in
                            Text(b.shortName ?? b.name).tag(b.id)
                        }
                    }

                    HStack {
                        Text("卡片名称")
                        Spacer()
                        TextField("输入卡片名称", text: $cardName)
                            .multilineTextAlignment(.trailing)
                            .accessibilityIdentifier("card.def.name")
                    }

                    if !products.isEmpty {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 6) {
                                ForEach(products) { prod in
                                    Button {
                                        selectedProductId = prod.id
                                        cardName = prod.cardName
                                    } label: {
                                        Text(prod.cardName)
                                            .font(.caption2)
                                            .padding(.horizontal, 8)
                                            .padding(.vertical, 4)
                                            .background(
                                                selectedProductId == prod.id
                                                    ? WCColors.primaryAccent.opacity(0.15)
                                                    : Color.secondary.opacity(0.12),
                                                in: Capsule()
                                            )
                                            .foregroundStyle(
                                                selectedProductId == prod.id
                                                    ? WCColors.primaryAccent
                                                    : WCColors.textPrimary
                                            )
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                        }
                    }
                }

                Section("卡号与持卡人") {
                    HStack {
                        Text("卡号后 4 位")
                        Spacer()
                        TextField("例如 8888", text: $cardNumberLast4)
                            .keyboardType(.asciiCapable)
                            .multilineTextAlignment(.trailing)
                            .accessibilityIdentifier("card.def.last4")
                    }

                    Picker("持卡人", selection: $selectedHolderId) {
                        ForEach(appState.dashboardHolders) { h in
                            Text(h.name).tag(h.id)
                        }
                    }
                    .accessibilityIdentifier("card.def.holder")
                }

                if let errorMessage {
                    Section {
                        Text(errorMessage)
                            .font(.footnote)
                            .foregroundStyle(WCColors.dangerInk)
                    }
                }
            }
            .navigationTitle("卡片定义设置")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                        .disabled(isSubmitting)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(action: save) {
                        if isSubmitting { ProgressView() } else { Text("保存").bold() }
                    }
                    .disabled(isSubmitting)
                    .accessibilityIdentifier("card.def.save")
                }
            }
            .task {
                banks = await appState.allBanks()
                if !selectedBankId.isEmpty {
                    products = await appState.cardProducts(for: selectedBankId)
                }
            }
            .onChange(of: selectedBankId) { _, newBankId in
                Task {
                    guard !newBankId.isEmpty else {
                        products = []
                        return
                    }
                    products = await appState.cardProducts(for: newBankId)
                    if let first = products.first, !products.contains(where: { $0.id == selectedProductId }) {
                        selectedProductId = first.id
                    }
                }
            }
        }
    }

    private func save() {
        let trimmedName = cardName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedName.isEmpty else {
            errorMessage = "请输入卡片名称"
            return
        }
        guard !selectedHolderId.isEmpty else {
            errorMessage = "请选择持卡人"
            return
        }
        let trimmedLast4 = cardNumberLast4.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedLast4.isEmpty && trimmedLast4.count > 4 {
            errorMessage = "卡号尾号最多 4 位"
            return
        }

        var input = CardUpdateInput()
        if !selectedProductId.isEmpty {
            input.cardProductId = selectedProductId
        }
        let selectedProdName = products.first(where: { $0.id == selectedProductId })?.cardName
        input.nameOverride = (trimmedName == selectedProdName) ? "" : trimmedName
        input.cardNumberLast4 = trimmedLast4
        input.holderId = selectedHolderId

        let finalInput = input
        isSubmitting = true
        errorMessage = nil

        Task {
            do {
                try await onSave(finalInput)
                HapticManager.success()
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
                HapticManager.error()
                isSubmitting = false
            }
        }
    }
}

// MARK: - 弹窗 2：账户与账单规则（额度 / 覆盖额度 / 年费覆盖 / 账单日 / 还款规则 / 发卡激活日 / 状态）

private struct CardRulesEditSheet: View {
    @Environment(\.dismiss) private var dismiss

    let card: CreditCard
    let product: CardProduct?
    let onSave: (CardUpdateInput) async throws -> Void

    @State private var creditLimitText: String
    @State private var hasLimitOverride: Bool
    @State private var limitOverrideText: String
    @State private var hasAnnualFeeOverride: Bool
    @State private var annualFeeOverrideText: String
    @State private var billingDayText: String
    @State private var hasCustomDueRule: Bool
    @State private var dueType: PaymentDueType
    @State private var dueValueText: String
    @State private var hasIssuedOn: Bool
    @State private var issuedDate: Date
    @State private var hasActivatedOn: Bool
    @State private var activatedDate: Date
    @State private var annualFeeCycleType: String
    @State private var hasNextAnnualFeeDate: Bool
    @State private var nextAnnualFeeDate: Date
    @State private var annualFeeStatus: String
    @State private var status: String
    @State private var isSubmitting: Bool = false
    @State private var errorMessage: String?

    private static let dateFormatter: DateFormatter = {
        let df = DateFormatter()
        df.locale = Locale(identifier: "en_US_POSIX")
        df.dateFormat = "yyyy-MM-dd"
        df.timeZone = TimeZone(identifier: "Asia/Shanghai") ?? .current
        return df
    }()

    init(
        card: CreditCard,
        product: CardProduct?,
        onSave: @escaping (CardUpdateInput) async throws -> Void
    ) {
        self.card = card
        self.product = product
        self.onSave = onSave

        _creditLimitText = State(initialValue: String(format: "%.0f", card.creditLimit))
        _hasLimitOverride = State(initialValue: card.creditLimitOverride != nil)
        _limitOverrideText = State(initialValue: card.creditLimitOverride.map { String(format: "%.0f", $0) } ?? "")
        _hasAnnualFeeOverride = State(initialValue: card.annualFeeOverride != nil)
        _annualFeeOverrideText = State(initialValue: card.annualFeeOverride.map { String(format: "%.0f", $0) } ?? "")
        _billingDayText = State(initialValue: "\(card.overrideBillingDay ?? card.billingDay)")
        _hasCustomDueRule = State(initialValue: card.overrideDueType != nil)
        _dueType = State(initialValue: card.overrideDueType ?? product?.paymentDueType ?? .afterBilling)
        _dueValueText = State(initialValue: "\(card.overrideDueValue ?? product?.paymentDueValue ?? 20)")

        let parsedIssued = card.issuedOn.flatMap { Self.dateFormatter.date(from: $0) }
        _hasIssuedOn = State(initialValue: parsedIssued != nil)
        _issuedDate = State(initialValue: parsedIssued ?? Date())

        let parsedActivated = card.activatedOn.flatMap { Self.dateFormatter.date(from: $0) }
        _hasActivatedOn = State(initialValue: parsedActivated != nil)
        _activatedDate = State(initialValue: parsedActivated ?? Date())

        _annualFeeCycleType = State(initialValue: card.annualFeeCycleType ?? "")
        let parsedNextFee = card.nextAnnualFeeDate.flatMap { Self.dateFormatter.date(from: $0) }
        _hasNextAnnualFeeDate = State(initialValue: parsedNextFee != nil)
        _nextAnnualFeeDate = State(initialValue: parsedNextFee ?? Date())
        _annualFeeStatus = State(initialValue: card.annualFeeStatus ?? "")

        _status = State(initialValue: card.status)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("授信额度与年费") {
                    let symbol = DashboardMoney.currencySymbol(product?.currency ?? "CNY")
                    HStack {
                        Text("基础额度 (\(symbol))")
                        Spacer()
                        TextField("0", text: $creditLimitText)
                            .keyboardType(.decimalPad)
                            .multilineTextAlignment(.trailing)
                            .accessibilityIdentifier("card.rules.limit")
                    }

                    Toggle("手动覆盖有效额度", isOn: $hasLimitOverride)
                    if hasLimitOverride {
                        HStack {
                            Text("覆盖额度 (\(symbol))")
                            Spacer()
                            TextField("输入大于 0 的覆盖额度", text: $limitOverrideText)
                                .keyboardType(.decimalPad)
                                .multilineTextAlignment(.trailing)
                                .accessibilityIdentifier("card.rules.limitOverride")
                        }
                    }

                    Toggle("自定义年费覆盖", isOn: $hasAnnualFeeOverride)
                    if hasAnnualFeeOverride {
                        HStack {
                            Text("年费金额 (\(symbol))")
                            Spacer()
                            TextField("0 表示免年费", text: $annualFeeOverrideText)
                                .keyboardType(.decimalPad)
                                .multilineTextAlignment(.trailing)
                                .accessibilityIdentifier("card.rules.annualFeeOverride")
                        }
                    }
                }

                Section("账单日与还款规则") {
                    HStack {
                        Text("每月账单日")
                        Spacer()
                        TextField("1-31", text: $billingDayText)
                            .keyboardType(.numberPad)
                            .multilineTextAlignment(.trailing)
                            .accessibilityIdentifier("card.rules.billingDay")
                        Text("日").foregroundStyle(.secondary)
                    }

                    Toggle("自定义还款规则", isOn: $hasCustomDueRule)
                    if hasCustomDueRule {
                        Picker("还款计算方式", selection: $dueType) {
                            Text("账单日后 X 天").tag(PaymentDueType.afterBilling)
                            Text("次月固定 X 日").tag(PaymentDueType.fixed)
                            Text("当月固定 X 日").tag(PaymentDueType.fixedBeforeBilling)
                        }

                        HStack {
                            Text(dueType == .afterBilling ? "间隔天数" : "每月日期")
                            Spacer()
                            TextField("数值", text: $dueValueText)
                                .keyboardType(.numberPad)
                                .multilineTextAlignment(.trailing)
                            Text(dueType == .afterBilling ? "天" : "日")
                                .foregroundStyle(.secondary)
                        }
                    }
                }

                Section("卡生命周期与状态") {
                    Toggle("记录发卡日期", isOn: $hasIssuedOn)
                    if hasIssuedOn {
                        DatePicker("发卡日期", selection: $issuedDate, displayedComponents: .date)
                    }

                    Toggle("记录激活日期", isOn: $hasActivatedOn)
                    if hasActivatedOn {
                        DatePicker("激活日期", selection: $activatedDate, displayedComponents: .date)
                    }

                    Picker("年费周期类型", selection: $annualFeeCycleType) {
                        Text("沿用卡产品默认").tag("")
                        Text("终身免年费").tag("none")
                        Text("发卡周年日").tag("anniversary_issued")
                        Text("激活周年日").tag("anniversary_activated")
                        Text("固定公历日").tag("calendar_year")
                        Text("手动指定扣费日").tag("custom_date")
                    }

                    Toggle("指定下次年费扣费日", isOn: $hasNextAnnualFeeDate)
                    if hasNextAnnualFeeDate {
                        DatePicker("下次年费扣费日", selection: $nextAnnualFeeDate, displayedComponents: .date)
                    }

                    Picker("本周期年费状态", selection: $annualFeeStatus) {
                        Text("自动推导").tag("")
                        Text("无年费").tag("not_applicable")
                        Text("考核累积中").tag("in_progress")
                        Text("已免除 / 已达标").tag("waived")
                        Text("已扣年费").tag("paid")
                    }

                    Picker("卡片状态", selection: $status) {
                        Text("正常").tag("active")
                        Text("已冻结").tag("frozen")
                        Text("已注销").tag("cancelled")
                    }
                    .accessibilityIdentifier("card.rules.status")
                }

                if let errorMessage {
                    Section {
                        Text(errorMessage)
                            .font(.footnote)
                            .foregroundStyle(WCColors.dangerInk)
                    }
                }
            }
            .navigationTitle("账户与账单规则")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                        .disabled(isSubmitting)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(action: save) {
                        if isSubmitting { ProgressView() } else { Text("保存").bold() }
                    }
                    .disabled(isSubmitting)
                    .accessibilityIdentifier("card.rules.save")
                }
            }
        }
    }

    private func save() {
        guard let limit = Double(creditLimitText), limit >= 0 else {
            errorMessage = "请输入有效的基础信用额度"
            return
        }
        guard let day = Int(billingDayText), (1...31).contains(day) else {
            errorMessage = "每月账单日必须在 1 到 31 之间"
            return
        }

        var input = CardUpdateInput()
        input.creditLimit = limit
        input.billingDay = day
        input.status = status

        if hasLimitOverride {
            guard let ovLimit = Double(limitOverrideText), ovLimit > 0 else {
                errorMessage = "请输入大于 0 的覆盖额度"
                return
            }
            input.creditLimitOverride = ovLimit
        } else if card.creditLimitOverride != nil {
            input.clearCreditLimitOverride = true
        }

        if hasAnnualFeeOverride {
            guard let fee = Double(annualFeeOverrideText), fee >= 0 else {
                errorMessage = "请输入有效的年费金额（非负数）"
                return
            }
            input.annualFeeOverride = fee
        } else if card.annualFeeOverride != nil {
            input.clearAnnualFeeOverride = true
        }

        if hasCustomDueRule {
            guard let val = Int(dueValueText), val > 0 else {
                errorMessage = "请输入有效的还款天数或日期"
                return
            }
            input.overrideDueType = dueType
            input.overrideDueValue = val
        } else {
            input.clearDueOverride = true
        }

        if hasIssuedOn {
            input.issuedOn = Self.dateFormatter.string(from: issuedDate)
        } else if card.issuedOn != nil {
            input.clearIssuedOn = true
        }

        if hasActivatedOn {
            input.activatedOn = Self.dateFormatter.string(from: activatedDate)
        } else if card.activatedOn != nil {
            input.clearActivatedOn = true
        }

        if !annualFeeCycleType.isEmpty {
            input.annualFeeCycleType = annualFeeCycleType
        } else if card.annualFeeCycleType != nil {
            input.clearAnnualFeeCycleType = true
        }

        if hasNextAnnualFeeDate {
            input.nextAnnualFeeDate = Self.dateFormatter.string(from: nextAnnualFeeDate)
        } else if card.nextAnnualFeeDate != nil {
            input.clearNextAnnualFeeDate = true
        }

        if !annualFeeStatus.isEmpty {
            input.annualFeeStatus = annualFeeStatus
        } else if card.annualFeeStatus != nil {
            input.clearAnnualFeeStatus = true
        }

        let finalInput = input
        isSubmitting = true
        errorMessage = nil

        Task {
            do {
                try await onSave(finalInput)
                HapticManager.success()
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
                HapticManager.error()
                isSubmitting = false
            }
        }
    }
}

// MARK: - 弹窗 3：信用账户池属性编辑

struct CreditAccountEditSheet: View {
    @Environment(\.dismiss) private var dismiss

    let account: CreditAccount
    let onSave: (ApiClient.UpdateCreditAccountInput) async throws -> Void

    @State private var label: String
    @State private var sharedLimitText: String
    @State private var billingDayText: String
    @State private var statementMode: String
    @State private var quotaMode: String
    @State private var isSubmitting: Bool = false
    @State private var errorMessage: String?

    init(
        account: CreditAccount,
        onSave: @escaping (ApiClient.UpdateCreditAccountInput) async throws -> Void
    ) {
        self.account = account
        self.onSave = onSave
        _label = State(initialValue: account.label ?? "")
        _sharedLimitText = State(initialValue: account.sharedCreditLimit.map { String(format: "%.0f", $0) } ?? "")
        _billingDayText = State(initialValue: account.billingDay.map { "\($0)" } ?? "")
        _statementMode = State(initialValue: account.statementMode)
        _quotaMode = State(initialValue: account.quotaMode)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("账户名称与模式") {
                    HStack {
                        Text("账户别名")
                        Spacer()
                        TextField("如 招行共享账户", text: $label)
                            .multilineTextAlignment(.trailing)
                    }

                    Picker("出账模式", selection: $statementMode) {
                        Text("独立账单").tag("independent")
                        Text("合并账单").tag("merged")
                    }

                    Picker("额度模式", selection: $quotaMode) {
                        Text("独立额度").tag("independent")
                        Text("共享额度池").tag("shared")
                    }
                }

                Section("共享额度与账单日") {
                    HStack {
                        let sym = DashboardMoney.currencySymbol(account.currency)
                        Text("共享额度 (\(sym))")
                        Spacer()
                        TextField("留空按卡面推断", text: $sharedLimitText)
                            .keyboardType(.decimalPad)
                            .multilineTextAlignment(.trailing)
                    }

                    HStack {
                        Text("统一账单日")
                        Spacer()
                        TextField("1-31（选填）", text: $billingDayText)
                            .keyboardType(.numberPad)
                            .multilineTextAlignment(.trailing)
                    }
                }

                if let errorMessage {
                    Section {
                        Text(errorMessage)
                            .font(.footnote)
                            .foregroundStyle(WCColors.dangerInk)
                    }
                }
            }
            .navigationTitle("编辑信用账户")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                        .disabled(isSubmitting)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(action: save) {
                        if isSubmitting { ProgressView() } else { Text("保存").bold() }
                    }
                    .disabled(isSubmitting)
                }
            }
        }
    }

    private func save() {
        var input = ApiClient.UpdateCreditAccountInput()
        let trimmedLabel = label.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmedLabel.isEmpty {
            if account.label != nil { input.clearLabel = true }
        } else {
            input.label = trimmedLabel
        }

        let trimmedLimit = sharedLimitText.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmedLimit.isEmpty {
            if account.sharedCreditLimit != nil { input.clearSharedCreditLimit = true }
        } else if let val = Double(trimmedLimit), val >= 0 {
            input.sharedCreditLimit = val
        } else {
            errorMessage = "请输入有效的共享信用额度"
            return
        }

        let trimmedDay = billingDayText.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmedDay.isEmpty {
            if account.billingDay != nil { input.clearBillingDay = true }
        } else {
            guard let day = Int(trimmedDay), (1...31).contains(day) else {
                errorMessage = "账单日必须在 1 到 31 之间"
                return
            }
            input.billingDay = day
        }

        input.statementMode = statementMode
        input.quotaMode = quotaMode

        let finalInput = input
        isSubmitting = true
        errorMessage = nil

        Task {
            do {
                try await onSave(finalInput)
                HapticManager.success()
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
                HapticManager.error()
                isSubmitting = false
            }
        }
    }
}
