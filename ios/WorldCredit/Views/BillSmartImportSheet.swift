import SwiftUI
import PhotosUI
import UniformTypeIdentifiers
import UIKit
import WorldCreditCore

struct BillSmartImportSheet: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss

    enum ImportMode: String, CaseIterable, Identifiable {
        case text = "粘贴文本"
        case image = "相册截图"
        case pdf = "PDF 月结单"
        var id: String { rawValue }
    }

    @State private var mode: ImportMode = .text
    @State private var selectedCardId = ""
    @State private var rawText = ""

    @State private var selectedPhotoItems: [PhotosPickerItem] = []
    @State private var pickedImages: [(name: String, data: Data, mime: String)] = []

    @State private var showingFileImporter = false
    @State private var pickedPdf: (name: String, data: Data)?
    @State private var pdfPassword = ""
    @State private var savePasswordToVault = true

    @State private var isSubmitting = false
    @State private var errorMessage: String?
    @State private var nonBillWarning: String?
    @State private var createdDraft: BillImportDraftDTO?

    private static let maxSingleFileBytes = 10 * 1024 * 1024
    private static let maxTotalImageBytes = 20 * 1024 * 1024

    var body: some View {
        NavigationStack {
            if let createdDraft {
                DraftConfirmView(draftId: createdDraft.id, initialDraft: createdDraft) {
                    dismiss()
                }
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("完成") { dismiss() }
                    }
                }
            } else {
                Form {
                    if let errorMessage {
                        Section {
                            Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                                .font(.footnote)
                                .foregroundStyle(WCColors.dangerInk)
                        }
                    }

                    if let nonBillWarning {
                        Section {
                            VStack(alignment: .leading, spacing: 8) {
                                Text(nonBillWarning)
                                    .font(.footnote)
                                    .foregroundStyle(WCColors.warningInk)
                                Button("仍转为草稿手动填写") {
                                    Task { await submit(forceSaveNonBill: true) }
                                }
                                .font(.footnote.bold())
                            }
                        }
                    }

                    Section("预选信用卡（选填）") {
                        Picker("关联卡片", selection: $selectedCardId) {
                            Text("自动识别匹配（推荐）").tag("")
                            ForEach(appState.cards) { card in
                                let tail = card.last4.isEmpty ? "" : " (\(card.last4))"
                                Text("\(card.bankName) · \(card.displayName)\(tail)").tag(card.id)
                            }
                        }
                    }

                    Section("导入方式") {
                        Picker("导入方式", selection: $mode) {
                            ForEach(ImportMode.allCases) { item in
                                Text(item.rawValue).tag(item)
                            }
                        }
                        .pickerStyle(.segmented)
                    }

                    switch mode {
                    case .text:
                        Section("账单短信 / 邮件文本") {
                            TextEditor(text: $rawText)
                                .frame(minHeight: 150)
                                .accessibilityIdentifier("import.textEditor")
                        }
                    case .image:
                        Section {
                            PhotosPicker(
                                selection: $selectedPhotoItems,
                                maxSelectionCount: 3,
                                matching: .images
                            ) {
                                Label("从相册选择账单截图（最多 3 张）", systemImage: "photo.on.rectangle")
                            }
                            .onChange(of: selectedPhotoItems) { _, items in
                                Task { await loadPickedPhotos(items) }
                            }

                            ForEach(Array(pickedImages.enumerated()), id: \.offset) { idx, img in
                                HStack {
                                    Text(img.name)
                                        .font(.subheadline)
                                        .lineLimit(1)
                                    Spacer()
                                    Text("\(max(1, img.data.count / 1024)) KB")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                    Button(role: .destructive) {
                                        pickedImages.remove(at: idx)
                                    } label: {
                                        Image(systemName: "trash")
                                    }
                                }
                            }
                        } footer: {
                            Text("单张 ≤ 10MB，合计 ≤ 20MB，支持 PNG / JPEG / HEIC。")
                        }
                    case .pdf:
                        Section {
                            Button {
                                showingFileImporter = true
                            } label: {
                                Label(
                                    pickedPdf?.name ?? "从「文件」选择 PDF 月结单",
                                    systemImage: "doc.fill"
                                )
                            }

                            if let pdf = pickedPdf {
                                LabeledContent("文件大小", value: "\(max(1, pdf.data.count / 1024)) KB")
                            }

                            SecureField("如已知加密密码可提前填写（选填）", text: $pdfPassword)
                            if !pdfPassword.isEmpty {
                                Toggle("同时保存到月结单密码本", isOn: $savePasswordToVault)
                            }
                        } footer: {
                            Text("单个 PDF ≤ 10MB；加密 PDF 会先自动尝试家庭密码本。")
                        }
                    }
                }
                .navigationTitle("智能导入账单")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("取消") { dismiss() }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button {
                            Task { await submit(forceSaveNonBill: false) }
                        } label: {
                            if isSubmitting {
                                ProgressView()
                            } else {
                                Text("解析").bold()
                            }
                        }
                        .disabled(isSubmitting || !canSubmit)
                    }
                }
                .fileImporter(
                    isPresented: $showingFileImporter,
                    allowedContentTypes: [.pdf],
                    allowsMultipleSelection: false
                ) { result in
                    handlePdfImportResult(result)
                }
            }
        }
    }

    private var canSubmit: Bool {
        switch mode {
        case .text: return !rawText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        case .image: return !pickedImages.isEmpty
        case .pdf: return pickedPdf != nil
        }
    }

    private func loadPickedPhotos(_ items: [PhotosPickerItem]) async {
        errorMessage = nil
        var loaded: [(name: String, data: Data, mime: String)] = []
        var total = 0
        for (idx, item) in items.prefix(3).enumerated() {
            guard let raw = try? await item.loadTransferable(type: Data.self) else { continue }
            let normalized = normalizeImageData(raw)
            if normalized.data.count > Self.maxSingleFileBytes {
                errorMessage = "单张截图不能超过 10MB"
                return
            }
            total += normalized.data.count
            if total > Self.maxTotalImageBytes {
                errorMessage = "多张截图合计不能超过 20MB"
                return
            }
            loaded.append(("screenshot-\(idx + 1).\(normalized.ext)", normalized.data, normalized.mime))
        }
        pickedImages = loaded
    }

    private func normalizeImageData(_ data: Data) -> (data: Data, mime: String, ext: String) {
        if let image = UIImage(data: data), let jpeg = image.jpegData(compressionQuality: 0.85) {
            return (jpeg, "image/jpeg", "jpg")
        }
        return (data, "image/png", "png")
    }

    private func handlePdfImportResult(_ result: Result<[URL], Error>) {
        errorMessage = nil
        switch result {
        case .failure(let err):
            errorMessage = "选择文件失败：\(err.localizedDescription)"
        case .success(let urls):
            guard let url = urls.first else { return }
            let accessed = url.startAccessingSecurityScopedResource()
            defer { if accessed { url.stopAccessingSecurityScopedResource() } }
            do {
                let data = try Data(contentsOf: url)
                guard data.count <= Self.maxSingleFileBytes else {
                    errorMessage = "单个 PDF 文件不能超过 10MB"
                    return
                }
                pickedPdf = (url.lastPathComponent, data)
            } catch {
                errorMessage = "读取 PDF 失败：\(error.localizedDescription)"
            }
        }
    }

    private func submit(forceSaveNonBill: Bool) async {
        isSubmitting = true
        errorMessage = nil
        nonBillWarning = nil
        defer { isSubmitting = false }

        do {
            let preDraftId = UUID().uuidString
            let clientReqId = UUID().uuidString
            var attachmentIds: [String]?

            switch mode {
            case .text:
                break
            case .image:
                var ids: [String] = []
                for img in pickedImages {
                    let uploaded = try await appState.uploadDraftAttachment(
                        recordId: preDraftId,
                        fileData: img.data,
                        fileName: img.name,
                        mimeType: img.mime
                    )
                    ids.append(uploaded.id)
                }
                attachmentIds = ids
            case .pdf:
                if let pdf = pickedPdf {
                    let uploaded = try await appState.uploadDraftAttachment(
                        recordId: preDraftId,
                        fileData: pdf.data,
                        fileName: pdf.name,
                        mimeType: "application/pdf"
                    )
                    attachmentIds = [uploaded.id]
                }
            }

            let sourceType: String = {
                switch mode {
                case .text: return "text"
                case .image: return "image"
                case .pdf: return "pdf"
                }
            }()

            let req = ImportAndParseBillRequest(
                sourceType: sourceType,
                rawText: mode == .text ? rawText.trimmingCharacters(in: .whitespacesAndNewlines) : nil,
                attachmentIds: attachmentIds,
                cardId: selectedCardId.isEmpty ? nil : selectedCardId,
                pdfPassword: mode == .pdf && !pdfPassword.isEmpty ? pdfPassword : nil,
                savePasswordToVault: mode == .pdf && !pdfPassword.isEmpty ? savePasswordToVault : nil,
                forceSaveNonBill: forceSaveNonBill ? true : nil,
                clientRequestId: clientReqId
            )

            let res = try await appState.importAndParseBill(req)
            if res.outcome == "non_bill_warning" {
                nonBillWarning = res.message ?? "识别结果疑似非账单内容，请核对或转为手动填写。"
                return
            }
            if let first = res.drafts.first {
                createdDraft = first
            } else {
                errorMessage = res.message ?? "未生成草稿"
            }
        } catch {
            errorMessage = "导入失败：\(error.localizedDescription)"
        }
    }
}
