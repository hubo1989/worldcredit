import SwiftUI
import WorldCreditCore

/// 录入信用卡账单 Sheet（替代原 `.createBill` WebView）。
struct BillCreateSheetView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss

    @State private var selectedCardId: String = ""
    @State private var selectedYear: Int
    @State private var selectedMonth: Int
    @State private var billAmountText: String = ""
    @State private var minPaymentText: String = ""
    @State private var includeStatementDate: Bool = true
    @State private var statementDate: Date = Date()
    @State private var dueDate: Date = Date()
    @State private var hasManuallyEditedStatementDate: Bool = false
    @State private var hasManuallyEditedDueDate: Bool = false
    @State private var suggestedStatementDateValue: Date?
    @State private var suggestedDueDateValue: Date?

    @State private var isSubmitting: Bool = false
    @State private var errorMessage: String?
    @State private var saveFeedbackTrigger: Int = 0
    @State private var errorFeedbackTrigger: Int = 0

    private static let shanghaiZone = TimeZone(identifier: "Asia/Shanghai") ?? .current

    private static let yyyymmddFormatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = shanghaiZone
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    private static var shanghaiCalendar: Calendar {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = shanghaiZone
        return cal
    }

    init() {
        let cal = Self.shanghaiCalendar
        let now = Date()
        _selectedYear = State(initialValue: cal.component(.year, from: now))
        _selectedMonth = State(initialValue: cal.component(.month, from: now))
    }

    private var activeCreditCards: [CardDisplayItem] {
        appState.cards.filter { $0.card.cardType != "loan" }
    }

    private var selectableCards: [CardDisplayItem] {
        activeCreditCards.isEmpty ? appState.cards : activeCreditCards
    }

    private var selectedCard: CardDisplayItem? {
        selectableCards.first(where: { $0.id == selectedCardId })
    }

    private var currencyCode: String {
        selectedCard?.product?.currency ?? appState.displayConfig.defaultCurrency
    }

    private var currencySymbol: String {
        DashboardMoney.currencySymbol(currencyCode)
    }

    private var billMonthString: String {
        String(format: "%04d-%02d", selectedYear, selectedMonth)
    }

    private var selectedAccountGroup: CreditAccountGroup? {
        guard let accountId = selectedCard?.card.accountId, !accountId.isEmpty else { return nil }
        return appState.creditAccountGroups.first(where: { $0.account.id == accountId })
    }

    private var duplicateBillExists: Bool {
        guard let selected = selectedCard, !selectedCardId.isEmpty else { return false }
        let targetAccountId = selected.card.accountId
        let isMergedAccount = selectedAccountGroup?.isMergedStatement ?? false
        return appState.allBills.contains { item in
            guard item.bill.billMonth == billMonthString else { return false }
            if item.card.id == selectedCardId { return true }
            if isMergedAccount, let targetAccountId, !targetAccountId.isEmpty {
                return item.bill.accountId == targetAccountId
                    || item.card.accountId == targetAccountId
                    || item.card.id == selectedAccountGroup?.account.primaryCardId
            }
            return false
        }
    }

    private var yearRange: [Int] {
        let currentYear = Self.shanghaiCalendar.component(.year, from: Date())
        return Array((currentYear - 2)...(currentYear + 1))
    }

    private var billMonthAnchorDate: Date {
        var comp = DateComponents()
        comp.year = selectedYear
        comp.month = selectedMonth
        comp.day = 1
        return Self.shanghaiCalendar.date(from: comp) ?? Date()
    }

    var body: some View {
        NavigationStack {
            Form {
                if selectableCards.isEmpty {
                    Section {
                        ContentUnavailableView(
                            "暂无信用卡",
                            systemImage: "creditcard",
                            description: Text("请先在「账户」页添加信用卡后再录入账单。")
                        )
                    }
                } else {
                    Section("账单归属") {
                        Picker("信用卡", selection: $selectedCardId) {
                            ForEach(selectableCards) { card in
                                Text(cardLabel(card)).tag(card.id)
                            }
                        }
                        .accessibilityIdentifier("bill.create.card")

                        HStack {
                            Text("账单月份")
                            Spacer()
                            Picker("年份", selection: $selectedYear) {
                                ForEach(yearRange, id: \.self) { year in
                                    Text("\(String(year))年").tag(year)
                                }
                            }
                            .labelsHidden()
                            .pickerStyle(.menu)

                            Picker("月份", selection: $selectedMonth) {
                                ForEach(1...12, id: \.self) { month in
                                    Text("\(month)月").tag(month)
                                }
                            }
                            .labelsHidden()
                            .pickerStyle(.menu)
                        }
                        .accessibilityIdentifier("bill.create.month")

                        if duplicateBillExists {
                            Label("该账户/卡片 \(billMonthString) 期已存在本地账单，重复录入可能冲突。", systemImage: "exclamationmark.triangle.fill")
                                .font(.caption)
                                .foregroundStyle(WCColors.warningInk)
                        }
                    }

                    Section("账单金额（\(currencyCode)）") {
                        HStack {
                            Text("账单金额 (\(currencySymbol))")
                            Spacer()
                            TextField("0.00", text: $billAmountText)
                                .keyboardType(.decimalPad)
                                .multilineTextAlignment(.trailing)
                                .accessibilityIdentifier("bill.create.amount")
                        }

                        HStack {
                            Text("最低还款额（选填）")
                            Spacer()
                            TextField("可留空", text: $minPaymentText)
                                .keyboardType(.decimalPad)
                                .multilineTextAlignment(.trailing)
                                .accessibilityIdentifier("bill.create.minPayment")
                        }
                    }

                    Section {
                        Toggle("设置出账日 / 账单日", isOn: $includeStatementDate)
                        if includeStatementDate {
                            DatePicker(
                                "出账日",
                                selection: $statementDate,
                                displayedComponents: .date
                            )
                            .environment(\.timeZone, Self.shanghaiZone)
                            .accessibilityIdentifier("bill.create.statementDate")
                        }

                        DatePicker(
                            "还款到期日",
                            selection: $dueDate,
                            displayedComponents: .date
                        )
                        .environment(\.timeZone, Self.shanghaiZone)
                        .accessibilityIdentifier("bill.create.dueDate")

                        if let selectedCard {
                            HStack {
                                Text("已按卡片规则预填")
                                    .font(.caption)
                                    .foregroundStyle(WCColors.textSecondary)
                                Spacer()
                                Button("按卡规则重填日期") {
                                    hasManuallyEditedDueDate = false
                                    hasManuallyEditedStatementDate = false
                                    applySuggestedDates(for: selectedCard, force: true)
                                }
                                .font(.caption.weight(.medium))
                                .foregroundStyle(WCColors.primaryAccent)
                            }
                        }
                    } header: {
                        Text("账单日与到期日")
                    } footer: {
                        if let card = selectedCard {
                            let effectiveBillingDay = BillingDateCalculator.getEffectiveBillingDay(card: card.card)
                            Text("每月 \(effectiveBillingDay) 日出账；到期日可在此基础上微调。")
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
            }
            .navigationTitle("录入账单")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                        .disabled(isSubmitting)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        Task { await submit() }
                    } label: {
                        if isSubmitting {
                            ProgressView()
                        } else {
                            Text("保存").bold()
                        }
                    }
                    .disabled(isSubmitting || selectableCards.isEmpty)
                    .accessibilityIdentifier("bill.create.submit")
                }
            }
            .onAppear {
                if selectedCardId.isEmpty, let first = selectableCards.first {
                    selectedCardId = first.id
                    applySuggestedDates(for: first, force: true)
                }
            }
            .onChange(of: selectedCardId) { _, _ in
                if let card = selectedCard {
                    applySuggestedDates(for: card, force: false)
                }
            }
            .onChange(of: selectedYear) { _, _ in
                if let card = selectedCard {
                    applySuggestedDates(for: card, force: false)
                }
            }
            .onChange(of: selectedMonth) { _, _ in
                if let card = selectedCard {
                    applySuggestedDates(for: card, force: false)
                }
            }
            .onChange(of: statementDate) { _, newValue in
                if let suggested = suggestedStatementDateValue,
                   Self.yyyymmddFormatter.string(from: newValue) == Self.yyyymmddFormatter.string(from: suggested) {
                    return
                }
                hasManuallyEditedStatementDate = true
            }
            .onChange(of: dueDate) { _, newValue in
                if let suggested = suggestedDueDateValue,
                   Self.yyyymmddFormatter.string(from: newValue) == Self.yyyymmddFormatter.string(from: suggested) {
                    return
                }
                hasManuallyEditedDueDate = true
            }
            .sensoryFeedback(.success, trigger: saveFeedbackTrigger)
            .sensoryFeedback(.error, trigger: errorFeedbackTrigger)
        }
    }

    private func cardLabel(_ item: CardDisplayItem) -> String {
        let bank = item.bankName
        let name = item.displayName
        let tail = item.last4.trimmingCharacters(in: .whitespacesAndNewlines)
        let base = bank.isEmpty ? name : "\(bank) · \(name)"
        return tail.isEmpty ? base : "\(base) (\(tail))"
    }

    private func applySuggestedDates(for item: CardDisplayItem, force: Bool) {
        let anchor = billMonthAnchorDate
        let billingDay = BillingDateCalculator.getEffectiveBillingDay(card: item.card)
        let suggestedStatement = BillingDateCalculator.getActualBillingDate(
            billingDay: billingDay,
            month: anchor
        )

        let suggestedDue: Date
        if item.card.cardType == "loan", let loanDay = item.card.loanDueDay {
            suggestedDue = BillingDateCalculator.getActualBillingDate(billingDay: loanDay, month: anchor)
        } else if let product = item.product {
            suggestedDue = BillingDateCalculator.getDueDate(
                card: item.card,
                cardProduct: product,
                billMonth: anchor
            )
        } else {
            suggestedDue = Self.shanghaiCalendar.date(byAdding: .day, value: 20, to: suggestedStatement)
                ?? suggestedStatement
        }

        if force || !hasManuallyEditedStatementDate {
            suggestedStatementDateValue = suggestedStatement
            statementDate = suggestedStatement
        }
        if force || !hasManuallyEditedDueDate {
            suggestedDueDateValue = suggestedDue
            dueDate = suggestedDue
        }
    }

    private func statementPeriodBounds() -> (start: String, end: String) {
        let cal = Self.shanghaiCalendar
        let anchor = billMonthAnchorDate
        let dayCount = cal.range(of: .day, in: .month, for: anchor)?.count ?? 28
        var endComp = cal.dateComponents([.year, .month], from: anchor)
        endComp.day = dayCount
        let endDate = cal.date(from: endComp) ?? anchor
        return (
            Self.yyyymmddFormatter.string(from: anchor),
            Self.yyyymmddFormatter.string(from: endDate)
        )
    }

    private func submit() async {
        errorMessage = nil
        guard !selectedCardId.isEmpty else {
            errorMessage = "请选择信用卡"
            errorFeedbackTrigger += 1
            return
        }
        let trimmedAmount = billAmountText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let billAmount = Double(trimmedAmount), billAmount.isFinite, billAmount >= 0 else {
            errorMessage = "账单金额必须是不小于 0 的数字"
            errorFeedbackTrigger += 1
            return
        }
        let trimmedMin = minPaymentText.trimmingCharacters(in: .whitespacesAndNewlines)
        var parsedMinPayment: Double?
        if !trimmedMin.isEmpty {
            guard let minP = Double(trimmedMin), minP.isFinite, minP >= 0 else {
                errorMessage = "最低还款额必须是不小于 0 的数字"
                errorFeedbackTrigger += 1
                return
            }
            parsedMinPayment = minP
        }

        let dueDateStr = Self.yyyymmddFormatter.string(from: dueDate)
        let statementDateStr = includeStatementDate ? Self.yyyymmddFormatter.string(from: statementDate) : nil
        let bounds = statementPeriodBounds()

        isSubmitting = true
        defer { isSubmitting = false }

        do {
            _ = try await appState.createBill(
                cardId: selectedCardId,
                billMonth: billMonthString,
                billAmount: billAmount,
                minPayment: parsedMinPayment,
                dueDate: dueDateStr,
                statementDate: statementDateStr,
                statementStart: bounds.start,
                statementEnd: bounds.end
            )
            saveFeedbackTrigger += 1
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
            errorFeedbackTrigger += 1
        }
    }
}
