import SwiftUI
import WorldCreditCore

struct AccountMergeWizardSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppState.self) private var appState

    var preselectedCardId: String? = nil
    var onMerged: (() -> Void)? = nil

    @State private var selectedBucketId: String = ""
    @State private var targetAccountId: String = ""
    @State private var selectedCardIds: Set<String> = []
    @State private var showingConfirmDialog: Bool = false
    @State private var isSubmitting: Bool = false
    @State private var errorMessage: String?

    private struct MergeBucket: Identifiable, Hashable {
        let holderId: String
        let holderName: String
        let bankId: String?
        let bankKey: String
        let bankDisplayName: String
        let currency: String
        let cards: [CardDisplayItem]

        var id: String { "\(holderId)|\(bankKey)|\(currency)" }

        var title: String {
            "\(holderName) · \(bankDisplayName) (\(currency))"
        }

        static func == (lhs: MergeBucket, rhs: MergeBucket) -> Bool {
            lhs.id == rhs.id
        }

        func hash(into hasher: inout Hasher) {
            hasher.combine(id)
        }
    }

    private var eligibleCards: [CardDisplayItem] {
        appState.cards.filter {
            $0.card.cardType != "loan" && $0.card.status == "active"
        }
    }

    private var buckets: [MergeBucket] {
        var grouped: [String: [CardDisplayItem]] = [:]
        var meta: [String: (holderId: String, holderName: String, bankId: String?, bankKey: String, bankDisplay: String, currency: String)] = [:]

        for card in eligibleCards {
            let holderId = card.card.holderId
            let holderName = card.holderName.isEmpty ? "默认持卡人" : card.holderName
            let bankKey = (card.product?.bankName ?? card.bank?.name ?? card.bankName)
                .trimmingCharacters(in: .whitespacesAndNewlines)
            let resolvedBankKey = bankKey.isEmpty ? "未知银行" : bankKey
            let bankDisplay = card.bankName.isEmpty ? resolvedBankKey : card.bankName
            let bankId = card.bank?.id ?? card.product?.bankId
            let currency = card.product?.currency ?? "CNY"
            let key = "\(holderId)|\(resolvedBankKey)|\(currency)"

            grouped[key, default: []].append(card)
            if meta[key] == nil {
                meta[key] = (holderId, holderName, bankId, resolvedBankKey, bankDisplay, currency)
            }
        }

        return grouped.compactMap { key, list in
            guard list.count >= 2, let m = meta[key] else { return nil }
            return MergeBucket(
                holderId: m.holderId,
                holderName: m.holderName,
                bankId: m.bankId,
                bankKey: m.bankKey,
                bankDisplayName: m.bankDisplay,
                currency: m.currency,
                cards: list
            )
        }
        .sorted { $0.title.localizedCompare($1.title) == .orderedAscending }
    }

    private var activeBucket: MergeBucket? {
        buckets.first(where: { $0.id == selectedBucketId }) ?? buckets.first
    }

    private var candidateAccounts: [CreditAccountGroup] {
        guard let bucket = activeBucket else { return [] }
        return appState.creditAccountGroups.filter { group in
            guard group.account.holderId == bucket.holderId,
                  group.account.currency == bucket.currency else {
                return false
            }
            if let accBankId = group.account.bankId, let bucketBankId = bucket.bankId,
               !accBankId.isEmpty, accBankId == bucketBankId {
                return true
            }
            let accBankName = group.account.bankName.trimmingCharacters(in: .whitespacesAndNewlines)
            if !accBankName.isEmpty && accBankName == bucket.bankKey {
                return true
            }
            if let gBankName = group.bank?.name.trimmingCharacters(in: .whitespacesAndNewlines),
               !gBankName.isEmpty, gBankName == bucket.bankKey {
                return true
            }
            return false
        }
    }

    private var selectedTargetGroup: CreditAccountGroup? {
        candidateAccounts.first(where: { $0.account.id == targetAccountId }) ?? candidateAccounts.first
    }

    private func isProtectedSourcePrimary(_ card: CardDisplayItem) -> Bool {
        guard let sourceAccountId = card.card.accountId,
              !sourceAccountId.isEmpty,
              sourceAccountId != targetAccountId else {
            return false
        }
        guard let sourceGroup = appState.creditAccountGroups.first(where: { $0.account.id == sourceAccountId }),
              sourceGroup.account.primaryCardId == card.id else {
            return false
        }
        let activeCount = appState.cards.filter { $0.card.accountId == sourceAccountId }.count
        return sourceGroup.cards.count > 1 || activeCount > 1
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("当同一持卡人在同一家银行持有多张同币种信用卡、且银行合并出账时，可将它们并入同一个信用账户。合并后共享额度池且仅生成一份权威账单。")
                        .font(.footnote)
                        .foregroundStyle(WCColors.textSecondary)
                        .padding(.vertical, 2)
                }

                if let errorMessage {
                    Section {
                        HStack(alignment: .top, spacing: 8) {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .foregroundStyle(WCColors.dangerInk)
                            Text(errorMessage)
                                .font(.footnote)
                                .foregroundStyle(WCColors.dangerInk)
                        }
                        .padding(.vertical, 2)
                        .accessibilityIdentifier("merge.error")
                    }
                }

                if buckets.isEmpty {
                    Section {
                        ContentUnavailableView {
                            Label("暂无可合并的卡片组合", systemImage: "rectangle.stack.badge.plus")
                        } description: {
                            Text("需要同一持卡人、同一银行且同币种下至少有 2 张有效信用卡，才支持合并为统一账单账户。")
                        }
                    }
                } else if let bucket = activeBucket {
                    Section("1. 选择持卡人与银行组合") {
                        Picker("同人同银行同币种", selection: $selectedBucketId) {
                            ForEach(buckets) { item in
                                Text("\(item.title)（\(item.cards.count) 张卡）").tag(item.id)
                            }
                        }
                        .accessibilityIdentifier("merge.bucketPicker")
                    }

                    Section("2. 选择归入的目标账户") {
                        if candidateAccounts.isEmpty {
                            VStack(alignment: .leading, spacing: 6) {
                                Label("该组合名下暂无已建立的信用账户", systemImage: "info.circle")
                                    .font(.footnote.bold())
                                    .foregroundStyle(WCColors.warningInk)
                                Text("请先下拉同步最新账户数据，或在网页端为其中一张卡片建立账户后再执行合并。")
                                    .font(.caption)
                                    .foregroundStyle(WCColors.textSecondary)
                            }
                            .padding(.vertical, 4)
                        } else {
                            Picker("目标信用账户", selection: $targetAccountId) {
                                ForEach(candidateAccounts) { group in
                                    Text(accountDisplayTitle(group))
                                        .tag(group.account.id)
                                }
                            }
                            .accessibilityIdentifier("merge.targetAccountPicker")
                        }
                    }

                    Section("3. 勾选待并入的卡片") {
                        ForEach(bucket.cards) { card in
                            let alreadyInTarget = !targetAccountId.isEmpty && card.card.accountId == targetAccountId
                            let isAnchor = alreadyInTarget && selectedTargetGroup?.account.primaryCardId == card.id
                            let protectedSourcePrimary = !alreadyInTarget && isProtectedSourcePrimary(card)
                            let isDisabled = alreadyInTarget || protectedSourcePrimary
                            let isSelected = !isDisabled && selectedCardIds.contains(card.id)

                            Button {
                                guard !isDisabled else { return }
                                HapticManager.selection()
                                errorMessage = nil
                                if isSelected {
                                    selectedCardIds.remove(card.id)
                                } else {
                                    selectedCardIds.insert(card.id)
                                }
                            } label: {
                                HStack(spacing: 12) {
                                    Image(systemName: alreadyInTarget
                                        ? "checkmark.circle.fill"
                                        : (protectedSourcePrimary
                                            ? "lock.circle"
                                            : (isSelected ? "checkmark.circle.fill" : "circle")))
                                        .font(.title3)
                                        .foregroundStyle(isDisabled ? WCColors.textSecondary : (isSelected ? WCColors.primaryAccent : WCColors.textSecondary))

                                    VStack(alignment: .leading, spacing: 3) {
                                        HStack(spacing: 6) {
                                            Text(card.displayName)
                                                .font(.subheadline.bold())
                                                .foregroundStyle(isDisabled ? WCColors.textSecondary : WCColors.textPrimary)
                                            if !card.last4.isEmpty {
                                                Text("尾号 \(card.last4)")
                                                    .font(.caption)
                                                    .foregroundStyle(WCColors.textSecondary)
                                            }
                                        }

                                        if isAnchor {
                                            Text("目标账户主卡（不可重复合并）")
                                                .font(.caption2)
                                                .foregroundStyle(WCColors.primaryAccent)
                                        } else if alreadyInTarget {
                                            Text("已在目标账户中")
                                                .font(.caption2)
                                                .foregroundStyle(WCColors.textSecondary)
                                        } else if protectedSourcePrimary {
                                            Text("原多卡账户主卡（需先在卡片详情拆出后再合并）")
                                                .font(.caption2)
                                                .foregroundStyle(WCColors.warningInk)
                                        } else {
                                            Text("账单日每月 \(card.card.overrideBillingDay ?? card.card.billingDay) 日 · 额度 \(DashboardMoney.format(card.card.effectiveCreditLimit, currency: bucket.currency))")
                                                .font(.caption2)
                                                .foregroundStyle(WCColors.textSecondary)
                                        }
                                    }

                                    Spacer()
                                }
                            }
                            .buttonStyle(.plain)
                            .disabled(isDisabled)
                            .accessibilityIdentifier("merge.card.\(card.id)")
                        }
                    }

                    if !selectedCardIds.isEmpty {
                        Section {
                            Label(
                                "将把已勾选的 \(selectedCardIds.count) 张卡并入目标账户，历史账单将迁移至目标账户主卡；若存在同月重复账单系统会阻止合并并提示。",
                                systemImage: "exclamationmark.shield"
                            )
                            .font(.caption)
                            .foregroundStyle(WCColors.warningInk)
                        }
                    }
                }
            }
            .navigationTitle("合并为统一账单账户")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") {
                        dismiss()
                    }
                    .disabled(isSubmitting)
                }

                if !buckets.isEmpty {
                    ToolbarItem(placement: .confirmationAction) {
                        Button {
                            showingConfirmDialog = true
                        } label: {
                            if isSubmitting {
                                ProgressView()
                            } else {
                                Text("确认合并")
                                    .bold()
                            }
                        }
                        .disabled(isSubmitting || targetAccountId.isEmpty || selectedCardIds.isEmpty)
                        .accessibilityIdentifier("merge.submit")
                    }
                }
            }
            .onAppear {
                initializeSelections()
            }
            .onChange(of: selectedBucketId) { _, _ in
                syncTargetAccountAndCards(preferPreservingCards: false)
            }
            .onChange(of: targetAccountId) { _, _ in
                selectedCardIds = selectedCardIds.filter { cardId in
                    guard let card = activeBucket?.cards.first(where: { $0.id == cardId }) else { return false }
                    return card.card.accountId != targetAccountId && !isProtectedSourcePrimary(card)
                }
            }
            .confirmationDialog(
                "确认将 \(selectedCardIds.count) 张卡片并入目标账户？",
                isPresented: $showingConfirmDialog,
                titleVisibility: .visible
            ) {
                Button("确认执行合并", role: .destructive) {
                    performMerge()
                }
                Button("取消", role: .cancel) {}
            } message: {
                Text("合并后待合并卡片的历史账单归属将迁移到目标账户主卡名下，共享账户额度与统一账单。")
            }
        }
    }

    private func accountDisplayTitle(_ group: CreditAccountGroup) -> String {
        let baseTitle: String
        if let label = group.account.label?.trimmingCharacters(in: .whitespacesAndNewlines), !label.isEmpty {
            baseTitle = label
        } else {
            let bank = group.bank?.shortName ?? group.bank?.name ?? group.account.bankName
            baseTitle = "\(bank)账户"
        }
        let primaryTail = group.cards.first(where: { $0.id == group.account.primaryCardId })?.last4
            ?? group.cards.first?.last4
            ?? ""
        let tailText = primaryTail.isEmpty ? "" : " · 主卡 \(primaryTail)"
        return "\(baseTitle)\(tailText)（\(group.cards.count)张）"
    }

    private func initializeSelections() {
        if let preselectedCardId,
           let matchedBucket = buckets.first(where: { bucket in
               bucket.cards.contains(where: { $0.id == preselectedCardId })
           }) {
            selectedBucketId = matchedBucket.id
            syncTargetAccountAndCards(preferPreservingCards: false)
            if let preCard = matchedBucket.cards.first(where: { $0.id == preselectedCardId }),
               preCard.card.accountId != targetAccountId,
               !isProtectedSourcePrimary(preCard) {
                selectedCardIds.insert(preselectedCardId)
            }
        } else if let firstBucket = buckets.first {
            selectedBucketId = firstBucket.id
            syncTargetAccountAndCards(preferPreservingCards: false)
        }
    }

    private func syncTargetAccountAndCards(preferPreservingCards: Bool) {
        errorMessage = nil
        if let firstAccount = candidateAccounts.first {
            if !candidateAccounts.contains(where: { $0.account.id == targetAccountId }) {
                targetAccountId = firstAccount.account.id
            }
        } else {
            targetAccountId = ""
        }
        if !preferPreservingCards {
            selectedCardIds = []
        }
    }

    private func performMerge() {
        guard !targetAccountId.isEmpty, !selectedCardIds.isEmpty else { return }
        isSubmitting = true
        errorMessage = nil

        let targetId = targetAccountId
        let cardIds = Array(selectedCardIds)

        Task {
            do {
                _ = try await appState.mergeCardsIntoAccount(targetAccountId: targetId, cardIds: cardIds)
                HapticManager.success()
                onMerged?()
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
                HapticManager.error()
                isSubmitting = false
            }
        }
    }
}
