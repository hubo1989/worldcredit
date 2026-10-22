import SwiftUI
import WorldCreditCore

struct CardEditSheetView: View {
    @Environment(\.dismiss) private var dismiss
    let card: CardDisplayItem
    let onSave: (CardUpdateInput) async throws -> Void

    @State private var nameOverride: String
    @State private var creditLimitText: String
    @State private var billingDayText: String
    @State private var hasCustomDueRule: Bool
    @State private var dueType: PaymentDueType
    @State private var dueValueText: String
    @State private var isSubmitting: Bool = false
    @State private var errorMessage: String?

    init(card: CardDisplayItem, onSave: @escaping (CardUpdateInput) async throws -> Void) {
        self.card = card
        self.onSave = onSave
        _nameOverride = State(initialValue: card.card.nameOverride ?? "")
        _creditLimitText = State(initialValue: String(format: "%.0f", card.card.creditLimit))
        let effectiveBillingDay = card.card.overrideBillingDay ?? card.card.billingDay
        _billingDayText = State(initialValue: "\(effectiveBillingDay)")

        let customDue = card.card.overrideDueType != nil
        _hasCustomDueRule = State(initialValue: customDue)
        _dueType = State(initialValue: card.card.overrideDueType ?? card.product?.paymentDueType ?? .afterBilling)
        let val = card.card.overrideDueValue ?? card.product?.paymentDueValue ?? 20
        _dueValueText = State(initialValue: "\(val)")
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("基本信息") {
                    LabeledContent("所属银行", value: card.bankName)
                    LabeledContent("原卡产品", value: card.product?.cardName ?? "信用卡")
                    LabeledContent("持卡人", value: card.holderName)
                    if !card.last4.isEmpty {
                        LabeledContent("卡号尾号", value: card.last4)
                    }

                    TextField("卡片备注名称", text: $nameOverride)
                        .accessibilityIdentifier("card.edit.name")
                }

                Section("额度与账单日") {
                    HStack {
                        Text("信用额度 (¥)")
                        Spacer()
                        TextField("0", text: $creditLimitText)
                            .keyboardType(.numberPad)
                            .multilineTextAlignment(.trailing)
                            .accessibilityIdentifier("card.edit.limit")
                    }

                    HStack {
                        Text("每月账单日")
                        Spacer()
                        TextField("1-31", text: $billingDayText)
                            .keyboardType(.numberPad)
                            .multilineTextAlignment(.trailing)
                            .accessibilityIdentifier("card.edit.billingDay")
                        Text("日")
                            .foregroundStyle(.secondary)
                    }
                }

                Section("还款日规则") {
                    Toggle("自定义还款规则", isOn: $hasCustomDueRule)
                        .accessibilityIdentifier("card.edit.customDue")

                    if hasCustomDueRule {
                        Picker("还款计算方式", selection: $dueType) {
                            Text("账单日后 X 天").tag(PaymentDueType.afterBilling)
                            Text("次月固定 X 日").tag(PaymentDueType.fixed)
                            Text("当月固定 X 日").tag(PaymentDueType.fixedBeforeBilling)
                        }

                        HStack {
                            Text(dueType == .afterBilling ? "天数" : "每月日期")
                            Spacer()
                            TextField("天数或日期", text: $dueValueText)
                                .keyboardType(.numberPad)
                                .multilineTextAlignment(.trailing)
                                .accessibilityIdentifier("card.edit.dueValue")
                            Text(dueType == .afterBilling ? "天" : "日")
                                .foregroundStyle(.secondary)
                        }
                    } else {
                        HStack {
                            Text("默认规则")
                            Spacer()
                            Text(defaultRuleDescription)
                                .foregroundStyle(.secondary)
                        }
                    }
                }

                if let errorMessage {
                    Section {
                        Text(errorMessage)
                            .foregroundStyle(.red)
                            .font(.footnote)
                    }
                }
            }
            .navigationTitle("编辑卡片")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(action: save) {
                        if isSubmitting {
                            ProgressView()
                        } else {
                            Text("保存")
                                .bold()
                        }
                    }
                    .disabled(isSubmitting)
                    .accessibilityIdentifier("card.edit.save")
                }
            }
        }
    }

    private var defaultRuleDescription: String {
        guard let p = card.product else { return "未指定" }
        switch p.paymentDueType {
        case .afterBilling:
            return "账单日后 \(p.paymentDueValue) 天"
        case .fixed:
            return "次月 \(p.paymentDueValue) 日"
        case .fixedBeforeBilling:
            return "当月 \(p.paymentDueValue) 日"
        }
    }

    private func save() {
        guard let limit = Double(creditLimitText), limit >= 0 else {
            errorMessage = "请输入有效的信用额度"
            return
        }
        guard let day = Int(billingDayText), day >= 1 && day <= 31 else {
            errorMessage = "账单日必须在 1 到 31 之间"
            return
        }

        var input = CardUpdateInput()
        input.nameOverride = nameOverride.trimmingCharacters(in: .whitespaces)
        input.creditLimit = limit
        input.overrideBillingDay = day

        if hasCustomDueRule {
            guard let val = Int(dueValueText), val > 0 else {
                errorMessage = "请输入有效的还款天数或日期"
                return
            }
            input.overrideDueType = dueType
            input.overrideDueValue = val
        } else {
            input.overrideDueType = nil
            input.overrideDueValue = nil
        }

        isSubmitting = true
        errorMessage = nil

        Task {
            do {
                try await onSave(input)
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
                isSubmitting = false
            }
        }
    }
}
