import SwiftUI
import WorldCreditCore

struct RecordPaymentView: View {
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

    private var billCurrency: String { item.currency }

    private func money(_ amount: Double) -> String {
        DashboardMoney.format(amount, currency: billCurrency)
    }

    private var effectiveAmount: Double {
        switch payType {
        case .full:
            return item.remainingAmount
        case .min:
            let minP = item.bill.minPayment ?? 0.0
            return min(minP > 0 ? minP : item.remainingAmount, item.remainingAmount)
        case .custom:
            return Double(customAmountText.trimmingCharacters(in: .whitespaces)) ?? 0.0
        }
    }

    private var validationError: String? {
        if payType == .custom {
            if customAmountText.trimmingCharacters(in: .whitespaces).isEmpty {
                return "请输入登记金额"
            }
            guard let amount = Double(customAmountText), amount > 0 else {
                return "登记金额必须大于 0"
            }
            if amount > item.remainingAmount + 0.001 {
                return "金额不能超过剩余待还 \(money(item.remainingAmount))"
            }
        } else {
            if effectiveAmount <= 0.001 {
                return "待还金额为 0"
            }
        }
        return nil
    }

    private var isValid: Bool {
        validationError == nil
    }

    // Preview calculations after payment
    private var previewPaid: Double {
        item.totalPaid + effectiveAmount
    }

    private var previewRemaining: Double {
        max(0, item.remainingAmount - effectiveAmount)
    }

    private var previewStatusText: String {
        if previewRemaining <= 0.01 {
            return "登记后本期将全额结清"
        } else if item.isOverdue {
            return "登记后仍为部分还款，逾期状态保留"
        } else {
            return "登记后剩余待还 \(money(previewRemaining))"
        }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    statementSummaryCard
                    amountSection
                    paymentInfoSection
                    afterPaymentPreviewCard
                    semanticsDisclaimer
                }
                .padding(.horizontal, 16)
                .padding(.top, 12)
                .padding(.bottom, 24)
            }
            .background(WCColors.canvas.ignoresSafeArea())
            .navigationTitle("登记还款")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") {
                        dismiss()
                    }
                    .foregroundStyle(WCColors.primaryAccent)
                }
            }
            .safeAreaInset(edge: .bottom) {
                footerView
            }
            .onAppear {
                if payType == .custom && customAmountText.isEmpty {
                    customAmountText = String(format: "%.2f", item.remainingAmount)
                }
            }
        }
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
                    color: item.isOverdue ? WCColors.dangerInk : WCColors.textPrimary
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

    // MARK: - Amount Section
    private var amountSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("本次登记金额")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(WCColors.textPrimary)

            Picker("还款方式", selection: $payType) {
                ForEach(PayType.allCases) { type in
                    Text(type.rawValue).tag(type)
                }
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier("payment.type")

            HStack(spacing: 8) {
                Text(DashboardMoney.currencySymbol(billCurrency))
                    .font(.title2.bold())
                    .foregroundStyle(WCColors.textPrimary)

                if payType == .custom {
                    TextField("输入金额", text: $customAmountText)
                        .font(.title3.bold())
                        .keyboardType(.decimalPad)
                        .foregroundStyle(WCColors.textPrimary)
                        .accessibilityIdentifier("payment.amountInput")
                } else {
                    Text(String(format: "%.2f", effectiveAmount))
                        .font(.title3.bold())
                        .foregroundStyle(WCColors.primaryAccent)
                    Spacer()
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .background(WCColors.subtle, in: RoundedRectangle(cornerRadius: 10))

            HStack {
                Text("可分次登记 · 本次最多 \(money(item.remainingAmount))")
                    .font(.caption2)
                    .foregroundStyle(WCColors.textSecondary)
                Spacer()
                if let err = validationError {
                    Text(err)
                        .font(.caption2.bold())
                        .foregroundStyle(WCColors.dangerInk)
                }
            }
        }
        .padding(16)
        .background(WCColors.surface, in: RoundedRectangle(cornerRadius: 14))
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .stroke(validationError != nil && payType == .custom ? WCColors.dangerInk : WCColors.border, lineWidth: 1)
        )
    }

    // MARK: - Payment Info Section
    private var paymentInfoSection: some View {
        VStack(spacing: 12) {
            DatePicker("还款日期", selection: $paidAt, displayedComponents: .date)
                .font(.subheadline)
                .foregroundStyle(WCColors.textPrimary)

            Divider()
                .background(WCColors.border)

            Picker("支付渠道", selection: $channel) {
                Text("微信支付").tag("微信支付")
                Text("支付宝").tag("支付宝")
                Text("手机银行").tag("手机银行")
                Text("云闪付").tag("云闪付")
                Text("自动扣款").tag("自动扣款")
                Text("手动还款").tag("手动还款")
            }
            .font(.subheadline)
            .foregroundStyle(WCColors.textPrimary)

            Divider()
                .background(WCColors.border)

            HStack {
                Text("备注（可选）")
                    .font(.subheadline)
                    .foregroundStyle(WCColors.textSecondary)
                Spacer()
                TextField("如：工资还款", text: $note)
                    .font(.subheadline)
                    .multilineTextAlignment(.trailing)
                    .foregroundStyle(WCColors.textPrimary)
            }
        }
        .padding(16)
        .background(WCColors.surface, in: RoundedRectangle(cornerRadius: 14))
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .stroke(WCColors.border, lineWidth: 1)
        )
    }

    // MARK: - After Payment Preview Card
    private var afterPaymentPreviewCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("累计已还 \(money(previewPaid))")
                    .font(.subheadline.bold())
                    .foregroundStyle(WCColors.successInk)
                Spacer()
                Text("剩余 \(money(previewRemaining))")
                    .font(.subheadline.bold())
                    .foregroundStyle(previewRemaining <= 0.01 ? WCColors.successInk : WCColors.textPrimary)
            }

            Text(previewStatusText)
                .font(.caption)
                .foregroundStyle(previewRemaining <= 0.01 ? WCColors.successInk : (item.isOverdue ? WCColors.dangerInk : WCColors.textSecondary))
        }
        .padding(14)
        .background(WCColors.subtle, in: RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(WCColors.border, lineWidth: 1)
        )
    }

    private var semanticsDisclaimer: some View {
        Text("仅登记已完成的还款，不会从银行卡扣款。")
            .font(.caption2)
            .foregroundStyle(WCColors.textSecondary)
            .frame(maxWidth: .infinity, alignment: .center)
            .padding(.top, 2)
    }

    // MARK: - Footer
    private var footerView: some View {
        VStack(spacing: 8) {
            Divider()
                .background(WCColors.border)

            if let err = errorMessage {
                Text(err)
                    .font(.caption)
                    .foregroundStyle(WCColors.dangerInk)
                    .padding(.horizontal)
            }

            Button(action: {
                Task {
                    await submit()
                }
            }) {
                HStack {
                    Spacer()
                    if isSubmitting {
                        ProgressView()
                            .tint(.white)
                            .padding(.trailing, 6)
                    }
                    Text("确认登记 \(money(effectiveAmount))")
                        .font(.headline.bold())
                    Spacer()
                }
                .foregroundStyle(Color.white)
                .padding(.vertical, 14)
                .background(
                    isValid && !isSubmitting ? WCColors.primaryAccent : WCColors.textSecondary.opacity(0.4),
                    in: RoundedRectangle(cornerRadius: 12)
                )
            }
            .disabled(!isValid || isSubmitting)
            .padding(.horizontal, 20)
            .accessibilityIdentifier("payment.confirm")

            Text("未实际还款时，请返回完成还款后再登记")
                .font(.caption2)
                .foregroundStyle(WCColors.textSecondary)
                .padding(.bottom, 6)
        }
        .background(WCColors.surface)
    }

    private func submit() async {
        guard isValid, !isSubmitting else { return }
        isSubmitting = true
        errorMessage = nil

        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        let dateStr = f.string(from: paidAt)

        do {
            try await onPay(effectiveAmount, dateStr, channel, note.isEmpty ? nil : note)
            dismiss()
        } catch {
            errorMessage = "还款失败：\(error.localizedDescription)"
            isSubmitting = false
        }
    }
}
