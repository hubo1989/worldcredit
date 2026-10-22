import SwiftUI
import WorldCreditCore

struct BillAmountOverrideSheetView: View {
    @Environment(\.dismiss) private var dismiss
    let item: BillDisplayItem
    let onSave: (Double?) async throws -> Void

    @State private var amountText: String
    @State private var isSubmitting: Bool = false
    @State private var errorMessage: String?

    init(item: BillDisplayItem, onSave: @escaping (Double?) async throws -> Void) {
        self.item = item
        self.onSave = onSave
        _amountText = State(initialValue: String(format: "%.2f", item.bill.effectiveAmount))
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("账单金额") {
                    LabeledContent("原始出账金额", value: "¥\(String(format: "%.2f", item.bill.billAmount))")

                    if let override = item.bill.billAmountOverride {
                        LabeledContent("当前人工调整", value: "¥\(String(format: "%.2f", override))")
                    }

                    HStack {
                        Text("调整为 (¥)")
                        Spacer()
                        TextField("输入调整金额", text: $amountText)
                            .keyboardType(.decimalPad)
                            .multilineTextAlignment(.trailing)
                            .accessibilityIdentifier("bill.adjust.amount")
                    }
                }

                if item.bill.billAmountOverride != nil {
                    Section {
                        Button("恢复原始出账金额", role: .destructive) {
                            submit(nil)
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
            .navigationTitle("调整账单金额")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("保存") {
                        guard let amt = Double(amountText), amt >= 0 else {
                            errorMessage = "请输入有效的非负金额"
                            return
                        }
                        submit(amt)
                    }
                    .disabled(isSubmitting)
                    .accessibilityIdentifier("bill.adjust.save")
                }
            }
        }
    }

    private func submit(_ amount: Double?) {
        isSubmitting = true
        errorMessage = nil

        Task {
            do {
                try await onSave(amount)
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
                isSubmitting = false
            }
        }
    }
}
