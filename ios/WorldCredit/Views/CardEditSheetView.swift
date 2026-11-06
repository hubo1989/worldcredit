import SwiftUI
import WorldCreditCore

struct CardEditSheetView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppState.self) private var appState
    let card: CardDisplayItem
    let onSave: (CardUpdateInput) async throws -> Void

    @State private var selectedBankId: String
    @State private var selectedCardProductId: String
    @State private var cardName: String
    @State private var selectedHolderId: String
    @State private var cardNumberLast4: String
    @State private var creditLimitText: String
    @State private var billingDayText: String
    @State private var hasCustomDueRule: Bool
    @State private var dueType: PaymentDueType
    @State private var dueValueText: String
    @State private var isSubmitting: Bool = false
    @State private var errorMessage: String?
    @State private var banks: [Bank] = []
    @State private var products: [CardProduct] = []

    init(card: CardDisplayItem, onSave: @escaping (CardUpdateInput) async throws -> Void) {
        self.card = card
        self.onSave = onSave
        let initialBankId = card.bank?.id ?? card.product?.bankId ?? ""
        _selectedBankId = State(initialValue: initialBankId)
        _selectedCardProductId = State(initialValue: card.card.cardProductId)
        let effectiveName = card.card.nameOverride ?? card.product?.cardName ?? card.displayName
        _cardName = State(initialValue: effectiveName)
        _selectedHolderId = State(initialValue: card.card.holderId)
        _cardNumberLast4 = State(initialValue: card.card.cardNumberLast4 ?? "")
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
                Section("卡片信息") {
                    Picker("所属银行", selection: $selectedBankId) {
                        if selectedBankId.isEmpty {
                            Text("未指定银行").tag("")
                        }
                        ForEach(banks) { bank in
                            Text(bank.shortName ?? bank.name).tag(bank.id)
                        }
                    }
                    .accessibilityIdentifier("card.edit.bank")

                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text("卡片名称")
                            Spacer()
                            TextField("输入卡片名称，或点选下方常用卡种", text: $cardName)
                                .multilineTextAlignment(.trailing)
                                .accessibilityIdentifier("card.edit.name")
                        }

                        if !products.isEmpty {
                            ScrollView(.horizontal, showsIndicators: false) {
                                HStack(spacing: 6) {
                                    ForEach(products) { prod in
                                        Button {
                                            selectedCardProductId = prod.id
                                            cardName = prod.cardName
                                        } label: {
                                            Text(prod.cardName)
                                                .font(.caption2)
                                                .padding(.horizontal, 8)
                                                .padding(.vertical, 4)
                                                .background(
                                                    selectedCardProductId == prod.id
                                                        ? WCColors.primaryAccent.opacity(0.15)
                                                        : Color.secondary.opacity(0.12)
                                                )
                                                .foregroundStyle(
                                                    selectedCardProductId == prod.id
                                                        ? WCColors.primaryAccent
                                                        : WCColors.textPrimary
                                                )
                                                .clipShape(Capsule())
                                        }
                                        .buttonStyle(.plain)
                                    }
                                }
                                .padding(.vertical, 2)
                            }
                        }
                    }
                }

                Section("人+卡账户信息") {
                    Picker("持卡人", selection: $selectedHolderId) {
                        ForEach(appState.dashboardHolders) { holder in
                            Text(holder.name).tag(holder.id)
                        }
                    }
                    .accessibilityIdentifier("card.edit.holder")

                    HStack {
                        Text("卡号尾号 (选填)")
                        Spacer()
                        TextField("如 8888", text: $cardNumberLast4)
                            .keyboardType(.asciiCapable)
                            .multilineTextAlignment(.trailing)
                            .accessibilityIdentifier("card.edit.last4")
                    }

                    HStack {
                        let symbol = DashboardMoney.currencySymbol(card.product?.currency ?? "CNY")
                        Text("信用额度 (\(symbol))")
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
            .task {
                await loadBanksAndProducts()
            }
            .onChange(of: selectedBankId) { _, newBankId in
                Task {
                    await handleBankChange(newBankId: newBankId)
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

    private func loadBanksAndProducts() async {
        let bList = await appState.allBanks()
        self.banks = bList
        if !selectedBankId.isEmpty {
            self.products = await appState.cardProducts(for: selectedBankId)
        }
    }

    private func handleBankChange(newBankId: String) async {
        guard !newBankId.isEmpty else { return }
        let prods = await appState.cardProducts(for: newBankId)
        self.products = prods
        if let first = prods.first {
            selectedCardProductId = first.id
            if cardName.isEmpty || cardName == card.displayName || cardName == card.product?.cardName {
                cardName = first.cardName
            }
        }
    }

    private func save() {
        let trimmedName = cardName.trimmingCharacters(in: .whitespaces)
        guard !trimmedName.isEmpty else {
            errorMessage = "请输入卡片名称"
            return
        }
        guard !selectedHolderId.isEmpty else {
            errorMessage = "请选择持卡人"
            return
        }
        guard let limit = Double(creditLimitText), limit >= 0 else {
            errorMessage = "请输入有效的信用额度"
            return
        }
        guard let day = Int(billingDayText), day >= 1 && day <= 31 else {
            errorMessage = "账单日必须在 1 到 31 之间"
            return
        }

        var input = CardUpdateInput()
        if !selectedCardProductId.isEmpty {
            input.cardProductId = selectedCardProductId
        }
        input.nameOverride = trimmedName
        input.holderId = selectedHolderId
        input.cardNumberLast4 = cardNumberLast4.trimmingCharacters(in: .whitespaces)
        input.creditLimit = limit
        // 关键收口：写入 billing_day，CardEditService 会强制清空 override_billing_day
        input.billingDay = day

        if hasCustomDueRule {
            guard let val = Int(dueValueText), val > 0 else {
                errorMessage = "请输入有效的还款天数或日期"
                return
            }
            input.overrideDueType = dueType
            input.overrideDueValue = val
        } else {
            input.clearDueOverride = true
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
