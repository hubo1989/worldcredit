import Foundation
import Security
import OSLog
#if canImport(CoreFoundation)
import CoreFoundation
#endif

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
    private static let syncLogger = Logger(subsystem: "com.chunfenshijie.worldcredit", category: "Sync")

    /// Most recent persistence failure. Contains only an operation and OSStatus, never credentials.
    public var lastKeychainFailure: KeychainFailure? { stateLock.withLock { keychainFailure } }
    public let baseURL: URL
    public let session: NetworkSession
    private var inMemoryToken: String?
    private var inMemoryUser: SessionUser?
    private let useKeychain: Bool
    private let retryBaseDelayNanoseconds: UInt64
    private let keychain: any TokenKeychain

    public convenience init(
        baseURL: URL,
        session: NetworkSession = URLSession.shared,
        token: String? = nil,
        useKeychain: Bool = true,
        retryBaseDelayNanoseconds: UInt64 = 300_000_000
    ) {
        self.init(
            baseURL: baseURL,
            session: session,
            token: token,
            useKeychain: useKeychain,
            retryBaseDelayNanoseconds: retryBaseDelayNanoseconds,
            keychain: SystemTokenKeychain()
        )
    }

    init(
        baseURL: URL,
        session: NetworkSession = URLSession.shared,
        token: String? = nil,
        useKeychain: Bool = true,
        retryBaseDelayNanoseconds: UInt64 = 300_000_000,
        keychain: any TokenKeychain
    ) {
        self.baseURL = baseURL
        self.session = session
        self.inMemoryToken = token
        self.useKeychain = useKeychain
        self.retryBaseDelayNanoseconds = retryBaseDelayNanoseconds
        self.keychain = keychain
    }

    private func currentTokenLocked() -> String? {
        // Explicit nil is a logout tombstone, even if Keychain deletion failed.
        if hasExplicitToken || inMemoryToken != nil { return inMemoryToken }
        return useKeychain ? readKeychainToken() : nil
    }

    public var token: String? {
        get {
            stateLock.withLock {
                currentTokenLocked()
            }
        }
        set {
            stateLock.withLock {
                hasExplicitToken = true
                inMemoryToken = newValue
                if newValue == nil {
                    // 登出：内存态直接丢弃 refresh 凭据与用户缓存（两种模式一致），
                    // Keychain 条目仅在启用时额外清理
                    inMemoryRefreshToken = nil
                    inMemoryUser = nil
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

    /// 注册新账号并请求签发移动端 Bearer token（`issue_token: true`）。
    /// 若服务端返回未包含 token（兼容旧版），自动回退调用密码登录交换 token。
    public func register(email: String, password: String, name: String? = nil) async throws -> TokenResponse {
        let url = baseURL.appendingPathComponent("api/auth/register")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var body: [String: Any] = [
            "email": email,
            "password": password,
            "issue_token": true,
        ]
        if let name, !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            body["name"] = name.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        req.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await session.data(for: req)
        guard let httpRes = response as? HTTPURLResponse else {
            throw URLError(.badServerResponse)
        }
        guard (200...299).contains(httpRes.statusCode) else {
            let errJson = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            let msg = (errJson?["error"] as? String) ?? "注册失败 (\(httpRes.statusCode))"
            throw NSError(domain: "ApiClient", code: httpRes.statusCode, userInfo: [NSLocalizedDescriptionKey: msg])
        }

        if let tokenRes = try? JSONDecoder().decode(TokenResponse.self, from: data),
           !tokenRes.token.isEmpty {
            self.token = tokenRes.token
            if let refresh = tokenRes.refreshToken {
                storeRefreshToken(refresh)
            }
            stateLock.withLock { inMemoryUser = tokenRes.user }
            return tokenRes
        }

        return try await performTokenExchange(["grant_type": "password", "email": email, "password": password])
    }

    private func exchangeToken(_ body: [String: String]) async throws -> SessionUser {
        try await performTokenExchange(body).user
    }

    private func performTokenExchange(_ body: [String: String]) async throws -> TokenResponse {
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
        stateLock.withLock { inMemoryUser = tokenRes.user }
        return tokenRes
    }

    /// 登出吊销：凭 refresh_token 吊销本设备凭据（会话失效时服务端也接受）。
    public func requestLogoutRevoke(refreshToken: String) async throws {
        let url = baseURL.appendingPathComponent("api/auth/logout")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.timeoutInterval = 10
        req.httpBody = try JSONSerialization.data(withJSONObject: ["refresh_token": refreshToken])
        _ = try await session.data(for: req)
    }

    public func pull(cursor: Int, limit: Int = 500, reconcile: [SyncReconcileTarget] = []) async throws -> PullResponse {
        guard let token = self.token else {
            throw NSError(domain: "ApiClient", code: 401, userInfo: [NSLocalizedDescriptionKey: "未登录"])
        }
        let url = baseURL.appendingPathComponent("api/sync/pull")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.timeoutInterval = 30
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        var body: [String: Any] = ["cursor": cursor, "limit": limit]
        if !reconcile.isEmpty {
            body["reconcile"] = reconcile.map { ["tbl": $0.tbl, "row_id": $0.rowId] }
        }
        req.httpBody = try JSONSerialization.data(withJSONObject: body)

        let data = try await performIdempotentSyncRequest(req, operation: "pull")
        do {
            return try JSONDecoder().decode(PullResponse.self, from: data)
        } catch {
            Self.syncLogger.error("Sync pull decode failed (cursor=\(cursor, privacy: .public)): \(error.localizedDescription, privacy: .public)")
            throw error
        }
    }

    private struct PushRequestBody: Encodable {
        let client_id: String
        let mutations: [MutationPayload]
    }

    public func push(clientId: String, mutations: [MutationPayload]) async throws -> [MutationPushResult] {
        guard let token = self.token else {
            throw NSError(domain: "ApiClient", code: 401, userInfo: [NSLocalizedDescriptionKey: "未登录"])
        }
        let url = baseURL.appendingPathComponent("api/sync/push")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.timeoutInterval = 30
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.httpBody = try JSONEncoder().encode(PushRequestBody(client_id: clientId, mutations: mutations))

        let data = try await performIdempotentSyncRequest(req, operation: "push")
        do {
            let pushRes = try JSONDecoder().decode(PushResponse.self, from: data)
            return pushRes.results
        } catch {
            Self.syncLogger.error("Sync push decode failed (count=\(mutations.count, privacy: .public)): \(error.localizedDescription, privacy: .public)")
            throw error
        }
    }

    private func performIdempotentSyncRequest(
        _ request: URLRequest,
        operation: String,
        maxAttempts: Int = 3
    ) async throws -> Data {
        let transientHTTPStatuses: Set<Int> = [502, 503, 504]
        let transientURLErrorCodes: Set<URLError.Code> = [
            .timedOut,
            .networkConnectionLost,
            .cannotConnectToHost,
            .cannotFindHost,
            .dnsLookupFailed,
        ]
        let fallbackMessage = operation == "push" ? "提交失败" : "拉取失败"

        var attempt = 0
        while true {
            attempt += 1
            try Task.checkCancellation()
            do {
                let (data, response) = try await session.data(for: request)
                guard let httpRes = response as? HTTPURLResponse else {
                    throw URLError(.badServerResponse)
                }
                if httpRes.statusCode == 200 {
                    return data
                }
                let envelope = try? JSONDecoder().decode(RPCErrorEnvelope.self, from: data)
                let serverMsg = envelope?.error?.trimmingCharacters(in: .whitespacesAndNewlines)
                let message = (serverMsg?.isEmpty == false) ? serverMsg! : "\(fallbackMessage) (\(httpRes.statusCode))"
                Self.syncLogger.error("Sync \(operation, privacy: .public) HTTP error: status=\(httpRes.statusCode, privacy: .public) attempt=\(attempt, privacy: .public)")

                if transientHTTPStatuses.contains(httpRes.statusCode), attempt < maxAttempts {
                    try await sleepBeforeRetry(attempt: attempt)
                    continue
                }
                throw NSError(
                    domain: "ApiClient",
                    code: httpRes.statusCode,
                    userInfo: [NSLocalizedDescriptionKey: message]
                )
            } catch let urlError as URLError {
                if urlError.code == .cancelled {
                    throw urlError
                }
                Self.syncLogger.error("Sync \(operation, privacy: .public) network error: code=\(urlError.code.rawValue, privacy: .public) attempt=\(attempt, privacy: .public)")
                if transientURLErrorCodes.contains(urlError.code), attempt < maxAttempts {
                    try await sleepBeforeRetry(attempt: attempt)
                    continue
                }
                throw urlError
            }
        }
    }

    private func sleepBeforeRetry(attempt: Int) async throws {
        try Task.checkCancellation()
        guard retryBaseDelayNanoseconds > 0 else { return }
        let factor = UInt64(1 << min(attempt - 1, 4))
        let base = retryBaseDelayNanoseconds * factor
        let jitter = UInt64.random(in: 0...(base / 4))
        try await Task.sleep(nanoseconds: base + jitter)
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
        stateLock.withLock { inMemoryUser = user }
        return user
    }

    /// Calls a named RPC and unwraps its {data,error} envelope. Does not mutate authentication.
    public func rpc<Value: Decodable & Sendable>(module: String, function: String,
                                                 args: [AnyCodable] = []) async throws -> Value {
        let data = try await sendRPCRequest(module: module, function: function, args: args)
        return try JSONDecoder().decode(RPCEnvelope<Value>.self, from: data).data
    }

    /// Calls a named RPC whose server implementation returns void/undefined/null.
    public func rpcVoid(module: String, function: String, args: [AnyCodable] = []) async throws {
        _ = try await sendRPCRequest(module: module, function: function, args: args)
    }

    private func sendRPCRequest(module: String, function: String, args: [AnyCodable]) async throws -> Data {
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "_-"))
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
        return data
    }

    private struct RPCErrorEnvelope: Decodable { let error: String? }
    private struct RPCEnvelope<Value: Decodable>: Decodable { let data: Value }

    // MARK: - Phase 1 Online RPC Wrappers

    public struct CreateBillSubtotalInput: Codable, Sendable, Equatable {
        public var cardId: String?
        public var cardTail: String
        public var subtotalAmount: Double
        public var currency: String?

        public init(cardId: String? = nil, cardTail: String, subtotalAmount: Double, currency: String? = nil) {
            self.cardId = cardId
            self.cardTail = cardTail
            self.subtotalAmount = subtotalAmount
            self.currency = currency
        }

        enum CodingKeys: String, CodingKey {
            case cardId = "card_id"
            case cardTail = "card_tail"
            case subtotalAmount = "subtotal_amount"
            case currency
        }
    }

    public struct CreateBillInput: Codable, Sendable, Equatable {
        public var cardId: String
        public var accountId: String?
        public var billMonth: String
        public var statementStart: String?
        public var statementEnd: String?
        public var statementDate: String?
        public var billAmount: Double
        public var minPayment: Double?
        public var dueDate: String
        public var status: String
        public var subtotals: [CreateBillSubtotalInput]?

        public init(
            cardId: String,
            billMonth: String,
            dueDate: String,
            billAmount: Double,
            minPayment: Double? = nil,
            statementStart: String? = nil,
            statementEnd: String? = nil,
            statementDate: String? = nil,
            accountId: String? = nil,
            status: String = "unpaid",
            subtotals: [CreateBillSubtotalInput]? = nil
        ) {
            self.cardId = cardId
            self.accountId = accountId
            self.billMonth = billMonth
            self.statementStart = statementStart
            self.statementEnd = statementEnd
            self.statementDate = statementDate
            self.billAmount = billAmount
            self.minPayment = minPayment
            self.dueDate = dueDate
            self.status = status
            self.subtotals = subtotals
        }

        enum CodingKeys: String, CodingKey {
            case cardId = "card_id"
            case accountId = "account_id"
            case billMonth = "bill_month"
            case statementStart = "statement_start"
            case statementEnd = "statement_end"
            case statementDate = "statement_date"
            case billAmount = "bill_amount"
            case minPayment = "min_payment"
            case dueDate = "due_date"
            case status
            case subtotals
        }
    }

    public struct MergeAccountResult: Codable, Sendable, Equatable {
        public let mergedCount: Int
    }

    public struct UpdateCreditAccountInput: Sendable, Equatable {
        public var label: String?
        public var clearLabel: Bool
        public var sharedCreditLimit: Double?
        public var clearSharedCreditLimit: Bool
        public var billingDay: Int?
        public var clearBillingDay: Bool
        public var dueType: PaymentDueType?
        public var clearDueType: Bool
        public var dueValue: Int?
        public var clearDueValue: Bool
        public var statementMode: String?
        public var quotaMode: String?

        public init(
            label: String? = nil,
            clearLabel: Bool = false,
            sharedCreditLimit: Double? = nil,
            clearSharedCreditLimit: Bool = false,
            billingDay: Int? = nil,
            clearBillingDay: Bool = false,
            dueType: PaymentDueType? = nil,
            clearDueType: Bool = false,
            dueValue: Int? = nil,
            clearDueValue: Bool = false,
            statementMode: String? = nil,
            quotaMode: String? = nil
        ) {
            self.label = label
            self.clearLabel = clearLabel
            self.sharedCreditLimit = sharedCreditLimit
            self.clearSharedCreditLimit = clearSharedCreditLimit
            self.billingDay = billingDay
            self.clearBillingDay = clearBillingDay
            self.dueType = dueType
            self.clearDueType = clearDueType
            self.dueValue = dueValue
            self.clearDueValue = clearDueValue
            self.statementMode = statementMode
            self.quotaMode = quotaMode
        }
    }

    private struct UserDisplayPreferencesEnvelope: Decodable {
        let userId: String
        let displayConfig: UserDisplayConfig

        enum CodingKeys: String, CodingKey {
            case userId = "user_id"
            case displayConfig = "display_config"
        }
    }

    @discardableResult
    public func createBill(input: CreateBillInput) async throws -> Bill {
        let payload = try encodeToAnyCodable(input)
        return try await rpc(module: "bills", function: "createBill", args: [payload])
    }

    @discardableResult
    public func createBill(
        cardId: String,
        billMonth: String,
        dueDate: String,
        billAmount: Double,
        minPayment: Double? = nil,
        statementStart: String? = nil,
        statementEnd: String? = nil,
        statementDate: String? = nil,
        accountId: String? = nil,
        status: String = "unpaid",
        subtotals: [CreateBillSubtotalInput]? = nil
    ) async throws -> Bill {
        try await createBill(input: CreateBillInput(
            cardId: cardId,
            billMonth: billMonth,
            dueDate: dueDate,
            billAmount: billAmount,
            minPayment: minPayment,
            statementStart: statementStart,
            statementEnd: statementEnd,
            statementDate: statementDate,
            accountId: accountId,
            status: status,
            subtotals: subtotals
        ))
    }

    public func deleteBill(billId: String) async throws {
        try await rpcVoid(module: "bills", function: "deleteBill", args: [AnyCodable(billId)])
    }

    @discardableResult
    public func updatePayment(
        paymentId: String,
        amount: Double? = nil,
        paidAt: String? = nil,
        channel: String? = nil,
        note: String? = nil,
        clearChannel: Bool = false,
        clearNote: Bool = false
    ) async throws -> Payment {
        var patch: [String: Any] = [:]
        if let amount { patch["amount"] = amount }
        if let paidAt { patch["paid_at"] = paidAt }
        if clearChannel {
            patch["channel"] = NSNull()
        } else if let channel {
            patch["channel"] = channel
        }
        if clearNote {
            patch["note"] = NSNull()
        } else if let note {
            patch["note"] = note
        }
        return try await rpc(
            module: "payments",
            function: "updatePayment",
            args: [AnyCodable(paymentId), AnyCodable(patch)]
        )
    }

    public func deletePayment(paymentId: String) async throws {
        try await rpcVoid(module: "payments", function: "deletePayment", args: [AnyCodable(paymentId)])
    }

    @discardableResult
    public func mergeCardsIntoAccount(targetAccountId: String, cardIds: [String]) async throws -> MergeAccountResult {
        try await rpc(
            module: "accounts",
            function: "mergeCardsIntoAccount",
            args: [AnyCodable(targetAccountId), AnyCodable(cardIds)]
        )
    }

    @discardableResult
    public func splitCardFromAccount(cardId: String) async throws -> CreditAccount {
        try await rpc(
            module: "accounts",
            function: "splitCardFromAccount",
            args: [AnyCodable(cardId)]
        )
    }

    @discardableResult
    public func updateCreditAccount(
        accountId: String,
        input: UpdateCreditAccountInput
    ) async throws -> CreditAccount {
        var patch: [String: Any] = [:]
        if input.clearLabel {
            patch["label"] = NSNull()
        } else if let label = input.label {
            patch["label"] = label
        }
        if input.clearSharedCreditLimit {
            patch["shared_credit_limit"] = NSNull()
        } else if let sharedCreditLimit = input.sharedCreditLimit {
            patch["shared_credit_limit"] = sharedCreditLimit
        }
        if input.clearBillingDay {
            patch["billing_day"] = NSNull()
        } else if let billingDay = input.billingDay {
            patch["billing_day"] = billingDay
        }
        if input.clearDueType {
            patch["due_type"] = NSNull()
        } else if let dueType = input.dueType {
            patch["due_type"] = dueType.rawValue
        }
        if input.clearDueValue {
            patch["due_value"] = NSNull()
        } else if let dueValue = input.dueValue {
            patch["due_value"] = dueValue
        }
        if let statementMode = input.statementMode {
            patch["statement_mode"] = statementMode
        }
        if let quotaMode = input.quotaMode {
            patch["quota_mode"] = quotaMode
        }
        return try await rpc(
            module: "accounts",
            function: "updateCreditAccount",
            args: [AnyCodable(accountId), AnyCodable(patch)]
        )
    }

    @discardableResult
    public func updateCreditAccount(
        accountId: String,
        label: String? = nil,
        sharedCreditLimit: Double? = nil,
        billingDay: Int? = nil,
        dueType: PaymentDueType? = nil,
        dueValue: Int? = nil,
        statementMode: String? = nil,
        quotaMode: String? = nil
    ) async throws -> CreditAccount {
        try await updateCreditAccount(
            accountId: accountId,
            input: UpdateCreditAccountInput(
                label: label,
                sharedCreditLimit: sharedCreditLimit,
                billingDay: billingDay,
                dueType: dueType,
                dueValue: dueValue,
                statementMode: statementMode,
                quotaMode: quotaMode
            )
        )
    }

    @discardableResult
    public func updateDisplayPreferences(_ config: UserDisplayConfig) async throws -> UserDisplayConfig {
        let displayPayload = try encodeToAnyCodable(config)
        let envelope: UserDisplayPreferencesEnvelope = try await rpc(
            module: "preferences",
            function: "updateUserPreferences",
            args: [AnyCodable(""), AnyCodable(["display_config": displayPayload.value])]
        )
        return envelope.displayConfig
    }

    private func encodeToAnyCodable<T: Encodable>(_ value: T) throws -> AnyCodable {
        let data = try JSONEncoder().encode(value)
        return try JSONDecoder().decode(AnyCodable.self, from: data)
    }

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

    public func refreshSession(failedToken: String? = nil) async throws -> SessionUser {
        if let failedToken {
            let cached: SessionUser? = stateLock.withLock {
                guard let active = currentTokenLocked(), !active.isEmpty, active != failedToken else {
                    return nil
                }
                return inMemoryUser
            }
            if let cached {
                return cached
            }
        }
        enum RefreshJoin {
            case existing(Task<SessionUser, Error>)
            case created(Task<SessionUser, Error>)
        }
        let join: RefreshJoin = refreshStateLock.withLock {
            if let existing = refreshTask {
                return .existing(existing)
            }
            let task = Task<SessionUser, Error> { [self] in
                defer { refreshStateLock.withLock { refreshTask = nil } }
                if let failedToken {
                    let cached: SessionUser? = stateLock.withLock {
                        guard let active = currentTokenLocked(), !active.isEmpty, active != failedToken else {
                            return nil
                        }
                        return inMemoryUser
                    }
                    if let cached {
                        return cached
                    }
                }
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
                if httpRes.statusCode == 200 {
                    let tokenRes = try JSONDecoder().decode(TokenResponse.self, from: data)
                    self.token = tokenRes.token
                    if let newRefresh = tokenRes.refreshToken {
                        storeRefreshToken(newRefresh)
                    }
                    stateLock.withLock { inMemoryUser = tokenRes.user }
                    Self.syncLogger.info("Session refreshed silently")
                    return tokenRes.user
                }
                let envelope = try? JSONDecoder().decode(RPCErrorEnvelope.self, from: data)
                if httpRes.statusCode == 400 || httpRes.statusCode == 401 || httpRes.statusCode == 403 {
                    // 明确凭据无效/过期/被吊销：清理两套凭据，抛 401 由调用方回登录页
                    Self.syncLogger.error("Session refresh rejected with status \(httpRes.statusCode, privacy: .public)")
                    storeRefreshToken(nil)
                    self.token = nil
                    throw NSError(
                        domain: "ApiClient",
                        code: 401,
                        userInfo: [NSLocalizedDescriptionKey: envelope?.error ?? "登录已过期"]
                    )
                }
                // 429 / 5xx 等瞬态异常不得清空有效凭据，保留待后续重试
                Self.syncLogger.error("Session refresh transient failure status \(httpRes.statusCode, privacy: .public)")
                throw NSError(
                    domain: "ApiClient",
                    code: httpRes.statusCode,
                    userInfo: [NSLocalizedDescriptionKey: envelope?.error ?? "刷新会话失败 (\(httpRes.statusCode))"]
                )
            }
            refreshTask = task
            return .created(task)
        }
        switch join {
        case .existing(let task), .created(let task):
            return try await task.value
        }
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
        case let nested as AnyCodable:
            try nested.encode(to: encoder)
        case let bool as Bool where type(of: value) == Bool.self:
            try container.encode(bool)
        case let int as Int where type(of: value) == Int.self:
            try container.encode(int)
        case let int64 as Int64 where type(of: value) == Int64.self:
            try container.encode(int64)
        case let double as Double where type(of: value) == Double.self:
            try container.encode(double)
        default:
            #if canImport(CoreFoundation)
            if let number = value as? NSNumber {
                if CFGetTypeID(number) == CFBooleanGetTypeID() {
                    try container.encode(number.boolValue)
                    return
                }
                if CFNumberIsFloatType(number) {
                    try container.encode(number.doubleValue)
                    return
                }
                try container.encode(number.int64Value)
                return
            }
            #endif
            switch value {
            case let bool as Bool:
                try container.encode(bool)
            case let int as Int:
                try container.encode(int)
            case let int64 as Int64:
                try container.encode(int64)
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
}
