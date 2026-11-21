import SwiftUI
import WorldCreditCore

/// 单笔还款记录编辑/删除 Sheet（对齐 Web `BillPaymentsManage`）。
struct PaymentEditSheetView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss

    let item: BillDisplayItem
    let payment: Payment
    let onSaved: () async -> Void

    @State private var amountText: String
    @State private var paidAt: Date
    @State private var channel: String
    @State private var note: String
    @State private var isSubmitting: Bool = false
    @State private var isDeleting: Bool = false
    @State private var showDeleteConfirm: Bool = false
    @State private var errorMessage: String?
    @State private var successTrigger: Int = 0
    @State private var errorTrigger: Int = 0

    private static let shanghaiZone = TimeZone(identifier: "Asia/Shanghai") ?? .current

    private static let yyyymmddFormatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = shanghaiZone
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    private static let presetChannels = [
        "微信支付",
        "支付宝",
        "手机银行",
        "云闪付",
        "自动扣款",
        "手动还款",
    ]

    init(item: BillDisplayItem, payment: Payment, onSaved: @escaping () async -> Void) {
        self.item = item
        self.payment = payment
        self.onSaved = onSaved

        _amountText = State(initialValue: String(format: "%.2f", payment.amount))
        _paidAt = State(initialValue: Self.yyyymmddFormatter.date(from: String(payment.paidAt.prefix(10))) ?? Date())
        _channel = State(initialValue: payment.channel ?? "")
        _note = State(initialValue: payment.note ?? "")
    }

    private var channelOptions: [String] {
        var options = Self.presetChannels
        let current = payment.channel?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !current.isEmpty, !options.contains(current) {
            options.insert(current, at: 0)
        }
        return options
    }

    private func money(_ value: Double) -> String {
        DashboardMoney.format(value, currency: item.currency)
    }

    private var parsedAmount: Double? {
        guard let v = Double(amountText.trimmingCharacters(in: .whitespacesAndNewlines)),
              v.isFinite else {
            return nil
        }
        return v
    }

    private var otherPaidAmount: Double {
        max(0, item.totalPaid - payment.amount)
    }

    private var previewTotalPaid: Double {
        otherPaidAmount + (parsedAmount ?? payment.amount)
    }

    private var previewRemaining: Double {
        max(0, item.bill.effectiveAmount - previewTotalPaid)
    }

    private var exceedsBillEffectiveAmount: Bool {
        guard let nextAmt = parsedAmount, nextAmt > payment.amount else { return false }
        return otherPaidAmount + nextAmt > item.bill.effectiveAmount + 0.01
    }

    private var previewStatusLabel: String {
        if item.bill.effectiveAmount <= 0 || previewTotalPaid >= item.bill.effectiveAmount - 0.01 {
            return "已结清"
        }
        if previewTotalPaid > 0 {
            return "部分还款"
        }
        return "待还"
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("还款内容（\(item.currency)）") {
                    HStack {
                        Text("还款金额 (\(DashboardMoney.currencySymbol(item.currency)))")
                        Spacer()
                        TextField("0.00", text: $amountText)
                            .keyboardType(.decimalPad)
                            .multilineTextAlignment(.trailing)
                            .accessibilityIdentifier("payment.edit.amount")
                    }

                    DatePicker("还款日期", selection: $paidAt, displayedComponents: .date)
                        .environment(\.timeZone, Self.shanghaiZone)
                        .accessibilityIdentifier("payment.edit.date")

                    Picker("支付渠道", selection: $channel) {
                        Text("未指定").tag("")
                        ForEach(channelOptions, id: \.self) { option in
                            Text(option).tag(option)
                        }
                    }
                    .accessibilityIdentifier("payment.edit.channel")

                    HStack {
                        Text("备注")
                        Spacer()
                        TextField("可留空", text: $note)
                            .multilineTextAlignment(.trailing)
                            .accessibilityIdentifier("payment.edit.note")
                    }
                }

                if exceedsBillEffectiveAmount {
                    Section {
                        let maxAllowed = max(0, item.bill.effectiveAmount + 0.01 - otherPaidAmount)
                        Label(
                            "编辑后金额超过该账单剩余可还额度（本笔最多 \(money(maxAllowed))）",
                            systemImage: "exclamationmark.triangle.fill"
                        )
                        .font(.caption)
                        .foregroundStyle(WCColors.warningInk)
                    }
                }

                Section("保存后预览") {
                    LabeledContent("账单生效金额", value: money(item.bill.effectiveAmount))
                    LabeledContent("累计已还") {
                        Text(money(previewTotalPaid))
                            .bold()
                            .foregroundStyle(WCColors.successInk)
                    }
                    LabeledContent("剩余应还") {
                        Text(money(previewRemaining))
                            .bold()
                            .foregroundStyle(previewRemaining <= 0.01 ? WCColors.successInk : WCColors.textPrimary)
                    }
                    LabeledContent("重算状态", value: previewStatusLabel)
                }

                if let errorMessage {
                    Section {
                        Text(errorMessage)
                            .foregroundStyle(WCColors.dangerInk)
                            .font(.footnote)
                    }
                }

                Section {
                    Button(role: .destructive) {
                        showDeleteConfirm = true
                    } label: {
                        HStack {
                            Spacer()
                            if isDeleting {
                                ProgressView()
                                    .padding(.trailing, 6)
                            }
                            Label("删除该笔还款", systemImage: "trash")
                                .bold()
                            Spacer()
                        }
                    }
                    .disabled(isSubmitting || isDeleting)
                    .accessibilityIdentifier("payment.edit.delete")
                } footer: {
                    Text("删改后系统按已还总额自动重算账单状态，支持从已结清回退。")
                }
            }
            .navigationTitle("编辑还款记录")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                        .disabled(isSubmitting || isDeleting)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        Task { await save() }
                    } label: {
                        if isSubmitting {
                            ProgressView()
                        } else {
                            Text("保存").bold()
                        }
                    }
                    .disabled(isSubmitting || isDeleting)
                    .accessibilityIdentifier("payment.edit.save")
                }
            }
            .confirmationDialog(
                "确认删除该笔还款？",
                isPresented: $showDeleteConfirm,
                titleVisibility: .visible
            ) {
                Button("确认删除", role: .destructive) {
                    Task { await deletePayment() }
                }
                Button("取消", role: .cancel) {}
            } message: {
                Text("将删除 \(money(payment.amount)) 的还款记录，账单状态将按剩余还款自动重算。")
            }
            .sensoryFeedback(.success, trigger: successTrigger)
            .sensoryFeedback(.error, trigger: errorTrigger)
        }
    }

    private func save() async {
        errorMessage = nil
        guard let amount = parsedAmount, amount > 0 else {
            errorMessage = "还款金额必须是大于 0 的数字"
            errorTrigger += 1
            return
        }
        if exceedsBillEffectiveAmount {
            let maxAllowed = max(0, item.bill.effectiveAmount + 0.01 - otherPaidAmount)
            errorMessage = "编辑后金额超过该账单剩余可还额度（本笔最多 \(money(maxAllowed))）"
            errorTrigger += 1
            return
        }

        let paidAtStr = Self.yyyymmddFormatter.string(from: paidAt)
        let trimmedChannel = channel.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedNote = note.trimmingCharacters(in: .whitespacesAndNewlines)
        let clearChannel = trimmedChannel.isEmpty && payment.channel != nil
        let clearNote = trimmedNote.isEmpty && payment.note != nil

        isSubmitting = true
        defer { isSubmitting = false }

        do {
            try await appState.updatePayment(
                paymentId: payment.id,
                billId: item.bill.id,
                amount: amount,
                paidAt: paidAtStr,
                channel: trimmedChannel.isEmpty ? nil : trimmedChannel,
                note: trimmedNote.isEmpty ? nil : trimmedNote,
                clearChannel: clearChannel,
                clearNote: clearNote
            )
            successTrigger += 1
            await onSaved()
            dismiss()
        } catch {
            errorMessage = "保存失败：\(error.localizedDescription)"
            errorTrigger += 1
        }
    }

    private func deletePayment() async {
        errorMessage = nil
        isDeleting = true
        defer { isDeleting = false }

        do {
            try await appState.deletePayment(paymentId: payment.id, billId: item.bill.id)
            successTrigger += 1
            await onSaved()
            dismiss()
        } catch {
            errorMessage = "删除失败：\(error.localizedDescription)"
            errorTrigger += 1
        }
    }
}
