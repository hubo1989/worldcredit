import SwiftUI
import WorldCreditCore

/// 完整账单编辑 Sheet（对齐 Web `BillEditForm`）：
/// - 卡 + 账期只读展示；
/// - 金额、最低还款额、账单日、还款到期日、账期起止编辑；
/// - 已手动覆盖字段支持单项「恢复导入值」；
/// - 管理员支持底部红色「删除账单」二次确认。
struct BillEditSheetView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss

    let item: BillDisplayItem
    var onDeleted: (() -> Void)? = nil

    private struct FieldSnapshot: Equatable {
        var amountText: String
        var minPaymentText: String
        var hasStatementDate: Bool
        var statementDateStr: String
        var dueDateStr: String
        var hasStatementStart: Bool
        var statementStartStr: String
        var hasStatementEnd: Bool
        var statementEndStr: String
    }

    @State private var liveBill: Bill
    @State private var amountText: String
    @State private var minPaymentText: String
    @State private var hasStatementDate: Bool
    @State private var statementDate: Date
    @State private var dueDate: Date
    @State private var hasStatementStart: Bool
    @State private var statementStart: Date
    @State private var hasStatementEnd: Bool
    @State private var statementEnd: Date
    @State private var initialSnapshot: FieldSnapshot
    @State private var isAdvancedExpanded: Bool = false

    @State private var isSubmitting: Bool = false
    @State private var clearingField: BillOverrideField?
    @State private var showDeleteConfirm: Bool = false
    @State private var isDeleting: Bool = false
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

    init(item: BillDisplayItem, onDeleted: (() -> Void)? = nil) {
        self.item = item
        self.onDeleted = onDeleted

        let bill = item.bill
        let amtStr = Self.formatDecimal(bill.effectiveAmount)
        let minStr = bill.effectiveMinPayment.map { Self.formatDecimal($0) } ?? ""
        let stmtStr = bill.effectiveStatementDate
        let stmtDateVal = stmtStr.flatMap { Self.parseDate($0) } ?? Date()
        let dueStr = bill.effectiveDueDate
        let dueDateVal = Self.parseDate(dueStr) ?? Date()
        let startStr = bill.effectiveStatementStart
        let startDateVal = startStr.flatMap { Self.parseDate($0) } ?? Date()
        let endStr = bill.effectiveStatementEnd
        let endDateVal = endStr.flatMap { Self.parseDate($0) } ?? Date()

        _liveBill = State(initialValue: bill)
        _amountText = State(initialValue: amtStr)
        _minPaymentText = State(initialValue: minStr)
        _hasStatementDate = State(initialValue: stmtStr != nil && !(stmtStr?.isEmpty ?? true))
        _statementDate = State(initialValue: stmtDateVal)
        _dueDate = State(initialValue: dueDateVal)
        _hasStatementStart = State(initialValue: startStr != nil && !(startStr?.isEmpty ?? true))
        _statementStart = State(initialValue: startDateVal)
        _hasStatementEnd = State(initialValue: endStr != nil && !(endStr?.isEmpty ?? true))
        _statementEnd = State(initialValue: endDateVal)

        _initialSnapshot = State(initialValue: FieldSnapshot(
            amountText: amtStr,
            minPaymentText: minStr,
            hasStatementDate: stmtStr != nil && !(stmtStr?.isEmpty ?? true),
            statementDateStr: Self.yyyymmddFormatter.string(from: stmtDateVal),
            dueDateStr: Self.yyyymmddFormatter.string(from: dueDateVal),
            hasStatementStart: startStr != nil && !(startStr?.isEmpty ?? true),
            statementStartStr: Self.yyyymmddFormatter.string(from: startDateVal),
            hasStatementEnd: endStr != nil && !(endStr?.isEmpty ?? true),
            statementEndStr: Self.yyyymmddFormatter.string(from: endDateVal)
        ))
    }

    private var currencySymbol: String {
        DashboardMoney.currencySymbol(item.currency)
    }

    private var isAdmin: Bool {
        appState.currentUser?.role == "admin"
    }

    private var currentBill: Bill {
        appState.allBills.first(where: { $0.id == item.bill.id })?.bill ?? liveBill
    }

    private var warnBelowPaid: Bool {
        guard item.totalPaid > 0,
              let parsed = Double(amountText.trimmingCharacters(in: .whitespacesAndNewlines)),
              parsed.isFinite else {
            return false
        }
        return parsed < item.totalPaid - 0.001
    }

    private var identityLabel: String {
        let tail = item.last4.isEmpty ? "" : " · 尾号 \(item.last4)"
        return "\(item.bankName) \(item.cardTitle)\(tail) · \(item.bill.billMonth) 期"
    }

    var body: some View {
        NavigationStack {
            Form {
                // 身份锁定卡
                Section {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(identityLabel)
                            .font(.subheadline.bold())
                            .foregroundStyle(WCColors.textPrimary)
                        Label("卡与账期为账单身份，不可修改；如需更换请删除后重新录入", systemImage: "lock.fill")
                            .font(.caption)
                            .foregroundStyle(WCColors.textSecondary)
                    }
                    .padding(.vertical, 4)
                }

                // 金额编辑
                Section("金额（\(item.currency)）") {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text("账单金额 (\(currencySymbol))")
                            Spacer()
                            if currentBill.billAmountOverride != nil {
                                overrideResetBadge(field: .amount, label: "恢复导入值 \(DashboardMoney.format(currentBill.billAmount, currency: item.currency))")
                            }
                        }
                        TextField("0.00", text: $amountText)
                            .keyboardType(.decimalPad)
                            .accessibilityIdentifier("bill.edit.amount")
                        if currentBill.billAmountOverride != nil {
                            Text("原始导入金额：\(DashboardMoney.format(currentBill.billAmount, currency: item.currency))")
                                .font(.caption2)
                                .foregroundStyle(WCColors.textSecondary)
                        }
                    }

                    if warnBelowPaid {
                        Label(
                            "新金额低于已还总额（\(DashboardMoney.format(item.totalPaid, currency: item.currency))）。保存后后续新增还款会被拒绝。",
                            systemImage: "exclamationmark.triangle.fill"
                        )
                        .font(.caption)
                        .foregroundStyle(WCColors.warningInk)
                    }

                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text("最低还款额（选填）")
                            Spacer()
                            if currentBill.minPaymentOverride != nil {
                                overrideResetBadge(field: .minPayment, label: "恢复导入值")
                            }
                        }
                        HStack {
                            TextField("可留空", text: $minPaymentText)
                                .keyboardType(.decimalPad)
                                .accessibilityIdentifier("bill.edit.minPayment")
                            if !minPaymentText.isEmpty {
                                Button("清空") {
                                    minPaymentText = ""
                                }
                                .font(.caption)
                                .foregroundStyle(WCColors.textSecondary)
                            }
                        }
                    }
                }

                // 日期编辑
                Section("账单日与到期日") {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Toggle("设置出账日 / 账单日", isOn: $hasStatementDate)
                            if currentBill.statementDateOverride != nil {
                                overrideResetBadge(field: .statementDate, label: "恢复导入值")
                            }
                        }
                        if hasStatementDate {
                            DatePicker("出账日", selection: $statementDate, displayedComponents: .date)
                                .environment(\.timeZone, Self.shanghaiZone)
                                .accessibilityIdentifier("bill.edit.statementDate")
                        }
                    }

                    VStack(alignment: .leading, spacing: 8) {
                        if currentBill.dueDateOverride != nil {
                            HStack {
                                Text("还款到期日（已手动覆盖）")
                                    .font(.caption)
                                    .foregroundStyle(WCColors.warningInk)
                                Spacer()
                                overrideResetBadge(field: .dueDate, label: "恢复 \(currentBill.dueDate)")
                            }
                        }
                        DatePicker("还款到期日", selection: $dueDate, displayedComponents: .date)
                            .environment(\.timeZone, Self.shanghaiZone)
                            .accessibilityIdentifier("bill.edit.dueDate")
                    }
                }

                // 状态说明（只读）
                Section("状态（只读）") {
                    LabeledContent("当前状态", value: item.displayStatus)
                    Text("账单状态由已还总额与生效金额/到期日自动重算，保存后立即更新。")
                        .font(.caption)
                        .foregroundStyle(WCColors.textSecondary)
                }

                // 高级：账期起止
                Section {
                    DisclosureGroup("高级 · 账期起止", isExpanded: $isAdvancedExpanded) {
                        Toggle("设置账期首日", isOn: $hasStatementStart)
                        if hasStatementStart {
                            DatePicker("账期首日", selection: $statementStart, displayedComponents: .date)
                                .environment(\.timeZone, Self.shanghaiZone)
                                .accessibilityIdentifier("bill.edit.statementStart")
                        }

                        Toggle("设置账期末日", isOn: $hasStatementEnd)
                        if hasStatementEnd {
                            DatePicker("账期末日", selection: $statementEnd, displayedComponents: .date)
                                .environment(\.timeZone, Self.shanghaiZone)
                                .accessibilityIdentifier("bill.edit.statementEnd")
                        }
                    }
                }

                if let errorMessage {
                    Section {
                        Text(errorMessage)
                            .foregroundStyle(WCColors.dangerInk)
                            .font(.footnote)
                    }
                }

                // 删除账单（仅管理员）
                Section {
                    if isAdmin {
                        Button(role: .destructive) {
                            showDeleteConfirm = true
                        } label: {
                            HStack {
                                Spacer()
                                if isDeleting {
                                    ProgressView()
                                        .padding(.trailing, 6)
                                }
                                Label("删除账单", systemImage: "trash")
                                    .bold()
                                Spacer()
                            }
                        }
                        .disabled(isSubmitting || isDeleting || clearingField != nil)
                        .accessibilityIdentifier("bill.edit.delete")
                    } else {
                        Text("删除账单仅限管理员操作。")
                            .font(.caption)
                            .foregroundStyle(WCColors.textSecondary)
                    }
                }
            }
            .navigationTitle("编辑账单")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                        .disabled(isSubmitting || isDeleting || clearingField != nil)
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
                    .disabled(isSubmitting || isDeleting || clearingField != nil)
                    .accessibilityIdentifier("bill.edit.save")
                }
            }
            .confirmationDialog(
                "确认删除该账单？",
                isPresented: $showDeleteConfirm,
                titleVisibility: .visible
            ) {
                Button("确认删除", role: .destructive) {
                    Task { await performDelete() }
                }
                Button("取消", role: .cancel) {}
            } message: {
                let paidNote = item.totalPaid > 0
                    ? "名下 \(DashboardMoney.format(item.totalPaid, currency: item.currency)) 已还记录将一并删除，"
                    : ""
                Text("将删除 \(identityLabel) 的账单记录，\(paidNote)此操作不可恢复。")
            }
            .sensoryFeedback(.success, trigger: successTrigger)
            .sensoryFeedback(.error, trigger: errorTrigger)
        }
    }

    @ViewBuilder
    private func overrideResetBadge(field: BillOverrideField, label: String) -> some View {
        Button {
            Task { await clearOverride(field) }
        } label: {
            HStack(spacing: 4) {
                if clearingField == field {
                    ProgressView().controlSize(.mini)
                } else {
                    Image(systemName: "arrow.uturn.backward.circle.fill")
                        .font(.caption2)
                }
                Text(label)
                    .font(.caption2.weight(.semibold))
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(WCColors.warningSoft, in: Capsule())
            .foregroundStyle(WCColors.warningInk)
        }
        .buttonStyle(.borderless)
        .disabled(clearingField != nil || isSubmitting || isDeleting)
        .accessibilityIdentifier("bill.edit.clear.\(field.rawValue)")
    }

    private func clearOverride(_ field: BillOverrideField) async {
        errorMessage = nil
        clearingField = field
        defer { clearingField = nil }

        do {
            try await appState.clearBillOverride(billId: item.bill.id, fields: [field])
            // 同步更新本地状态与初值快照，避免后续保存其他字段时把刚清除的字段重新钉回 override
            var updatedBill = appState.allBills.first(where: { $0.id == item.bill.id })?.bill ?? liveBill
            switch field {
            case .amount:
                updatedBill.billAmountOverride = nil
                let nextAmt = Self.formatDecimal(updatedBill.billAmount)
                amountText = nextAmt
                initialSnapshot.amountText = nextAmt
            case .minPayment:
                updatedBill.minPaymentOverride = nil
                let nextMin = updatedBill.minPayment.map { Self.formatDecimal($0) } ?? ""
                minPaymentText = nextMin
                initialSnapshot.minPaymentText = nextMin
            case .dueDate:
                updatedBill.dueDateOverride = nil
                let nextDueDate = Self.parseDate(updatedBill.dueDate) ?? Date()
                dueDate = nextDueDate
                initialSnapshot.dueDateStr = Self.yyyymmddFormatter.string(from: nextDueDate)
            case .statementDate:
                updatedBill.statementDateOverride = nil
                let hasStmt = updatedBill.statementDate != nil && !(updatedBill.statementDate?.isEmpty ?? true)
                hasStatementDate = hasStmt
                initialSnapshot.hasStatementDate = hasStmt
                if let s = updatedBill.statementDate, let d = Self.parseDate(s) {
                    statementDate = d
                    initialSnapshot.statementDateStr = Self.yyyymmddFormatter.string(from: d)
                }
            }
            liveBill = updatedBill
            successTrigger += 1
        } catch {
            errorMessage = "恢复导入值失败：\(error.localizedDescription)"
            errorTrigger += 1
        }
    }

    private func save() async {
        errorMessage = nil

        let trimmedAmount = amountText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let parsedAmount = Double(trimmedAmount), parsedAmount.isFinite, parsedAmount >= 0 else {
            errorMessage = "账单金额必须是不小于 0 的数字"
            errorTrigger += 1
            return
        }

        let trimmedMin = minPaymentText.trimmingCharacters(in: .whitespacesAndNewlines)
        var parsedMin: Double?
        if !trimmedMin.isEmpty {
            guard let minVal = Double(trimmedMin), minVal.isFinite, minVal >= 0 else {
                errorMessage = "最低还款额必须是不小于 0 的数字"
                errorTrigger += 1
                return
            }
            parsedMin = minVal
        }

        let stmtDateStr = Self.yyyymmddFormatter.string(from: statementDate)
        let dueDateStr = Self.yyyymmddFormatter.string(from: dueDate)
        let startStr = Self.yyyymmddFormatter.string(from: statementStart)
        let endStr = Self.yyyymmddFormatter.string(from: statementEnd)

        if hasStatementStart && hasStatementEnd && startStr > endStr {
            errorMessage = "账期开始日不能晚于账期结束日"
            errorTrigger += 1
            return
        }

        var input = BillFieldsUpdateInput()
        var hasChanges = false

        if trimmedAmount != initialSnapshot.amountText {
            input.billAmount = parsedAmount
            hasChanges = true
        }
        if trimmedMin != initialSnapshot.minPaymentText {
            if let parsedMin {
                input.minPayment = parsedMin
            } else {
                input.clearMinPayment = true
            }
            hasChanges = true
        }
        if hasStatementDate != initialSnapshot.hasStatementDate || (hasStatementDate && stmtDateStr != initialSnapshot.statementDateStr) {
            if hasStatementDate {
                input.statementDate = stmtDateStr
            } else {
                input.clearStatementDate = true
            }
            hasChanges = true
        }
        if dueDateStr != initialSnapshot.dueDateStr {
            input.dueDate = dueDateStr
            hasChanges = true
        }
        if hasStatementStart != initialSnapshot.hasStatementStart || (hasStatementStart && startStr != initialSnapshot.statementStartStr) {
            if hasStatementStart {
                input.statementStart = startStr
            } else {
                input.clearStatementStart = true
            }
            hasChanges = true
        }
        if hasStatementEnd != initialSnapshot.hasStatementEnd || (hasStatementEnd && endStr != initialSnapshot.statementEndStr) {
            if hasStatementEnd {
                input.statementEnd = endStr
            } else {
                input.clearStatementEnd = true
            }
            hasChanges = true
        }

        guard hasChanges else {
            dismiss()
            return
        }

        isSubmitting = true
        defer { isSubmitting = false }

        do {
            try await appState.updateBillFields(billId: item.bill.id, input: input)
            successTrigger += 1
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
            errorTrigger += 1
        }
    }

    private func performDelete() async {
        errorMessage = nil
        isDeleting = true
        defer { isDeleting = false }

        do {
            try await appState.deleteBill(billId: item.bill.id)
            successTrigger += 1
            dismiss()
            onDeleted?()
        } catch {
            errorMessage = "删除账单失败：\(error.localizedDescription)"
            errorTrigger += 1
        }
    }

    private static func parseDate(_ raw: String) -> Date? {
        yyyymmddFormatter.date(from: String(raw.prefix(10)))
    }

    private static func formatDecimal(_ value: Double) -> String {
        String(format: "%.2f", value)
    }
}
