import Foundation
import Security

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

    enum CodingKeys: String, CodingKey {
        case token, user
        case tokenType = "token_type"
        case expiresIn = "expires_in"
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

public protocol NetworkSession: Sendable {
    func data(for request: URLRequest) async throws -> (Data, URLResponse)
}

extension URLSession: NetworkSession {}

public final class ApiClient: @unchecked Sendable {
    public let baseURL: URL
    public let session: NetworkSession
    private var inMemoryToken: String?
    private let useKeychain: Bool

    public init(baseURL: URL, session: NetworkSession = URLSession.shared, token: String? = nil, useKeychain: Bool = true) {
        self.baseURL = baseURL
        self.session = session
        self.inMemoryToken = token
        self.useKeychain = useKeychain
    }

    public var token: String? {
        get { inMemoryToken ?? (useKeychain ? readKeychainToken() : nil) }
        set {
            inMemoryToken = newValue
            guard useKeychain else { return }
            if let newValue {
                saveKeychainToken(newValue)
            } else {
                deleteKeychainToken()
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
    public func loginWithGoogle(idToken: String) async throws -> SessionUser {
        try await exchangeToken(["grant_type": "google", "id_token": idToken])
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

    // MARK: - Keychain Helpers

    private let keychainAccount = "com.chunfenshijie.worldcredit.sessionToken"
    private let keychainService = "com.chunfenshijie.worldcredit"

    private func saveKeychainToken(_ token: String) {
        let data = Data(token.utf8)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainAccount,
        ]
        SecItemDelete(query as CFDictionary)
        var newQuery = query
        newQuery[kSecValueData as String] = data
        newQuery[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(newQuery as CFDictionary, nil)
    }

    private func readKeychainToken() -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainAccount,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess, let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private func deleteKeychainToken() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainAccount,
        ]
        SecItemDelete(query as CFDictionary)
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
