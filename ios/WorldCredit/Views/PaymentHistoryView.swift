import SwiftUI
import WorldCreditCore

struct PaymentHistoryView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss

    let item: BillDisplayItem
    var onOpenRecordPayment: (() -> Void)? = nil

    @State private var payments: [Payment] = []
    @State private var isLoading: Bool = true
    @State private var showingRecordPaymentSheet: Bool = false

    private var billCurrency: String { item.currency }

    private func money(_ amount: Double) -> String {
        DashboardMoney.format(amount, currency: billCurrency)
    }

    /// Calculated running balance for each payment entry
    struct HistoryEntry: Identifiable {
        let payment: Payment
        let balanceAfter: Double
        var id: String { payment.id }
    }

    private var historyEntries: [HistoryEntry] {
        let sortedChronological = payments.sorted { $0.paidAt < $1.paidAt }
        var runningRemaining = item.bill.effectiveAmount
        var resultChronological: [HistoryEntry] = []
        for p in sortedChronological {
            runningRemaining = max(0, runningRemaining - p.amount)
            resultChronological.append(HistoryEntry(payment: p, balanceAfter: runningRemaining))
        }
        return resultChronological.reversed()
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    statementSummaryCard
                    historyHeading
                    entriesList
                    semanticsNote
                }
                .padding(.horizontal, 16)
                .padding(.top, 12)
                .padding(.bottom, 24)
            }
            .background(WCColors.canvas.ignoresSafeArea())
            .navigationTitle("还款记录")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("关闭") {
                        dismiss()
                    }
                    .foregroundStyle(WCColors.primaryAccent)
                }
            }
            .safeAreaInset(edge: .bottom) {
                footerView
            }
            .task {
                await loadPayments()
            }
            .sheet(isPresented: $showingRecordPaymentSheet) {
                RecordPaymentView(item: item) { amount, date, channel, note in
                    try await appState.recordPayment(
                        billId: item.bill.id,
                        amount: amount,
                        paidAt: date,
                        channel: channel,
                        note: note
                    )
                    await loadPayments()
                    await appState.reloadData()
                }
            }
        }
    }

    private func loadPayments() async {
        isLoading = true
        let summary = try? await appState.paymentService.getPaymentSummary(billId: item.bill.id)
        payments = summary?.payments ?? []
        isLoading = false
    }

    // MARK: - Statement Summary Card
    private var statementSummaryCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 6) {
                        Text(item.bankName)
                            .font(.headline.bold())
                            .foregroundStyle(WCColors.textPrimary)
                        Text(item.holderName)
                            .font(.subheadline)
                            .foregroundStyle(WCColors.textSecondary)
                    }
                    Text("\(item.cardTitle) · \(item.bill.billMonth)期账单")
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(WCColors.textSecondary)
                }
                Spacer()
                statusBadge
            }

            Text("\(item.bill.dueDate) 到期")
                .font(.caption)
                .foregroundStyle(item.isOverdue ? WCColors.dangerInk : WCColors.textSecondary)

            Divider()
                .background(WCColors.border)

            HStack(spacing: 0) {
                summaryColumn(label: "原始账单", value: money(item.bill.effectiveAmount), color: WCColors.textPrimary)
                Spacer()
                summaryColumn(label: "累计已还", value: money(item.totalPaid), color: WCColors.successInk)
                Spacer()
                summaryColumn(
                    label: "剩余应还",
                    value: money(item.remainingAmount),
                    color: item.isOverdue ? WCColors.dangerInk : (item.remainingAmount <= 0.01 ? WCColors.successInk : WCColors.textPrimary)
                )
            }
        }
        .padding(16)
        .background(WCColors.surface, in: RoundedRectangle(cornerRadius: 14))
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .stroke(WCColors.border, lineWidth: 1)
        )
    }

    private func summaryColumn(label: String, value: String, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.caption2)
                .foregroundStyle(WCColors.textSecondary)
            Text(value)
                .font(.subheadline.bold())
                .foregroundStyle(color)
        }
    }

    private var statusBadge: some View {
        HStack(spacing: 4) {
            if item.remainingAmount <= 0.01 {
                Image(systemName: "checkmark.circle.fill")
                    .font(.caption2)
                Text("已结清")
                    .font(.caption.bold())
            } else if item.isOverdue {
                Image(systemName: "exclamationmark.circle.fill")
                    .font(.caption2)
                Text(item.totalPaid > 0 ? "逾期 · 部分还款" : "逾期")
                    .font(.caption.bold())
            } else if item.daysUntilDue <= 3 {
                Image(systemName: "clock.fill")
                    .font(.caption2)
                Text(item.totalPaid > 0 ? "临期 · 部分还款" : "临期")
                    .font(.caption.bold())
            } else {
                Text(item.totalPaid > 0 ? "部分还款" : "待还")
                    .font(.caption.bold())
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

    // MARK: - History Heading
    private var historyHeading: some View {
        HStack {
            Text("已登记 \(payments.count) 笔")
                .font(.subheadline.bold())
                .foregroundStyle(WCColors.textPrimary)
            Spacer()
            Text("按还款日期倒序")
                .font(.caption)
                .foregroundStyle(WCColors.textSecondary)
        }
        .padding(.horizontal, 4)
    }

    // MARK: - Entries List
    @ViewBuilder
    private var entriesList: some View {
        if isLoading {
            ProgressView()
                .frame(maxWidth: .infinity)
                .padding(.vertical, 24)
        } else if historyEntries.isEmpty {
            VStack(spacing: 8) {
                Image(systemName: "tray")
                    .font(.largeTitle)
                    .foregroundStyle(WCColors.textSecondary)
                Text("暂无还款记录")
                    .font(.subheadline)
                    .foregroundStyle(WCColors.textSecondary)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 36)
            .background(WCColors.surface, in: RoundedRectangle(cornerRadius: 12))
        } else {
            VStack(spacing: 10) {
                ForEach(historyEntries) { entry in
                    entryCard(entry)
                }
            }
        }
    }

    private func entryCard(_ entry: HistoryEntry) -> some View {
        let p = entry.payment
        return VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(formatDate(p.paidAt))
                    .font(.subheadline.bold())
                    .foregroundStyle(WCColors.textPrimary)
                Spacer()
                Text(money(p.amount))
                    .font(.headline.bold())
                    .foregroundStyle(WCColors.successInk)
            }

            HStack(spacing: 8) {
                Image(systemName: channelIcon(p.channel))
                    .font(.caption)
                    .foregroundStyle(WCColors.textSecondary)
                Text(p.channel ?? "手动还款")
                    .font(.caption)
                    .foregroundStyle(WCColors.textSecondary)
                Text("已登记")
                    .font(.caption2)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 1)
                    .background(WCColors.subtle, in: Capsule())
                    .foregroundStyle(WCColors.textSecondary)
            }

            if let note = p.note, !note.isEmpty {
                Text(note)
                    .font(.caption)
                    .foregroundStyle(WCColors.textSecondary)
            }

            Divider()
                .background(WCColors.border)

            Text("登记后剩余待还 \(money(entry.balanceAfter))")
                .font(.caption2)
                .foregroundStyle(WCColors.textSecondary)
        }
        .padding(14)
        .background(WCColors.surface, in: RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(WCColors.border, lineWidth: 1)
        )
    }

    private func channelIcon(_ channel: String?) -> String {
        switch channel {
        case "微信支付": return "bubble.left.and.bubble.right.fill"
        case "支付宝": return "dollarsign.circle.fill"
        case "手机银行": return "building.columns.fill"
        case "云闪付": return "creditcard.fill"
        case "自动扣款": return "arrow.triangle.2.circlepath"
        default: return "hand.tap.fill"
        }
    }

    private func formatDate(_ dateStr: String) -> String {
        // e.g. "2026-10-28" -> "10月28日"
        let parts = dateStr.split(separator: "-")
        if parts.count == 3, let month = Int(parts[1]), let day = Int(parts[2]) {
            return "\(month)月\(day)日"
        }
        return dateStr
    }

    private var semanticsNote: some View {
        Text("此处显示已登记记录，银行实际入账以银行为准。")
            .font(.caption2)
            .foregroundStyle(WCColors.textSecondary)
            .frame(maxWidth: .infinity, alignment: .center)
            .padding(.top, 4)
    }

    // MARK: - Footer
    private var footerView: some View {
        VStack(spacing: 10) {
            Divider()
                .background(WCColors.border)

            if item.remainingAmount > 0.01 {
                HStack {
                    Text("仍需还款 \(money(item.remainingAmount))")
                        .font(.subheadline.bold())
                        .foregroundStyle(item.isOverdue ? WCColors.dangerInk : WCColors.textPrimary)
                    Spacer()
                    Button(action: {
                        if let onOpenRecordPayment {
                            dismiss()
                            onOpenRecordPayment()
                        } else {
                            showingRecordPaymentSheet = true
                        }
                    }) {
                        Text("继续登记还款")
                            .font(.subheadline.bold())
                            .foregroundStyle(Color.white)
                            .padding(.horizontal, 20)
                            .padding(.vertical, 10)
                            .background(WCColors.primaryAccent, in: RoundedRectangle(cornerRadius: 8))
                    }
                    .accessibilityIdentifier("payment.history.continue")
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 6)
            } else {
                HStack {
                    Image(systemName: "checkmark.seal.fill")
                        .foregroundStyle(WCColors.successInk)
                    Text("本期已全额结清")
                        .font(.subheadline.bold())
                        .foregroundStyle(WCColors.successInk)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
            }
        }
        .background(WCColors.surface)
    }
}
