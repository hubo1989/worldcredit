import SwiftUI
import WorldCreditCore

struct OpportunityCalendarAndRemindersView: View {
    @Environment(AppState.self) private var appState
    @Binding var deepLinkedEventKey: String?

    enum SubTab: String, CaseIterable, Identifiable {
        case reminders = "待办提醒"
        case calendarList = "日程列表"
        case calendarMonth = "月历视图"
        var id: String { rawValue }
    }

    @State private var subTab: SubTab = .reminders
    @State private var selectedHolderId: String?
    @State private var selectedMonthAnchor: Date = Date()
    @State private var calendarEvents: [OpportunityCalendarEventView] = []
    @State private var reminders: [OpportunityCalendarEventView] = []
    @State private var highlightedEventKey: String?
    @State private var actionError: String?

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(spacing: 12) {
                    Picker("日历子视图", selection: $subTab) {
                        ForEach(SubTab.allCases) { tab in
                            Text(tab.rawValue).tag(tab)
                        }
                    }
                    .pickerStyle(.segmented)

                    if !appState.dashboardHolders.isEmpty {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 8) {
                                filterChip("全部持卡人", selected: selectedHolderId == nil) {
                                    selectedHolderId = nil
                                }
                                ForEach(appState.dashboardHolders) { holder in
                                    filterChip(holder.name, selected: selectedHolderId == holder.id) {
                                        selectedHolderId = holder.id
                                    }
                                }
                            }
                        }
                    }

                    if let err = actionError {
                        Text(err).font(.caption).foregroundStyle(.red)
                    }

                    switch subTab {
                    case .reminders:
                        remindersListSection
                    case .calendarList:
                        calendarListSection
                    case .calendarMonth:
                        calendarMonthSection
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .padding(.bottom, 28)
            }
            .refreshable {
                _ = await appState.sync()
                await reloadData()
            }
            .task {
                await reloadData()
                consumeDeepLinkedEvent(with: proxy)
            }
            .onChange(of: selectedHolderId) { _, _ in Task { await reloadData() } }
            .onChange(of: selectedMonthAnchor) { _, _ in Task { await reloadData() } }
            .onChange(of: appState.opportunityReminders) { _, _ in Task { await reloadData() } }
            .onChange(of: deepLinkedEventKey) { _, _ in
                consumeDeepLinkedEvent(with: proxy)
            }
        }
    }

    private func consumeDeepLinkedEvent(with proxy: ScrollViewProxy) {
        guard let targetKey = deepLinkedEventKey, !targetKey.isEmpty else { return }
        deepLinkedEventKey = nil
        highlightedEventKey = targetKey
        if !reminders.contains(where: { $0.eventKey == targetKey }),
           calendarEvents.contains(where: { $0.eventKey == targetKey }) {
            subTab = .calendarList
        } else {
            subTab = .reminders
        }
        DispatchQueue.main.async {
            withAnimation {
                proxy.scrollTo(targetKey, anchor: .center)
            }
        }
    }

    private func reloadData() async {
        let todayOn = OpportunityDates.localDateInZone(Date(), timeZone: "Asia/Shanghai")
        let fromOn = OpportunityDates.addDays(todayOn, days: -7)
        let toBefore = OpportunityDates.addDays(todayOn, days: 85) // 85 + 7 == 92 <= CALENDAR_MAX_DAYS
        do {
            calendarEvents = try await appState.opportunityQueryService.fetchCalendar(
                fromOn: fromOn,
                toBefore: toBefore,
                holderId: selectedHolderId,
                userId: appState.currentUser?.id
            )
            reminders = try await appState.opportunityQueryService.fetchReminders(
                userId: appState.currentUser?.id,
                holderId: selectedHolderId
            )
        } catch {
            actionError = error.localizedDescription
        }
    }

    // MARK: - Reminders Section

    private var remindersListSection: some View {
        Group {
            if reminders.isEmpty {
                ContentUnavailableView(
                    "未来 30 天暂无待办提醒",
                    systemImage: "bell.badge",
                    description: Text("临近到期、领取窗口或预约服务节点会自动出现在这里。")
                )
                .padding(.vertical, 32)
            } else {
                LazyVStack(spacing: 10) {
                    ForEach(reminders) { event in
                        eventCard(event, showReminderActions: true)
                    }
                }
            }
        }
    }

    // MARK: - Calendar List Section

    private var calendarListSection: some View {
        Group {
            if calendarEvents.isEmpty {
                ContentUnavailableView(
                    "近 90 天暂无日历事件",
                    systemImage: "calendar",
                    description: Text("当权益到期、重置、领取或任务截止落入近 90 天内时会自动展示。")
                )
                .padding(.vertical, 32)
            } else {
                LazyVStack(spacing: 10) {
                    ForEach(calendarEvents) { event in
                        eventCard(event, showReminderActions: !event.dismissed)
                    }
                }
            }
        }
    }

    // MARK: - Month Grid Section

    private var calendarMonthSection: some View {
        let cal = {
            var c = Calendar(identifier: .gregorian)
            c.timeZone = TimeZone(identifier: "Asia/Shanghai")!
            return c
        }()
        let monthTitle: String = {
            let df = DateFormatter()
            df.dateFormat = "yyyy年M月"
            df.timeZone = cal.timeZone
            return df.string(from: selectedMonthAnchor)
        }()
        let monthDates = monthDays(in: selectedMonthAnchor, calendar: cal)
        let eventsByDay = Dictionary(grouping: calendarEvents, by: \.localDateOn)
        let monthPrefix: String = {
            let df = DateFormatter()
            df.dateFormat = "yyyy-MM"
            df.timeZone = cal.timeZone
            return df.string(from: selectedMonthAnchor)
        }()
        let monthEvents = calendarEvents.filter { $0.localDateOn.hasPrefix(monthPrefix) }

        return VStack(spacing: 12) {
            HStack {
                Button {
                    selectedMonthAnchor = cal.date(byAdding: .month, value: -1, to: selectedMonthAnchor) ?? selectedMonthAnchor
                } label: {
                    Image(systemName: "chevron.left").frame(width: 44, height: 36)
                }
                Spacer()
                Text(monthTitle).font(.headline)
                Spacer()
                Button {
                    selectedMonthAnchor = cal.date(byAdding: .month, value: 1, to: selectedMonthAnchor) ?? selectedMonthAnchor
                } label: {
                    Image(systemName: "chevron.right").frame(width: 44, height: 36)
                }
            }

            LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 7), spacing: 6) {
                ForEach(["一", "二", "三", "四", "五", "六", "日"], id: \.self) { wd in
                    Text(wd).font(.caption2.bold()).foregroundStyle(.secondary)
                }
                ForEach(Array(monthDates.enumerated()), id: \.offset) { _, dateStr in
                    if let dateStr {
                        let count = eventsByDay[dateStr]?.count ?? 0
                        let dayNum = String(dateStr.suffix(2)).replacingOccurrences(of: "^0", with: "", options: .regularExpression)
                        VStack(spacing: 3) {
                            Text(dayNum)
                                .font(.caption.bold())
                            Circle()
                                .fill(count > 0 ? WCColors.primaryAccent : .clear)
                                .frame(width: 6, height: 6)
                        }
                        .frame(maxWidth: .infinity, minHeight: 36)
                        .background(count > 0 ? WCColors.primaryAccent.opacity(0.08) : .clear, in: RoundedRectangle(cornerRadius: 8))
                    } else {
                        Color.clear.frame(height: 36)
                    }
                }
            }
            .padding(12)
            .background(Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16))

            if !monthEvents.isEmpty {
                LazyVStack(spacing: 10) {
                    ForEach(monthEvents) { ev in
                        eventCard(ev, showReminderActions: !ev.dismissed)
                    }
                }
            }
        }
    }

    private func monthDays(in anchor: Date, calendar: Calendar) -> [String?] {
        let comps = calendar.dateComponents([.year, .month], from: anchor)
        guard let start = calendar.date(from: comps),
              let range = calendar.range(of: .day, in: .month, for: start) else { return [] }
        let firstWeekday = calendar.component(.weekday, from: start) // 1=Sun,2=Mon...
        let leadingEmpty = firstWeekday == 1 ? 6 : (firstWeekday - 2)
        var slots: [String?] = Array(repeating: nil, count: leadingEmpty)
        let df = DateFormatter()
        df.dateFormat = "yyyy-MM-dd"
        df.timeZone = calendar.timeZone
        for day in range {
            if let d = calendar.date(byAdding: .day, value: day - 1, to: start) {
                slots.append(df.string(from: d))
            }
        }
        return slots
    }

    // MARK: - Event Row Card

    private func eventCard(_ event: OpportunityCalendarEventView, showReminderActions: Bool) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(event.kindLabel)
                    .font(.caption2.bold())
                    .foregroundStyle(WCColors.primaryAccent)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(WCColors.primaryAccent.opacity(0.14), in: Capsule())

                if event.needsReview {
                    Text("需核对")
                        .font(.caption2.bold())
                        .foregroundStyle(.orange)
                }
                if event.dismissed {
                    Text("已忽略")
                        .font(.caption2.bold())
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Text(event.localDateOn)
                    .font(.caption.bold())
                    .foregroundStyle(.secondary)
            }

            if let accountId = event.accountId {
                NavigationLink(value: accountId) {
                    HStack {
                        Text(event.title)
                            .font(.headline)
                            .foregroundStyle(.primary)
                        Spacer()
                        Image(systemName: "chevron.right").font(.caption).foregroundStyle(.secondary)
                    }
                }
                .buttonStyle(.plain)
            } else {
                Text(event.title)
                    .font(.headline)
            }

            Text(event.actionHint)
                .font(.caption)
                .foregroundStyle(.secondary)

            HStack(spacing: 10) {
                if event.dismissed {
                    Button("恢复提醒") {
                        performReminderAction(event, action: "restore", untilAt: nil)
                    }
                    .font(.caption.bold())
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                } else if showReminderActions {
                    Button("延后 1 天") {
                        let until = ISO8601DateFormatter().string(from: Date().addingTimeInterval(86400))
                        performReminderAction(event, action: "snooze", untilAt: until)
                    }
                    .font(.caption.bold())
                    .buttonStyle(.bordered)
                    .controlSize(.small)

                    Button("忽略") {
                        performReminderAction(event, action: "dismiss", untilAt: nil)
                    }
                    .font(.caption.bold())
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                }
            }
        }
        .padding(14)
        .background(Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16))
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(highlightedEventKey == event.eventKey ? WCColors.primaryAccent : .clear, lineWidth: 2)
        )
        .id(event.eventKey)
        .accessibilityIdentifier("benefits.calendar.event.\(event.eventKey)")
    }

    private func performReminderAction(_ event: OpportunityCalendarEventView, action: String, untilAt: String?) {
        Task {
            do {
                try await appState.updateOpportunityReminderState(
                    eventKey: event.eventKey,
                    action: action,
                    untilAt: untilAt,
                    deadlineUtc: event.deadlineBefore.map { "\($0)T23:59:59Z" },
                    expectedRevision: event.stateRevision > 0 ? event.stateRevision : nil
                )
                HapticManager.selection()
                await reloadData()
            } catch {
                actionError = error.localizedDescription
            }
        }
    }

    private func filterChip(_ title: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button {
            HapticManager.selection()
            action()
        } label: {
            Text(title)
                .font(.caption.bold())
                .padding(.horizontal, 12)
                .frame(minHeight: 36)
                .background(selected ? WCColors.primaryAccent : Color(uiColor: .secondarySystemGroupedBackground), in: Capsule())
                .foregroundStyle(selected ? .white : .primary)
        }
        .buttonStyle(.plain)
    }
}
