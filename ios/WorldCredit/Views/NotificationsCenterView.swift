import SwiftUI
import WorldCreditCore

struct NotificationsCenterView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss
    @State private var filter: String = "all"
    @State private var selectedNotification: UserNotificationItem?
    @State private var showingDeleteAllConfirm = false
    @State private var actionError: String?
    @State private var hasSyncedToday = false

    var body: some View {
        List {
            if let err = actionError ?? appState.notificationsError {
                Section {
                    HStack(spacing: 8) {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .foregroundStyle(.red)
                        Text(err)
                            .font(.caption)
                            .foregroundStyle(.red)
                    }
                }
            }

            Section {
                Picker("筛选", selection: $filter) {
                    Text("全部").tag("all")
                    Text("未读 (\(appState.unreadNotificationCount))").tag("unread")
                }
                .pickerStyle(.segmented)
                .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
            }

            Section {
                if appState.isLoadingNotifications && appState.notifications.isEmpty {
                    HStack {
                        Spacer()
                        ProgressView("正在加载通知…")
                        Spacer()
                    }
                    .padding(.vertical, 24)
                } else if appState.notifications.isEmpty {
                    ContentUnavailableView(
                        filter == "unread" ? "暂无未读通知" : "暂无通知记录",
                        systemImage: "bell.slash",
                        description: Text(filter == "unread" ? "所有主动提醒与账单动态均已阅读。" : "当日待还与免息期通知会在生成后出现在这里。")
                    )
                    .padding(.vertical, 16)
                } else {
                    ForEach(appState.notifications) { item in
                        Button {
                            openNotification(item)
                        } label: {
                            notificationRow(item)
                        }
                        .buttonStyle(.plain)
                        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                            Button(role: .destructive) {
                                Task { await performDelete(item.id) }
                            } label: {
                                Label("删除", systemImage: "trash")
                            }
                        }
                        .swipeActions(edge: .leading, allowsFullSwipe: true) {
                            if item.isUnread {
                                Button {
                                    Task { await performMarkRead(item.id) }
                                } label: {
                                    Label("已读", systemImage: "checkmark.circle")
                                }
                                .tint(.accentColor)
                            }
                        }
                    }

                    if appState.hasMoreNotifications {
                        Button {
                            Task { await appState.loadMoreNotifications() }
                        } label: {
                            HStack {
                                Spacer()
                                if appState.isLoadingMoreNotifications {
                                    ProgressView()
                                        .padding(.trailing, 6)
                                    Text("正在加载更多…")
                                } else {
                                    Text("加载更多")
                                }
                                Spacer()
                            }
                        }
                        .disabled(appState.isLoadingMoreNotifications)
                    }
                }
            } header: {
                if appState.totalNotificationCount > 0 {
                    Text("共 \(appState.totalNotificationCount) 条通知 · \(appState.unreadNotificationCount) 条未读")
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("通知中心")
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                Button {
                    Task { await performMarkAllRead() }
                } label: {
                    Image(systemName: "checkmark.circle")
                }
                .disabled(appState.unreadNotificationCount == 0)
                .accessibilityLabel("全部已读")

                Button(role: .destructive) {
                    showingDeleteAllConfirm = true
                } label: {
                    Image(systemName: "trash")
                }
                .disabled(appState.notifications.isEmpty && appState.totalNotificationCount == 0)
                .accessibilityLabel("全部删除")

                NavigationLink {
                    NotificationSettingsView()
                } label: {
                    Image(systemName: "gearshape")
                }
                .accessibilityLabel("通知开关设置")
            }
        }
        .refreshable {
            hasSyncedToday = true
            await appState.loadNotifications(filter: filter, syncToday: true)
        }
        .task(id: filter) {
            let shouldSync = !hasSyncedToday
            await appState.loadNotifications(filter: filter, syncToday: shouldSync)
            if appState.notificationsError == nil {
                hasSyncedToday = true
            }
        }
        .sheet(item: $selectedNotification) { item in
            notificationDetailSheet(item)
        }
        .confirmationDialog("确定删除全部通知？", isPresented: $showingDeleteAllConfirm, titleVisibility: .visible) {
            Button("全部删除", role: .destructive) {
                Task { await performDeleteAll() }
            }
            Button("取消", role: .cancel) {}
        } message: {
            Text("删除后将清空通知中心历史记录，且当日已删通知不会重新弹出。")
        }
    }

    private func notificationRow(_ item: UserNotificationItem) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                if item.isUnread {
                    Circle()
                        .fill(Color.accentColor)
                        .frame(width: 8, height: 8)
                }
                Text(item.category.label)
                    .font(.caption2.bold())
                    .foregroundStyle(toneColor(item.category.tone))
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(toneColor(item.category.tone).opacity(0.14), in: Capsule())
                Spacer()
                Text(formatSentTime(item.sentAt, full: false))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }

            Text(item.title)
                .font(.subheadline.weight(item.isUnread ? .semibold : .regular))
                .foregroundStyle(.primary)

            if let body = item.body, !body.isEmpty {
                Text(body)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
        }
        .padding(.vertical, 4)
        .opacity(item.isUnread ? 1.0 : 0.78)
    }

    private func notificationDetailSheet(_ item: UserNotificationItem) -> some View {
        NavigationStack {
            List {
                Section {
                    HStack {
                        Text(item.category.label)
                            .font(.caption.bold())
                            .foregroundStyle(toneColor(item.category.tone))
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(toneColor(item.category.tone).opacity(0.14), in: Capsule())
                        Spacer()
                        Text(formatSentTime(item.sentAt, full: true))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    Text(item.title)
                        .font(.headline)
                        .textSelection(.enabled)

                    if let body = item.body, !body.isEmpty {
                        Text(body)
                            .font(.body)
                            .foregroundStyle(.primary)
                            .textSelection(.enabled)
                    }
                }

                if let meta = item.parsedMetadata {
                    if let totals = meta.totalsByCurrency, !totals.isEmpty {
                        Section("分币种合计") {
                            ForEach(totals.sorted(by: { $0.key < $1.key }), id: \.key) { code, amount in
                                LabeledContent(code, value: DashboardMoney.format(amount, currency: code))
                            }
                        }
                    }

                    if let bills = meta.bills, !bills.isEmpty {
                        Section("涉及账单") {
                            ForEach(bills) { bill in
                                HStack {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(bill.subject).font(.subheadline.bold())
                                        Text("到期日：\(bill.dueDate)").font(.caption).foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    Text(DashboardMoney.format(bill.remaining, currency: bill.currency))
                                        .font(.subheadline.bold())
                                }
                            }
                        }
                    }

                    if let payables = meta.payables, !payables.isEmpty {
                        Section("涉及固定支出") {
                            ForEach(payables) { payable in
                                HStack {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text("\(payable.name) · \(payable.category)").font(.subheadline.bold())
                                        Text("应付日：\(payable.dueDate)").font(.caption).foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    Text(DashboardMoney.format(payable.remaining, currency: payable.currency))
                                        .font(.subheadline.bold())
                                }
                            }
                        }
                    }

                    if let cards = meta.cards, !cards.isEmpty {
                        Section("最长免息期明细") {
                            ForEach(cards) { card in
                                VStack(alignment: .leading, spacing: 4) {
                                    HStack {
                                        Text(card.label).font(.subheadline.bold())
                                        Spacer()
                                        Text("最长 \(card.graceDays) 天")
                                            .font(.caption.bold())
                                            .foregroundStyle(.orange)
                                    }
                                    Text("下期账单日 \(card.nextBillingDate) · 还款日 \(card.nextDueDate)")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                }

                Section {
                    if let targetUrl = item.targetUrl,
                       targetUrl.hasPrefix("/"),
                       !targetUrl.hasPrefix("//") {
                        Button {
                            selectedNotification = nil
                            appState.handleNotificationRoute(targetUrl)
                            let cleanPath = targetUrl
                                .split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false).first
                                .map(String.init) ?? targetUrl
                            if cleanPath != "/notifications" {
                                dismiss()
                            }
                        } label: {
                            Label("前往查看", systemImage: "arrow.up.right.square")
                        }
                    }
                    if item.isUnread {
                        Button("标记为已读") {
                            Task {
                                await performMarkRead(item.id)
                                selectedNotification = item.markingRead(at: ISO8601DateFormatter().string(from: Date()))
                            }
                        }
                    }
                    Button("删除此通知", role: .destructive) {
                        let deletingId = item.id
                        selectedNotification = nil
                        Task { await performDelete(deletingId) }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("通知详情")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("完成") { selectedNotification = nil }
                }
            }
        }
    }

    private func openNotification(_ item: UserNotificationItem) {
        if item.isUnread {
            selectedNotification = item.markingRead(at: ISO8601DateFormatter().string(from: Date()))
            Task { await performMarkRead(item.id) }
        } else {
            selectedNotification = item
        }
    }

    private func performMarkRead(_ id: String) async {
        actionError = nil
        do {
            try await appState.markNotificationRead(id)
            if filter == "unread" {
                await appState.loadNotifications(filter: "unread", syncToday: false)
            }
        } catch {
            actionError = "标记已读失败：\(error.localizedDescription)"
        }
    }

    private func performMarkAllRead() async {
        actionError = nil
        do {
            try await appState.markAllNotificationsRead()
            if filter == "unread" {
                await appState.loadNotifications(filter: "unread", syncToday: false)
            }
        } catch {
            actionError = "全部已读失败：\(error.localizedDescription)"
        }
    }

    private func performDelete(_ id: String) async {
        actionError = nil
        do {
            try await appState.deleteNotification(id)
        } catch {
            actionError = "删除失败：\(error.localizedDescription)"
        }
    }

    private func performDeleteAll() async {
        actionError = nil
        do {
            try await appState.deleteAllNotifications()
        } catch {
            actionError = "全部删除失败：\(error.localizedDescription)"
        }
    }

    private func toneColor(_ tone: NotificationCategoryTone) -> Color {
        switch tone {
        case .danger: return .red
        case .gold: return .orange
        case .accent: return .accentColor
        case .muted: return .secondary
        }
    }

    private func formatSentTime(_ iso: String, full: Bool) -> String {
        let isoFormatter = ISO8601DateFormatter()
        isoFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = isoFormatter.date(from: iso) ?? ISO8601DateFormatter().date(from: iso) else {
            return String(iso.prefix(16)).replacingOccurrences(of: "T", with: " ")
        }
        let df = DateFormatter()
        df.timeZone = TimeZone(identifier: "Asia/Shanghai") ?? .current
        df.dateFormat = full ? "yyyy-MM-dd HH:mm" : "MM-dd HH:mm"
        return df.string(from: date)
    }
}
