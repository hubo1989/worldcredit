import SwiftUI
import WorldCreditCore

struct NotificationSettingsView: View {
    @Environment(AppState.self) private var appState
    @State private var saveError: String?

    private let advanceDayChoices = [7, 5, 3, 2, 1, 0]

    private let timezonePresets: [(id: String, name: String)] = [
        ("Asia/Shanghai", "中国标准时间"),
        ("Asia/Hong_Kong", "香港时间"),
        ("Asia/Tokyo", "日本标准时间"),
        ("Asia/Singapore", "新加坡时间"),
        ("America/New_York", "美东时间"),
        ("America/Los_Angeles", "美西时间"),
        ("Europe/London", "伦敦时间"),
        ("Australia/Sydney", "悉尼时间"),
    ]

    private let hourChoices: [String] = (0..<24).map { String(format: "%02d:00", $0) }

    private enum QuietPreset: String, CaseIterable, Identifiable {
        case off = "off"
        case night22 = "22:00-08:00"
        case night23 = "23:00-07:00"
        case night21 = "21:00-09:00"

        var id: String { rawValue }

        var title: String {
            switch self {
            case .off: return "关闭免打扰"
            case .night22: return "22:00 - 08:00"
            case .night23: return "23:00 - 07:00"
            case .night21: return "21:00 - 09:00"
            }
        }

        var bounds: (String?, String?) {
            switch self {
            case .off: return (nil, nil)
            case .night22: return ("22:00", "08:00")
            case .night23: return ("23:00", "07:00")
            case .night21: return ("21:00", "09:00")
            }
        }
    }

    var body: some View {
        List {
            if let err = saveError ?? appState.reminderPreferencesError {
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
                Toggle("当日待还信用卡账单", isOn: itemBinding(\.billDueToday))
                Toggle("当日待还固定支出", isOn: itemBinding(\.payableDueToday))
                Toggle("今日新增最长免息期账单", isOn: itemBinding(\.gracePeriodLongest))
                Toggle("账单还款日前提前提醒", isOn: itemBinding(\.billDueAdvance))
                Toggle("固定支出提前提醒", isOn: itemBinding(\.payableDueAdvance))
                Toggle("逾期账单提醒", isOn: itemBinding(\.billOverdue))
            } header: {
                Text("账单与固定支出通知")
            } footer: {
                Text("支持独立关闭或开启任意通知项；最长免息期会在账单日次日主动提醒。")
            }

            Section {
                Toggle("启用权益提醒", isOn: Binding(
                    get: { appState.reminderPreferences.opportunities.enabled },
                    set: { enabled in
                        var next = appState.reminderPreferences
                        next.opportunities.enabled = enabled
                        persist(next)
                    }
                ))

                let oppDisabled = !appState.reminderPreferences.opportunities.enabled
                Toggle("权益到期提醒", isOn: itemBinding(\.opportunityExpiry))
                    .disabled(oppDisabled)
                Toggle("权益领取截止提醒", isOn: itemBinding(\.opportunityClaim))
                    .disabled(oppDisabled)
                Toggle("优惠活动提醒", isOn: itemBinding(\.opportunityActivity))
                    .disabled(oppDisabled)
                Toggle("达标任务提醒", isOn: itemBinding(\.opportunityTask))
                    .disabled(oppDisabled)
                Toggle("权益周期重置提醒", isOn: itemBinding(\.opportunityReset) { next, val in
                    next.opportunities.resetEnabled = val
                })
                .disabled(oppDisabled)
                Toggle("预约服务提醒", isOn: itemBinding(\.opportunityBooking) { next, val in
                    next.opportunities.bookingEnabled = val
                })
                .disabled(oppDisabled)
            } header: {
                Text("权益与活动通知")
            }

            Section {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(advanceDayChoices, id: \.self) { day in
                            let selected = appState.reminderPreferences.remindDaysBefore.contains(day)
                            Button {
                                toggleAdvanceDay(day)
                            } label: {
                                Text(day == 0 ? "到期当天" : "提前 \(day) 天")
                                    .font(.caption.bold())
                                    .padding(.horizontal, 12)
                                    .padding(.vertical, 6)
                                    .background(
                                        selected ? Color.accentColor : Color(uiColor: .tertiarySystemGroupedBackground),
                                        in: Capsule()
                                    )
                                    .foregroundStyle(selected ? .white : .primary)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.vertical, 4)
                }
            } header: {
                Text("提前提醒天数")
            }

            Section {
                Toggle("站外推送通知（Web Push / iOS APNs）", isOn: Binding(
                    get: { appState.reminderPreferences.webPushChannelEnabled },
                    set: { enabled in
                        var next = appState.reminderPreferences
                        var channels = next.enabledChannels.filter { $0 != "web_push" }
                        if enabled {
                            channels.insert("web_push", at: 0)
                        }
                        next.enabledChannels = channels
                        next.opportunities.webPushEnabled = enabled
                        persist(next)
                    }
                ))

                Picker("免打扰时段", selection: quietPresetBinding) {
                    ForEach(QuietPreset.allCases) { preset in
                        Text(preset.title).tag(preset)
                    }
                }
            } header: {
                Text("推送通道与免打扰")
            } footer: {
                if let start = appState.reminderPreferences.quietHoursStart,
                   let end = appState.reminderPreferences.quietHoursEnd {
                    Text("当前免打扰时段：\(start) - \(end)（关闭站外推送后仅保留站内通知中心，不下发系统推送）。")
                } else {
                    Text("关闭站外推送后仅写站内通知中心，不下发系统推送。")
                }
            }

            Section {
                Picker("提醒时区", selection: timeZoneBinding) {
                    ForEach(timezoneOptions, id: \.id) { opt in
                        Text(opt.label).tag(opt.id)
                    }
                }
                .accessibilityIdentifier("settings.notifications.timezone")

                Button {
                    var next = appState.reminderPreferences
                    next.opportunities.timeZone = TimeZone.current.identifier
                    persist(next)
                } label: {
                    Label("使用当前设备时区（\(TimeZone.current.identifier)）", systemImage: "location.fill")
                        .font(.subheadline)
                }
                .accessibilityIdentifier("settings.notifications.useDeviceTimezone")

                Picker("每日提醒推送时间", selection: localTimeBinding) {
                    ForEach(hourSelectionChoices, id: \.self) { hhmm in
                        Text(hhmm).tag(hhmm)
                    }
                }
                .accessibilityIdentifier("settings.notifications.localTime")

                if isLocalTimeInQuietHours,
                   let qStart = appState.reminderPreferences.quietHoursStart,
                   let qEnd = appState.reminderPreferences.quietHoursEnd {
                    HStack(alignment: .top, spacing: 8) {
                        Image(systemName: "clock.badge.exclamationmark")
                            .foregroundStyle(.orange)
                        Text("该时刻位于免打扰时段（\(qStart)–\(qEnd)）内，推送将顺延至免打扰结束（\(qEnd)）后发出。")
                            .font(.caption)
                            .foregroundStyle(.orange)
                    }
                    .accessibilityIdentifier("settings.notifications.quietHoursWarning")
                }
            } header: {
                Text("提醒时区与推送时间")
            } footer: {
                let hourPrefix = String(appState.reminderPreferences.opportunities.localTime.prefix(2))
                Text("每日账单汇总与逾期提醒将在您所选时区的该整点小时窗口内（如 \(hourPrefix):00–\(hourPrefix):59）推送；本地提醒亦按此时区与时刻安排。")
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("通知与提醒开关")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                if appState.isSavingReminderPreferences {
                    ProgressView()
                }
            }
        }
        .task {
            await appState.loadReminderPreferences()
        }
    }

    private func itemBinding(
        _ keyPath: WritableKeyPath<NotificationItemSwitches, Bool>,
        onUpdate: ((inout UserReminderPreferences, Bool) -> Void)? = nil
    ) -> Binding<Bool> {
        Binding(
            get: { appState.reminderPreferences.items[keyPath: keyPath] },
            set: { newValue in
                var next = appState.reminderPreferences
                next.items[keyPath: keyPath] = newValue
                onUpdate?(&next, newValue)
                persist(next)
            }
        )
    }

    private var timezoneOptions: [(id: String, label: String)] {
        let current = appState.reminderPreferences.opportunities.timeZone
        var list: [(id: String, label: String)] = timezonePresets.map { preset in
            (preset.id, formatTimeZoneLabel(preset.id, name: preset.name))
        }
        if !current.isEmpty && !list.contains(where: { $0.id == current }) {
            list.insert((current, formatTimeZoneLabel(current, name: "当前设置")), at: 0)
        }
        return list
    }

    private func formatTimeZoneLabel(_ identifier: String, name: String) -> String {
        guard let tz = TimeZone(identifier: identifier) else { return "\(identifier) (\(name))" }
        let sec = tz.secondsFromGMT()
        let hours = sec / 3600
        let mins = abs(sec % 3600) / 60
        let offsetStr = mins == 0
            ? String(format: "UTC%+d", hours)
            : String(format: "UTC%+d:%02d", hours, mins)
        return "\(identifier) (\(name) \(offsetStr))"
    }

    private var hourSelectionChoices: [String] {
        let current = appState.reminderPreferences.opportunities.localTime
        var choices = hourChoices
        if !choices.contains(current) && !current.isEmpty {
            choices.insert(current, at: 0)
        }
        return choices
    }

    private var timeZoneBinding: Binding<String> {
        Binding(
            get: { appState.reminderPreferences.opportunities.timeZone },
            set: { tz in
                var next = appState.reminderPreferences
                next.opportunities.timeZone = tz
                persist(next)
            }
        )
    }

    private var localTimeBinding: Binding<String> {
        Binding(
            get: { appState.reminderPreferences.opportunities.localTime },
            set: { hhmm in
                var next = appState.reminderPreferences
                next.opportunities.localTime = hhmm
                persist(next)
            }
        )
    }

    private var isLocalTimeInQuietHours: Bool {
        let local = appState.reminderPreferences.opportunities.localTime
        guard let start = appState.reminderPreferences.quietHoursStart,
              let end = appState.reminderPreferences.quietHoursEnd,
              let lMin = parseMinutes(local),
              let sMin = parseMinutes(start),
              let eMin = parseMinutes(end),
              sMin != eMin else {
            return false
        }
        if sMin > eMin {
            return lMin >= sMin || lMin < eMin
        }
        return lMin >= sMin && lMin < eMin
    }

    private func parseMinutes(_ hhmm: String) -> Int? {
        let parts = hhmm.split(separator: ":")
        guard parts.count == 2, let h = Int(parts[0]), let m = Int(parts[1]) else { return nil }
        return h * 60 + m
    }

    private var quietPresetBinding: Binding<QuietPreset> {
        Binding(
            get: {
                let s = appState.reminderPreferences.quietHoursStart
                let e = appState.reminderPreferences.quietHoursEnd
                if s == nil || e == nil { return .off }
                switch "\(s!)-\(e!)" {
                case "23:00-07:00": return .night23
                case "21:00-09:00": return .night21
                default: return .night22
                }
            },
            set: { preset in
                var next = appState.reminderPreferences
                let (start, end) = preset.bounds
                next.quietHoursStart = start
                next.quietHoursEnd = end
                persist(next)
            }
        )
    }

    private func toggleAdvanceDay(_ day: Int) {
        var days = Set(appState.reminderPreferences.remindDaysBefore)
        if days.contains(day) {
            days.remove(day)
        } else {
            days.insert(day)
        }
        var next = appState.reminderPreferences
        next.remindDaysBefore = Array(days).sorted(by: >)
        persist(next)
    }

    private func persist(_ next: UserReminderPreferences) {
        saveError = nil
        Task {
            do {
                try await appState.updateReminderPreferences(next)
            } catch {
                saveError = "保存失败，已恢复原设置：\(error.localizedDescription)"
            }
        }
    }
}
