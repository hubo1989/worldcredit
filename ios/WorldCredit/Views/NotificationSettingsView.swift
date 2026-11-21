import SwiftUI
import WorldCreditCore

struct NotificationSettingsView: View {
    @Environment(AppState.self) private var appState
    @State private var saveError: String?

    private let advanceDayChoices = [7, 5, 3, 2, 1, 0]

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
                Toggle("推送通道（Web Push / 站外推送）", isOn: Binding(
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
                    Text("当前免打扰时段：\(start) - \(end)（仍会保留站内通知中心记录）。")
                } else {
                    Text("当前未开启免打扰，将在触发时段正常下发推送。")
                }
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
