import SwiftUI
import WorldCreditCore

struct BillDetailRoute: Hashable {
    let item: BillDisplayItem

    static func == (lhs: Self, rhs: Self) -> Bool { lhs.item.id == rhs.item.id }
    func hash(into hasher: inout Hasher) { hasher.combine(item.id) }
}

struct BillDetailView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @State private var item: BillDisplayItem
    @State private var showingPaymentSheet: Bool = false
    @State private var showingPaymentHistorySheet: Bool = false
    @State private var showingAmountOverrideSheet: Bool = false
    @State private var showingBillEditSheet: Bool = false
    @State private var deletedFromEditSheet: Bool = false
    @State private var showingCardEditSheet: Bool = false
    @State private var editingPayment: Payment?
    @State private var deletingPayment: Payment?
    @State private var paymentActionError: String?
    @State private var payments: [Payment] = []
    @State private var subtotals: [BillCardSubtotal] = []
    @State private var hapticSuccessTrigger: Int = 0

    init(item: BillDisplayItem) {
        _item = State(initialValue: item)
    }

    private var matchedCard: CardDisplayItem? {
        appState.cards.first(where: { $0.id == item.card.id })
    }

    private var fallbackCard: CardDisplayItem {
        CardDisplayItem(
            card: item.card,
            product: item.product,
            bank: item.bank,
            holder: item.holder,
            latestBill: item.bill,
            remainingAmount: item.remainingAmount,
            interestFreeDaysToday: item.interestFreeDaysToday,
            nextDueDate: Date()
        )
    }

    /// 账单以原币结算，不能固定写 ¥。
    private func money(_ amount: Double) -> String {
        DashboardMoney.format(amount, currency: item.currency)
    }

    var body: some View {
        List {
            // 关联卡片与信息修改（对齐 Web 版卡片详情入口）
            Section("关联卡片") {
                Button(action: {
                    showingCardEditSheet = true
                }) {
                    HStack(spacing: 12) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(item.cardTitle)
                                .font(.headline)
                                .foregroundStyle(WCColors.textPrimary)
                            Text(item.bankName)
                                .font(.caption)
                                .foregroundStyle(WCColors.textSecondary)
                        }
                        Spacer()
                        HStack(spacing: 4) {
                            Text("修改卡片信息")
                                .font(.footnote.weight(.medium))
                            Image(systemName: "chevron.right")
                                .font(.caption.bold())
                        }
                        .foregroundStyle(WCColors.primaryAccent)
                    }
                    .padding(.vertical, 2)
                }
                .accessibilityIdentifier("bill.detail.editCard")

                let graceDays = matchedCard?.interestFreeDaysToday ?? item.interestFreeDaysToday
                LabeledContent("今日刷卡免息", value: "\(graceDays) 天")

                NavigationLink {
                    CardDetailView(cardId: item.card.id)
                } label: {
                    LabeledContent("查看卡片详情") {
                        Text(item.last4.isEmpty ? "管理卡面与账单规则" : "尾号 \(item.last4)")
                            .font(.footnote)
                            .foregroundStyle(WCColors.primaryAccent)
                    }
                }
                .accessibilityIdentifier("bill.detail.cardDetail")
            }

            // 账单基本信息与人+卡账户属性
            Section {
                LabeledContent("持卡人", value: item.holderName)
                LabeledContent("卡号尾号", value: item.last4.isEmpty ? "-" : item.last4)
                let limitSymbol = DashboardMoney.currencySymbol(item.currency)
                let limit = matchedCard?.card.effectiveCreditLimit ?? item.card.effectiveCreditLimit
                LabeledContent("信用额度") {
                    Text("\(limitSymbol)\(String(format: "%.0f", limit))")
                        .blur(radius: appState.displayConfig.privacyMode ? 5 : 0)
                }
                let bDay = matchedCard?.card.overrideBillingDay ?? matchedCard?.card.billingDay ?? item.card.overrideBillingDay ?? item.card.billingDay
                LabeledContent("每月账单日", value: "\(bDay) 日")

                if let start = item.bill.effectiveStatementStart,
                   let end = item.bill.effectiveStatementEnd,
                   !start.isEmpty, !end.isEmpty {
                    LabeledContent("账单周期", value: "\(start) ~ \(end)")
                } else {
                    LabeledContent("账单周期", value: item.bill.billMonth)
                }
                if let stmtDate = item.bill.effectiveStatementDate, !stmtDate.isEmpty {
                    LabeledContent("出账日") {
                        HStack(spacing: 6) {
                            Text(stmtDate)
                            if item.bill.statementDateOverride != nil {
                                overridePill
                            }
                        }
                    }
                }
                LabeledContent("还款日") {
                    HStack(spacing: 6) {
                        Text(item.bill.effectiveDueDate)
                        if item.bill.dueDateOverride != nil {
                            overridePill
                        }
                    }
                }
                LabeledContent("距还款日", value: item.distanceLabel)

                if hasActiveOverrides {
                    Label("部分字段已人工覆盖，可在「编辑账单」中恢复导入值", systemImage: "pencil.and.outline")
                        .font(.caption)
                        .foregroundStyle(WCColors.warningInk)
                }
            } header: {
                HStack {
                    Text("账单信息（人+卡）")
                    Spacer()
                    Button("修改") {
                        showingCardEditSheet = true
                    }
                    .font(.footnote)
                    .foregroundStyle(WCColors.primaryAccent)
                    .accessibilityIdentifier("bill.detail.editAccount")
                }
            }

            if !subtotals.isEmpty {
                Section("合并账单分卡小计（\(subtotals.count) 张卡）") {
                    ForEach(subtotals) { sub in
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("尾号 \(sub.cardTail)")
                                    .font(.subheadline.weight(.medium))
                                    .foregroundStyle(WCColors.textPrimary)
                                Text(subtotalSourceLabel(sub.source))
                                    .font(.caption2)
                                    .foregroundStyle(WCColors.textSecondary)
                            }
                            Spacer()
                            Text(DashboardMoney.format(sub.subtotalAmount, currency: sub.currency ?? item.currency))
                                .font(.subheadline.bold())
                                .foregroundStyle(WCColors.textPrimary)
                                .blur(radius: appState.displayConfig.privacyMode ? 5 : 0)
                        }
                    }
                }
            }

            // 金额信息
            Section("金额与状态") {
                if item.bill.billAmountOverride != nil {
                    LabeledContent("应还金额 (已调整)") {
                        Text(money(item.bill.effectiveAmount))
                            .blur(radius: appState.displayConfig.privacyMode ? 5 : 0)
                    }
                    .accessibilityIdentifier("bill.detail.amount")
                    LabeledContent("原始出账金额") {
                        Text(money(item.bill.billAmount))
                            .blur(radius: appState.displayConfig.privacyMode ? 5 : 0)
                    }
                } else {
                    LabeledContent("账单金额") {
                        Text(money(item.bill.effectiveAmount))
                            .blur(radius: appState.displayConfig.privacyMode ? 5 : 0)
                    }
                    .accessibilityIdentifier("bill.detail.amount")
                }

                if let minP = item.bill.effectiveMinPayment, minP > 0 {
                    LabeledContent(item.bill.minPaymentOverride != nil ? "最低还款 (已调整)" : "最低还款") {
                        Text(money(minP))
                            .blur(radius: appState.displayConfig.privacyMode ? 5 : 0)
                    }
                }
                LabeledContent("已还金额") {
                    Text(money(item.totalPaid))
                        .blur(radius: appState.displayConfig.privacyMode ? 5 : 0)
                }
                LabeledContent("剩余应还") {
                    Text(money(item.remainingAmount))
                        .bold()
                        .foregroundStyle(item.isOverdue ? WCColors.dangerInk : (item.remainingAmount <= 0.01 ? WCColors.successInk : WCColors.textPrimary))
                        .blur(radius: appState.displayConfig.privacyMode ? 5 : 0)
                        .accessibilityIdentifier("bill.detail.remaining")
                }
                LabeledContent("状态") {
                    Text(item.displayStatus)
                        .font(.caption.bold())
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(
                            item.remainingAmount <= 0.01 ? WCColors.successSoft :
                            (item.isOverdue ? WCColors.dangerSoft : (item.daysUntilDue <= 3 ? WCColors.warningSoft : WCColors.subtle))
                        )
                        .foregroundStyle(
                            item.remainingAmount <= 0.01 ? WCColors.successInk :
                            (item.isOverdue ? WCColors.dangerInk : (item.daysUntilDue <= 3 ? WCColors.warningInk : WCColors.primaryAccent))
                        )
                        .clipShape(Capsule())
                        .accessibilityIdentifier("bill.detail.status")
                }

                Button("调整账单金额") {
                    showingAmountOverrideSheet = true
                }
                .font(.subheadline)
                .accessibilityIdentifier("bill.detail.adjust")

                Button("编辑账单（金额 / 日期 / 覆盖）") {
                    showingBillEditSheet = true
                }
                .font(.subheadline)
                .accessibilityIdentifier("bill.detail.editBill")
            }

            // 还款记录
            Section {
                if let paymentActionError {
                    Text(paymentActionError)
                        .font(.caption)
                        .foregroundStyle(WCColors.dangerInk)
                }

                if payments.isEmpty {
                    Text("暂无还款记录")
                        .foregroundStyle(.secondary)
                } else {
                    Button(action: {
                        showingPaymentHistorySheet = true
                    }) {
                        HStack {
                            Text("查看完整还款记录（\(payments.count) 笔）")
                                .font(.subheadline.bold())
                                .foregroundStyle(WCColors.primaryAccent)
                            Spacer()
                            Image(systemName: "chevron.right")
                                .font(.caption.bold())
                                .foregroundStyle(WCColors.textSecondary)
                        }
                    }
                    .accessibilityIdentifier("bill.detail.viewHistory")

                    ForEach(payments) { p in
                        Button {
                            editingPayment = p
                        } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(money(p.amount))
                                        .font(.headline)
                                        .foregroundStyle(WCColors.textPrimary)
                                        .blur(radius: appState.displayConfig.privacyMode ? 5 : 0)
                                    Text("\(p.paidAt) · \(p.channel ?? "手动还款")")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                Spacer()
                                if let note = p.note, !note.isEmpty {
                                    Text(note)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(1)
                                }
                                Image(systemName: "pencil")
                                    .font(.caption)
                                    .foregroundStyle(WCColors.textSecondary)
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            Button(role: .destructive) {
                                deletingPayment = p
                            } label: {
                                Label("删除", systemImage: "trash")
                            }
                            Button {
                                editingPayment = p
                            } label: {
                                Label("编辑", systemImage: "pencil")
                            }
                            .tint(WCColors.primaryAccent)
                        }
                        .accessibilityIdentifier("bill.detail.payment.\(p.id)")
                    }
                }
            } header: {
                Text("还款记录")
            } footer: {
                if !payments.isEmpty {
                    Text("点击或左滑单笔记录可编辑或删除。")
                }
            }
        }
        .navigationTitle(item.cardTitle)
        .toolbar {
            if item.remainingAmount > 0.01 {
                ToolbarItem(placement: .primaryAction) {
                    Button("登记还款") {
                        showingPaymentSheet = true
                    }
                    .accessibilityIdentifier("bill.detail.pay")
                }
            }
        }
        .sheet(isPresented: $showingPaymentHistorySheet) {
            PaymentHistoryView(item: item) {
                showingPaymentSheet = true
            }
        }
        .sheet(isPresented: $showingPaymentSheet) {
            PaymentSheetView(
                item: item,
                onPay: { amount, date, channel, note in
                    try await appState.recordPayment(
                        billId: item.bill.id,
                        amount: amount,
                        paidAt: date,
                        channel: channel,
                        note: note
                    )
                    await loadDetails()
                },
                onPayWithFx: { amount, date, channel, note, settledCur, settledAmt, lockedRate in
                    try await appState.recordPayment(
                        billId: item.bill.id,
                        amount: amount,
                        paidAt: date,
                        channel: channel,
                        note: note,
                        settledCurrency: settledCur,
                        settledAmount: settledAmt,
                        lockedFxRate: lockedRate
                    )
                    await loadDetails()
                }
            )
        }
        .sheet(isPresented: $showingAmountOverrideSheet) {
            // onSave 只负责业务写入；详情刷新交给 appState.isSyncing 变更后的
            // onChange / .task。若把 await loadDetails() 放进回调，它一慢就会
            // 阻塞弹窗 dismiss()，表现为「提交转圈永不结束」。
            BillAmountOverrideSheetView(item: item) { newAmount in
                try await appState.setBillAmountOverride(billId: item.bill.id, amount: newAmount)
            }
        }
        .sheet(isPresented: $showingBillEditSheet, onDismiss: {
            if deletedFromEditSheet {
                dismiss()
            } else {
                Task { await loadDetails() }
            }
        }) {
            BillEditSheetView(item: item) {
                deletedFromEditSheet = true
            }
        }
        .sheet(item: $editingPayment) { payment in
            PaymentEditSheetView(item: item, payment: payment) {
                await loadDetails()
            }
        }
        .sheet(isPresented: $showingCardEditSheet) {
            CardEditSheetView(card: matchedCard ?? fallbackCard) { input in
                // 回调只做写入：reloadData+loadDetails 交给已有的
                // onChange(of: appState.isSyncing)/.task 路径，避免重载阻塞弹窗 dismiss
                try await appState.updateCard(cardId: item.card.id, input: input)
                Task { await appState.reloadData() }
            }
        }
        .confirmationDialog(
            "确认删除该笔还款？",
            isPresented: Binding(
                get: { deletingPayment != nil },
                set: { if !$0 { deletingPayment = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button("确认删除", role: .destructive) {
                if let payment = deletingPayment {
                    Task { await deletePayment(payment) }
                }
            }
            Button("取消", role: .cancel) { deletingPayment = nil }
        } message: {
            if let payment = deletingPayment {
                Text("将删除 \(money(payment.amount)) 的还款记录，账单状态将按剩余还款自动重算。")
            }
        }
        .sensoryFeedback(.success, trigger: hapticSuccessTrigger)
        .task {
            await loadDetails()
        }
        .onChange(of: appState.isSyncing) { _, isSyncing in
            if !isSyncing {
                Task { await loadDetails() }
            }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                Task { await loadDetails() }
            }
        }
    }

    private var hasActiveOverrides: Bool {
        item.bill.billAmountOverride != nil
            || item.bill.minPaymentOverride != nil
            || item.bill.dueDateOverride != nil
            || item.bill.statementDateOverride != nil
    }

    private var overridePill: some View {
        Text("已手动")
            .font(.caption2.bold())
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(WCColors.warningSoft, in: Capsule())
            .foregroundStyle(WCColors.warningInk)
    }

    private func subtotalSourceLabel(_ source: String) -> String {
        switch source {
        case "email": return "邮件解析"
        case "ai": return "AI 识别"
        case "manual": return "手动录入"
        default: return source
        }
    }

    private func deletePayment(_ payment: Payment) async {
        paymentActionError = nil
        do {
            try await appState.deletePayment(paymentId: payment.id, billId: item.bill.id)
            deletingPayment = nil
            hapticSuccessTrigger += 1
            await loadDetails()
        } catch {
            deletingPayment = nil
            paymentActionError = "删除还款失败：\(error.localizedDescription)"
        }
    }

    private func loadDetails() async {
        do {
            // A paid bill disappears from the unpaid list, but its open detail must stay current.
            if let updated = try await appState.queryService.fetchBills(filter: .all).first(where: { $0.id == item.id }) {
                self.item = updated
            }
            let summary = try await appState.paymentService.getPaymentSummary(billId: item.bill.id)
            self.payments = summary.payments
            self.subtotals = await appState.fetchBillSubtotals(billId: item.bill.id)
        } catch {
            print("Failed to refresh bill details: \(error)")
        }
    }
}
