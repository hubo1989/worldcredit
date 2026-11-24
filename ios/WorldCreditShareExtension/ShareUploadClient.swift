import Foundation
import ImageIO
import Security
import UniformTypeIdentifiers

// MARK: - Share Extension 轻量模型与上传客户端（零 GRDB / 零 GoogleSignIn）

struct ShareCardLiteDTO: Codable, Identifiable, Equatable {
    let id: String
    let bankName: String
    let cardName: String
    let last4: String
    let currency: String
    let holderName: String

    enum CodingKeys: String, CodingKey {
        case id, currency, last4
        case bankName = "bank_name"
        case cardName = "card_name"
        case holderName = "holder_name"
    }

    var displayLabel: String {
        let holderSuffix = holderName.isEmpty ? "" : "（\(holderName)）"
        return "\(bankName) \(cardName) ·\(last4)\(holderSuffix)"
    }
}

struct ShareDraftSummary: Identifiable, Decodable, Equatable {
    let id: String
    let status: String
    let cardLast4: String?
    let currency: String?
    let parseErrorMessage: String?
    let parsedPayload: Payload?

    struct Payload: Decodable, Equatable {
        let bankName: String?
        let totalAmount: Double?
        let currency: String?

        enum CodingKeys: String, CodingKey {
            case bankName = "bank_name"
            case totalAmount = "total_amount"
            case currency
        }
    }

    enum CodingKeys: String, CodingKey {
        case id, status
        case cardLast4 = "card_last4"
        case currency
        case parseErrorMessage = "parse_error_message"
        case parsedPayload = "parsed_payload"
    }

    var displayBankName: String {
        parsedPayload?.bankName ?? "待补充银行"
    }

    var displayCurrency: String {
        parsedPayload?.currency ?? currency ?? "CNY"
    }

    var statusLabel: String {
        switch status {
        case "ready_for_confirm": return "待确认入账"
        case "needs_password": return "PDF 需要密码"
        case "parse_failed": return "解析待补充"
        case "committed": return "已入账"
        default: return status
        }
    }
}

struct ShareImportResponse: Decodable {
    let outcome: String
    let drafts: [ShareDraftSummary]
    let message: String?
    let deduplicated: Bool?
}

enum ShareInputKind: Equatable {
    case pdf
    case images
    case text
}

struct PreparedShareItem: Identifiable {
    let id = UUID()
    let fileURL: URL
    let fileName: String
    let mimeType: String
}

enum ShareExtensionError: LocalizedError {
    case unauthenticated
    case invalidInput(String)
    case serverError(String)
    case imageProcessingFailed

    var errorDescription: String? {
        switch self {
        case .unauthenticated:
            return "尚未登录 WorldCredit，请先打开主 App 登录。"
        case .invalidInput(let msg):
            return msg
        case .serverError(let msg):
            return msg
        case .imageProcessingFailed:
            return "图片压缩处理失败，请重试。"
        }
    }
}

// MARK: - Keychain & App Group Cache

enum ShareKeychainStore {
    private static let service = "com.chunfenshijie.worldcredit"
    private static let sessionAccount = "com.chunfenshijie.worldcredit.sessionToken"
    private static let refreshAccount = "com.chunfenshijie.worldcredit.refreshToken"

    static var sessionToken: String? {
        read(account: sessionAccount)
    }

    static var refreshToken: String? {
        read(account: refreshAccount)
    }

    static func saveSessionToken(_ token: String?) {
        write(token, account: sessionAccount)
    }

    static func saveRefreshToken(_ token: String?) {
        write(token, account: refreshAccount)
    }

    private static func read(account: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess,
              let data = result as? Data,
              let value = String(data: data, encoding: .utf8),
              !value.isEmpty else {
            return nil
        }
        return value
    }

    private static func write(_ value: String?, account: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
        guard let value, !value.isEmpty else { return }
        var attrs = query
        attrs[kSecValueData as String] = Data(value.utf8)
        attrs[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(attrs as CFDictionary, nil)
    }
}

enum ShareCardCacheReader {
    private static let appGroupId = "group.com.chunfenshijie.worldcredit"

    static func loadCards() -> [ShareCardLiteDTO] {
        guard let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupId) else {
            return []
        }
        let fileURL = container
            .appendingPathComponent("ShareExtensionCache", isDirectory: true)
            .appendingPathComponent("cards_lite.json")
        guard let data = try? Data(contentsOf: fileURL),
              let cards = try? JSONDecoder().decode([ShareCardLiteDTO].self, from: data) else {
            return []
        }
        return cards
    }
}

// MARK: - Low-Memory Media Prep (HEIC / Large Image <= 2048px JPEG)

enum ShareMediaProcessor {
    static func tempDirectoryURL() throws -> URL {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("worldcredit-share-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    static func copyFileToTemp(_ sourceURL: URL, preferredExtension: String? = nil, in dir: URL) throws -> URL {
        let scoped = sourceURL.startAccessingSecurityScopedResource()
        defer {
            if scoped { sourceURL.stopAccessingSecurityScopedResource() }
        }
        let ext = preferredExtension ?? (sourceURL.pathExtension.isEmpty ? "bin" : sourceURL.pathExtension)
        let destURL = dir.appendingPathComponent("item-\(UUID().uuidString).\(ext)")
        if FileManager.default.fileExists(atPath: destURL.path) {
            try FileManager.default.removeItem(at: destURL)
        }
        try FileManager.default.copyItem(at: sourceURL, to: destURL)
        return destURL
    }

    /// 用 CGImageSource 直接按最长边 <= 2048px 生成缩略图并写成 JPEG，不解码全图到内存。
    static func transcodeImageToJPEG(sourceURL: URL, maxPixelSize: Int = 2048, in dir: URL) throws -> URL {
        let sourceOptions: [CFString: Any] = [
            kCGImageSourceShouldCache: false,
        ]
        guard let imageSource = CGImageSourceCreateWithURL(sourceURL as CFURL, sourceOptions as CFDictionary) else {
            throw ShareExtensionError.imageProcessingFailed
        }
        let thumbOptions: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixelSize,
            kCGImageSourceShouldCache: false,
        ]
        guard let cgImage = CGImageSourceCreateThumbnailAtIndex(imageSource, 0, thumbOptions as CFDictionary) else {
            throw ShareExtensionError.imageProcessingFailed
        }
        let outURL = dir.appendingPathComponent("img-\(UUID().uuidString).jpg")
        guard let destination = CGImageDestinationCreateWithURL(
            outURL as CFURL,
            UTType.jpeg.identifier as CFString,
            1,
            nil
        ) else {
            throw ShareExtensionError.imageProcessingFailed
        }
        let writeProps: [CFString: Any] = [
            kCGImageDestinationLossyCompressionQuality: 0.82,
        ]
        CGImageDestinationAddImage(destination, cgImage, writeProps as CFDictionary)
        guard CGImageDestinationFinalize(destination) else {
            throw ShareExtensionError.imageProcessingFailed
        }
        return outURL
    }
}

// MARK: - Network Client (Streaming Multipart + RPC)

final class ShareUploadClient: Sendable {
    static let baseURL = URL(string: "https://app.all-bill.com")!
    private let session: URLSession

    init(session: URLSession = .shared) {
        self.session = session
    }

    func hasSession() -> Bool {
        if let token = ShareKeychainStore.sessionToken, !token.isEmpty {
            return true
        }
        if let refresh = ShareKeychainStore.refreshToken, !refresh.isEmpty {
            return true
        }
        return false
    }

    func submit(
        kind: ShareInputKind,
        files: [PreparedShareItem],
        rawText: String?,
        cardId: String?,
        pdfPassword: String?
    ) async throws -> ShareImportResponse {
        let clientRequestId = UUID().uuidString.lowercased()
        let token = try await ensureSessionToken()

        var attachmentIds: [String] = []
        if kind == .pdf || kind == .images {
            for item in files {
                let uploadedId = try await uploadWithRefreshRetry(
                    file: item,
                    recordId: clientRequestId,
                    initialToken: token
                )
                attachmentIds.append(uploadedId)
            }
        }

        let sourceType: String
        switch kind {
        case .pdf: sourceType = "pdf"
        case .images: sourceType = "image"
        case .text: sourceType = "text"
        }

        var arg: [String: Any] = [
            "source_type": sourceType,
            "client_request_id": clientRequestId,
        ]
        if let rawText = rawText?.trimmingCharacters(in: .whitespacesAndNewlines), !rawText.isEmpty {
            arg["raw_text"] = rawText
        }
        if !attachmentIds.isEmpty {
            arg["attachment_ids"] = attachmentIds
        }
        if let cardId, !cardId.isEmpty {
            arg["card_id"] = cardId
        }
        if let pdfPassword, !pdfPassword.isEmpty {
            arg["pdf_password"] = pdfPassword
        }

        let currentToken = try await ensureSessionToken()
        return try await callImportRPCWithRetry(arg: arg, initialToken: currentToken)
    }

    private func ensureSessionToken() async throws -> String {
        if let token = ShareKeychainStore.sessionToken, !token.isEmpty {
            return token
        }
        return try await refreshSessionToken()
    }

    private func refreshSessionToken() async throws -> String {
        guard let refreshToken = ShareKeychainStore.refreshToken, !refreshToken.isEmpty else {
            throw ShareExtensionError.unauthenticated
        }
        var req = URLRequest(url: Self.baseURL.appendingPathComponent("api/auth/refresh"))
        req.httpMethod = "POST"
        req.timeoutInterval = 20
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["refresh_token": refreshToken])

        let (data, response) = try await session.data(for: req)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw ShareExtensionError.unauthenticated
        }
        struct RefreshEnvelope: Decodable {
            let token: String
            let refreshToken: String?
            enum CodingKeys: String, CodingKey {
                case token
                case refreshToken = "refresh_token"
            }
        }
        let decoded = try JSONDecoder().decode(RefreshEnvelope.self, from: data)
        ShareKeychainStore.saveSessionToken(decoded.token)
        if let nextRefresh = decoded.refreshToken {
            ShareKeychainStore.saveRefreshToken(nextRefresh)
        }
        return decoded.token
    }

    private func uploadWithRefreshRetry(
        file: PreparedShareItem,
        recordId: String,
        initialToken: String
    ) async throws -> String {
        do {
            return try await uploadSingleFile(file: file, recordId: recordId, token: initialToken)
        } catch ShareExtensionError.unauthenticated {
            let newToken = try await refreshSessionToken()
            return try await uploadSingleFile(file: file, recordId: recordId, token: newToken)
        }
    }

    /// 流式将 multipart 请求体拼到临时文件再使用 upload(fromFile:)，控制内存占用 < 35MB。
    private func uploadSingleFile(
        file: PreparedShareItem,
        recordId: String,
        token: String
    ) async throws -> String {
        let boundary = "Boundary-\(UUID().uuidString)"
        let multipartURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("upload-body-\(UUID().uuidString).tmp")
        FileManager.default.createFile(atPath: multipartURL.path, contents: nil)
        defer { try? FileManager.default.removeItem(at: multipartURL) }

        let handle = try FileHandle(forWritingTo: multipartURL)
        defer { try? handle.close() }

        func writeString(_ str: String) throws {
            if let data = str.data(using: .utf8) {
                try handle.write(contentsOf: data)
            }
        }

        func appendField(_ name: String, _ value: String) throws {
            try writeString("--\(boundary)\r\n")
            try writeString("Content-Disposition: form-data; name=\"\(name)\"\r\n\r\n")
            try writeString("\(value)\r\n")
        }

        try appendField("record_type", "draft")
        try appendField("record_id", recordId)

        let safeName = file.fileName.replacingOccurrences(of: "\"", with: "_")
        try writeString("--\(boundary)\r\n")
        try writeString("Content-Disposition: form-data; name=\"file\"; filename=\"\(safeName)\"\r\n")
        try writeString("Content-Type: \(file.mimeType)\r\n\r\n")

        let inputHandle = try FileHandle(forReadingFrom: file.fileURL)
        defer { try? inputHandle.close() }
        while true {
            let chunk = try inputHandle.read(upToCount: 64 * 1024) ?? Data()
            if chunk.isEmpty { break }
            try handle.write(contentsOf: chunk)
        }

        try writeString("\r\n--\(boundary)--\r\n")
        try handle.synchronize()

        var request = URLRequest(url: Self.baseURL.appendingPathComponent("api/attachments/upload"))
        request.httpMethod = "POST"
        request.timeoutInterval = 90
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")

        let (data, response) = try await session.upload(for: request, fromFile: multipartURL)
        guard let http = response as? HTTPURLResponse else {
            throw ShareExtensionError.serverError("上传响应异常")
        }
        if http.statusCode == 401 {
            throw ShareExtensionError.unauthenticated
        }
        struct UploadEnvelope: Decodable {
            let data: UploadedAttachment?
            let error: String?
            struct UploadedAttachment: Decodable {
                let id: String
            }
        }
        let decoded = try? JSONDecoder().decode(UploadEnvelope.self, from: data)
        if !(200...299).contains(http.statusCode) {
            throw ShareExtensionError.serverError(decoded?.error ?? "上传失败 (HTTP \(http.statusCode))")
        }
        if let err = decoded?.error {
            throw ShareExtensionError.serverError(err)
        }
        guard let id = decoded?.data?.id else {
            throw ShareExtensionError.serverError("上传响应缺少附件 ID")
        }
        return id
    }

    private func callImportRPCWithRetry(
        arg: [String: Any],
        initialToken: String
    ) async throws -> ShareImportResponse {
        do {
            return try await callImportRPC(arg: arg, token: initialToken)
        } catch ShareExtensionError.unauthenticated {
            let newToken = try await refreshSessionToken()
            return try await callImportRPC(arg: arg, token: newToken)
        }
    }

    private func callImportRPC(arg: [String: Any], token: String) async throws -> ShareImportResponse {
        var request = URLRequest(url: Self.baseURL.appendingPathComponent("api/rpc/billDrafts/importAndParseBill"))
        request.httpMethod = "POST"
        request.timeoutInterval = 90
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["args": [arg]])

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw ShareExtensionError.serverError("解析请求失败")
        }
        if http.statusCode == 401 {
            throw ShareExtensionError.unauthenticated
        }
        struct RPCEnvelope: Decodable {
            let data: ShareImportResponse?
            let error: String?
        }
        let decoded = try? JSONDecoder().decode(RPCEnvelope.self, from: data)
        if !(200...299).contains(http.statusCode) {
            throw ShareExtensionError.serverError(decoded?.error ?? "解析失败 (HTTP \(http.statusCode))")
        }
        if let err = decoded?.error {
            throw ShareExtensionError.serverError(err)
        }
        guard let payload = decoded?.data else {
            throw ShareExtensionError.serverError("服务端返回数据格式异常")
        }
        return payload
    }
}
