import SwiftUI
import UIKit
import UniformTypeIdentifiers

@objc(ShareViewController)
final class ShareViewController: UIViewController {
    private let client = ShareUploadClient()
    private var tempDirectoryURL: URL?
    private var hostingController: UIHostingController<ShareExtensionView>?

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        Task { await prepareAndMount() }
    }

    deinit {
        cleanupTempFiles()
    }

    private func cleanupTempFiles() {
        if let dir = tempDirectoryURL {
            try? FileManager.default.removeItem(at: dir)
            tempDirectoryURL = nil
        }
    }

    @MainActor
    private func prepareAndMount() async {
        let cards = ShareCardCacheReader.loadCards()
        let hasSession = client.hasSession()

        guard hasSession else {
            mountView(
                cards: cards,
                hasSession: false,
                inputKind: nil,
                files: [],
                rawText: nil,
                loadError: nil
            )
            return
        }

        do {
            let dir = try ShareMediaProcessor.tempDirectoryURL()
            tempDirectoryURL = dir
            let extracted = try await extractItems(into: dir)
            mountView(
                cards: cards,
                hasSession: true,
                inputKind: extracted.kind,
                files: extracted.files,
                rawText: extracted.rawText,
                loadError: extracted.kind == nil ? "未识别到 PDF 文件、账单截图或文本内容。" : nil
            )
        } catch {
            mountView(
                cards: cards,
                hasSession: true,
                inputKind: nil,
                files: [],
                rawText: nil,
                loadError: error.localizedDescription
            )
        }
    }

    @MainActor
    private func mountView(
        cards: [ShareCardLiteDTO],
        hasSession: Bool,
        inputKind: ShareInputKind?,
        files: [PreparedShareItem],
        rawText: String?,
        loadError: String?
    ) {
        let rootView = ShareExtensionView(
            cards: cards,
            hasSession: hasSession,
            inputKind: inputKind,
            files: files,
            rawText: rawText,
            loadError: loadError,
            onSubmit: { [weak self] cardId, pdfPassword in
                guard let self, let inputKind else {
                    throw ShareExtensionError.invalidInput("缺少可提交的账单内容")
                }
                return try await self.client.submit(
                    kind: inputKind,
                    files: files,
                    rawText: rawText,
                    cardId: cardId,
                    pdfPassword: pdfPassword
                )
            },
            onOpenMainApp: { [weak self] draftId, completion in
                guard let self else {
                    completion(false)
                    return
                }
                self.openMainApp(draftId: draftId, completion: completion)
            },
            onClose: { [weak self] in
                self?.finishAndDismiss()
            }
        )

        if let existing = hostingController {
            existing.rootView = rootView
            return
        }
        let host = UIHostingController(rootView: rootView)
        addChild(host)
        host.view.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(host.view)
        NSLayoutConstraint.activate([
            host.view.topAnchor.constraint(equalTo: view.topAnchor),
            host.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            host.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            host.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
        host.didMove(toParent: self)
        hostingController = host
    }

    @MainActor
    private func openMainApp(draftId: String?, completion: @escaping @MainActor @Sendable (Bool) -> Void) {
        var allowed = CharacterSet.urlPathAllowed
        allowed.remove(charactersIn: "/?#%")
        let encodedId = draftId?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .addingPercentEncoding(withAllowedCharacters: allowed)
        let target: String
        if let encodedId, !encodedId.isEmpty {
            target = "worldcredit://drafts/\(encodedId)"
        } else {
            target = "worldcredit://"
        }
        guard let url = URL(string: target) else {
            completion(false)
            return
        }

        // Share Extension 中 NSExtensionContext.open 仅限 Today Widget，需沿 Responder Chain 调用宿主 UIApplication。
        let openSelector = NSSelectorFromString("openURL:options:completionHandler:")
        let legacySelector = NSSelectorFromString("openURL:")
        var responder: UIResponder? = self
        while let current = responder {
            if current.responds(to: openSelector), let imp = current.method(for: openSelector) {
                typealias OpenFn = @convention(c) (AnyObject, Selector, NSURL, NSDictionary, Any?) -> Void
                let fn = unsafeBitCast(imp, to: OpenFn.self)
                fn(current, openSelector, url as NSURL, [:], nil)
                completion(true)
                self.finishAndDismiss()
                return
            }
            if current.responds(to: legacySelector) {
                _ = current.perform(legacySelector, with: url)
                completion(true)
                self.finishAndDismiss()
                return
            }
            responder = current.next
        }

        if let context = extensionContext {
            context.open(url) { [weak self] opened in
                Task { @MainActor in
                    completion(opened)
                    if opened {
                        self?.finishAndDismiss()
                    }
                }
            }
        } else {
            completion(false)
        }
    }

    private func finishAndDismiss() {
        cleanupTempFiles()
        extensionContext?.completeRequest(returningItems: nil)
    }

    // MARK: - NSExtensionContext Extraction

    private struct ExtractedPayload {
        let kind: ShareInputKind?
        let files: [PreparedShareItem]
        let rawText: String?
    }

    private func extractItems(into dir: URL) async throws -> ExtractedPayload {
        guard let items = extensionContext?.inputItems as? [NSExtensionItem] else {
            return ExtractedPayload(kind: nil, files: [], rawText: nil)
        }
        let providers = items.compactMap(\.attachments).flatMap { $0 }

        // 1. 优先 PDF（单文件）
        if let pdfProvider = providers.first(where: { $0.hasItemConformingToTypeIdentifier(UTType.pdf.identifier) }) {
            let fileURL = try await loadFileCopy(from: pdfProvider, typeIdentifier: UTType.pdf.identifier, fallbackExt: "pdf", into: dir)
            let name = (pdfProvider.suggestedName?.isEmpty == false ? pdfProvider.suggestedName! : "statement")
                + (pdfProvider.suggestedName?.lowercased().hasSuffix(".pdf") == true ? "" : ".pdf")
            return ExtractedPayload(
                kind: .pdf,
                files: [PreparedShareItem(fileURL: fileURL, fileName: name, mimeType: "application/pdf")],
                rawText: nil
            )
        }

        // 2. 图片（最多 3 张，HEIC/大图就地缩略降采样到 <= 2048px JPEG）
        let imageProviders = providers
            .filter { $0.hasItemConformingToTypeIdentifier(UTType.image.identifier) }
            .prefix(3)
        if !imageProviders.isEmpty {
            var prepared: [PreparedShareItem] = []
            for (idx, provider) in imageProviders.enumerated() {
                let rawURL = try await loadFileCopy(from: provider, typeIdentifier: UTType.image.identifier, fallbackExt: "heic", into: dir)
                let jpegURL = try ShareMediaProcessor.transcodeImageToJPEG(sourceURL: rawURL, maxPixelSize: 2048, in: dir)
                try? FileManager.default.removeItem(at: rawURL)
                let baseName = provider.suggestedName ?? "bill-\(idx + 1)"
                let fileName = "\(baseName).jpg"
                prepared.append(PreparedShareItem(fileURL: jpegURL, fileName: fileName, mimeType: "image/jpeg"))
            }
            return ExtractedPayload(kind: .images, files: prepared, rawText: nil)
        }

        // 3. 文本
        var collectedTexts: [String] = []
        for provider in providers where provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
            if let text = try await loadPlainText(from: provider), !text.isEmpty {
                collectedTexts.append(text)
            }
        }
        if !collectedTexts.isEmpty {
            return ExtractedPayload(kind: .text, files: [], rawText: collectedTexts.joined(separator: "\n"))
        }

        return ExtractedPayload(kind: nil, files: [], rawText: nil)
    }

    private func loadFileCopy(
        from provider: NSItemProvider,
        typeIdentifier: String,
        fallbackExt: String,
        into dir: URL
    ) async throws -> URL {
        try await withCheckedThrowingContinuation { continuation in
            provider.loadFileRepresentation(forTypeIdentifier: typeIdentifier) { url, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }
                guard let url else {
                    continuation.resume(throwing: ShareExtensionError.invalidInput("未能读取系统分享文件"))
                    return
                }
                do {
                    // loadFileRepresentation 返回的临时文件在回调返回后可能被系统清理，必须同步拷入自有临时目录。
                    let copied = try ShareMediaProcessor.copyFileToTemp(url, preferredExtension: url.pathExtension.isEmpty ? fallbackExt : url.pathExtension, in: dir)
                    continuation.resume(returning: copied)
                } catch {
                    continuation.resume(throwing: error)
                }
            }
        }
    }

    private func loadPlainText(from provider: NSItemProvider) async throws -> String? {
        try await withCheckedThrowingContinuation { continuation in
            provider.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { item, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }
                if let text = item as? String {
                    continuation.resume(returning: text)
                } else if let data = item as? Data, let text = String(data: data, encoding: .utf8) {
                    continuation.resume(returning: text)
                } else if let url = item as? URL, let text = try? String(contentsOf: url, encoding: .utf8) {
                    continuation.resume(returning: text)
                } else {
                    continuation.resume(returning: nil)
                }
            }
        }
    }
}
