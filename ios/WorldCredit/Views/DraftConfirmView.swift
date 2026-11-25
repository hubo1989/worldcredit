import SwiftUI
import QuickLook
import WorldCreditCore

struct DraftConfirmView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss

    let draftId: String
    let initialDraft: BillImportDraftDTO?
    var onConfirmed: (() -> Void)? = nil

    @State private var draft: BillImportDraftDTO?
    @State private var isLoading = false
    @State private var isSubmitting = false
    @State private var errorMessage: String?

    // 解密状态
    @State private var pdfPassword = ""
    @State private var savePasswordToVault = true
    @State private var vaultHint = ""

    // 编辑字段
    @State private var selectedCardId = ""
    @State private var billMonth = ""
    @State private var currency = "CNY"
    @State private var billAmountText = ""
    @State private var minPaymentText = ""
    @State private var statementDateText = ""
    @State private var dueDateText = ""

    // 建卡与预览
    @State private var showingCardCreate = false
    @State private var showingDiscardConfirm = false
    @State private var duplicateConflict: DuplicateBillConflictDetails?
    @State private var previewFileURL: URL?
    @State private var isLoadingPreview = false

    private static let supportedCurrencies = ["CNY", "USD", "HKD", "JPY", "EUR", "GBP"]

    init(draftId: String, initialDraft: BillImportDraftDTO? = nil, onConfirmed: (() -> Void)? = nil) {
        self.draftId = draftId
        self.initialDraft = initialDraft
        self.onConfirmed = onConfirmed
    }

    var body: some View {
        Form {
            if let errorMessage {
                Section {
                    Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                        .font(.footnote)
                        .foregroundStyle(WCColors.dangerInk)
                }
            }

            if isLoading && draft == nil {
                Section {
                    HStack {
                        Spacer()
                        ProgressView("正在加载草稿详情…")
                        Spacer()
                    }
                    .padding(.vertical, 20)
                }
            } else if let draft {
                statusHeaderSection(draft)

                if draft.parseStatus == "needs_password" {
                    passwordUnlockSection(draft)
                } else if draft.parseStatus == "parse_failed" {
                    parseFailedSection(draft)
                } else {
                    editFieldsSection(draft)
                    if let subtotals = draft.parsedPayload.cardSubtotals, !subtotals.isEmpty {
                        subtotalsSection(subtotals)
                    }
                    sourcePreviewSection(draft)
                    actionsSection(draft)
                }
            }
        }
        .navigationTitle("核对账单草稿")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            if let initialDraft, draft == nil {
                applyDraft(initialDraft)
            }
            await reloadDraft()
        }
        .sheet(isPresented: $showingCardCreate) {
            CardCreateSheetView()
                .onDisappear {
                    Task { await appState.reloadData() }
                }
        }
        .quickLookPreview($previewFileURL)
        .confirmationDialog("确定丢弃此草稿？", isPresented: $showingDiscardConfirm, titleVisibility: .visible) {
            Button("丢弃草稿", role: .destructive) {
                Task { await performDiscard() }
            }
            Button("取消", role: .cancel) {}
        } message: {
            Text("邮件来源草稿丢弃后将保留去重标记，下次同步不会重复生成。")
        }
        .alert("检测到同卡同月重复账单", isPresented: Binding(
            get: { duplicateConflict != nil },
            set: { if !$0 { duplicateConflict = nil } }
        )) {
            Button("合并更新原账单") {
                Task { await performConfirm(conflictResolution: "merge_update") }
            }
            Button("丢弃草稿", role: .destructive) {
                duplicateConflict = nil
                Task { await performDiscard() }
            }
            Button("取消", role: .cancel) { duplicateConflict = nil }
        } message: {
            if let dup = duplicateConflict {
                Text(
                    "该卡在 \(dup.billMonth) 已存在账单（\(DashboardMoney.format(dup.existingAmount, currency: dup.currency))，状态：\(dup.existingStatus)），新草稿金额为 \(DashboardMoney.format(dup.draftAmount, currency: dup.currency))。是否合并更新？"
                )
            }
        }
    }

    @ViewBuilder
    private func statusHeaderSection(_ draft: BillImportDraftDTO) -> some View {
        Section("识别摘要") {
            LabeledContent("来源", value: draft.sourceLabel ?? draft.sourceType)
            if let conf = draft.confidence {
                LabeledContent("置信度", value: "\(Int((conf * 100).rounded()))%")
            }
            if let attr = draft.attributionSource {
                LabeledContent("归属依据", value: attributionLabel(attr))
            }
            if let legacy = draft.parsedPayload.legacyLedger, legacy.paidAmount > 0 {
                Text("历史已还 \(DashboardMoney.format(legacy.paidAmount, currency: currency))，确认后将自动补记还款记录。")
                    .font(.caption)
                    .foregroundStyle(WCColors.successInk)
            }
            if let warnings = draft.parsedPayload.warnings, !warnings.isEmpty {
                ForEach(warnings, id: \.self) { warn in
                    Label(warn, systemImage: "exclamationmark.circle")
                        .font(.caption)
                        .foregroundStyle(WCColors.warningInk)
                }
            }
        }
    }

    @ViewBuilder
    private func passwordUnlockSection(_ draft: BillImportDraftDTO) -> some View {
        Section("PDF 密码解锁") {
            if let hint = draft.passwordHint, !hint.isEmpty {
                Text("提示：\(hint)")
                    .font(.caption)
                    .foregroundStyle(WCColors.warningInk)
            }
            SecureField("输入 PDF 打开密码", text: $pdfPassword)
                .accessibilityIdentifier("draft.unlock.password")
            Toggle("保存到月结单密码本", isOn: $savePasswordToVault)
            if savePasswordToVault {
                TextField("密码提示词（选填，如：身份证后6位）", text: $vaultHint)
            }
            Button {
                Task { await performUnlock(draft) }
            } label: {
                HStack {
                    Text("解锁并解析")
                    Spacer()
                    if isSubmitting { ProgressView() }
                }
            }
            .disabled(pdfPassword.isEmpty || isSubmitting)
            .accessibilityIdentifier("draft.unlock.submit")
        }

        Section {
            Button("丢弃草稿", role: .destructive) {
                showingDiscardConfirm = true
            }
        }
    }

    @ViewBuilder
    private func parseFailedSection(_ draft: BillImportDraftDTO) -> some View {
        Section("解析异常") {
            Text(draft.errorMessage ?? "智能解析失败或超时，原件已保留。")
                .font(.footnote)
                .foregroundStyle(WCColors.dangerInk)
            Button("重试解析") {
                Task { await performRetry(manualMode: false) }
            }
            .disabled(isSubmitting)
            Button("转为手动补全字段") {
                Task { await performRetry(manualMode: true) }
            }
            .disabled(isSubmitting)
            Button("丢弃草稿", role: .destructive) {
                showingDiscardConfirm = true
            }
        }
    }

    @ViewBuilder
    private func editFieldsSection(_ draft: BillImportDraftDTO) -> some View {
        let candidateIds = Set(draft.parsedPayload.candidateCardIds ?? [])
        let orderedCards = candidateIds.isEmpty
            ? appState.cards
            : appState.cards.filter { candidateIds.contains($0.id) } + appState.cards.filter { !candidateIds.contains($0.id) }

        Section("账单归属与核心字段") {
            Picker("归属信用卡", selection: $selectedCardId) {
                Text("请选择信用卡").tag("")
                ForEach(orderedCards) { card in
                    let prefix = candidateIds.contains(card.id) ? "★ " : ""
                    let tail = card.last4.isEmpty ? "" : " (\(card.last4))"
                    Text("\(prefix)\(card.bankName) · \(card.displayName)\(tail) · \(card.holderName)")
                        .tag(card.id)
                }
            }
            .accessibilityIdentifier("draft.confirm.cardPicker")

            if selectedCardId.isEmpty {
                Button {
                    showingCardCreate = true
                } label: {
                    Label("新建信用卡并回选", systemImage: "plus.circle")
                        .font(.footnote)
                        .foregroundStyle(WCColors.primaryAccent)
                }
            }

            HStack {
                Text("账单月份")
                Spacer()
                TextField("YYYY-MM", text: $billMonth)
                    .multilineTextAlignment(.trailing)
                    .keyboardType(.numbersAndPunctuation)
                    .accessibilityIdentifier("draft.confirm.billMonth")
            }

            Picker("币种", selection: $currency) {
                ForEach(Self.supportedCurrencies, id: \.self) { code in
                    Text("\(code) (\(DashboardMoney.currencySymbol(code)))").tag(code)
                }
            }

            HStack {
                Text("应还金额 (\(DashboardMoney.currencySymbol(currency)))")
                Spacer()
                TextField("0.00", text: $billAmountText)
                    .multilineTextAlignment(.trailing)
                    .keyboardType(.decimalPad)
                    .accessibilityIdentifier("draft.confirm.amount")
            }

            HStack {
                Text("最低还款 (\(DashboardMoney.currencySymbol(currency)))")
                Spacer()
                TextField("选填", text: $minPaymentText)
                    .multilineTextAlignment(.trailing)
                    .keyboardType(.decimalPad)
            }

            HStack {
                Text("出账日")
                Spacer()
                TextField("YYYY-MM-DD（选填）", text: $statementDateText)
                    .multilineTextAlignment(.trailing)
                    .keyboardType(.numbersAndPunctuation)
            }

            HStack {
                Text("还款截止日")
                Spacer()
                TextField("YYYY-MM-DD", text: $dueDateText)
                    .multilineTextAlignment(.trailing)
                    .keyboardType(.numbersAndPunctuation)
                    .accessibilityIdentifier("draft.confirm.dueDate")
            }
        }
    }

    @ViewBuilder
    private func subtotalsSection(_ subtotals: [BillDraftSubtotalDTO]) -> some View {
        Section("合并账户分卡小计") {
            ForEach(Array(subtotals.enumerated()), id: \.offset) { _, sub in
                HStack {
                    Text("\(sub.cardName ?? "卡") · 尾号 \(sub.cardLast4)")
                        .font(.subheadline)
                    Spacer()
                    Text(DashboardMoney.format(sub.amount, currency: sub.currency ?? currency))
                        .font(.subheadline.bold())
                }
            }
        }
    }

    @ViewBuilder
    private func sourcePreviewSection(_ draft: BillImportDraftDTO) -> some View {
        if draft.fileRef != nil || (draft.rawText != nil && !(draft.rawText?.isEmpty ?? true)) {
            Section("原件溯源") {
                if let fileRef = draft.fileRef {
                    Button {
                        Task { await loadPreview(fileRef: fileRef, sourceType: draft.sourceType) }
                    } label: {
                        HStack {
                            Label("预览 PDF / 图片原件", systemImage: "doc.text.magnifyingglass")
                            Spacer()
                            if isLoadingPreview { ProgressView() }
                        }
                    }
                    .disabled(isLoadingPreview)
                }
                if let rawText = draft.rawText, !rawText.isEmpty {
                    DisclosureGroup("查看原始文本") {
                        Text(rawText)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .textSelection(.enabled)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func actionsSection(_ draft: BillImportDraftDTO) -> some View {
        let canConfirm = !selectedCardId.isEmpty
            && !billMonth.trimmingCharacters(in: .whitespaces).isEmpty
            && Double(billAmountText.trimmingCharacters(in: .whitespaces)) != nil
            && !dueDateText.trimmingCharacters(in: .whitespaces).isEmpty

        Section {
            Button {
                Task { await performConfirm(conflictResolution: nil) }
            } label: {
                HStack {
                    Spacer()
                    if isSubmitting {
                        ProgressView()
                    } else {
                        Text("确认入账")
                            .bold()
                    }
                    Spacer()
                }
            }
            .disabled(!canConfirm || isSubmitting)
            .accessibilityIdentifier("draft.confirm.submit")

            Button("保存草稿修改") {
                Task { await performSaveEdits() }
            }
            .disabled(isSubmitting)

            Button("丢弃草稿", role: .destructive) {
                showingDiscardConfirm = true
            }
            .disabled(isSubmitting)
        }
    }

    private func applyDraft(_ item: BillImportDraftDTO) {
        draft = item
        selectedCardId = item.cardId ?? ""
        billMonth = item.parsedPayload.billMonth ?? ""
        let cardCurrency = appState.cards.first(where: { $0.id == item.cardId })?.product?.currency
        currency = DashboardFx.normalizeCurrencyOrDefault(item.parsedPayload.currency ?? cardCurrency, "CNY")
        billAmountText = item.parsedPayload.billAmount.map { String($0) } ?? ""
        minPaymentText = item.parsedPayload.minPayment.map { String($0) } ?? ""
        statementDateText = item.parsedPayload.statementDate ?? ""
        dueDateText = item.parsedPayload.dueDate ?? ""
    }

    private func buildUpdatedPayload(_ existing: BillDraftPayloadDTO) -> BillDraftPayloadDTO {
        var next = existing
        next.billMonth = billMonth.trimmingCharacters(in: .whitespaces)
        next.currency = currency
        next.billAmount = Double(billAmountText.trimmingCharacters(in: .whitespaces))
        next.minPayment = Double(minPaymentText.trimmingCharacters(in: .whitespaces))
        let stmt = statementDateText.trimmingCharacters(in: .whitespaces)
        next.statementDate = stmt.isEmpty ? nil : stmt
        let due = dueDateText.trimmingCharacters(in: .whitespaces)
        next.dueDate = due.isEmpty ? nil : due
        return next
    }

    private func reloadDraft() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let fetched = try await appState.fetchBillDraft(id: draftId)
            applyDraft(fetched)
        } catch {
            if draft == nil {
                errorMessage = "加载草稿失败：\(error.localizedDescription)"
            }
        }
    }

    private func performUnlock(_ draft: BillImportDraftDTO) async {
        isSubmitting = true
        errorMessage = nil
        defer { isSubmitting = false }
        do {
            let updatedList = try await appState.unlockEncryptedDraft(
                draftId: draft.id,
                password: pdfPassword,
                saveToVault: savePasswordToVault,
                label: "\(draft.parsedPayload.bankName ?? "月结单")密码",
                holderId: draft.holderId,
                bankKeyword: draft.parsedPayload.bankName,
                hint: vaultHint.trimmingCharacters(in: .whitespaces).isEmpty ? nil : vaultHint
            )
            pdfPassword = ""
            if let first = updatedList.first {
                applyDraft(first)
            }
        } catch {
            errorMessage = "解锁失败：\(error.localizedDescription)"
        }
    }

    private func performRetry(manualMode: Bool) async {
        isSubmitting = true
        errorMessage = nil
        defer { isSubmitting = false }
        do {
            let updated = try await appState.retryParseDraft(draftId: draftId, manualMode: manualMode)
            applyDraft(updated)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func performSaveEdits() async {
        guard let current = draft else { return }
        isSubmitting = true
        errorMessage = nil
        defer { isSubmitting = false }
        do {
            let updated = try await appState.updateBillDraft(
                draftId: current.id,
                cardId: selectedCardId.isEmpty ? nil : selectedCardId,
                clearCardId: selectedCardId.isEmpty,
                holderId: current.holderId,
                payload: buildUpdatedPayload(current.parsedPayload)
            )
            applyDraft(updated)
        } catch {
            errorMessage = "保存修改失败：\(error.localizedDescription)"
        }
    }

    private func performConfirm(conflictResolution: String?) async {
        guard let current = draft else { return }
        isSubmitting = true
        errorMessage = nil
        defer { isSubmitting = false }
        do {
            _ = try await appState.updateBillDraft(
                draftId: current.id,
                cardId: selectedCardId.isEmpty ? nil : selectedCardId,
                clearCardId: selectedCardId.isEmpty,
                holderId: current.holderId,
                payload: buildUpdatedPayload(current.parsedPayload)
            )
            _ = try await appState.confirmBillDraft(
                draftId: current.id,
                conflictResolution: conflictResolution
            )
            onConfirmed?()
            dismiss()
        } catch {
            if let dup = DuplicateBillConflictDetails.parse(from: error) {
                duplicateConflict = dup
            } else {
                errorMessage = "确认入账失败：\(error.localizedDescription)"
            }
        }
    }

    private func performDiscard() async {
        isSubmitting = true
        errorMessage = nil
        defer { isSubmitting = false }
        do {
            try await appState.discardBillDraft(draftId: draftId)
            onConfirmed?()
            dismiss()
        } catch {
            errorMessage = "丢弃失败：\(error.localizedDescription)"
        }
    }

    private func loadPreview(fileRef: String, sourceType: String) async {
        isLoadingPreview = true
        errorMessage = nil
        defer { isLoadingPreview = false }
        do {
            let (data, mime) = try await appState.fetchAttachmentData(attachmentId: fileRef)
            let ext: String
            if let mime, mime.contains("pdf") {
                ext = "pdf"
            } else if let mime, mime.contains("png") {
                ext = "png"
            } else if sourceType == "pdf" {
                ext = "pdf"
            } else {
                ext = "jpg"
            }
            let safeRef = fileRef.map { ch -> Character in
                (ch.isASCII && (ch.isLetter || ch.isNumber || ch == "-" || ch == "_")) ? ch : "_"
            }
            let fileNameStem = safeRef.isEmpty ? UUID().uuidString : String(safeRef)
            let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("draft-\(fileNameStem).\(ext)")
            try data.write(to: tmp, options: .atomic)
            previewFileURL = tmp
        } catch {
            errorMessage = "预览原件失败：\(error.localizedDescription)"
        }
    }

    private func attributionLabel(_ source: String) -> String {
        switch source {
        case "unique_card": return "唯一卡片匹配"
        case "header_name": return "邮件称呼匹配"
        case "body_honorific": return "正文姓名匹配"
        case "pdf_holder_hint": return "PDF 持卡人匹配"
        case "connection_default": return "邮箱默认归属"
        case "holder_email": return "持卡人邮箱匹配"
        case "conflict": return "多卡同尾号冲突"
        case "manual": return "手动指定"
        default: return "待确认归属"
        }
    }
}
