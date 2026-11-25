import SwiftUI
import QuickLook
import WorldCreditCore

struct DraftsInboxView: View {
    @Environment(AppState.self) private var appState
    @State private var showingSmartImport = false
    @State private var showingBatchDiscardConfirm = false
    @State private var actionError: String?
    @State private var isBatchDiscarding = false

    private var sortedDrafts: [BillImportDraftDTO] {
        appState.billDrafts.sorted { a, b in
            urgencyWeight(a) < urgencyWeight(b)
        }
    }

    private var cleanableDraftIds: [String] {
        sortedDrafts
            .filter { $0.parseStatus == "parse_failed" || $0.parsedPayload.isBill == false }
            .map(\.id)
    }

    private func urgencyWeight(_ draft: BillImportDraftDTO) -> Int {
        switch draft.parseStatus {
        case "needs_password": return 0
        case "parse_failed": return 1
        default:
            let hasMissing = draft.cardId == nil || draft.parsedPayload.billAmount == nil || draft.parsedPayload.billMonth == nil
            return hasMissing ? 2 : 3
        }
    }

    var body: some View {
        List {
            if let err = actionError ?? appState.billDraftsError {
                Section {
                    Label(err, systemImage: "exclamationmark.triangle.fill")
                        .font(.footnote)
                        .foregroundStyle(WCColors.dangerInk)
                }
            }

            if UITestConfiguration.isEnabled {
                Section {
                    Text("草稿解析、密码本解锁与确认入账需连接服务端后执行。")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            if appState.isLoadingBillDrafts && appState.billDrafts.isEmpty {
                Section {
                    HStack {
                        Spacer()
                        ProgressView("正在加载草稿箱…")
                        Spacer()
                    }
                    .padding(.vertical, 24)
                }
            } else if sortedDrafts.isEmpty {
                Section {
                    ContentUnavailableView {
                        Label("暂无待确认草稿", systemImage: "tray")
                    } description: {
                        Text("通过邮件同步、智能导入或系统分享提交的账单会停泊在这里供核对入账。")
                    } actions: {
                        Button("智能导入账单") {
                            showingSmartImport = true
                        }
                        .buttonStyle(.borderedProminent)
                    }
                    .padding(.vertical, 20)
                }
            } else {
                Section {
                    ForEach(sortedDrafts) { draft in
                        NavigationLink {
                            DraftConfirmView(draftId: draft.id, initialDraft: draft)
                        } label: {
                            draftRow(draft)
                        }
                        .accessibilityIdentifier("draft.row.\(draft.id)")
                    }
                } header: {
                    Text("共 \(sortedDrafts.count) 份待处理草稿")
                } footer: {
                    Text("解析与确认入账需联网写入服务端；确认后自动同步刷新本地账单。")
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("账单草稿箱")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                if !cleanableDraftIds.isEmpty {
                    Button {
                        showingBatchDiscardConfirm = true
                    } label: {
                        Image(systemName: "trash")
                    }
                    .disabled(isBatchDiscarding)
                    .accessibilityLabel("批量清理草稿")
                }

                Button {
                    showingSmartImport = true
                } label: {
                    Image(systemName: "plus.circle.fill")
                }
                .accessibilityLabel("智能导入账单")
                .accessibilityIdentifier("drafts.smartImport")
            }
        }
        .refreshable {
            await appState.refreshBillDrafts(silent: false)
        }
        .task {
            await appState.refreshBillDrafts(silent: false)
        }
        .sheet(isPresented: $showingSmartImport) {
            BillSmartImportSheet()
        }
        .confirmationDialog("批量清理非账单/失败草稿？", isPresented: $showingBatchDiscardConfirm, titleVisibility: .visible) {
            Button("确认清理", role: .destructive) {
                Task { await performBatchDiscard() }
            }
            Button("取消", role: .cancel) {}
        } message: {
            Text("将清理 \(cleanableDraftIds.count) 份「解析失败 / 非账单」草稿，不会影响待输入密码或待确认账单。")
        }
    }

    private func draftRow(_ draft: BillImportDraftDTO) -> some View {
        let p = draft.parsedPayload
        let currency = p.currency ?? appState.cards.first(where: { $0.id == draft.cardId })?.product?.currency ?? "CNY"
        return VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Text(draft.sourceLabel ?? sourceDisplayName(draft.sourceType))
                    .font(.caption2.bold())
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(WCColors.subtle, in: Capsule())
                    .foregroundStyle(WCColors.textSecondary)

                statusBadge(for: draft)

                Spacer()

                if let conf = draft.confidence {
                    Text("\(Int((conf * 100).rounded()))%")
                        .font(.caption2)
                        .foregroundStyle(WCColors.textSecondary)
                }
            }

            HStack {
                Text(rowTitle(draft))
                    .font(.subheadline.bold())
                    .foregroundStyle(WCColors.textPrimary)
                    .lineLimit(1)
                Spacer()
                if let amount = p.billAmount {
                    Text(DashboardMoney.format(amount, currency: currency))
                        .font(.subheadline.bold())
                        .foregroundStyle(WCColors.textPrimary)
                } else {
                    Text("金额待补")
                        .font(.caption.bold())
                        .foregroundStyle(WCColors.warningInk)
                }
            }

            HStack(spacing: 8) {
                Text(p.billMonth ?? "月份待补")
                Text("·")
                Text("到期 \(p.dueDate ?? "待补")")
                if draft.cardId == nil {
                    Text("· 待选卡")
                        .foregroundStyle(WCColors.warningInk)
                }
            }
            .font(.caption)
            .foregroundStyle(WCColors.textSecondary)

            if let warn = p.warnings?.first, !warn.isEmpty {
                Text(warn)
                    .font(.caption2)
                    .foregroundStyle(WCColors.warningInk)
                    .lineLimit(2)
            }
        }
        .padding(.vertical, 4)
    }

    @ViewBuilder
    private func statusBadge(for draft: BillImportDraftDTO) -> some View {
        switch draft.parseStatus {
        case "needs_password":
            Text("待输密码")
                .font(.caption2.bold())
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(WCColors.warningSoft, in: Capsule())
                .foregroundStyle(WCColors.warningInk)
        case "parse_failed":
            Text("解析失败")
                .font(.caption2.bold())
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(WCColors.dangerSoft, in: Capsule())
                .foregroundStyle(WCColors.dangerInk)
        default:
            if draft.cardId == nil || draft.parsedPayload.billAmount == nil || draft.parsedPayload.dueDate == nil {
                Text("待补全")
                    .font(.caption2.bold())
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(WCColors.warningSoft, in: Capsule())
                    .foregroundStyle(WCColors.warningInk)
            } else {
                Text("可确认")
                    .font(.caption2.bold())
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(WCColors.successSoft, in: Capsule())
                    .foregroundStyle(WCColors.successInk)
            }
        }
    }

    private func rowTitle(_ draft: BillImportDraftDTO) -> String {
        let bank = draft.parsedPayload.bankName ?? "待识别银行"
        if let tail = draft.parsedPayload.cardLast4, !tail.isEmpty {
            return "\(bank) (\(tail))"
        }
        return bank
    }

    private func sourceDisplayName(_ sourceType: String) -> String {
        switch sourceType {
        case "pdf": return "PDF 上传"
        case "image": return "截图导入"
        case "text": return "文本导入"
        case "share_ios": return "iOS 分享"
        case "legacy_ledger": return "历史账本迁入"
        default: return "邮件同步"
        }
    }

    private func performBatchDiscard() async {
        let targetIds = cleanableDraftIds
        guard !targetIds.isEmpty else { return }
        isBatchDiscarding = true
        actionError = nil
        do {
            _ = try await appState.batchDiscardBillDrafts(draftIds: targetIds)
        } catch {
            actionError = "批量清理失败：\(error.localizedDescription)"
        }
        isBatchDiscarding = false
    }
}
