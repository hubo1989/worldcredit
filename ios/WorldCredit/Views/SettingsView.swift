import SwiftUI
import WorldCreditCore

struct SettingsView: View {
    @Environment(AppState.self) private var appState
    @State private var showingLogoutAlert: Bool = false

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

                Section("离线机制与安全") {
                    LabeledContent("本地数据库", value: "SQLite (GRDB)")
                    LabeledContent("通知提醒", value: "本地系统日历推导 (09:00)")
                    LabeledContent("离线能力", value: "断网查看 / 本地离线还款")
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
            .navigationTitle("设置")
            .confirmationDialog("确定退出登录？", isPresented: $showingLogoutAlert, titleVisibility: .visible) {
                Button("退出登录", role: .destructive) {
                    appState.logout()
                }
                Button("取消", role: .cancel) {}
            }
        }
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
