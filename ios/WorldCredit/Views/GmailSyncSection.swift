import SwiftUI
import UIKit
import GoogleSignIn
import WorldCreditCore

/// 设置页「Gmail 账单同步」卡片（支持 1:N 多邮箱、默认归属人、单连接同步与全局草稿复核开关）。
///
/// iOS 侧只做三件事：发起授权拿 serverAuthCode、把 code 交给服务端、
/// 展示连接状态并支持手动同步/配置/断开。refresh token 由服务端保管，客户端不落盘。
struct GmailSyncSection: View {
    @Environment(AppState.self) private var appState
    @State private var connections: [GmailConnectionDTO] = []
    @State private var requireDraftReview: Bool = false
    @State private var isLoadingPreferences: Bool = false
    @State private var isUpdatingPreferences: Bool = false
    @State private var statusError: String?
    @State private var isConnecting = false
    @State private var syncingConnectionId: String?
    @State private var isDisconnecting = false
    @State private var pendingDisconnectConnection: GmailConnectionDTO?
    @State private var showingDisconnectAlert = false
    @State private var alertMessage: String?
    @State private var progressMessage: String?

    @State private var showingAddMailboxSheet = false
    @State private var addDisplayLabel = ""
    @State private var addDefaultHolderId = ""
    @State private var editingConnection: GmailConnectionDTO?

    var body: some View {
        Section {
            if connections.isEmpty {
                disconnectedRows
            } else {
                ForEach(Array(connections.enumerated()), id: \.element.id) { index, conn in
                    connectionCard(conn, isPrimary: index == 0)
                }

                Button {
                    addDisplayLabel = ""
                    addDefaultHolderId = ""
                    showingAddMailboxSheet = true
                } label: {
                    HStack {
                        Label("添加其他 Gmail 邮箱", systemImage: "plus.circle")
                        Spacer()
                        if isConnecting {
                            ProgressView()
                        }
                    }
                }
                .disabled(isConnecting || syncingConnectionId != nil || isDisconnecting)
                .accessibilityIdentifier("gmail.addAccount")
            }

            Toggle(isOn: Binding(
                get: { requireDraftReview },
                set: { newValue in
                    Task { await updateSafetyPreference(requireReview: newValue) }
                }
            )) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("全部邮箱同步先停草稿箱复核")
                    Text("开启后，高置信度邮件账单也不自动入账，需在草稿箱确认。")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
            .disabled(isLoadingPreferences || isUpdatingPreferences)
            .accessibilityIdentifier("gmail.requireDraftReview")
        } header: {
            Text("Gmail 账单同步")
        }
        .task { await refreshAll() }
        .alert("Gmail 同步", isPresented: Binding(
            get: { alertMessage != nil },
            set: { if !$0 { alertMessage = nil } }
        )) {
            Button("好", role: .cancel) {}
        } message: {
            Text(alertMessage ?? "")
        }
        .confirmationDialog(
            "断开后将停止每日自动拉取账单，已入库数据保留。确定断开？",
            isPresented: $showingDisconnectAlert,
            titleVisibility: .visible
        ) {
            Button("断开", role: .destructive) {
                let target = pendingDisconnectConnection
                pendingDisconnectConnection = nil
                Task { await disconnect(target) }
            }
            Button("取消", role: .cancel) {
                pendingDisconnectConnection = nil
            }
        }
        .sheet(isPresented: $showingAddMailboxSheet) {
            addMailboxSheet
        }
        .sheet(item: $editingConnection) { conn in
            EditGmailConnectionSheet(
                connection: conn,
                holders: appState.dashboardHolders
            ) { label, clearLabel, holderId, clearHolder, mode, syncEnabled in
                try await appState.apiClient.updateGmailConnection(
                    connectionId: conn.id,
                    displayLabel: label,
                    clearDisplayLabel: clearLabel,
                    defaultHolderId: holderId,
                    clearDefaultHolderId: clearHolder,
                    attributionMode: mode,
                    syncEnabled: syncEnabled
                )
                await reloadStatusAfterMutation()
            }
        }
    }

    // MARK: - Rows

    @ViewBuilder
    private func connectionCard(_ conn: GmailConnectionDTO, isPrimary: Bool) -> some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                if let label = conn.displayLabel, !label.isEmpty {
                    Text(label)
                        .font(.subheadline.weight(.semibold))
                }
                Text(conn.email)
                    .font(.subheadline)
                    .foregroundStyle(conn.displayLabel?.isEmpty == false ? .secondary : .primary)
            }
            Spacer()
            Text(conn.syncEnabled ? (conn.status == "revoked" ? "已失效" : "已连接") : "已暂停")
                .font(.caption2.weight(.semibold))
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .background(statusBadgeColor(conn).opacity(0.16), in: Capsule())
                .foregroundStyle(statusBadgeColor(conn))
        }

        if let holderId = conn.defaultHolderId, !holderId.isEmpty {
            let holderName = appState.dashboardHolders.first(where: { $0.id == holderId })?.name ?? holderId
            LabeledContent("默认归属人", value: holderName)
                .font(.caption)
        }

        if let summary = conn.lastSyncSummary {
            LabeledContent("上次同步") {
                VStack(alignment: .trailing, spacing: 2) {
                    if let at = conn.lastSyncAt {
                        Text(at).font(.footnote)
                    }
                    Text(summary)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
        } else if let at = conn.lastSyncAt {
            LabeledContent("上次同步", value: at)
        } else {
            LabeledContent("上次同步") {
                Text("尚未同步；服务端每日自动拉取（北京时间约 17:00）")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }

        if conn.status == "revoked" {
            Label("Google 侧授权已撤销，请断开后重新连接", systemImage: "exclamationmark.triangle.fill")
                .font(.footnote)
                .foregroundStyle(.orange)
        }

        if let err = conn.lastError, !err.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                Text("最近同步错误")
                    .font(.caption.bold())
                    .foregroundStyle(.red)
                Text(err)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }

        let isThisSyncing = syncingConnectionId == conn.id
        Button(action: { Task { await syncNow(connectionId: conn.id) } }) {
            HStack {
                Text("立即同步")
                Spacer()
                if isThisSyncing {
                    ProgressView()
                }
            }
        }
        .disabled(syncingConnectionId != nil || isConnecting || isDisconnecting)
        .accessibilityIdentifier(isPrimary ? "gmail.sync" : "gmail.sync.\(conn.id)")

        if isThisSyncing, let progressMessage {
            Text(progressMessage)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }

        if !conn.id.isEmpty {
            Button("编辑归属与开关") {
                editingConnection = conn
            }
            .font(.footnote)
            .disabled(syncingConnectionId != nil || isConnecting || isDisconnecting)
        }

        Button(role: .destructive, action: {
            pendingDisconnectConnection = conn
            showingDisconnectAlert = true
        }) {
            HStack {
                Text("断开 Gmail")
                Spacer()
                if isDisconnecting {
                    ProgressView()
                }
            }
        }
        .disabled(syncingConnectionId != nil || isDisconnecting)
        .accessibilityIdentifier(isPrimary ? "gmail.disconnect" : "gmail.disconnect.\(conn.id)")
    }

    @ViewBuilder
    private var disconnectedRows: some View {
        if let statusError {
            VStack(alignment: .leading, spacing: 4) {
                Text("无法获取连接状态")
                    .font(.caption.bold())
                    .foregroundStyle(.red)
                Text(statusError)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            Button("重试") {
                Task { await refreshAll() }
            }
        } else {
            Text("授权后服务端每日自动从 Gmail 拉取银行账单邮件并进入草稿或账单。仅需只读权限（gmail.readonly），支持连接多个家庭/个人邮箱。")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }

        Button(action: { Task { await connect(defaultHolderId: nil, displayLabel: nil) } }) {
            HStack {
                Text("连接 Gmail（只读）")
                Spacer()
                if isConnecting {
                    ProgressView()
                }
            }
        }
        .disabled(isConnecting || syncingConnectionId != nil)
        .accessibilityIdentifier("gmail.connect")

        Button("设置归属人并连接...") {
            addDisplayLabel = ""
            addDefaultHolderId = ""
            showingAddMailboxSheet = true
        }
        .font(.footnote)
        .disabled(isConnecting || syncingConnectionId != nil)
    }

    private var addMailboxSheet: some View {
        NavigationStack {
            Form {
                Section("邮箱标识") {
                    TextField("备注名（如：主账号 / 配偶邮箱）", text: $addDisplayLabel)
                    Picker("默认持卡人（兜底归属）", selection: $addDefaultHolderId) {
                        Text("自动识别（不固定）").tag("")
                        ForEach(appState.dashboardHolders) { holder in
                            Text(holder.name).tag(holder.id)
                        }
                    }
                }
                Section {
                    Button {
                        let holder = addDefaultHolderId.isEmpty ? nil : addDefaultHolderId
                        let label = addDisplayLabel.trimmingCharacters(in: .whitespacesAndNewlines)
                        showingAddMailboxSheet = false
                        Task {
                            await connect(
                                defaultHolderId: holder,
                                displayLabel: label.isEmpty ? nil : label
                            )
                        }
                    } label: {
                        HStack {
                            Spacer()
                            Text("发起 Google 只读授权")
                                .fontWeight(.semibold)
                            Spacer()
                        }
                    }
                } footer: {
                    Text("将弹出 Google 账号选择页，仅申请 gmail.readonly 权限。")
                }
            }
            .navigationTitle("添加 Gmail 邮箱")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { showingAddMailboxSheet = false }
                }
            }
        }
    }

    private func statusBadgeColor(_ conn: GmailConnectionDTO) -> Color {
        if conn.status == "revoked" { return .orange }
        return conn.syncEnabled ? .green : .secondary
    }

    // MARK: - Actions

    private func refreshAll() async {
        await refreshStatus()
        await refreshPreferences()
    }

    private func refreshStatus() async {
        do {
            let list = try await appState.apiClient.gmailConnections()
            connections = list
            statusError = nil
            return
        } catch is CancellationError {
            return
        } catch let urlError as URLError where urlError.code == .cancelled {
            return
        } catch {
            // 兼容仅实现旧单账号端点或 UI Test 离线 stub 的环境：回退查 /api/gmail/status。
            do {
                let legacy = try await appState.apiClient.gmailStatus()
                if legacy.connected {
                    connections = [
                        GmailConnectionDTO(
                            id: "",
                            email: legacy.email ?? "未知",
                            displayLabel: nil,
                            defaultHolderId: nil,
                            attributionMode: "auto_then_default",
                            syncEnabled: true,
                            status: legacy.status ?? "active",
                            lastSyncAt: legacy.lastSyncAt,
                            lastSyncSummary: legacy.lastSyncSummary,
                            lastError: legacy.lastError
                        )
                    ]
                } else {
                    connections = []
                }
                statusError = nil
            } catch is CancellationError {
                return
            } catch let urlError as URLError where urlError.code == .cancelled {
                return
            } catch let fallbackError {
                let nsError = fallbackError as NSError
                if nsError.code == 401 { return }
                if connections.isEmpty {
                    statusError = fallbackError.localizedDescription
                }
            }
        }
    }

    private func refreshPreferences() async {
        isLoadingPreferences = true
        defer { isLoadingPreferences = false }
        if let prefs = try? await appState.apiClient.fetchImportPreferences() {
            requireDraftReview = !prefs.autoCommitTrustedEmail
        }
    }

    private func updateSafetyPreference(requireReview: Bool) async {
        let previous = requireDraftReview
        requireDraftReview = requireReview
        isUpdatingPreferences = true
        defer { isUpdatingPreferences = false }
        do {
            let updated = try await appState.apiClient.updateImportPreferences(
                autoCommitTrustedEmail: !requireReview
            )
            requireDraftReview = !updated.autoCommitTrustedEmail
        } catch {
            requireDraftReview = previous
            alertMessage = "更新安全开关失败：\(error.localizedDescription)"
        }
    }

    private func reloadStatusAfterMutation() async {
        do {
            let list = try await appState.apiClient.gmailConnections()
            connections = list
            statusError = nil
        } catch {
            do {
                let legacy = try await appState.apiClient.gmailStatus()
                if legacy.connected {
                    connections = [
                        GmailConnectionDTO(
                            id: "",
                            email: legacy.email ?? "未知",
                            status: legacy.status ?? "active",
                            lastSyncAt: legacy.lastSyncAt,
                            lastSyncSummary: legacy.lastSyncSummary,
                            lastError: legacy.lastError
                        )
                    ]
                } else {
                    connections = []
                }
                statusError = nil
            } catch let fallbackError {
                alertMessage = "状态可能未刷新：\(fallbackError.localizedDescription)"
            }
        }
    }

    private func connect(defaultHolderId: String?, displayLabel: String?) async {
        guard let presenter = Self.presentingViewController() else {
            alertMessage = "无法获取当前窗口，请稍后重试"
            return
        }
        isConnecting = true
        defer { isConnecting = false }
        do {
            GIDSignIn.sharedInstance.signOut()
            let code = try await Self.authorizeGmail(presenting: presenter)
            let result = try await appState.apiClient.gmailConnectAccount(
                serverAuthCode: code,
                defaultHolderId: defaultHolderId,
                displayLabel: displayLabel
            )
            if connections.isEmpty {
                connections = [
                    GmailConnectionDTO(
                        id: "pending-\(UUID().uuidString)",
                        email: result.email ?? "Gmail",
                        displayLabel: displayLabel,
                        defaultHolderId: defaultHolderId,
                        status: "active"
                    )
                ]
            }
            statusError = nil
            alertMessage = "已连接 \(result.email ?? "Gmail")，服务端将每日自动拉取账单。"
            await reloadStatusAfterMutation()
        } catch let error as GIDSignInError where error.code == .canceled {
            // 用户在授权页主动返回，静默即可。
        } catch {
            alertMessage = "连接失败：\(error.localizedDescription)"
        }
    }

    /// 与 Web 面板同款的分轮拉取：每轮 6 封、按 remaining 续拉、最多 30 轮，
    /// 过程中实时展示进度，结束后一次性汇总。
    private func syncNow(connectionId: String) async {
        syncingConnectionId = connectionId
        progressMessage = nil
        defer { syncingConnectionId = nil }
        do {
            let scopedId = connectionId.isEmpty ? nil : connectionId
            var total = GmailSyncResult(scanned: 0, written: 0, drafted: 0, skipped: 0, failed: 0)
            for round in 1...30 {
                let result = try await appState.apiClient.gmailSyncConnection(connectionId: scopedId, maxMessages: 6)
                total = total.merged(with: result)
                progressMessage = "同步中（第 \(round) 轮）… 落账单 \(total.written)｜草稿 \(total.drafted)｜剩余 \(result.remaining ?? 0) 封"
                guard let remaining = result.remaining, remaining > 0, round < 30 else { break }
            }
            await reloadStatusAfterMutation()
            await appState.refreshBillDrafts(silent: true)
            alertMessage = "同步完成：\(total.summaryText)"
        } catch {
            alertMessage = "同步失败：\(error.localizedDescription)"
        }
    }

    private func disconnect(_ connection: GmailConnectionDTO?) async {
        isDisconnecting = true
        defer { isDisconnecting = false }
        do {
            let targetId = (connection?.id.isEmpty == false) ? connection?.id : nil
            try await appState.apiClient.gmailDisconnectConnection(connectionId: targetId)
            if let id = connection?.id {
                connections.removeAll { $0.id == id }
            } else {
                connections = []
            }
            GIDSignIn.sharedInstance.signOut()
            await reloadStatusAfterMutation()
        } catch {
            alertMessage = "断开失败：\(error.localizedDescription)"
        }
    }

    // MARK: - Google Sign-In (View layer only; AppState must not link GoogleSignIn)

    private static let webServerClientID = "490117963106-31ss52gua36fa8i231ss074ed61rn330.apps.googleusercontent.com"
    private static let gmailReadonlyScope = "https://www.googleapis.com/auth/gmail.readonly"

    private enum GmailAuthError: LocalizedError {
        case missingClientID
        case noServerAuthCode

        var errorDescription: String? {
            switch self {
            case .missingClientID:
                return "缺少 Google 客户端配置，无法发起授权"
            case .noServerAuthCode:
                return "Google 未返回授权码。请到 Google 账号 → 安全 → 第三方应用访问中移除本应用的授权后重试"
            }
        }
    }

    @MainActor
    private static func authorizeGmail(presenting: UIViewController) async throws -> String {
        let signIn = GIDSignIn.sharedInstance
        guard let iOSClientID = Bundle.main.object(forInfoDictionaryKey: "GIDClientID") as? String,
              !iOSClientID.isEmpty else {
            throw GmailAuthError.missingClientID
        }
        let gmailConfig = GIDConfiguration(clientID: iOSClientID, serverClientID: webServerClientID)
        let previousConfig = signIn.configuration
        signIn.configuration = gmailConfig
        defer { signIn.configuration = previousConfig }

        let result: GIDSignInResult
        if let currentUser = signIn.currentUser,
           currentUser.configuration.serverClientID == webServerClientID {
            result = try await currentUser.addScopes([gmailReadonlyScope], presenting: presenting)
        } else {
            if signIn.currentUser != nil {
                signIn.signOut()
            }
            result = try await signIn.signIn(withPresenting: presenting)
        }
        guard let code = result.serverAuthCode, !code.isEmpty else {
            throw GmailAuthError.noServerAuthCode
        }
        return code
    }

    private static func presentingViewController() -> UIViewController? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let keyWindow = scenes.flatMap(\.windows).first(where: \.isKeyWindow)
        var top = keyWindow?.rootViewController
        while let presented = top?.presentedViewController {
            top = presented
        }
        return top
    }
}

private struct EditGmailConnectionSheet: View {
    let connection: GmailConnectionDTO
    let holders: [CardHolder]
    let onSave: (String?, Bool, String?, Bool, String, Bool) async throws -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var displayLabel: String
    @State private var defaultHolderId: String
    @State private var attributionMode: String
    @State private var syncEnabled: Bool
    @State private var isSaving = false
    @State private var errorMessage: String?

    init(
        connection: GmailConnectionDTO,
        holders: [CardHolder],
        onSave: @escaping (String?, Bool, String?, Bool, String, Bool) async throws -> Void
    ) {
        self.connection = connection
        self.holders = holders
        self.onSave = onSave
        _displayLabel = State(initialValue: connection.displayLabel ?? "")
        _defaultHolderId = State(initialValue: connection.defaultHolderId ?? "")
        _attributionMode = State(initialValue: connection.attributionMode)
        _syncEnabled = State(initialValue: connection.syncEnabled)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("邮箱") {
                    LabeledContent("地址", value: connection.email)
                    TextField("备注名（如：主账号）", text: $displayLabel)
                }

                Section("归属规则") {
                    Picker("默认持卡人", selection: $defaultHolderId) {
                        Text("不设默认").tag("")
                        ForEach(holders) { holder in
                            Text(holder.name).tag(holder.id)
                        }
                    }

                    Picker("归属匹配策略", selection: $attributionMode) {
                        Text("自动匹配优先，失败兜底").tag("auto_then_default")
                        Text("始终归属默认持卡人").tag("always_default")
                        Text("仅按姓名/别名自动匹配").tag("auto_only")
                    }
                }

                Section("同步开关") {
                    Toggle("启用每日自动拉取", isOn: $syncEnabled)
                }

                if let errorMessage {
                    Section {
                        Text(errorMessage)
                            .font(.footnote)
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("编辑邮箱配置")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                        .disabled(isSaving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("保存") {
                        Task { await save() }
                    }
                    .disabled(isSaving)
                }
            }
        }
    }

    private func save() async {
        isSaving = true
        errorMessage = nil
        defer { isSaving = false }
        let trimmedLabel = displayLabel.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            try await onSave(
                trimmedLabel.isEmpty ? nil : trimmedLabel,
                trimmedLabel.isEmpty,
                defaultHolderId.isEmpty ? nil : defaultHolderId,
                defaultHolderId.isEmpty,
                attributionMode,
                syncEnabled
            )
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
