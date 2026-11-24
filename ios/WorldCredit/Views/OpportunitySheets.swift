import SwiftUI
import GRDB
import WorldCreditCore

// MARK: - Usage Editor Sheet (Create / Correct)

struct OpportunityUsageEditorSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppState.self) private var appState

    let item: OpportunityLedgerItem
    let editingUsage: OpportunityUsageRecord?
    let onSaved: () async -> Void

    @State private var selectedCardId: String = ""
    @State private var usedDate: Date = Date()
    @State private var quantity: Int = 1
    @State private var amountText: String = ""
    @State private var note: String = ""
    @State private var reason: String = ""
    @State private var isSubmitting = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                if let err = errorMessage {
                    Section {
                        Text(err).font(.caption).foregroundStyle(.red)
                    }
                }

                Section("使用详情") {
                    if !item.cardIds.isEmpty {
                        Picker("使用卡片", selection: $selectedCardId) {
                            ForEach(item.cardIds, id: \.self) { cid in
                                Text(cardLabel(cid)).tag(cid)
                            }
                        }
                    }

                    DatePicker("使用日期", selection: $usedDate, displayedComponents: .date)

                    Stepper("数量：\(quantity) \(item.rules.unitLabel)", value: $quantity, in: 1...999)

                    if item.currentCycle?.amountLimitMinor != nil {
                        HStack {
                            Text("金额 (\(DashboardMoney.currencySymbol(item.currentCycle?.currency ?? "CNY")))")
                            Spacer()
                            TextField("0.00", text: $amountText)
                                .keyboardType(.decimalPad)
                                .multilineTextAlignment(.trailing)
                        }
                    }

                    TextField("备注（选填）", text: $note)
                }

                if editingUsage != nil {
                    Section("更正原因（必填）") {
                        TextField("如：输入次数有误", text: $reason)
                    }
                }
            }
            .navigationTitle(editingUsage == nil ? "记录权益使用" : "更正使用记录")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isSubmitting ? "保存中…" : "保存") {
                        Task { await submit() }
                    }
                    .disabled(isSubmitting)
                }
            }
            .onAppear {
                if let u = editingUsage {
                    selectedCardId = u.cardId
                    usedDate = parseDate(u.usedOn) ?? Date()
                    quantity = u.quantity
                    if u.amountMinor > 0 {
                        amountText = String(format: "%.2f", Double(u.amountMinor) / 100.0)
                    }
                    note = u.note ?? ""
                } else {
                    selectedCardId = item.cardIds.first ?? ""
                }
            }
        }
    }

    private func submit() async {
        guard let cycle = item.currentCycle else {
            errorMessage = "当前无可用周期"
            return
        }
        guard !selectedCardId.isEmpty else {
            errorMessage = "请选择使用卡片"
            return
        }
        let usedOn = OpportunityDates.localDateInZone(usedDate, timeZone: item.rules.timeZone)
        let amountMinor: Int = {
            if let val = Double(amountText.trimmingCharacters(in: .whitespaces)), val >= 0 {
                return Int((val * 100.0).rounded())
            }
            return 0
        }()
        let trimmedNote = note.trimmingCharacters(in: .whitespacesAndNewlines)

        isSubmitting = true
        errorMessage = nil
        defer { isSubmitting = false }
        do {
            if let u = editingUsage {
                try await appState.correctOpportunityUsage(
                    usageId: u.id,
                    usedOn: usedOn,
                    quantity: quantity,
                    amountMinor: amountMinor,
                    note: trimmedNote.isEmpty ? nil : trimmedNote,
                    clearNote: trimmedNote.isEmpty,
                    reason: reason,
                    expectedRevision: u.revision
                )
            } else {
                try await appState.recordOpportunityUsage(
                    accountId: item.account.id,
                    cycleId: cycle.id,
                    cardId: selectedCardId,
                    usedOn: usedOn,
                    quantity: quantity,
                    amountMinor: amountMinor,
                    note: trimmedNote.isEmpty ? nil : trimmedNote
                )
            }
            HapticManager.success()
            await onSaved()
            dismiss()
        } catch {
            HapticManager.error()
            errorMessage = error.localizedDescription
        }
    }

    private func cardLabel(_ cid: String) -> String {
        guard let card = appState.cards.first(where: { $0.id == cid }) else { return cid }
        return card.last4.isEmpty ? card.displayName : "\(card.displayName) (\(card.last4))"
    }

    private func parseDate(_ s: String) -> Date? {
        let df = DateFormatter()
        df.dateFormat = "yyyy-MM-dd"
        df.timeZone = TimeZone(identifier: item.rules.timeZone)
        return df.date(from: s)
    }
}

// MARK: - Reason Input Sheet

struct OpportunityReasonSheet: View {
    @Environment(\.dismiss) private var dismiss
    let title: String
    let message: String
    let onConfirm: (String) async throws -> Void

    @State private var reason: String = ""
    @State private var isSubmitting = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(message).font(.footnote).foregroundStyle(.secondary)
                }
                Section("原因（必填）") {
                    TextField("请输入原因", text: $reason)
                }
                if let err = errorMessage {
                    Section {
                        Text(err).font(.caption).foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isSubmitting ? "提交中…" : "确认") {
                        Task {
                            isSubmitting = true
                            errorMessage = nil
                            defer { isSubmitting = false }
                            do {
                                try await onConfirm(reason)
                                HapticManager.success()
                                dismiss()
                            } catch {
                                HapticManager.error()
                                errorMessage = error.localizedDescription
                            }
                        }
                    }
                    .disabled(isSubmitting || reason.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
    }
}

// MARK: - Claim Sheet

struct OpportunityClaimSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppState.self) private var appState
    let item: OpportunityLedgerItem
    let onSaved: () async -> Void

    @State private var selectedCardId: String = ""
    @State private var claimedDate: Date = Date()
    @State private var note: String = ""
    @State private var isSubmitting = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                if let err = errorMessage {
                    Section { Text(err).font(.caption).foregroundStyle(.red) }
                }
                Section("领取信息") {
                    Picker("领取卡片", selection: $selectedCardId) {
                        ForEach(item.cardIds, id: \.self) { cid in
                            Text(cid).tag(cid)
                        }
                    }
                    DatePicker("领取日期", selection: $claimedDate, displayedComponents: .date)
                    TextField("备注（选填）", text: $note)
                }
            }
            .navigationTitle("记录已领取")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isSubmitting ? "提交中…" : "确认领取") {
                        Task { await submit() }
                    }
                    .disabled(isSubmitting)
                }
            }
            .onAppear { selectedCardId = item.cardIds.first ?? "" }
        }
    }

    private func submit() async {
        guard let cycle = item.currentCycle else {
            errorMessage = "当前无待领取周期"
            return
        }
        isSubmitting = true
        defer { isSubmitting = false }
        do {
            try await appState.recordOpportunityClaim(
                accountId: item.account.id,
                cycleId: cycle.id,
                cardId: selectedCardId,
                holderId: item.account.holderId,
                claimedOn: OpportunityDates.localDateInZone(claimedDate, timeZone: item.rules.timeZone),
                note: note.isEmpty ? nil : note
            )
            HapticManager.success()
            await onSaved()
            dismiss()
        } catch {
            HapticManager.error()
            errorMessage = error.localizedDescription
        }
    }
}

// MARK: - Booking Sheet

struct OpportunityBookingSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppState.self) private var appState
    let item: OpportunityLedgerItem
    let onSaved: () async -> Void

    @State private var selectedCardId: String = ""
    @State private var serviceDate: Date = Date()
    @State private var quantity: Int = 1
    @State private var amountText: String = ""
    @State private var note: String = ""
    @State private var isSubmitting = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                if let err = errorMessage {
                    Section { Text(err).font(.caption).foregroundStyle(.red) }
                }
                Section("预约信息") {
                    Picker("预约卡片", selection: $selectedCardId) {
                        ForEach(item.cardIds, id: \.self) { cid in
                            Text(cid).tag(cid)
                        }
                    }
                    DatePicker("服务时间", selection: $serviceDate)
                    Stepper("数量：\(quantity) \(item.rules.unitLabel)", value: $quantity, in: 1...99)
                    if item.currentCycle?.amountLimitMinor != nil {
                        HStack {
                            Text("占用金额")
                            Spacer()
                            TextField("0.00", text: $amountText)
                                .keyboardType(.decimalPad)
                                .multilineTextAlignment(.trailing)
                        }
                    }
                    TextField("备注（选填）", text: $note)
                }
            }
            .navigationTitle("记录预约")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isSubmitting ? "提交中…" : "保存预约") {
                        Task { await submit() }
                    }
                    .disabled(isSubmitting)
                }
            }
            .onAppear { selectedCardId = item.cardIds.first ?? "" }
        }
    }

    private func submit() async {
        guard let cycle = item.currentCycle else {
            errorMessage = "当前无可用周期"
            return
        }
        let minor = Int(((Double(amountText) ?? 0) * 100.0).rounded())
        let iso = ISO8601DateFormatter().string(from: serviceDate)
        isSubmitting = true
        defer { isSubmitting = false }
        do {
            try await appState.recordOpportunityBooking(
                accountId: item.account.id,
                cycleId: cycle.id,
                cardId: selectedCardId,
                holderId: item.account.holderId,
                serviceAt: iso,
                serviceTimeZone: item.rules.timeZone,
                quantity: quantity,
                amountMinor: minor,
                note: note.isEmpty ? nil : note
            )
            HapticManager.success()
            await onSaved()
            dismiss()
        } catch {
            HapticManager.error()
            errorMessage = error.localizedDescription
        }
    }
}

// MARK: - Booking Settlement Sheet

struct OpportunityBookingSettlementSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppState.self) private var appState
    let booking: OpportunityFulfillmentRecord
    let onSaved: () async -> Void

    @State private var settlement: String = "returned"
    @State private var reason: String = ""
    @State private var isSubmitting = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                if let err = errorMessage {
                    Section { Text(err).font(.caption).foregroundStyle(.red) }
                }
                Section("取消后额度结算方式") {
                    Picker("结算结果", selection: $settlement) {
                        Text("额度退回 (可重新使用)").tag("returned")
                        Text("已扣减无法退回").tag("charged")
                        Text("暂不清楚（待向银行确认）").tag("unknown")
                    }
                    .pickerStyle(.inline)
                }
                Section("原因（必填）") {
                    TextField("如：行程取消", text: $reason)
                }
            }
            .navigationTitle("预约取消与结算")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("关闭") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isSubmitting ? "提交中…" : "确认") {
                        Task {
                            isSubmitting = true
                            defer { isSubmitting = false }
                            do {
                                try await appState.cancelOpportunityBooking(
                                    fulfillmentId: booking.id,
                                    settlement: settlement,
                                    reason: reason,
                                    expectedRevision: booking.revision
                                )
                                HapticManager.success()
                                await onSaved()
                                dismiss()
                            } catch {
                                HapticManager.error()
                                errorMessage = error.localizedDescription
                            }
                        }
                    }
                    .disabled(isSubmitting || reason.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
    }
}

// MARK: - Online-Only Eligibility / Opening Balance / Account Setup Sheets

struct OpportunityEligibilitySheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppState.self) private var appState
    let item: OpportunityLedgerItem
    let onSaved: () async -> Void

    @State private var eligibility: String = "confirmed"
    @State private var hasFromDate: Bool = false
    @State private var fromDate: Date = Date()
    @State private var note: String = ""
    @State private var isSubmitting = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("确认个人资格需联网完成，提交后会自动同步最新周期配额。")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Section("资格判定") {
                    Picker("状态", selection: $eligibility) {
                        Text("确认适用").tag("confirmed")
                        Text("不适用").tag("ineligible")
                        Text("待确认").tag("unknown")
                    }
                    Toggle("指定生效日期", isOn: $hasFromDate)
                    if hasFromDate {
                        DatePicker("生效日期", selection: $fromDate, displayedComponents: .date)
                    }
                    TextField("说明（选填）", text: $note)
                }
                if let err = errorMessage {
                    Section { Text(err).font(.caption).foregroundStyle(.red) }
                }
            }
            .navigationTitle("确认个人资格")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isSubmitting ? "提交中…" : "提交") {
                        Task {
                            isSubmitting = true
                            defer { isSubmitting = false }
                            do {
                                let fromOn = hasFromDate ? OpportunityDates.localDateInZone(fromDate, timeZone: item.rules.timeZone) : nil
                                try await appState.confirmOpportunityEligibility(
                                    accountId: item.account.id,
                                    eligibility: eligibility,
                                    eligibleFromOn: fromOn,
                                    note: note.isEmpty ? nil : note,
                                    expectedRevision: item.account.revision
                                )
                                HapticManager.success()
                                await onSaved()
                                dismiss()
                            } catch {
                                HapticManager.error()
                                errorMessage = error.localizedDescription
                            }
                        }
                    }
                    .disabled(isSubmitting)
                }
            }
            .onAppear { eligibility = item.account.eligibility }
        }
    }
}

struct OpportunityOpeningBalanceSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppState.self) private var appState
    let accountId: String
    let cycle: OpportunityCycleRecord
    let onSaved: () async -> Void

    @State private var usedCount: Int = 0
    @State private var usedAmountText: String = "0"
    @State private var asOfDate: Date = Date()
    @State private var isSubmitting = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("核对并锁定本周期初始已使用次数/金额（需联网提交）。")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Section("期初数值") {
                    Stepper("期初已用次数：\(usedCount)", value: $usedCount, in: 0...9999)
                    if cycle.amountLimitMinor != nil {
                        HStack {
                            Text("期初已用金额")
                            Spacer()
                            TextField("0.00", text: $usedAmountText)
                                .keyboardType(.decimalPad)
                                .multilineTextAlignment(.trailing)
                        }
                    }
                    DatePicker("统计截至", selection: $asOfDate, displayedComponents: .date)
                }
                if let err = errorMessage {
                    Section { Text(err).font(.caption).foregroundStyle(.red) }
                }
            }
            .navigationTitle("核对期初余额")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isSubmitting ? "提交中…" : "确认") {
                        Task {
                            isSubmitting = true
                            defer { isSubmitting = false }
                            do {
                                let minor = Int(((Double(usedAmountText) ?? 0) * 100.0).rounded())
                                try await appState.confirmOpeningBalance(
                                    accountId: accountId,
                                    cycleId: cycle.id,
                                    openingUsedCount: usedCount,
                                    openingUsedMinor: minor,
                                    asOfOn: OpportunityDates.localDateInZone(asOfDate, timeZone: cycle.timeZone),
                                    expectedRevision: cycle.revision
                                )
                                HapticManager.success()
                                await onSaved()
                                dismiss()
                            } catch {
                                HapticManager.error()
                                errorMessage = error.localizedDescription
                            }
                        }
                    }
                    .disabled(isSubmitting)
                }
            }
            .onAppear {
                usedCount = cycle.openingUsedCount
                usedAmountText = String(format: "%.2f", Double(cycle.openingUsedMinor) / 100.0)
            }
        }
    }
}

struct OpportunityAccountSetupSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppState.self) private var appState
    let onSaved: () async -> Void

    @State private var definitions: [(id: String, title: String)] = []
    @State private var selectedDefId: String = ""
    @State private var selectedHolderId: String = ""
    @State private var scopeKind: String = "card"
    @State private var selectedCardIds: Set<String> = []
    @State private var eligibility: String = "confirmed"
    @State private var isSubmitting = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                if definitions.isEmpty {
                    Section {
                        Text("暂无可配置的权益定义，请先下拉刷新同步规则目录。")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                } else {
                    Section("规则与持卡人（需联网配置）") {
                        Picker("权益规则", selection: $selectedDefId) {
                            ForEach(definitions, id: \.id) { d in
                                Text(d.title).tag(d.id)
                            }
                        }
                        Picker("持卡人", selection: $selectedHolderId) {
                            ForEach(appState.dashboardHolders) { h in
                                Text(h.name).tag(h.id)
                            }
                        }
                        Picker("账户维度", selection: $scopeKind) {
                            Text("按单卡").tag("card")
                            Text("按持卡人共享").tag("holder")
                        }
                        Picker("资格", selection: $eligibility) {
                            Text("已确认适用").tag("confirmed")
                            Text("待确认").tag("unknown")
                        }
                    }

                    Section("关联信用卡") {
                        let holderCards = appState.cards.filter { $0.card.holderId == selectedHolderId }
                        ForEach(holderCards) { card in
                            Button {
                                if selectedCardIds.contains(card.id) {
                                    selectedCardIds.remove(card.id)
                                } else {
                                    if scopeKind == "card" { selectedCardIds.removeAll() }
                                    selectedCardIds.insert(card.id)
                                }
                            } label: {
                                HStack {
                                    Text(card.last4.isEmpty ? card.displayName : "\(card.displayName)(\(card.last4))")
                                    Spacer()
                                    if selectedCardIds.contains(card.id) {
                                        Image(systemName: "checkmark").foregroundStyle(WCColors.primaryAccent)
                                    }
                                }
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                if let err = errorMessage {
                    Section { Text(err).font(.caption).foregroundStyle(.red) }
                }
            }
            .navigationTitle("新建权益账户")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isSubmitting ? "提交中…" : "创建") {
                        Task {
                            isSubmitting = true
                            defer { isSubmitting = false }
                            do {
                                try await appState.createOpportunityAccount(
                                    definitionId: selectedDefId,
                                    holderId: selectedHolderId,
                                    scopeKind: scopeKind,
                                    cardIds: Array(selectedCardIds),
                                    eligibility: eligibility,
                                    eligibleFromOn: nil,
                                    note: nil
                                )
                                HapticManager.success()
                                await onSaved()
                                dismiss()
                            } catch {
                                HapticManager.error()
                                errorMessage = error.localizedDescription
                            }
                        }
                    }
                    .disabled(isSubmitting || selectedDefId.isEmpty || selectedHolderId.isEmpty || selectedCardIds.isEmpty)
                }
            }
            .task {
                definitions = await loadAvailableDefinitions()
                selectedDefId = definitions.first?.id ?? ""
                selectedHolderId = appState.dashboardHolders.first?.id ?? ""
            }
        }
    }

    private func loadAvailableDefinitions() async -> [(id: String, title: String)] {
        (try? await appState.dbManager.dbWriter.read { db in
            let defs = try OpportunityDefinitionRecord.filter(Column("status") == "active").fetchAll(db)
            let vers = try OpportunityRuleVersionRecord.fetchAll(db)
            let decoder = JSONDecoder()
            var out: [(id: String, title: String)] = []
            for d in defs {
                let latest = vers.filter { $0.definitionId == d.id }.max(by: { $0.version < $1.version })
                let title = latest.flatMap {
                    $0.rulesJson.data(using: .utf8).flatMap { try? decoder.decode(RuleSnapshotV1.self, from: $0).title }
                } ?? d.id
                out.append((d.id, title))
            }
            return out
        }) ?? []
    }
}
