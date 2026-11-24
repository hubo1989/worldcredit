import SwiftUI

struct ShareExtensionView: View {
    let cards: [ShareCardLiteDTO]
    let hasSession: Bool
    let inputKind: ShareInputKind?
    let files: [PreparedShareItem]
    let rawText: String?
    let loadError: String?
    let onSubmit: (String?, String?) async throws -> ShareImportResponse
    let onOpenMainApp: (String?) -> Void
    let onClose: () -> Void

    @State private var selectedCardId: String = ""
    @State private var pdfPassword: String = ""
    @State private var isSubmitting = false
    @State private var submitError: String?
    @State private var result: ShareImportResponse?

    var body: some View {
        NavigationStack {
            Group {
                if !hasSession {
                    unauthenticatedView
                } else if let loadError {
                    errorStateView(loadError)
                } else if let result {
                    resultView(result)
                } else {
                    formView
                }
            }
            .navigationTitle("导入账单到 WorldCredit")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(result == nil ? "取消" : "完成") {
                        onClose()
                    }
                    .disabled(isSubmitting)
                }
            }
        }
    }

    private var unauthenticatedView: some View {
        ContentUnavailableView {
            Label("尚未登录", systemImage: "person.crop.circle.badge.exclamationmark")
        } description: {
            Text("请先在 WorldCredit 主 App 中完成登录，再通过系统分享导入账单。")
        } actions: {
            Button("打开 WorldCredit") {
                onOpenMainApp(nil)
            }
            .buttonStyle(.borderedProminent)
        }
    }

    private func errorStateView(_ message: String) -> some View {
        ContentUnavailableView {
            Label("无法读取分享内容", systemImage: "exclamationmark.triangle")
        } description: {
            Text(message)
        } actions: {
            Button("关闭") { onClose() }
                .buttonStyle(.bordered)
        }
    }

    private var formView: some View {
        Form {
            Section("分享内容") {
                switch inputKind {
                case .pdf:
                    if let first = files.first {
                        Label(first.fileName, systemImage: "doc.richtext")
                            .font(.subheadline)
                    }
                case .images:
                    Label("已选择 \(files.count) 张账单截图（已压缩适配）", systemImage: "photo.on.rectangle")
                        .font(.subheadline)
                    ForEach(files) { file in
                        Text(file.fileName)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                case .text:
                    Text(rawText ?? "")
                        .font(.footnote)
                        .lineLimit(6)
                        .foregroundStyle(.secondary)
                case nil:
                    Text("未检测到可用的 PDF、截图或账单文本。")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }

            Section("归属配置（可选）") {
                Picker("指定信用卡", selection: $selectedCardId) {
                    Text("自动识别银行与卡号").tag("")
                    ForEach(cards) { card in
                        Text(card.displayLabel).tag(card.id)
                    }
                }

                if inputKind == .pdf {
                    SecureField("PDF 解密密码（如无加密可留空）", text: $pdfPassword)
                        .textContentType(.password)
                }
            }

            if let submitError {
                Section {
                    Text(submitError)
                        .font(.footnote)
                        .foregroundStyle(.red)
                }
            }

            Section {
                Button {
                    Task { await runSubmit() }
                } label: {
                    HStack {
                        Spacer()
                        if isSubmitting {
                            ProgressView()
                                .padding(.trailing, 6)
                            Text("正在上传并解析...")
                        } else {
                            Text("上传并生成待确认草稿")
                                .fontWeight(.semibold)
                        }
                        Spacer()
                    }
                }
                .disabled(isSubmitting || inputKind == nil)
            }
        }
    }

    private func resultView(_ response: ShareImportResponse) -> some View {
        List {
            Section("解析结果") {
                if let msg = response.message, !msg.isEmpty {
                    Text(msg)
                        .font(.subheadline)
                } else {
                    Text("已生成 \(response.drafts.count) 条账单草稿，请打开主 App 确认入账。")
                        .font(.subheadline)
                }

                ForEach(response.drafts) { draft in
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text(draft.displayBankName)
                                .font(.headline)
                            if let last4 = draft.cardLast4, !last4.isEmpty {
                                Text("·\(last4)")
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            Text(draft.statusLabel)
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(draft.status == "ready_for_confirm" ? .green : .orange)
                        }

                        if let amount = draft.parsedPayload?.totalAmount {
                            Text(String(format: "%@ %.2f", draft.displayCurrency, amount))
                                .font(.title3.monospacedDigit().weight(.semibold))
                        }
                        if let err = draft.parseErrorMessage, !err.isEmpty {
                            Text(err)
                                .font(.caption)
                                .foregroundStyle(.orange)
                        }
                    }
                    .padding(.vertical, 4)
                }
            }

            Section {
                Button {
                    onOpenMainApp(response.drafts.first?.id)
                } label: {
                    HStack {
                        Spacer()
                        Text("打开 WorldCredit 确认")
                            .fontWeight(.semibold)
                        Spacer()
                    }
                }

                Button("完成") {
                    onClose()
                }
                .frame(maxWidth: .infinity, alignment: .center)
            }
        }
    }

    @MainActor
    private func runSubmit() async {
        isSubmitting = true
        submitError = nil
        defer { isSubmitting = false }
        do {
            let trimmedPwd = pdfPassword.trimmingCharacters(in: .whitespacesAndNewlines)
            let res = try await onSubmit(
                selectedCardId.isEmpty ? nil : selectedCardId,
                trimmedPwd.isEmpty ? nil : trimmedPwd
            )
            result = res
        } catch {
            submitError = error.localizedDescription
        }
    }
}
