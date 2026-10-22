import SwiftUI
import WorldCreditCore

struct BillDetailView: View {
    @Environment(AppState.self) private var appState
    let item: BillDisplayItem
    @State private var showingPaymentSheet: Bool = false
    @State private var showingAmountOverrideSheet: Bool = false
    @State private var payments: [Payment] = []

    var body: some View {
        List {
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
                    LabeledContent("应还金额 (已调整)", value: "¥\(String(format: "%.2f", item.bill.effectiveAmount))")
                    LabeledContent("原始出账金额", value: "¥\(String(format: "%.2f", item.bill.billAmount))")
                } else {
                    LabeledContent("账单金额", value: "¥\(String(format: "%.2f", item.bill.effectiveAmount))")
                }

                if let minP = item.bill.minPayment, minP > 0 {
                    LabeledContent("最低还款", value: "¥\(String(format: "%.2f", minP))")
                }
                LabeledContent("已还金额", value: "¥\(String(format: "%.2f", item.totalPaid))")
                LabeledContent("剩余应还") {
                    Text("¥\(String(format: "%.2f", item.remainingAmount))")
                        .bold()
                        .foregroundStyle(item.isOverdue ? .red : (item.remainingAmount <= 0.01 ? .green : .primary))
                }
                LabeledContent("状态") {
                    Text(item.displayStatus)
                        .font(.caption)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(
                            item.remainingAmount <= 0.01 ? Color.green.opacity(0.15) :
                            (item.isOverdue ? Color.red.opacity(0.15) : Color.blue.opacity(0.15))
                        )
                        .foregroundStyle(
                            item.remainingAmount <= 0.01 ? .green :
                            (item.isOverdue ? .red : .blue)
                        )
                        .clipShape(Capsule())
                }

                Button("调整账单金额") {
                    showingAmountOverrideSheet = true
                }
                .font(.subheadline)
            }

            // 还款记录
            Section("还款记录") {
                if payments.isEmpty {
                    Text("暂无还款记录")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(payments) { p in
                        HStack {
                            VStack(alignment: .leading, spacing: 4) {
                                Text("¥\(String(format: "%.2f", p.amount))")
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
                }
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
                await loadPayments()
            }
        }
        .sheet(isPresented: $showingAmountOverrideSheet) {
            BillAmountOverrideSheetView(item: item) { newAmount in
                try await appState.setBillAmountOverride(billId: item.bill.id, amount: newAmount)
            }
        }
        .task {
            await loadPayments()
        }
    }

    private func loadPayments() async {
        do {
            let list = try await appState.paymentService.dbManager.dbWriter.read { db in
                try Payment.filter(Column("bill_id") == item.bill.id)
                    .order(Column("paid_at").desc, Column("created_at").desc)
                    .fetchAll(db)
            }
            self.payments = list
        } catch {
            print("Failed to load payments: \(error)")
        }
    }
}
