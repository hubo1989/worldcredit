import SwiftUI
import WorldCreditCore

struct StatementPasswordVaultView: View {
    @Environment(AppState.self) private var appState
    @State private var rules: [StatementPasswordRuleDTO] = []
    @State private var isLoading = false
    @State private var errorMessage: String?

    @State private var showingEditor = false
    @State private var editingRule: StatementPasswordRuleDTO?
    @State private var label = ""
    @State private var password = ""
    @State private var selectedHolderId = ""
    @State private var bankKeyword = ""
    @State private var hint = ""
    @State private var isSaving = false

    var body: some View {
        List {
            if let errorMessage {
                Section {
                    Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                        .font(.footnote)
                        .foregroundStyle(WCColors.dangerInk)
                }
            }

            Section {
                if isLoading && rules.isEmpty {
                    ProgressView("正在加载密码本…")
                } else if rules.isEmpty {
                    ContentUnavailableView(
                        "尚未添加密码规则",
                        systemImage: "key.fill",
                        description: Text("密码采用 AES-GCM 加密保存（只写不读），用于自动解密加密 PDF 月结单。")
                    )
                } else {
                    ForEach(rules) { rule in
                        Button {
                            openEdit(rule)
                        } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                HStack {
                                    Text(rule.label)
                                        .font(.subheadline.bold())
                                        .foregroundStyle(WCColors.textPrimary)
                                    Spacer()
                                    Text("命中 \(rule.useCount) 次")
                                        .font(.caption2)
                                        .foregroundStyle(WCColors.textSecondary)
                                }
                                HStack(spacing: 8) {
                                    if let hid = rule.holderId,
                                       let holderName = appState.dashboardHolders.first(where: { $0.id == hid })?.name {
                                        Text(holderName)
                                    } else {
                                        Text("全部持卡人")
                                    }
                                    if let kw = rule.bankKeyword, !kw.isEmpty {
                                        Text("· \(kw)")
                                    }
                                    if let h = rule.hint, !h.isEmpty {
                                        Text("· 提示：\(h)")
                                            .foregroundStyle(WCColors.warningInk)
                                    }
                                }
                                .font(.caption)
                                .foregroundStyle(WCColors.textSecondary)
                            }
                            .padding(.vertical, 2)
                        }
                        .swipeActions(edge: .trailing) {
                            Button(role: .destructive) {
                                Task { await deleteRule(rule.id) }
                            } label: {
                                Label("删除", systemImage: "trash")
                            }
                        }
                    }
                }
            } footer: {
                Text("安全策略：密码仅支持加密写入与服务端自动解密，不会以明文回显。")
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("月结单密码本")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    openCreate()
                } label: {
                    Image(systemName: "plus")
                }
                .accessibilityLabel("添加密码规则")
            }
        }
        .task { await reload() }
        .sheet(isPresented: $showingEditor) {
            NavigationStack {
                Form {
                    Section("规则配置") {
                        TextField("规则名称（如：本人身份证后6位）", text: $label)
                        SecureField(
                            editingRule == nil ? "PDF 解密密码" : "新密码（留空则保持不变）",
                            text: $password
                        )
                        Picker("关联持卡人", selection: $selectedHolderId) {
                            Text("全部持卡人").tag("")
                            ForEach(appState.dashboardHolders) { holder in
                                Text(holder.name).tag(holder.id)
                            }
                        }
                        TextField("银行关键词（选填，如：HSBC / 建行）", text: $bankKeyword)
                        TextField("密码提示词（选填，如：身份证后6位）", text: $hint)
                    }
                }
                .navigationTitle(editingRule == nil ? "添加密码规则" : "编辑密码规则")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("取消") { showingEditor = false }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("保存") {
                            Task { await saveRule() }
                        }
                        .disabled(isSaving || label.trimmingCharacters(in: .whitespaces).isEmpty || (editingRule == nil && password.isEmpty))
                    }
                }
            }
        }
    }

    private func reload() async {
        guard !UITestConfiguration.isEnabled else { return }
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            rules = try await appState.listPasswordRules()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func openCreate() {
        editingRule = nil
        label = ""
        password = ""
        selectedHolderId = ""
        bankKeyword = ""
        hint = ""
        showingEditor = true
    }

    private func openEdit(_ rule: StatementPasswordRuleDTO) {
        editingRule = rule
        label = rule.label
        password = ""
        selectedHolderId = rule.holderId ?? ""
        bankKeyword = rule.bankKeyword ?? ""
        hint = rule.hint ?? ""
        showingEditor = true
    }

    private func saveRule() async {
        isSaving = true
        errorMessage = nil
        defer { isSaving = false }
        do {
            if let editingRule {
                _ = try await appState.updatePasswordRule(
                    ruleId: editingRule.id,
                    label: label.trimmingCharacters(in: .whitespaces),
                    password: password.isEmpty ? nil : password,
                    holderId: selectedHolderId.isEmpty ? nil : selectedHolderId,
                    clearHolderId: selectedHolderId.isEmpty,
                    bankKeyword: bankKeyword.trimmingCharacters(in: .whitespaces),
                    hint: hint.trimmingCharacters(in: .whitespaces)
                )
            } else {
                _ = try await appState.createPasswordRule(
                    label: label.trimmingCharacters(in: .whitespaces),
                    password: password,
                    holderId: selectedHolderId.isEmpty ? nil : selectedHolderId,
                    bankKeyword: bankKeyword.trimmingCharacters(in: .whitespaces).isEmpty ? nil : bankKeyword.trimmingCharacters(in: .whitespaces),
                    hint: hint.trimmingCharacters(in: .whitespaces).isEmpty ? nil : hint.trimmingCharacters(in: .whitespaces)
                )
            }
            showingEditor = false
            await reload()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func deleteRule(_ ruleId: String) async {
        do {
            try await appState.deletePasswordRule(ruleId: ruleId)
            rules.removeAll { $0.id == ruleId }
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
