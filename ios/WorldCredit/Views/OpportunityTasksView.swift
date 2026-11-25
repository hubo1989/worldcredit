import SwiftUI
import WorldCreditCore

struct OpportunityTasksView: View {
    @Environment(AppState.self) private var appState
    @Binding var deepLinkedTaskCycleId: String?

    @State private var selectedHolderId: String?
    @State private var tasks: [OpportunityTaskView] = []
    @State private var highlightedTaskCycleId: String?
    @State private var editingProgressTask: OpportunityTaskView?
    @State private var rewardTask: OpportunityTaskView?
    @State private var claimTarget: OpportunityLedgerItem?
    @State private var actionError: String?

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(spacing: 14) {
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

                    claimableSection
                    tasksSection
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
                consumeDeepLinkedTask(with: proxy)
            }
            .onChange(of: selectedHolderId) { _, _ in Task { await reloadData() } }
            .onChange(of: appState.opportunityTasks) { _, _ in Task { await reloadData() } }
            .onChange(of: deepLinkedTaskCycleId) { _, _ in
                consumeDeepLinkedTask(with: proxy)
            }
        }
        .sheet(item: $editingProgressTask) { taskView in
            ManualProgressEditorSheet(taskView: taskView) {
                await reloadData()
            }
        }
        .sheet(item: $rewardTask) { taskView in
            RewardReceivedSheet(taskView: taskView) {
                await reloadData()
            }
        }
        .sheet(item: $claimTarget) { item in
            OpportunityClaimSheet(item: item) {
                await reloadData()
            }
        }
    }

    private func consumeDeepLinkedTask(with proxy: ScrollViewProxy) {
        guard let targetCycleId = deepLinkedTaskCycleId, !targetCycleId.isEmpty else { return }
        deepLinkedTaskCycleId = nil
        highlightedTaskCycleId = targetCycleId
        DispatchQueue.main.async {
            withAnimation {
                proxy.scrollTo(targetCycleId, anchor: .center)
            }
        }
    }

    private func reloadData() async {
        do {
            tasks = try await appState.opportunityQueryService.fetchTasks(holderId: selectedHolderId)
        } catch {
            actionError = error.localizedDescription
        }
    }

    // MARK: - Claimable Opportunities Section

    private var claimableItems: [OpportunityLedgerItem] {
        appState.opportunityLedger.filter { item in
            item.availability.status == .claimable &&
                (selectedHolderId == nil || item.account.holderId == selectedHolderId)
        }
    }

    private var claimableSection: some View {
        Group {
            if !claimableItems.isEmpty {
                VStack(alignment: .leading, spacing: 10) {
                    Text("待领取权益 (\(claimableItems.count))")
                        .font(.headline)

                    ForEach(claimableItems) { item in
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(item.rules.title).font(.subheadline.bold())
                                Text("\(item.holderName) · \(item.availability.reason)")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            Button("记录已领取") {
                                HapticManager.impactLight()
                                claimTarget = item
                            }
                            .buttonStyle(.borderedProminent)
                            .controlSize(.small)
                        }
                        .padding(14)
                        .background(Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 14))
                    }
                }
            }
        }
    }

    // MARK: - Tasks Section

    private var tasksSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("消费/年费达标任务 (\(tasks.count))")
                .font(.headline)

            if tasks.isEmpty {
                ContentUnavailableView(
                    "暂无达标任务",
                    systemImage: "checklist",
                    description: Text("免年费、开卡礼或月度刷卡任务将在同步后显示在这里。")
                )
                .padding(.vertical, 32)
            } else {
                ForEach(tasks) { view in
                    taskCard(view)
                }
            }
        }
    }

    private func taskCard(_ view: OpportunityTaskView) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Text(taskTypeLabel(view.task.taskType))
                            .font(.caption2.bold())
                            .foregroundStyle(WCColors.primaryAccent)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 2)
                            .background(WCColors.primaryAccent.opacity(0.14), in: Capsule())

                        Text(view.evaluation.satisfied ? "已达标" : "进行中")
                            .font(.caption2.bold())
                            .foregroundStyle(view.evaluation.satisfied ? .green : .orange)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 2)
                            .background((view.evaluation.satisfied ? Color.green : Color.orange).opacity(0.14), in: Capsule())

                        if view.rewardRecorded {
                            Text("奖励已到账")
                                .font(.caption2.bold())
                                .foregroundStyle(.green)
                        }
                    }

                    Text(view.task.title)
                        .font(.headline)

                    Text("\(view.holderName) · 统计截止 \(String(view.cycle.deadlineAt.prefix(10)))")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
            }

            ForEach(Array(view.evaluation.groups.enumerated()), id: \.element.id) { index, group in
                VStack(alignment: .leading, spacing: 4) {
                    if view.evaluation.groups.count > 1 {
                        Text("条件组 \(index + 1)\(index == 0 ? "" : "（或）")")
                            .font(.caption2.bold())
                            .foregroundStyle(.secondary)
                    }
                    ForEach(group.metrics) { metric in
                        HStack {
                            Image(systemName: metric.satisfied ? "checkmark.circle.fill" : "circle")
                                .foregroundStyle(metric.satisfied ? .green : .secondary)
                                .font(.caption)
                            Text(metricLabel(metric, currency: view.rules.currency))
                                .font(.caption)
                            Spacer()
                            if let gap = metric.gap, gap > 0 {
                                Text(gapLabel(metric: metric, gap: gap, currency: view.rules.currency))
                                    .font(.caption2.bold())
                                    .foregroundStyle(.orange)
                            }
                        }
                    }
                }
                .padding(10)
                .background(WCColors.canvas, in: RoundedRectangle(cornerRadius: 10))
            }

            HStack(spacing: 10) {
                Button("更新进度") {
                    editingProgressTask = view
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.small)
                .accessibilityIdentifier("benefits.tasks.update.\(view.task.id)")

                if view.evaluation.satisfied && !view.rewardRecorded {
                    Button("登记奖励到账") {
                        rewardTask = view
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                }
            }
        }
        .padding(14)
        .background(Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16))
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(highlightedTaskCycleId == view.cycle.id ? WCColors.primaryAccent : .clear, lineWidth: 2)
        )
        .id(view.cycle.id)
        .accessibilityIdentifier("benefits.tasks.cycle.\(view.cycle.id)")
    }

    private func metricLabel(_ m: OpportunityDomainEngine.EvaluatedTaskMetric, currency: String) -> String {
        switch m.kind {
        case "amount":
            let cur = DashboardMoney.format(m.currentValue / 100.0, currency: currency)
            let tgt = DashboardMoney.format(Double(m.targetMinor ?? 0) / 100.0, currency: currency)
            return "消费金额：\(cur) / \(tgt)"
        case "count":
            return "消费笔数：\(Int(m.currentValue)) / \(m.targetCount ?? 0) 笔"
        default:
            return m.label ?? "确认项"
        }
    }

    private func gapLabel(metric: OpportunityDomainEngine.EvaluatedTaskMetric, gap: Double, currency: String) -> String {
        switch metric.kind {
        case "amount":
            return "还差 \(DashboardMoney.format(gap / 100.0, currency: currency))"
        case "count":
            return "还差 \(Int(gap)) 笔"
        default:
            return "未完成"
        }
    }

    private func taskTypeLabel(_ raw: String) -> String {
        switch raw {
        case "annual_fee": return "年费达标"
        case "welcome": return "开卡礼"
        case "monthly_spend": return "月度消费"
        default: return "自定义任务"
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

// MARK: - Manual Progress Editor Sheet

struct ManualProgressEditorSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppState.self) private var appState
    let taskView: OpportunityTaskView
    let onSaved: () async -> Void

    @State private var asOfDate: Date = Date()
    @State private var numericText: [String: String] = [:]
    @State private var boolValues: [String: Bool] = [:]
    @State private var reason: String = "更新最新统计进度"
    @State private var isSubmitting = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                if let err = errorMessage {
                    Section { Text(err).font(.caption).foregroundStyle(.red) }
                }

                Section("统计截至日期") {
                    DatePicker("统计至", selection: $asOfDate, displayedComponents: .date)
                }

                Section("达标指标") {
                    ForEach(taskView.rules.groups.flatMap(\.metrics)) { metric in
                        if metric.kind == "check" {
                            Toggle(metric.label ?? "确认", isOn: Binding(
                                get: { boolValues[metric.id] ?? false },
                                set: { boolValues[metric.id] = $0 }
                            ))
                        } else if metric.kind == "amount" {
                            HStack {
                                Text("金额 (\(DashboardMoney.currencySymbol(taskView.rules.currency)))")
                                Spacer()
                                TextField("0.00", text: Binding(
                                    get: { numericText[metric.id] ?? "0" },
                                    set: { numericText[metric.id] = $0 }
                                ))
                                .keyboardType(.decimalPad)
                                .multilineTextAlignment(.trailing)
                            }
                        } else {
                            HStack {
                                Text("累计笔数")
                                Spacer()
                                TextField("0", text: Binding(
                                    get: { numericText[metric.id] ?? "0" },
                                    set: { numericText[metric.id] = $0 }
                                ))
                                .keyboardType(.numberPad)
                                .multilineTextAlignment(.trailing)
                            }
                        }
                    }
                }

                Section("修改说明（必填）") {
                    TextField("说明本次调整原因", text: $reason)
                }
            }
            .navigationTitle("更新任务进度")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isSubmitting ? "保存中…" : "保存") {
                        Task { await submit() }
                    }
                    .disabled(isSubmitting || reason.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .onAppear {
                for metric in taskView.rules.groups.flatMap(\.metrics) {
                    if metric.kind == "check" {
                        boolValues[metric.id] = taskView.progress.metricValues[metric.id]?.boolValue ?? false
                    } else if metric.kind == "amount" {
                        let minor = taskView.progress.metricValues[metric.id]?.numericValue ?? 0
                        numericText[metric.id] = String(format: "%.2f", minor / 100.0)
                    } else {
                        let count = Int(taskView.progress.metricValues[metric.id]?.numericValue ?? 0)
                        numericText[metric.id] = "\(count)"
                    }
                }
            }
        }
    }

    private func submit() async {
        var nextValues: [String: ProgressMetricValue] = [:]
        for metric in taskView.rules.groups.flatMap(\.metrics) {
            if metric.kind == "check" {
                nextValues[metric.id] = .bool(boolValues[metric.id] ?? false)
            } else if metric.kind == "amount" {
                let raw = Double(numericText[metric.id] ?? "0") ?? 0
                nextValues[metric.id] = .number(max(0, (raw * 100.0).rounded()))
            } else {
                let raw = Double(Int(numericText[metric.id] ?? "0") ?? 0)
                nextValues[metric.id] = .number(max(0, raw))
            }
        }

        let nextProgress = ManualProgress(
            asOfOn: OpportunityDates.localDateInZone(asOfDate, timeZone: "Asia/Shanghai"),
            metricValues: nextValues,
            note: nil
        )
        isSubmitting = true
        defer { isSubmitting = false }
        do {
            try await appState.updateManualTaskProgress(
                taskCycleId: taskView.cycle.id,
                progress: nextProgress,
                reason: reason,
                expectedRevision: taskView.cycle.revision
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

// MARK: - Reward Received Sheet

struct RewardReceivedSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppState.self) private var appState
    let taskView: OpportunityTaskView
    let onSaved: () async -> Void

    @State private var receivedDate: Date = Date()
    @State private var note: String = ""
    @State private var isSubmitting = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                if let err = errorMessage {
                    Section { Text(err).font(.caption).foregroundStyle(.red) }
                }
                Section("奖励到账信息") {
                    LabeledContent("奖励名称", value: taskView.rewardPlan?.title ?? taskView.task.title)
                    DatePicker("到账日期", selection: $receivedDate, displayedComponents: .date)
                    TextField("备注（选填）", text: $note)
                }
            }
            .navigationTitle("登记奖励到账")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isSubmitting ? "提交中…" : "确认登记") {
                        Task {
                            isSubmitting = true
                            defer { isSubmitting = false }
                            do {
                                try await appState.recordTaskRewardReceived(
                                    taskCycleId: taskView.cycle.id,
                                    rewardKey: taskView.rewardPlan?.rewardKey ?? "default",
                                    receivedOn: OpportunityDates.localDateInZone(receivedDate, timeZone: "Asia/Shanghai"),
                                    holderId: taskView.task.holderId,
                                    accountId: taskView.rewardPlan?.accountId,
                                    usableStartOn: nil,
                                    usableEndBefore: nil,
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
                    .disabled(isSubmitting)
                }
            }
        }
    }
}
