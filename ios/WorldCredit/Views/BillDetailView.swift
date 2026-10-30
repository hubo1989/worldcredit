import SwiftUI
import WorldCreditCore

struct BillDetailRoute: Hashable {
    let item: BillDisplayItem

    static func == (lhs: Self, rhs: Self) -> Bool { lhs.item.id == rhs.item.id }
    func hash(into hasher: inout Hasher) { hasher.combine(item.id) }
}

struct BillDetailView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.scenePhase) private var scenePhase
    @State private var item: BillDisplayItem
    @State private var showingPaymentSheet: Bool = false
    @State private var showingPaymentHistorySheet: Bool = false
    @State private var showingAmountOverrideSheet: Bool = false
    @State private var showingCardEditSheet: Bool = false
    @State private var payments: [Payment] = []

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
                            Text("\(item.bankName) · \(item.holderName) · 尾号 \(item.last4.isEmpty ? "-" : item.last4)")
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

                if let card = matchedCard {
                    let billingDay = card.card.overrideBillingDay ?? card.card.billingDay
                    // 多币种卡：额度符号按卡片币种（缺产品信息时回落 CNY），不硬编码人民币
                    let limitSymbol = DashboardMoney.currencySymbol(card.product?.currency ?? "CNY")
                    LabeledContent("信用额度", value: "\(limitSymbol)\(String(format: "%.0f", card.card.creditLimit))")
                    LabeledContent("每月账单日", value: "\(billingDay) 日")
                    LabeledContent("今日刷卡免息", value: "\(card.interestFreeDaysToday) 天")
                }
            }

            // 账单基本信息
            Section("账单信息") {
                LabeledContent("银行/卡片", value: "\(item.bankName) · \(item.cardTitle)")
                LabeledContent("卡号尾号", value: item.last4.isEmpty ? "-" : item.last4)
                LabeledContent("持卡人", value: item.holderName)
                LabeledContent("账单周期", value: item.bill.billMonth)
                if let stmtDate = item.bill.statementDate {
                    LabeledContent("出账日", value: stmtDate)
                }
                LabeledContent("还款日", value: item.bill.dueDate)
                LabeledContent("距还款日", value: item.distanceLabel)
            }

            // 金额信息
            Section("金额与状态") {
                if item.bill.billAmountOverride != nil {
                    LabeledContent("应还金额 (已调整)", value: money(item.bill.effectiveAmount))
                        .accessibilityIdentifier("bill.detail.amount")
                    LabeledContent("原始出账金额", value: money(item.bill.billAmount))
                } else {
                    LabeledContent("账单金额", value: money(item.bill.effectiveAmount))
                        .accessibilityIdentifier("bill.detail.amount")
                }

                if let minP = item.bill.minPayment, minP > 0 {
                    LabeledContent("最低还款", value: money(minP))
                }
                LabeledContent("已还金额", value: money(item.totalPaid))
                LabeledContent("剩余应还") {
                    Text(money(item.remainingAmount))
                        .bold()
                        .foregroundStyle(item.isOverdue ? WCColors.dangerInk : (item.remainingAmount <= 0.01 ? WCColors.successInk : WCColors.textPrimary))
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
            }

            // 还款记录
            Section("还款记录") {
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
                        HStack {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(money(p.amount))
                                    .font(.headline)
                                Text("\(p.paidAt) · \(p.channel ?? "手动还款")")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            if let note = p.note, !note.isEmpty {
                                Text(note)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
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
            PaymentSheetView(item: item) { amount, date, channel, note in
                try await appState.recordPayment(
                    billId: item.bill.id,
                    amount: amount,
                    paidAt: date,
                    channel: channel,
                    note: note
                )
                await loadDetails()
            }
        }
        .sheet(isPresented: $showingAmountOverrideSheet) {
            // onSave 只负责业务写入；详情刷新交给 appState.isSyncing 变更后的
            // onChange / .task。若把 await loadDetails() 放进回调，它一慢就会
            // 阻塞弹窗 dismiss()，表现为「提交转圈永不结束」。
            BillAmountOverrideSheetView(item: item) { newAmount in
                try await appState.setBillAmountOverride(billId: item.bill.id, amount: newAmount)
            }
        }
        .sheet(isPresented: $showingCardEditSheet) {
            CardEditSheetView(card: matchedCard ?? fallbackCard) { input in
                try await appState.updateCard(cardId: item.card.id, input: input)
                await appState.reloadData()
                await loadDetails()
            }
        }
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

    private func loadDetails() async {
        do {
            // A paid bill disappears from the unpaid list, but its open detail must stay current.
            if let updated = try await appState.queryService.fetchBills(filter: .all).first(where: { $0.id == item.id }) {
                self.item = updated
            }
            let summary = try await appState.paymentService.getPaymentSummary(billId: item.bill.id)
            self.payments = summary.payments
        } catch {
            print("Failed to refresh bill details: \(error)")
        }
    }
}
