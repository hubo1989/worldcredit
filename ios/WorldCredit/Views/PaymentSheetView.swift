import SwiftUI
import WorldCreditCore

struct PaymentSheetView: View {
    @Environment(\.dismiss) private var dismiss
    let item: BillDisplayItem
    let onPay: (Double, String, String, String?) async throws -> Void

    @State private var payType: PayType = .full
    @State private var customAmountText: String = ""
    @State private var paidAt: Date = Date()
    @State private var channel: String = "微信支付"
    @State private var note: String = ""
    @State private var isSubmitting: Bool = false
    @State private var errorMessage: String?

    enum PayType: String, CaseIterable, Identifiable {
        case full = "全额还款"
        case min = "最低还款"
        case custom = "自定义"

        var id: String { rawValue }
    }

    private var effectiveAmount: Double {
        switch payType {
        case .full:
            return item.remainingAmount
        case .min:
            let minP = item.bill.minPayment ?? 0.0
            return min(minP > 0 ? minP : item.remainingAmount, item.remainingAmount)
        case .custom:
            return Double(customAmountText) ?? 0.0
        }
    }

    /// 账单以原币结算：固定 ¥ 会把外币账单显示成人民币。
    private var billCurrency: String { item.currency }

    private func money(_ amount: Double) -> String {
        DashboardMoney.format(amount, currency: billCurrency)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("还款账单") {
                    HStack {
                        Text(item.cardTitle)
                            .fontWeight(.medium)
                        Spacer()
                        Text("尾号 \(item.last4)")
                            .foregroundStyle(.secondary)
                    }
                    HStack {
                        Text("剩余应还")
                        Spacer()
                        Text(money(item.remainingAmount))
                            .font(.headline)
                            .foregroundStyle(item.isOverdue ? .red : .primary)
                    }
                }

                Section("还款金额") {
                    Picker("还款方式", selection: $payType) {
                        ForEach(PayType.allCases) { type in
                            Text(type.rawValue).tag(type)
                        }
                    }
                    .pickerStyle(.segmented)
                    .accessibilityIdentifier("payment.type")

                    if payType == .custom {
                        HStack {
                            Text(DashboardMoney.currencySymbol(billCurrency))
                                .font(.title3.bold())
                            TextField("输入金额", text: $customAmountText)
                                .keyboardType(.decimalPad)
                        }
                    } else {
                        HStack {
                            Text("本次还款")
                            Spacer()
                            Text(money(effectiveAmount))
                                .font(.title3.bold())
                                .foregroundStyle(.tint)
                        }
                    }
                }

                Section("还款信息") {
                    DatePicker("还款日期", selection: $paidAt, displayedComponents: .date)

                    Picker("支付渠道", selection: $channel) {
                        Text("微信支付").tag("微信支付")
                        Text("支付宝").tag("支付宝")
                        Text("手机银行").tag("手机银行")
                        Text("云闪付").tag("云闪付")
                        Text("自动扣款").tag("自动扣款")
                        Text("手动还款").tag("手动还款")
                    }

                    TextField("备注（可选）", text: $note)
                }

                if let errorMessage {
                    Section {
                        Text(errorMessage)
                            .foregroundStyle(.red)
                            .font(.footnote)
                    }
                }
            }
            .navigationTitle("登记还款")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(action: submitPayment) {
                        if isSubmitting {
                            ProgressView()
                        } else {
                            Text("确认")
                                .bold()
                        }
                    }
                    .disabled(isSubmitting || effectiveAmount <= 0)
                    .accessibilityIdentifier("payment.confirm")
                }
            }
        }
    }

    private func submitPayment() {
        guard effectiveAmount > 0 else {
            errorMessage = "还款金额必须大于 0"
            return
        }
        guard effectiveAmount <= item.remainingAmount + 0.01 else {
            errorMessage = "还款金额不能超过剩余应还 \(money(item.remainingAmount))"
            return
        }

        let df = DateFormatter()
        df.dateFormat = "yyyy-MM-dd"
        df.timeZone = TimeZone(identifier: "Asia/Shanghai") ?? .current
        let dateStr = df.string(from: paidAt)

        isSubmitting = true
        errorMessage = nil

        Task {
            do {
                try await onPay(
                    effectiveAmount,
                    dateStr,
                    channel,
                    note.isEmpty ? nil : note
                )
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
                isSubmitting = false
            }
        }
    }
}
