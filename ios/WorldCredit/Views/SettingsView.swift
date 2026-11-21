import SwiftUI
import UIKit
import WorldCreditCore

struct SettingsView: View {
    @Environment(AppState.self) private var appState
    @State private var showingLogoutAlert: Bool = false
    @State private var copiedForwardEmail: Bool = false
    @State private var copyFeedbackTrigger: Int = 0
    @State private var displayFeedbackTrigger: Int = 0
    @State private var copyResetTask: Task<Void, Never>?

    var body: some View {
        NavigationStack {
            List {
                Section("账户信息") {
                    if let user = appState.currentUser {
                        LabeledContent("用户", value: user.name ?? user.email)
                        LabeledContent("邮箱", value: user.email)
                        LabeledContent("角色", value: user.role == "admin" ? "管理员" : "家庭成员")
                    } else {
                        LabeledContent("状态", value: appState.isLoggedIn ? "已登录 (Token)" : "未登录")
                    }
                }

                Section("数据同步") {
                    LabeledContent("服务器地址", value: "app.all-bill.com")

                    LabeledContent("上次同步时间") {
                        if let lastSynced = appState.lastSyncedAt {
                            Text(formatTimestamp(lastSynced))
                                .font(.footnote)
                        } else {
                            Text("尚未同步")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                    }

                    LabeledContent("待提交改动") {
                        if appState.pendingSyncCount > 0 {
                            Text("\(appState.pendingSyncCount) 条待提交")
                                .font(.footnote.bold())
                                .foregroundStyle(.orange)
                        } else {
                            Text("已与服务端保持一致")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .accessibilityIdentifier("settings.pendingChanges")

                    if let err = appState.lastSyncError {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("最近同步异常")
                                .font(.caption.bold())
                                .foregroundStyle(.red)
                            Text(err)
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }

                    if appState.isolatedSyncChanges.isEmpty {
                        LabeledContent("同步异常隔离记录", value: "0 条")
                            .accessibilityIdentifier("settings.isolatedChanges")
                    } else {
                        NavigationLink {
                            IsolatedSyncChangesView(changes: appState.isolatedSyncChanges)
                        } label: {
                            HStack {
                                Text("同步异常隔离记录")
                                Spacer()
                                Text("\(appState.isolatedSyncChanges.count) 条")
                                    .font(.footnote.bold())
                                    .foregroundStyle(.orange)
                            }
                        }
                        .accessibilityIdentifier("settings.isolatedChanges")
                    }

                    Button(action: {
                        Task { await appState.sync() }
                    }) {
                        HStack {
                            Text("立即同步")
                            Spacer()
                            if appState.isSyncing {
                                ProgressView()
                            }
                        }
                    }
                    .disabled(appState.isSyncing)
                }

                GmailSyncSection()

                Section {
                    if let userId = appState.currentUser?.id, !userId.isEmpty {
                        let forwardAddress = "bills+\(userId)@20160325.xyz"
                        HStack(spacing: 10) {
                            VStack(alignment: .leading, spacing: 3) {
                                Text("专属账单转发邮箱")
                                    .font(.subheadline)
                                Text(forwardAddress)
                                    .font(.system(.caption, design: .monospaced))
                                    .foregroundStyle(WCColors.textSecondary)
                                    .textSelection(.enabled)
                            }
                            Spacer()
                            Button {
                                UIPasteboard.general.string = forwardAddress
                                copyFeedbackTrigger += 1
                                copiedForwardEmail = true
                                copyResetTask?.cancel()
                                copyResetTask = Task { @MainActor in
                                    try? await Task.sleep(for: .seconds(2))
                                    if !Task.isCancelled {
                                        copiedForwardEmail = false
                                    }
                                }
                            } label: {
                                Text(copiedForwardEmail ? "已复制" : "复制")
                                    .font(.caption.bold())
                                    .padding(.horizontal, 10)
                                    .padding(.vertical, 5)
                                    .background(
                                        copiedForwardEmail ? WCColors.successSoft : WCColors.subtle,
                                        in: Capsule()
                                    )
                                    .foregroundStyle(
                                        copiedForwardEmail ? WCColors.successInk : WCColors.primaryAccent
                                    )
                            }
                            .buttonStyle(.borderless)
                            .accessibilityIdentifier("settings.copyForwardEmail")
                        }

                        Button {
                            appState.openWebDestination(.gmailLedger)
                        } label: {
                            Label("查看邮箱账单流水", systemImage: "envelope.open")
                        }
                    } else {
                        LabeledContent("专属账单转发邮箱", value: "登录后生成")
                    }
                } header: {
                    Text("邮箱账单转发")
                } footer: {
                    Text("把银行账单邮件作为 .eml 附件转发至此地址可补录账单。")
                }

                Section("通知与提醒") {
                    NavigationLink {
                        NotificationsCenterView()
                    } label: {
                        HStack {
                            Label("通知中心", systemImage: "bell")
                            Spacer()
                            if appState.unreadNotificationCount > 0 {
                                Text("\(appState.unreadNotificationCount)")
                                    .font(.caption.bold())
                                    .foregroundStyle(.white)
                                    .padding(.horizontal, 7)
                                    .padding(.vertical, 2)
                                    .background(Color.red, in: Capsule())
                            }
                        }
                    }

                    NavigationLink {
                        NotificationSettingsView()
                    } label: {
                        Label("通知与提醒开关", systemImage: "slider.horizontal.3")
                    }
                }

                Section("外观与主题") {
                    Picker("主题模式", selection: Binding(
                        get: { appState.themeMode },
                        set: { appState.themeMode = $0 }
                    )) {
                        ForEach(AppThemeMode.allCases) { mode in
                            Text(mode.title).tag(mode)
                        }
                    }
                    .pickerStyle(.segmented)
                    .accessibilityIdentifier("settings.themePicker")
                }

                Section {
                    Picker("折算主币种", selection: Binding(
                        get: { appState.displayConfig.defaultCurrency },
                        set: { newValue in
                            displayFeedbackTrigger += 1
                            let nextCurrency = newValue
                            Task {
                                await appState.updateDisplayConfig { config in
                                    config.defaultCurrency = nextCurrency
                                }
                            }
                        }
                    )) {
                        ForEach(currencyOptions, id: \.code) { option in
                            Text(option.label).tag(option.code)
                        }
                    }
                    .accessibilityIdentifier("settings.defaultCurrency")

                    Toggle("高斯模糊隐私模式", isOn: Binding(
                        get: { appState.displayConfig.privacyMode },
                        set: { newValue in
                            displayFeedbackTrigger += 1
                            let enabled = newValue
                            Task {
                                await appState.updateDisplayConfig { config in
                                    config.privacyMode = enabled
                                }
                            }
                        }
                    ))
                    .accessibilityIdentifier("settings.privacyMode")

                    Toggle("显示最低还款额", isOn: Binding(
                        get: { appState.displayConfig.showMinPayment },
                        set: { newValue in
                            displayFeedbackTrigger += 1
                            let enabled = newValue
                            Task {
                                await appState.updateDisplayConfig { config in
                                    config.showMinPayment = enabled
                                }
                            }
                        }
                    ))

                    Toggle("显示账单日", isOn: Binding(
                        get: { appState.displayConfig.showStatementDate },
                        set: { newValue in
                            displayFeedbackTrigger += 1
                            let enabled = newValue
                            Task {
                                await appState.updateDisplayConfig { config in
                                    config.showStatementDate = enabled
                                }
                            }
                        }
                    ))

                    Toggle("显示年费信息", isOn: Binding(
                        get: { appState.displayConfig.showAnnualFee },
                        set: { newValue in
                            displayFeedbackTrigger += 1
                            let enabled = newValue
                            Task {
                                await appState.updateDisplayConfig { config in
                                    config.showAnnualFee = enabled
                                }
                            }
                        }
                    ))

                    Toggle("显示卡号后 4 位", isOn: Binding(
                        get: { appState.displayConfig.showCardLast4 },
                        set: { newValue in
                            displayFeedbackTrigger += 1
                            let enabled = newValue
                            Task {
                                await appState.updateDisplayConfig { config in
                                    config.showCardLast4 = enabled
                                }
                            }
                        }
                    ))
                } header: {
                    Text("显示与隐私偏好")
                } footer: {
                    Text("设置会同步至云端，并在看板与账单卡片即时生效。")
                }

                Section("安全与隐私") {
                    Toggle("启用 \(BiometricAuthManager.shared.biometryName) 锁定", isOn: Binding(
                        get: { appState.isBiometricsEnabled },
                        set: { enabled in
                            if enabled {
                                Task {
                                    let success = await BiometricAuthManager.shared.authenticate(reason: "验证身份以启用生物识别保护")
                                    if success {
                                        appState.isBiometricsEnabled = true
                                    }
                                }
                            } else {
                                appState.isBiometricsEnabled = false
                            }
                        }
                    ))

                    Button("测试锁定屏幕") {
                        appState.isLocked = true
                    }

                    LabeledContent("文件数据保护", value: "CompleteUntilFirstAuth")
                    LabeledContent("本地数据库", value: "SQLite (GRDB)")
                    LabeledContent("远程通道", value: "APNs (HTTP/2)")
                }

                if appState.currentUser?.role == "admin" {
                    Section {
                        Text("当前账号具备管理员权限。卡种目录、银行配置与系统运营请在桌面 Web 端管理。")
                            .font(.footnote)
                            .foregroundStyle(.secondary)

                        if let adminURL = URL(string: "https://app.all-bill.com/admin") {
                            Link(destination: adminURL) {
                                Label("打开管理后台（浏览器）", systemImage: "safari")
                            }
                            .accessibilityIdentifier("settings.adminLink")
                        }
                    } header: {
                        Text("管理后台（桌面 Web 优先）")
                    }
                }

                Section {
                    Button(role: .destructive, action: {
                        showingLogoutAlert = true
                    }) {
                        HStack {
                            Spacer()
                            Text("退出登录")
                            Spacer()
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("我的")
            .sensoryFeedback(.success, trigger: copyFeedbackTrigger)
            .sensoryFeedback(.selection, trigger: displayFeedbackTrigger)
            .onDisappear {
                copyResetTask?.cancel()
            }
            .confirmationDialog("确定退出登录？", isPresented: $showingLogoutAlert, titleVisibility: .visible) {
                Button("退出登录", role: .destructive) {
                    Task {
                        do { try await appState.logout() }
                        catch { appState.lastSyncError = "退出登录失败：\(error.localizedDescription)" }
                    }
                }
                Button("取消", role: .cancel) {}
            }
        }
    }

    private var currencyOptions: [(code: String, label: String)] {
        var options: [(code: String, label: String)] = [
            ("CNY", "人民币 CNY"),
            ("USD", "美元 USD"),
            ("HKD", "港币 HKD"),
        ]
        let current = appState.displayConfig.defaultCurrency.trimmingCharacters(in: .whitespacesAndNewlines)
        if !current.isEmpty, !options.contains(where: { $0.code == current }) {
            options.append((current, "\(current)（历史设置）"))
        }
        return options
    }

    private func formatTimestamp(_ iso: String) -> String {
        // e.g. "2026-10-21T15:00:00.000Z" -> "10-21 23:00"
        let isoFormatter = ISO8601DateFormatter()
        isoFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = isoFormatter.date(from: iso) ?? ISO8601DateFormatter().date(from: iso) else {
            return iso
        }
        let df = DateFormatter()
        df.dateFormat = "MM-dd HH:mm"
        df.timeZone = TimeZone(identifier: "Asia/Shanghai") ?? .current
        return df.string(from: date)
    }
}

private struct IsolatedSyncChangesView: View {
    let changes: [[String: String]]

    var body: some View {
        List {
            if changes.isEmpty {
                ContentUnavailableView(
                    "暂无异常隔离记录",
                    systemImage: "checkmark.shield",
                    description: Text("本地数据库与服务端同步状态健康。")
                )
            } else {
                ForEach(Array(changes.enumerated()), id: \.offset) { _, entry in
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text(entry["tbl"] ?? "未知数据表")
                                .font(.subheadline.bold())
                                .foregroundStyle(WCColors.textPrimary)
                            Spacer()
                            Text(entry["row_id"] ?? "-")
                                .font(.system(.caption2, design: .monospaced))
                                .foregroundStyle(WCColors.textSecondary)
                                .lineLimit(1)
                        }
                        Text(entry["error"] ?? "未知同步错误")
                            .font(.caption)
                            .foregroundStyle(WCColors.dangerInk)
                    }
                    .padding(.vertical, 4)
                }
            }
        }
        .navigationTitle("同步异常隔离记录")
        .navigationBarTitleDisplayMode(.inline)
    }
}
