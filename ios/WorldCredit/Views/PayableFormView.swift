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
    @State private var currency: PayableCurrencySelection = .supported(.cny)
    @State private var dueDay = 1
    /// 归属持卡人；空字符串 = 不指定
    @State private var holderId = ""
    @State private var note = ""
    @State private var bankAccount = ""
    @State private var errorMessage: String?
    @State private var confirmDelete = false
    @State private var saving = false
    @State private var showingDueDayPicker = false

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
                    Picker("币种", selection: $currency) {
                        if let existing, PayableCurrency.normalize(existing.currency) == nil {
                            let label = existing.currency.trimmingCharacters(in: .whitespacesAndNewlines)
                            Text("保留 \(label.isEmpty ? "空币种" : label)（历史值）")
                                .tag(PayableCurrencySelection.legacy(existing.currency))
                        }
                        ForEach(PayableCurrency.allCases) { item in
                            Text(item.label).tag(PayableCurrencySelection.supported(item))
                        }
                    }
                    if let existing, PayableCurrency.normalize(existing.currency) == nil {
                        Text("可保留历史币种；如需更改，请选择 CNY / USD / HKD，并核对金额。")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    // 点击行弹出滚轮选择（替代 Stepper 加减：从 1 按到 31 不现实）
                    Button {
                        showingDueDayPicker = true
                    } label: {
                        HStack {
                            Text("每月应付日")
                                .foregroundStyle(.primary)
                            Spacer()
                            Text("\(dueDay) 日")
                                .foregroundStyle(.secondary)
                        }
                    }
                    .accessibilityIdentifier("payable.form.dueDay")
                }

                Section("选填") {
                    // 归属用于账单页按持卡人筛选与汇总；不指定时该固定支出只出现在「全部」
                    Picker("归属持卡人", selection: $holderId) {
                        Text("不指定").tag("")
                        ForEach(appState.dashboardHolders) { holder in
                            Text(holder.name).tag(holder.id)
                        }
                    }
                    .accessibilityIdentifier("payable.form.holder")
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
            .sheet(isPresented: $showingDueDayPicker) {
                NavigationStack {
                    Picker("每月应付日", selection: $dueDay) {
                        ForEach(1...31, id: \.self) { day in
                            Text("\(day) 日").tag(day)
                        }
                    }
                    .pickerStyle(.wheel)
                    .frame(maxWidth: .infinity)
                    .frame(height: 280)
                    .padding(.vertical, 40)
                    .background(WCColors.subtle)
                    .clipShape(RoundedRectangle(cornerRadius: 16))
                    .padding(.horizontal, 16)
                    .navigationTitle("每月应付日")
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .confirmationAction) {
                            Button("完成") { showingDueDayPicker = false }
                        }
                    }
                }
                .presentationDetents([.height(480)])
            }
        }
    }

    private func populate() {
        guard let existing else { return }
        name = existing.name
        category = existing.category
        amountText = String(format: "%.2f", existing.amount)
        currency = PayableCurrencySelection(persistedCurrency: existing.currency)
        dueDay = existing.dueDay
        holderId = existing.holderId ?? ""
        note = existing.note ?? ""
        bankAccount = existing.bankAccount ?? ""
    }

    private func save() async {
        guard let amount = Double(amountText), amount >= 0 else {
            errorMessage = "金额必须是不小于 0 的数字"
            return
        }
        let draft = PayableDraft(
            name: name.trimmingCharacters(in: .whitespaces),
            category: category,
            amount: amount,
            currency: currency.draftCurrency,
            dueDay: dueDay,
            holderId: holderId.isEmpty ? nil : holderId,
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
