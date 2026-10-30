import Foundation
import Security
import OSLog

public struct SessionUser: Codable, Sendable {
    public var id: String
    public var email: String
    public var name: String?
    public var role: String
    public var createdAt: String

    public init(id: String, email: String, name: String? = nil, role: String = "member", createdAt: String = "") {
        self.id = id
        self.email = email
        self.name = name
        self.role = role
        self.createdAt = createdAt
    }

    enum CodingKeys: String, CodingKey {
        case id, email, name, role
        case createdAt = "created_at"
    }
}

public struct TokenResponse: Codable, Sendable {
    public var token: String
    public var tokenType: String
    public var expiresIn: Int
    public var user: SessionUser
    /// 静默续期凭据：一次性轮换，服务端只存哈希；旧版服务端不返回时为 nil
    public var refreshToken: String?

    enum CodingKeys: String, CodingKey {
        case token, user
        case tokenType = "token_type"
        case expiresIn = "expires_in"
        case refreshToken = "refresh_token"
    }
}

public struct PullChangeItem: Codable, Sendable {
    public var tbl: String
    public var rowId: String
    public var op: String // "upsert" or "delete"
    public var row: [String: AnyCodable]?

    enum CodingKeys: String, CodingKey {
        case tbl, op, row
        case rowId = "row_id"
    }
}

public struct PullResponse: Codable, Sendable {
    public var cursor: Int
    public var hasMore: Bool
    public var changes: [PullChangeItem]
    public var serverTime: String

    enum CodingKeys: String, CodingKey {
        case cursor, changes
        case hasMore = "has_more"
        case serverTime = "server_time"
    }
}

public struct SyncReconcileTarget: Codable, Hashable, Sendable {
    public let tbl: String
    public let rowId: String

    public init(tbl: String, rowId: String) {
        self.tbl = tbl
        self.rowId = rowId
    }

    enum CodingKeys: String, CodingKey {
        case tbl
        case rowId = "row_id"
    }
}

public struct MutationPayload: Codable, Sendable {
    public var id: String
    public var name: String
    public var args: [AnyCodable]

    public init(id: String, name: String, args: [AnyCodable]) {
        self.id = id
        self.name = name
        self.args = args
    }
}

public struct MutationPushResult: Codable, Sendable {
    public var id: String
    public var ok: Bool
    public var error: String?
    public var permanent: Bool?
    public var alreadyProcessed: Bool?

    enum CodingKeys: String, CodingKey {
        case id, ok, error, permanent
        case alreadyProcessed = "already_processed"
    }
}

public struct PushResponse: Codable, Sendable {
    public var results: [MutationPushResult]
}

// MARK: - Gmail bill sync models

/// `GET /api/gmail/status`。未连接时除 connected 外全为 null。
public struct GmailSyncStatus: Codable, Sendable, Equatable {
    public var connected: Bool
    public var email: String?
    /// active | error | revoked | null
    public var status: String?
    public var lastSyncAt: String?
    public var lastSyncSummary: String?
    public var lastError: String?

    enum CodingKeys: String, CodingKey {
        case connected, email, status
        case lastSyncAt = "last_sync_at"
        case lastSyncSummary = "last_sync_summary"
        case lastError = "last_error"
    }

    public init(connected: Bool, email: String? = nil, status: String? = nil,
                lastSyncAt: String? = nil, lastSyncSummary: String? = nil, lastError: String? = nil) {
        self.connected = connected
        self.email = email
        self.status = status
        self.lastSyncAt = lastSyncAt
        self.lastSyncSummary = lastSyncSummary
        self.lastError = lastError
    }
}

/// `POST /api/gmail/connect`。
public struct GmailConnectResponse: Codable, Sendable, Equatable {
    public var ok: Bool
    public var email: String?
}

/// `POST /api/gmail/sync`。`remaining` 为服务端剩余待扫描邮件数，客户端据此分轮续拉。
public struct GmailSyncResult: Codable, Sendable, Equatable {
    public var scanned: Int
    public var written: Int
    public var drafted: Int
    public var skipped: Int
    public var failed: Int
    public var errors: [String]
    public var remaining: Int?

    public init(scanned: Int, written: Int, drafted: Int, skipped: Int, failed: Int,
                errors: [String] = [], remaining: Int? = nil) {
        self.scanned = scanned
        self.written = written
        self.drafted = drafted
        self.skipped = skipped
        self.failed = failed
        self.errors = errors
        self.remaining = remaining
    }

    public var summaryText: String {
        "扫描 \(scanned)｜落账单 \(written)｜草稿 \(drafted)｜跳过 \(skipped)｜失败 \(failed)"
    }

    /// 分轮同步时把各轮计数合并为一个汇总。
    public func merged(with other: GmailSyncResult) -> GmailSyncResult {
        GmailSyncResult(
            scanned: scanned + other.scanned,
            written: written + other.written,
            drafted: drafted + other.drafted,
            skipped: skipped + other.skipped,
            failed: failed + other.failed,
            errors: errors + other.errors,
            remaining: other.remaining
        )
    }
}

/// `POST /api/gmail/disconnect`。
public struct GmailDisconnectResponse: Codable, Sendable, Equatable {
    public var ok: Bool
}

public protocol NetworkSession: Sendable {
    func data(for request: URLRequest) async throws -> (Data, URLResponse)
}

extension URLSession: NetworkSession {}

protocol TokenKeychain: Sendable {
    func add(_ attributes: [String: Any]) -> OSStatus
    func delete(_ query: [String: Any]) -> OSStatus
    func read(_ query: [String: Any]) -> (OSStatus, Data?)
}

private struct SystemTokenKeychain: TokenKeychain {
    func add(_ attributes: [String: Any]) -> OSStatus { SecItemAdd(attributes as CFDictionary, nil) }
    func delete(_ query: [String: Any]) -> OSStatus { SecItemDelete(query as CFDictionary) }
    func read(_ query: [String: Any]) -> (OSStatus, Data?) {
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        return (status, item as? Data)
    }
}

public struct KeychainFailure: Error, Equatable, Sendable {
    public enum Operation: String, Sendable { case read, add, delete }
    public let operation: Operation
    public let status: OSStatus
}

public final class ApiClient: @unchecked Sendable {
    // This lock covers memory AND the complete synchronous Keychain operation.
    private let stateLock = NSLock()
    private var keychainFailure: KeychainFailure?
    private var hasExplicitToken = false
    private static let logger = Logger(subsystem: "com.chunfenshijie.worldcredit", category: "Keychain")

    /// Most recent persistence failure. Contains only an operation and OSStatus, never credentials.
    public var lastKeychainFailure: KeychainFailure? { stateLock.withLock { keychainFailure } }
    public let baseURL: URL
    public let session: NetworkSession
    private var inMemoryToken: String?
    private let useKeychain: Bool
    private let keychain: any TokenKeychain

    public convenience init(baseURL: URL, session: NetworkSession = URLSession.shared, token: String? = nil, useKeychain: Bool = true) {
        self.init(baseURL: baseURL, session: session, token: token, useKeychain: useKeychain, keychain: SystemTokenKeychain())
    }

    init(baseURL: URL, session: NetworkSession = URLSession.shared, token: String? = nil,
         useKeychain: Bool = true, keychain: any TokenKeychain) {
        self.baseURL = baseURL
        self.session = session
        self.inMemoryToken = token
        self.useKeychain = useKeychain
        self.keychain = keychain
    }

    public var token: String? {
        get {
            stateLock.withLock {
                // Explicit nil is a logout tombstone, even if Keychain deletion failed.
                if hasExplicitToken || inMemoryToken != nil { return inMemoryToken }
                return useKeychain ? readKeychainToken() : nil
            }
        }
        set {
            stateLock.withLock {
                hasExplicitToken = true
                inMemoryToken = newValue
                if newValue == nil {
                    // 登出：内存态直接丢弃 refresh 凭据（两种模式一致），
                    // Keychain 条目仅在启用时额外清理
                    inMemoryRefreshToken = nil
                }
                guard useKeychain else { return }
                if let newValue {
                    saveKeychainToken(newValue)
                } else {
                    deleteKeychainToken()
                    // 登出同时丢弃 refresh 凭据，防止换号后旧凭据被复用
                    let refreshQuery: [String: Any] = [
                        kSecClass as String: kSecClassGenericPassword,
                        kSecAttrService as String: keychainService,
                        kSecAttrAccount as String: keychainRefreshAccount,
                    ]
                    checkKeychainStatus(keychain.delete(refreshQuery), operation: .delete, allowsMissing: true)
                }
            }
        }
    }

    public func loginWithPassword(email: String, password: String) async throws -> SessionUser {
        try await exchangeToken(["grant_type": "password", "email": email, "password": password])
    }

    /// 用 Google Sign-In 换到的 ID token 换取会话。
    ///
    /// GoogleSignIn SDK 的交互留在 App 层：Core 只接收 token 字符串，这样 Watch 与
    /// Widget 不必链接一个只支持 iOS/macOS 的包。服务端 `POST /api/auth/token`
    /// 的 `grant_type: "google"` 会按 JWKS 验签并核对 audience。
    public func loginWithGoogle(idToken: String, nonce: String? = nil) async throws -> SessionUser {
        var payload = ["grant_type": "google", "id_token": idToken]
        if let nonce, !nonce.isEmpty {
            payload["nonce"] = nonce
        }
        return try await exchangeToken(payload)
    }

    private func exchangeToken(_ body: [String: String]) async throws -> SessionUser {
        let url = baseURL.appendingPathComponent("api/auth/token")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await session.data(for: req)
        guard let httpRes = response as? HTTPURLResponse else {
            throw URLError(.badServerResponse)
        }
        guard httpRes.statusCode == 200 else {
            let errJson = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            let msg = (errJson?["error"] as? String) ?? "登录失败 (\(httpRes.statusCode))"
            throw NSError(domain: "ApiClient", code: httpRes.statusCode, userInfo: [NSLocalizedDescriptionKey: msg])
        }

        let tokenRes = try JSONDecoder().decode(TokenResponse.self, from: data)
        self.token = tokenRes.token
        if let refresh = tokenRes.refreshToken {
            storeRefreshToken(refresh)
        }
        return tokenRes.user
    }

    public func pull(cursor: Int, limit: Int = 500, reconcile: [SyncReconcileTarget] = []) async throws -> PullResponse {
        guard let token = self.token else {
            throw NSError(domain: "ApiClient", code: 401, userInfo: [NSLocalizedDescriptionKey: "未登录"])
        }
        let url = baseURL.appendingPathComponent("api/sync/pull")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        var body: [String: Any] = ["cursor": cursor, "limit": limit]
        if !reconcile.isEmpty {
            body["reconcile"] = reconcile.map { ["tbl": $0.tbl, "row_id": $0.rowId] }
        }
        req.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await session.data(for: req)
        guard let httpRes = response as? HTTPURLResponse, httpRes.statusCode == 200 else {
            throw NSError(domain: "ApiClient", code: (response as? HTTPURLResponse)?.statusCode ?? 500, userInfo: [NSLocalizedDescriptionKey: "拉取失败"])
        }

        return try JSONDecoder().decode(PullResponse.self, from: data)
    }

    public func push(clientId: String, mutations: [MutationPayload]) async throws -> [MutationPushResult] {
        guard let token = self.token else {
            throw NSError(domain: "ApiClient", code: 401, userInfo: [NSLocalizedDescriptionKey: "未登录"])
        }
        let url = baseURL.appendingPathComponent("api/sync/push")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let bodyObj: [String: Any] = [
            "client_id": clientId,
            "mutations": mutations.map { mut in
                [
                    "id": mut.id,
                    "name": mut.name,
                    "args": mut.args.map { $0.value },
                ]
            },
        ]
        req.httpBody = try JSONSerialization.data(withJSONObject: bodyObj)

        let (data, response) = try await session.data(for: req)
        guard let httpRes = response as? HTTPURLResponse, httpRes.statusCode == 200 else {
            throw NSError(domain: "ApiClient", code: (response as? HTTPURLResponse)?.statusCode ?? 500, userInfo: [NSLocalizedDescriptionKey: "提交失败"])
        }

        let pushRes = try JSONDecoder().decode(PushResponse.self, from: data)
        return pushRes.results
    }

    // MARK: - Authenticated reads and generic RPC

    /// Restores the current server identity without changing credentials or Keychain state.
    public func fetchSessionUser() async throws -> SessionUser {
        let request = try authenticatedRequest(path: "api/auth/session", method: "GET")
        let (data, response) = try await session.data(for: request)
        try validateHTTP(response, data: data)
        struct Envelope: Decodable { let user: SessionUser? }
        guard let user = try JSONDecoder().decode(Envelope.self, from: data).user else {
            throw NSError(domain: "ApiClient", code: 401, userInfo: [NSLocalizedDescriptionKey: "未登录"])
        }
        return user
    }

    /// Calls a named RPC and unwraps its {data,error} envelope. Does not mutate authentication.
    public func rpc<Value: Decodable & Sendable>(module: String, function: String,
                                                 args: [AnyCodable] = []) async throws -> Value {
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "_"))
        guard [module, function].allSatisfy({ !$0.isEmpty && $0.unicodeScalars.allSatisfy(allowed.contains) }) else {
            throw URLError(.badURL)
        }
        var request = try authenticatedRequest(path: "api/rpc/\(module)/\(function)", method: "POST")
        request.httpBody = try JSONEncoder().encode(["args": args])
        let (data, response) = try await session.data(for: request)
        try validateHTTP(response, data: data)
        // Decode errors first: an error must win even if data has the wrong shape.
        let failure = try JSONDecoder().decode(RPCErrorEnvelope.self, from: data)
        if let error = failure.error {
            throw NSError(domain: "ApiClient", code: 500, userInfo: [NSLocalizedDescriptionKey: error])
        }
        return try JSONDecoder().decode(RPCEnvelope<Value>.self, from: data).data
    }

    private struct RPCErrorEnvelope: Decodable { let error: String? }
    private struct RPCEnvelope<Value: Decodable>: Decodable { let data: Value }

    private func authenticatedRequest(path: String, method: String, timeoutInterval: TimeInterval = 20) throws -> URLRequest {
        // 默认 20s；确实耗时的慢端点（如 gmail/sync）在调用点显式传更长超时
        guard let token = self.token, !token.isEmpty else {
            throw NSError(domain: "ApiClient", code: 401, userInfo: [NSLocalizedDescriptionKey: "未登录"])
        }
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.httpMethod = method
        request.timeoutInterval = timeoutInterval
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        return request
    }

    private func validateHTTP(_ response: URLResponse, data: Data) throws {
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        guard (200...299).contains(http.statusCode) else {
            let envelope = try? JSONDecoder().decode(RPCErrorEnvelope.self, from: data)
            throw NSError(domain: "ApiClient", code: http.statusCode,
                          userInfo: [NSLocalizedDescriptionKey: envelope?.error ?? "请求失败 (\(http.statusCode))"])
        }
    }

    // MARK: - Device Tokens (APNs)

    public func registerDeviceToken(
        token: String,
        platform: String = "ios",
        appVersion: String? = nil,
        authenticationToken: String? = nil
    ) async throws {
        var inputObj: [String: Any] = [
            "token": token,
            "platform": platform,
        ]
        if let appVersion {
            inputObj["appVersion"] = appVersion
        }
        try await sendDeviceTokenRequest(
            function: "registerToken", input: inputObj,
            authenticationToken: authenticationToken, failureMessage: "注册设备推送失败"
        )
    }

    /// The explicit credential lets logout finish a queued request after clearing the local session.
    public func unregisterDeviceToken(token: String, authenticationToken: String? = nil) async throws {
        try await sendDeviceTokenRequest(
            function: "unregisterToken", input: ["token": token],
            authenticationToken: authenticationToken, failureMessage: "注销设备推送失败"
        )
    }

    private struct DeviceTokenResponse: Decodable {
        struct Result: Decodable {
            let success: Bool
        }
        let data: Result?
        let error: String?
    }

    private func sendDeviceTokenRequest(
        function: String,
        input: [String: Any],
        authenticationToken: String?,
        failureMessage: String
    ) async throws {
        guard let authToken = authenticationToken ?? self.token, !authToken.isEmpty else {
            throw NSError(domain: "ApiClient", code: 401, userInfo: [NSLocalizedDescriptionKey: "未登录"])
        }
        let url = baseURL.appendingPathComponent("api/rpc/devices/\(function)")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.timeoutInterval = 20
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["args": [input]])

        let (data, response) = try await session.data(for: req)
        guard let httpRes = response as? HTTPURLResponse else {
            throw URLError(.badServerResponse)
        }
        guard (200...299).contains(httpRes.statusCode) else {
            let body = try? JSONDecoder().decode(DeviceTokenResponse.self, from: data)
            throw NSError(domain: "ApiClient", code: httpRes.statusCode,
                          userInfo: [NSLocalizedDescriptionKey: body?.error ?? failureMessage])
        }
        let body = try JSONDecoder().decode(DeviceTokenResponse.self, from: data)
        guard body.error == nil, body.data?.success == true else {
            throw NSError(domain: "ApiClient", code: 500,
                          userInfo: [NSLocalizedDescriptionKey: body.error ?? failureMessage])
        }
    }

    // MARK: - Gmail Bill Sync

    /// 服务端每日 cron 拉取 Gmail 账单；本方法只读取当前连接状态。
    public func gmailStatus() async throws -> GmailSyncStatus {
        let request = try authenticatedRequest(path: "api/gmail/status", method: "GET")
        let (data, response) = try await session.data(for: request)
        try validateHTTP(response, data: data)
        return try JSONDecoder().decode(GmailSyncStatus.self, from: data)
    }

    /// 用 Google Sign-In 的 serverAuthCode 建立连接；refresh token 只存在服务端。
    public func gmailConnect(serverAuthCode: String) async throws -> GmailConnectResponse {
        var request = try authenticatedRequest(path: "api/gmail/connect", method: "POST")
        request.httpBody = try JSONEncoder().encode(["serverAuthCode": serverAuthCode])
        let (data, response) = try await session.data(for: request)
        try validateHTTP(response, data: data)
        return try JSONDecoder().decode(GmailConnectResponse.self, from: data)
    }

    /// 手动触发一次拉取。`maxMessages` 限制单轮扫描封数（UI 按轮续拉时传 6）；
    /// 服务端要逐封扫邮件，120s 超时作为单轮兜底。
    public func gmailSync(maxMessages: Int? = nil) async throws -> GmailSyncResult {
        var request = try authenticatedRequest(path: "api/gmail/sync", method: "POST", timeoutInterval: 120)
        if let maxMessages {
            request.httpBody = try JSONEncoder().encode(["maxMessages": maxMessages])
        }
        let (data, response) = try await session.data(for: request)
        try validateHTTP(response, data: data)
        return try JSONDecoder().decode(GmailSyncResult.self, from: data)
    }

    public func gmailDisconnect() async throws {
        let request = try authenticatedRequest(path: "api/gmail/disconnect", method: "POST")
        let (data, response) = try await session.data(for: request)
        try validateHTTP(response, data: data)
        _ = try JSONDecoder().decode(GmailDisconnectResponse.self, from: data)
    }

    // MARK: - Keychain Helpers

    private let keychainAccount = "com.chunfenshijie.worldcredit.sessionToken"
    private let keychainRefreshAccount = "com.chunfenshijie.worldcredit.refreshToken"
    private let keychainService = "com.chunfenshijie.worldcredit"

    private func saveKeychainToken(_ token: String) {
        let data = Data(token.utf8)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainAccount,
        ]
        let deletion = keychain.delete(query)
        guard checkKeychainStatus(deletion, operation: .delete, allowsMissing: true) else { return }
        var newQuery = query
        newQuery[kSecValueData as String] = data
        newQuery[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        checkKeychainStatus(keychain.add(newQuery), operation: .add)
    }

    private func readKeychainToken() -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainAccount,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        let (status, item) = keychain.read(query)
        guard checkKeychainStatus(status, operation: .read, allowsMissing: true), status == errSecSuccess else { return nil }
        guard let data = item, let token = String(data: data, encoding: .utf8) else {
            checkKeychainStatus(errSecDecode, operation: .read)
            return nil
        }
        return token
    }

    private func deleteKeychainToken() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainAccount,
        ]
        checkKeychainStatus(keychain.delete(query), operation: .delete, allowsMissing: true)
    }

    // MARK: - Refresh Token (Keychain-backed)

    private func saveKeychainRefreshToken(_ token: String) {
        let data = Data(token.utf8)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainRefreshAccount,
        ]
        let deletion = keychain.delete(query)
        guard checkKeychainStatus(deletion, operation: .delete, allowsMissing: true) else { return }
        var newQuery = query
        newQuery[kSecValueData as String] = data
        newQuery[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        checkKeychainStatus(keychain.add(newQuery), operation: .add)
    }

    public var refreshToken: String? {
        stateLock.withLock {
            if let inMemoryRefreshToken { return inMemoryRefreshToken }
            guard useKeychain else { return nil }
            let query: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: keychainService,
                kSecAttrAccount as String: keychainRefreshAccount,
                kSecReturnData as String: true,
                kSecMatchLimit as String: kSecMatchLimitOne,
            ]
            let (status, item) = keychain.read(query)
            guard status == errSecSuccess, let data = item,
                  let token = String(data: data, encoding: .utf8) else { return nil }
            return token
        }
    }

    private func storeRefreshToken(_ token: String?) {
        stateLock.withLock {
            inMemoryRefreshToken = token
            guard useKeychain else { return }
            if let token {
                saveKeychainRefreshToken(token)
            } else {
                let query: [String: Any] = [
                    kSecClass as String: kSecClassGenericPassword,
                    kSecAttrService as String: keychainService,
                    kSecAttrAccount as String: keychainRefreshAccount,
                ]
                checkKeychainStatus(keychain.delete(query), operation: .delete, allowsMissing: true)
            }
        }
    }

    /// 静默续期：用 refresh token 换新 access token（服务端一次性轮换 refresh token）。
    /// 成功返回新用户会话；refresh token 也失效时抛 401，由调用方落地到登录页。
    /// refreshTask 合并并发触发：多个 401 同时到达只续一次，后来者复用结果。
    private let refreshStateLock = NSLock()
    private var refreshTask: Task<SessionUser, Error>?
    private var inMemoryRefreshToken: String?

    public func refreshSession() async throws -> SessionUser {
        let existing: Task<SessionUser, Error>? = refreshStateLock.withLock { refreshTask }
        if let existing {
            return try await existing.value
        }
        let task = Task<SessionUser, Error> { [self] in
            defer { refreshStateLock.withLock { refreshTask = nil } }
            guard let current = refreshToken else {
                throw NSError(domain: "ApiClient", code: 401, userInfo: [NSLocalizedDescriptionKey: "未登录"])
            }
            let url = baseURL.appendingPathComponent("api/auth/refresh")
            var req = URLRequest(url: url)
            req.httpMethod = "POST"
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.timeoutInterval = 20
            req.httpBody = try JSONSerialization.data(withJSONObject: ["refresh_token": current])

            let (data, response) = try await session.data(for: req)
            guard let httpRes = response as? HTTPURLResponse else {
                throw URLError(.badServerResponse)
            }
            guard httpRes.statusCode == 200 else {
                // refresh token 失效：彻底登出（清两套凭据），抛 401 由调用方回登录页
                storeRefreshToken(nil)
                self.token = nil
                throw NSError(domain: "ApiClient", code: 401, userInfo: [NSLocalizedDescriptionKey: "登录已过期"])
            }
            let tokenRes = try JSONDecoder().decode(TokenResponse.self, from: data)
            self.token = tokenRes.token
            if let newRefresh = tokenRes.refreshToken {
                storeRefreshToken(newRefresh)
            }
            return tokenRes.user
        }
        let stored: Task<SessionUser, Error>? = refreshStateLock.withLock {
            if let existing = refreshTask { return existing }
            refreshTask = task
            return nil
        }
        if let stored { return try await stored.value }
        return try await task.value
    }

    /// Called only while stateLock is held. Preserve failures until a later successful persistence operation.
    @discardableResult
    private func checkKeychainStatus(_ status: OSStatus, operation: KeychainFailure.Operation,
                                     allowsMissing: Bool = false) -> Bool {
        if status == errSecSuccess || (allowsMissing && status == errSecItemNotFound) {
            keychainFailure = nil
            return true
        }
        keychainFailure = KeychainFailure(operation: operation, status: status)
        Self.logger.error("Keychain \(operation.rawValue, privacy: .public) failed (OSStatus \(status, privacy: .public))")
        return false
    }
}

// MARK: - Type-erased Codable for arbitrary JSON structures

public struct AnyCodable: Codable, @unchecked Sendable {
    public let value: Any

    public init(_ value: Any) {
        self.value = value
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self.value = NSNull()
        } else if let bool = try? container.decode(Bool.self) {
            self.value = bool
        } else if let int = try? container.decode(Int.self) {
            self.value = int
        } else if let double = try? container.decode(Double.self) {
            self.value = double
        } else if let string = try? container.decode(String.self) {
            self.value = string
        } else if let array = try? container.decode([AnyCodable].self) {
            self.value = array.map { $0.value }
        } else if let dict = try? container.decode([String: AnyCodable].self) {
            self.value = dict.mapValues { $0.value }
        } else {
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "AnyCodable value cannot be decoded")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch value {
        case is NSNull:
            try container.encodeNil()
        case let bool as Bool:
            try container.encode(bool)
        case let int as Int:
            try container.encode(int)
        case let double as Double:
            try container.encode(double)
        case let string as String:
            try container.encode(string)
        case let array as [Any]:
            try container.encode(array.map { AnyCodable($0) })
        case let dict as [String: Any]:
            try container.encode(dict.mapValues { AnyCodable($0) })
        default:
            throw EncodingError.invalidValue(value, EncodingError.Context(codingPath: container.codingPath, debugDescription: "AnyCodable value cannot be encoded"))
        }
    }
}
