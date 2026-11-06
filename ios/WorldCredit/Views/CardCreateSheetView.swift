import SwiftUI
import WorldCreditCore

struct CardCreateSheetView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppState.self) private var appState

    @State private var selectedBankId: String = ""
    @State private var selectedCardProductId: String = ""
    @State private var cardName: String = ""
    @State private var selectedHolderId: String = ""
    @State private var isCreatingHolder: Bool = false
    @State private var newHolderName: String = ""
    @State private var cardNumberLast4: String = ""
    @State private var creditLimitText: String = "20000"
    @State private var billingDayText: String = "10"
    @State private var banks: [Bank] = []
    @State private var products: [CardProduct] = []
    @State private var isSubmitting: Bool = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                Section("卡片信息") {
                    Picker("所属银行", selection: $selectedBankId) {
                        if selectedBankId.isEmpty {
                            Text("请选择发卡银行").tag("")
                        }
                        ForEach(banks) { bank in
                            Text(bank.shortName ?? bank.name).tag(bank.id)
                        }
                    }
                    .accessibilityIdentifier("card.create.bank")

                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text("卡片名称")
                            Spacer()
                            TextField("输入卡片名称，或点选常用卡种", text: $cardName)
                                .multilineTextAlignment(.trailing)
                                .accessibilityIdentifier("card.create.name")
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

                Section("持卡人") {
                    if isCreatingHolder {
                        HStack {
                            TextField("持卡人姓名", text: $newHolderName)
                                .accessibilityIdentifier("card.create.newHolderName")
                            Button("取消") {
                                isCreatingHolder = false
                                newHolderName = ""
                            }
                            .font(.footnote)
                        }
                    } else {
                        Picker("持卡人", selection: $selectedHolderId) {
                            if selectedHolderId.isEmpty {
                                Text("请选择持卡人").tag("")
                            }
                            ForEach(appState.dashboardHolders) { holder in
                                Text(holder.name).tag(holder.id)
                            }
                        }
                        .accessibilityIdentifier("card.create.holder")

                        Button {
                            isCreatingHolder = true
                        } label: {
                            Label("新建持卡人", systemImage: "plus.circle")
                                .font(.footnote)
                                .foregroundStyle(WCColors.primaryAccent)
                        }
                    }
                }

                Section("账户信息") {
                    HStack {
                        Text("卡号尾号 (选填)")
                        Spacer()
                        TextField("如 8888", text: $cardNumberLast4)
                            .keyboardType(.asciiCapable)
                            .multilineTextAlignment(.trailing)
                            .accessibilityIdentifier("card.create.last4")
                    }

                    HStack {
                        Text("信用额度 (¥)")
                        Spacer()
                        TextField("0", text: $creditLimitText)
                            .keyboardType(.numberPad)
                            .multilineTextAlignment(.trailing)
                            .accessibilityIdentifier("card.create.limit")
                    }

                    HStack {
                        Text("每月账单日")
                        Spacer()
                        TextField("1-31", text: $billingDayText)
                            .keyboardType(.numberPad)
                            .multilineTextAlignment(.trailing)
                            .accessibilityIdentifier("card.create.billingDay")
                        Text("日")
                            .foregroundStyle(.secondary)
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
            .navigationTitle("新增卡片")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(action: createCard) {
                        if isSubmitting {
                            ProgressView()
                        } else {
                            Text("创建卡片")
                                .bold()
                        }
                    }
                    .disabled(isSubmitting)
                    .accessibilityIdentifier("card.create.submit")
                }
            }
            .task {
                await loadBanks()
            }
            .onChange(of: selectedBankId) { _, newBankId in
                Task {
                    await handleBankChange(newBankId: newBankId)
                }
            }
        }
    }

    private func loadBanks() async {
        let bList = await appState.allBanks()
        self.banks = bList
        if let first = bList.first, selectedBankId.isEmpty {
            selectedBankId = first.id
        }
        if selectedHolderId.isEmpty, let firstHolder = appState.dashboardHolders.first {
            selectedHolderId = firstHolder.id
        }
    }

    private func handleBankChange(newBankId: String) async {
        guard !newBankId.isEmpty else {
            products = []
            return
        }
        let prods = await appState.cardProducts(for: newBankId)
        self.products = prods
        if let first = prods.first {
            selectedCardProductId = first.id
            if cardName.isEmpty {
                cardName = first.cardName
            }
        } else {
            selectedCardProductId = ""
            if cardName.isEmpty {
                let bankName = banks.first(where: { $0.id == newBankId })?.shortName ?? "信用卡"
                cardName = "\(bankName)信用卡"
            }
        }
    }

    private func createCard() {
        guard !selectedBankId.isEmpty else {
            errorMessage = "请选择发卡银行"
            return
        }
        let trimmedName = cardName.trimmingCharacters(in: .whitespaces)
        guard !trimmedName.isEmpty else {
            errorMessage = "请输入卡片名称"
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

        isSubmitting = true
        errorMessage = nil

        Task {
            do {
                let finalHolderId: String
                if isCreatingHolder {
                    let hName = newHolderName.trimmingCharacters(in: .whitespaces)
                    guard !hName.isEmpty else {
                        errorMessage = "请输入持卡人姓名"
                        isSubmitting = false
                        return
                    }
                    let holder = try await appState.createHolder(name: hName)
                    finalHolderId = holder.id
                } else {
                    guard !selectedHolderId.isEmpty else {
                        errorMessage = "请选择持卡人"
                        isSubmitting = false
                        return
                    }
                    finalHolderId = selectedHolderId
                }

                try await appState.createCard(
                    holderId: finalHolderId,
                    bankId: selectedBankId,
                    cardProductId: selectedCardProductId.isEmpty ? nil : selectedCardProductId,
                    cardName: trimmedName,
                    last4: cardNumberLast4.trimmingCharacters(in: .whitespaces),
                    creditLimit: limit,
                    billingDay: day
                )
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
                isSubmitting = false
            }
        }
    }
}
