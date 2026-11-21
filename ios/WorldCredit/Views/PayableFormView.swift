import SwiftUI
import WorldCreditCore

/// 固定支出录入/编辑表单：字段对齐 Web PayableForm(名称/分类/金额/币种/每月应付日/备注/收款账号)。
struct PayableFormView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss

    let existing: PayableItem?

    @State private var name = ""
    @State private var category: PayableCategory = .rent
    @State private var customCategory = ""
    @State private var savedCustomCategories: [String] = []
    @State private var cycleType: PayableCycleType = .monthly
    @State private var cycleMonthsText = "3"
    @State private var dueMonth = PayableFormView.currentShanghaiYearMonth().month
    @State private var anchorPeriod = PayableFormView.currentShanghaiYearMonth().period
    @State private var amountText = ""
    @State private var currency: PayableCurrencySelection = .supported(.cny)
    @State private var dueDay = 1
    /// 归属持卡人；空字符串 = 不指定
    @State private var holderId = ""
    /// 归属银行；空字符串 = 非银行
    @State private var bankName = ""
    @State private var note = ""
    @State private var bankAccount = ""
    @State private var errorMessage: String?
    @State private var confirmDelete = false
    @State private var saving = false
    @State private var showingDueDayPicker = false
    @State private var successTrigger = 0
    @State private var errorTrigger = 0

    private static func currentShanghaiYearMonth() -> (year: Int, month: Int, period: String) {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "Asia/Shanghai") ?? .current
        let now = Date()
        let y = cal.component(.year, from: now)
        let m = cal.component(.month, from: now)
        return (y, m, String(format: "%04d-%02d", y, m))
    }

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
                    .accessibilityIdentifier("payable.form.category")

                    if category == .other {
                        VStack(alignment: .leading, spacing: 8) {
                            TextField("自定义分类名称（如：宽带、车位费）", text: $customCategory)
                                .accessibilityIdentifier("payable.form.customCategory")

                            if !mergedCustomCategories.isEmpty {
                                ScrollView(.horizontal, showsIndicators: false) {
                                    HStack(spacing: 6) {
                                        ForEach(mergedCustomCategories, id: \.self) { item in
                                            let isSelected = customCategory.trimmingCharacters(in: .whitespacesAndNewlines)
                                                .caseInsensitiveCompare(item) == .orderedSame
                                            Button {
                                                customCategory = isSelected ? "" : item
                                            } label: {
                                                Text(item)
                                                    .font(.caption2.weight(.medium))
                                                    .padding(.horizontal, 10)
                                                    .padding(.vertical, 5)
                                                    .background(
                                                        isSelected ? WCColors.primaryAccent.opacity(0.16) : WCColors.subtle,
                                                        in: Capsule()
                                                    )
                                                    .foregroundStyle(
                                                        isSelected ? WCColors.primaryAccent : WCColors.textSecondary
                                                    )
                                            }
                                            .buttonStyle(.plain)
                                        }
                                    }
                                    .padding(.vertical, 2)
                                }
                            }
                        }
                    }

                    Picker("周期", selection: $cycleType) {
                        ForEach(PayableCycleType.allCases) { item in
                            Text(item.label).tag(item)
                        }
                    }
                    .accessibilityIdentifier("payable.form.cycleType")

                    if cycleType == .everyNMonths {
                        HStack {
                            Text("间隔月数")
                            Spacer()
                            TextField("2–24", text: $cycleMonthsText)
                                .keyboardType(.numberPad)
                                .multilineTextAlignment(.trailing)
                                .frame(width: 80)
                                .accessibilityIdentifier("payable.form.cycleMonths")
                            Text("个月")
                                .foregroundStyle(.secondary)
                        }

                        HStack {
                            Text("起算月份")
                            Spacer()
                            TextField("YYYY-MM", text: $anchorPeriod)
                                .keyboardType(.numbersAndPunctuation)
                                .multilineTextAlignment(.trailing)
                                .frame(width: 110)
                                .accessibilityIdentifier("payable.form.anchorPeriod")
                            Button("本月") {
                                anchorPeriod = Self.currentShanghaiYearMonth().period
                            }
                            .font(.caption.weight(.medium))
                            .foregroundStyle(WCColors.primaryAccent)
                            .buttonStyle(.borderless)
                        }
                    } else if cycleType == .yearly {
                        Picker("应付月份", selection: $dueMonth) {
                            ForEach(1...12, id: \.self) { month in
                                Text("\(month) 月").tag(month)
                            }
                        }
                        .accessibilityIdentifier("payable.form.dueMonth")
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
                            Text(dueDayRowLabel)
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
                    Picker("银行（可选）", selection: $bankName) {
                        Text("非银行 / 不指定").tag("")
                        ForEach(payableBankOptions, id: \.self) { name in
                            Text(name).tag(name)
                        }
                    }
                    .accessibilityIdentifier("payable.form.bank")
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
            .task {
                savedCustomCategories = await appState.fetchCustomPayableCategories()
            }
            .sensoryFeedback(.success, trigger: successTrigger)
            .sensoryFeedback(.error, trigger: errorTrigger)
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
                    .navigationTitle(dueDayRowLabel)
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

    private var dueDayRowLabel: String {
        switch cycleType {
        case .monthly: return "每月应付日"
        case .everyNMonths: return "每期应付日"
        case .yearly: return "每年应付日"
        }
    }

    private var mergedCustomCategories: [String] {
        var result: [String] = []
        var seen = Set<String>()
        let presetLabels = Set(PayableCategory.allCases.map(\.label))
        let presetRaws = Set(PayableCategory.allCases.map(\.rawValue))
        let candidates = savedCustomCategories + [existing?.customCategory].compactMap { $0 }
        for raw in candidates {
            let collapsed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
                .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            guard !collapsed.isEmpty,
                  !presetLabels.contains(collapsed),
                  !presetRaws.contains(collapsed.lowercased()) else { continue }
            let key = collapsed.lowercased()
            if seen.insert(key).inserted {
                result.append(collapsed)
            }
        }
        return result
    }

    /// 银行选项：公开银行目录 ∪ 用户已有卡片的银行 ∪ 当前记录的历史值。
    private var payableBankOptions: [String] {
        var names = appState.bankOptions.map(\.name)
        names.append(contentsOf: appState.cards.map(\.bankName))
        if let legacy = existing?.bankName, !legacy.isEmpty { names.append(legacy) }
        var seen = Set<String>()
        return names.filter { !$0.isEmpty && seen.insert($0).inserted }.sorted()
    }

    private func populate() {
        let current = Self.currentShanghaiYearMonth()
        guard let existing else {
            dueMonth = current.month
            anchorPeriod = current.period
            return
        }
        name = existing.name
        category = existing.category
        customCategory = existing.customCategory?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !customCategory.isEmpty && category != .other {
            category = .other
        }
        cycleType = existing.cycleType
        cycleMonthsText = existing.cycleType == .everyNMonths
            ? "\(max(2, existing.cycleMonths))"
            : "3"
        let anchorMonth: Int? = existing.anchorPeriod.flatMap { period in
            let parts = period.split(separator: "-")
            guard parts.count == 2 else { return nil }
            return Int(parts[1])
        }
        dueMonth = existing.dueMonth ?? anchorMonth ?? current.month
        anchorPeriod = existing.anchorPeriod ?? current.period
        amountText = String(format: "%.2f", existing.amount)
        currency = PayableCurrencySelection(persistedCurrency: existing.currency)
        dueDay = existing.dueDay
        holderId = existing.holderId ?? ""
        bankName = existing.bankName ?? ""
        note = existing.note ?? ""
        bankAccount = existing.bankAccount ?? ""
    }

    private static func isValidPayablePeriod(_ raw: String) -> Bool {
        let parts = raw.split(separator: "-", omittingEmptySubsequences: false)
        guard parts.count == 2,
              parts[0].count == 4, parts[1].count == 2,
              let year = Int(parts[0]), let month = Int(parts[1]),
              (1970...2100).contains(year), (1...12).contains(month) else {
            return false
        }
        return true
    }

    private func save() async {
        errorMessage = nil
        guard let amount = Double(amountText), amount >= 0 else {
            errorMessage = "金额必须是不小于 0 的数字"
            errorTrigger += 1
            return
        }

        // 1. 解析分类与自定义分类
        var resolvedCategory = category
        var resolvedCustomCategory: String?
        if category == .other {
            let collapsed = customCategory.trimmingCharacters(in: .whitespacesAndNewlines)
                .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            if !collapsed.isEmpty {
                if collapsed.count > 30 {
                    errorMessage = "自定义分类名称不能超过 30 个字符"
                    errorTrigger += 1
                    return
                }
                if let matchedPreset = PayableCategory.allCases.first(where: {
                    $0.label == collapsed || $0.rawValue == collapsed.lowercased()
                }) {
                    resolvedCategory = matchedPreset
                    resolvedCustomCategory = nil
                } else {
                    resolvedCategory = .other
                    resolvedCustomCategory = collapsed
                }
            }
        }

        // 2. 解析周期字段
        let resolvedCycleMonths: Int
        let resolvedDueMonth: Int?
        let resolvedAnchorPeriod: String?
        switch cycleType {
        case .monthly:
            resolvedCycleMonths = 1
            resolvedDueMonth = nil
            resolvedAnchorPeriod = nil
        case .everyNMonths:
            let trimmedMonths = cycleMonthsText.trimmingCharacters(in: .whitespacesAndNewlines)
            let maxAllowed = max(24, existing?.cycleMonths ?? 24)
            guard let months = Int(trimmedMonths), (2...maxAllowed).contains(months) else {
                errorMessage = "间隔月数必须是 2–24 之间的整数"
                errorTrigger += 1
                return
            }
            let trimmedAnchor = anchorPeriod.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmedAnchor.isEmpty && !Self.isValidPayablePeriod(trimmedAnchor) {
                errorMessage = "起算月份格式必须为 YYYY-MM"
                errorTrigger += 1
                return
            }
            resolvedCycleMonths = months
            resolvedDueMonth = nil
            resolvedAnchorPeriod = trimmedAnchor.isEmpty ? Self.currentShanghaiYearMonth().period : trimmedAnchor
        case .yearly:
            guard (1...12).contains(dueMonth) else {
                errorMessage = "每年应付月份必须在 1–12 之间"
                errorTrigger += 1
                return
            }
            resolvedCycleMonths = 12
            resolvedDueMonth = dueMonth
            resolvedAnchorPeriod = nil
        }

        saving = true
        defer { saving = false }

        if let resolvedCustomCategory {
            let alreadyKnown = mergedCustomCategories.contains {
                $0.caseInsensitiveCompare(resolvedCustomCategory) == .orderedSame
            }
            if !alreadyKnown {
                await appState.saveCustomPayableCategory(name: resolvedCustomCategory)
                savedCustomCategories = await appState.fetchCustomPayableCategories()
            }
        }

        let draft = PayableDraft(
            name: name.trimmingCharacters(in: .whitespaces),
            category: resolvedCategory,
            amount: amount,
            currency: currency.draftCurrency,
            dueDay: dueDay,
            holderId: holderId.isEmpty ? nil : holderId,
            bankName: bankName.isEmpty ? nil : bankName,
            note: note.isEmpty ? nil : note,
            bankAccount: bankAccount.isEmpty ? nil : bankAccount,
            customCategory: resolvedCustomCategory,
            cycleType: cycleType,
            cycleMonths: resolvedCycleMonths,
            dueMonth: resolvedDueMonth,
            anchorPeriod: resolvedAnchorPeriod
        )
        do {
            try await appState.savePayable(draft, existing: existing)
            successTrigger += 1
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
            errorTrigger += 1
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
