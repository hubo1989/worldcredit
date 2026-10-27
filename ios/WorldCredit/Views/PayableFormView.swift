import SwiftUI
import WorldCreditCore

/// 固定支出录入/编辑表单：字段对齐 Web PayableForm(名称/分类/金额/币种/每月应付日/备注/收款账号)。
struct PayableFormView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss

    let existing: PayableItem?

    @State private var name = ""
    @State private var category: PayableCategory = .rent
    @State private var amountText = ""
    @State private var currency = "CNY"
    @State private var dueDay = 1
    @State private var note = ""
    @State private var bankAccount = ""
    @State private var errorMessage: String?
    @State private var confirmDelete = false
    @State private var saving = false

    var body: some View {
        NavigationStack {
            Form {
                Section("基本信息") {
                    TextField("名称（如：房贷、房租）", text: $name)
                    Picker("分类", selection: $category) {
                        ForEach(PayableCategory.allCases) { item in
                            Text(item.label).tag(item)
                        }
                    }
                    TextField("金额", text: $amountText)
                        .keyboardType(.decimalPad)
                    TextField("币种（如 CNY / USD / HKD）", text: $currency)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.characters)
                    Stepper("每月应付日：\(dueDay) 日", value: $dueDay, in: 1...31)
                }

                Section("选填") {
                    TextField("备注", text: $note)
                    TextField("收款银行账号（展示层一键复制）", text: $bankAccount)
                        .keyboardType(.numberPad)
                }

                if existing != nil {
                    Section {
                        Button("删除该固定支出", role: .destructive) {
                            confirmDelete = true
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
            .navigationTitle(existing == nil ? "添加固定支出" : "编辑固定支出")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("保存") {
                        Task { await save() }
                    }
                    .disabled(saving || name.trimmingCharacters(in: .whitespaces).isEmpty || Double(amountText) == nil)
                }
            }
            .onAppear(perform: populate)
            .confirmationDialog("确认删除？历史登记记录保留。", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("删除", role: .destructive) {
                    Task { await deleteExisting() }
                }
            }
        }
    }

    private func populate() {
        guard let existing else { return }
        name = existing.name
        category = existing.category
        amountText = String(format: "%.2f", existing.amount)
        currency = existing.currency
        dueDay = existing.dueDay
        note = existing.note ?? ""
        bankAccount = existing.bankAccount ?? ""
    }

    private func save() async {
        guard let amount = Double(amountText), amount >= 0 else {
            errorMessage = "金额必须是不小于 0 的数字"
            return
        }
        let trimmedCurrency = currency.trimmingCharacters(in: .whitespaces).uppercased()
        guard trimmedCurrency.count == 3 else {
            errorMessage = "币种请填 3 位代码，如 CNY"
            return
        }
        let draft = PayableDraft(
            name: name.trimmingCharacters(in: .whitespaces),
            category: category,
            amount: amount,
            currency: trimmedCurrency,
            dueDay: dueDay,
            note: note.isEmpty ? nil : note,
            bankAccount: bankAccount.isEmpty ? nil : bankAccount
        )
        saving = true
        defer { saving = false }
        do {
            try await appState.savePayable(draft, existing: existing)
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func deleteExisting() async {
        guard let existing else { return }
        do {
            try await appState.deletePayable(existing)
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
