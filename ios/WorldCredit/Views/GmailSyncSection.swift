import SwiftUI
import UIKit
import GoogleSignIn
import WorldCreditCore

/// 设置页「Gmail 账单同步」卡片。
///
/// iOS 侧只做三件事：发起授权拿 serverAuthCode、把 code 交给服务端、
/// 展示连接状态并支持手动同步/断开。refresh token 由服务端保管，客户端不落盘。
struct GmailSyncSection: View {
    @Environment(AppState.self) private var appState
    @State private var status: GmailSyncStatus?
    @State private var statusError: String?
    @State private var isConnecting = false
    @State private var isSyncing = false
    @State private var isDisconnecting = false
    @State private var showingDisconnectAlert = false
    @State private var alertMessage: String?

    var body: some View {
        Section("Gmail 账单同步") {
            if let status, status.connected {
                connectedRows(status)
            } else {
                disconnectedRows
            }
        }
        .task { await refreshStatus() }
        .alert("Gmail 同步", isPresented: Binding(
            get: { alertMessage != nil },
            set: { if !$0 { alertMessage = nil } }
        )) {
            Button("好", role: .cancel) {}
        } message: {
            Text(alertMessage ?? "")
        }
        .confirmationDialog("断开后将停止每日自动拉取账单，已入库数据保留。确定断开？", isPresented: $showingDisconnectAlert, titleVisibility: .visible) {
            Button("断开", role: .destructive) {
                Task { await disconnect() }
            }
            Button("取消", role: .cancel) {}
        }
    }

    // MARK: - Rows

    @ViewBuilder
    private func connectedRows(_ status: GmailSyncStatus) -> some View {
        LabeledContent("账号", value: status.email ?? "未知")

        if let summary = status.lastSyncSummary {
            LabeledContent("上次同步") {
                VStack(alignment: .trailing, spacing: 2) {
                    if let at = status.lastSyncAt {
                        Text(at)
                            .font(.footnote)
                    }
                    Text(summary)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
        } else if let at = status.lastSyncAt {
            LabeledContent("上次同步", value: at)
        } else {
            LabeledContent("上次同步") {
                Text("尚未同步（服务端每日 09:00 自动拉取）")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }

        if status.status == "revoked" {
            Label("Google 侧授权已撤销，请断开后重新连接", systemImage: "exclamationmark.triangle.fill")
                .font(.footnote)
                .foregroundStyle(.orange)
        }

        if let err = status.lastError, !err.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                Text("最近同步错误")
                    .font(.caption.bold())
                    .foregroundStyle(.red)
                Text(err)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }

        Button(action: { Task { await syncNow() } }) {
            HStack {
                Text("立即同步")
                Spacer()
                if isSyncing {
                    ProgressView()
                }
            }
        }
        .disabled(isSyncing || isConnecting || isDisconnecting)
        .accessibilityIdentifier("gmail.sync")

        Button(role: .destructive, action: { showingDisconnectAlert = true }) {
            HStack {
                Text("断开 Gmail")
                Spacer()
                if isDisconnecting {
                    ProgressView()
                }
            }
        }
        .disabled(isSyncing || isDisconnecting)
        .accessibilityIdentifier("gmail.disconnect")
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
                Task { await refreshStatus() }
            }
        } else {
            Text("授权后服务端每日自动从 Gmail 拉取银行账单邮件并生成账单记录。仅需只读权限（gmail.readonly）。")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }

        Button(action: { Task { await connect() } }) {
            HStack {
                Text("连接 Gmail（只读）")
                Spacer()
                if isConnecting {
                    ProgressView()
                }
            }
        }
        .disabled(isConnecting || isSyncing)
        .accessibilityIdentifier("gmail.connect")
    }

    // MARK: - Actions

    private func refreshStatus() async {
        do {
            status = try await appState.apiClient.gmailStatus()
            statusError = nil
        } catch {
            // 服务端未部署或网络异常时保留上次状态，不打断设置页。
            if status == nil { statusError = error.localizedDescription }
        }
    }

    private func connect() async {
        guard let presenter = Self.presentingViewController() else {
            alertMessage = "无法获取当前窗口，请稍后重试"
            return
        }
        isConnecting = true
        defer { isConnecting = false }
        do {
            let code = try await Self.authorizeGmail(presenting: presenter)
            let result = try await appState.apiClient.gmailConnect(serverAuthCode: code)
            await refreshStatus()
            alertMessage = "已连接 \(result.email ?? status?.email ?? "Gmail")，服务端将每日自动拉取账单。"
        } catch let error as GIDSignInError where error.code == .canceled {
            // 用户在授权页主动返回，静默即可。
        } catch {
            alertMessage = "连接失败：\(error.localizedDescription)"
        }
    }

    private func syncNow() async {
        isSyncing = true
        defer { isSyncing = false }
        do {
            let result = try await appState.apiClient.gmailSync()
            await refreshStatus()
            alertMessage = "同步完成：\(result.summaryText)"
        } catch {
            alertMessage = "同步失败：\(error.localizedDescription)"
        }
    }

    private func disconnect() async {
        isDisconnecting = true
        defer { isDisconnecting = false }
        do {
            try await appState.apiClient.gmailDisconnect()
            await refreshStatus()
        } catch {
            alertMessage = "断开失败：\(error.localizedDescription)"
        }
    }

    // MARK: - Google Sign-In (View layer only; AppState must not link GoogleSignIn)

    /// serverClientID 必须用 Web client：serverAuthCode 要由服务端拿 Web client secret 换 refresh token。
    /// 与登录用的 iOS client（Info.plist GIDClientID）同属一个 Google Cloud 项目。
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

    /// 已登录 Google 时增量加 scope；否则走完整 signIn。两者都要求 config 带 serverClientID，
    /// 否则结果里不会有 serverAuthCode。结束后恢复原配置，不影响默认登录路径。
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
        if let currentUser = signIn.currentUser {
            result = try await currentUser.addScopes([gmailReadonlyScope], presenting: presenting)
        } else {
            result = try await signIn.signIn(withPresenting: presenting)
        }
        guard let code = result.serverAuthCode, !code.isEmpty else {
            throw GmailAuthError.noServerAuthCode
        }
        return code
    }

    /// GoogleSignIn 走 ASWebAuthenticationSession，需要一个 presenting view controller。
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
