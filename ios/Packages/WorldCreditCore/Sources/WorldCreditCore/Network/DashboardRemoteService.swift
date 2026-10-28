import Foundation

public enum DashboardRemoteSource: String, CaseIterable, Hashable, Sendable {
    case preferences, availableCount, reminders, exchangeRates
}

public struct DashboardRemoteFailure: Error, Equatable, Sendable {
    public let message: String
    public let code: Int

    init(_ error: any Error) {
        message = error.localizedDescription
        code = (error as NSError).code
    }
}

public struct DashboardDisplayPreferences: Equatable, Sendable {
    public let displayCurrency: String
    public let privacyMode: Bool
}

public struct DashboardReminder: Codable, Equatable, Identifiable, Sendable {
    public struct Event: Codable, Equatable, Sendable {
        public let eventKey: String
        public let kind: String
        public let accountId: String?
        public let cycleId: String?
        public let title: String
        public let localDateOn: String
        public let timeZone: String
        public let deadlineBefore: String?
        public let actionHint: String
        public let needsReview: Bool

        enum CodingKeys: String, CodingKey {
            case kind, title
            case eventKey = "event_key", accountId = "account_id", cycleId = "cycle_id"
            case localDateOn = "local_date_on", timeZone = "time_zone", deadlineBefore = "deadline_before"
            case actionHint = "action_hint", needsReview = "needs_review"
        }
    }

    public struct State: Codable, Equatable, Sendable {
        public let readSteps: [String]
        public let dismissedAt: String?
        public let snoozeUntil: String?
        public let revision: Int

        enum CodingKeys: String, CodingKey {
            case revision
            case readSteps = "read_steps", dismissedAt = "dismissed_at", snoozeUntil = "snooze_until"
        }
    }

    public let event: Event
    public let state: State
    public var id: String { event.eventKey }
    public var eventKey: String { event.eventKey }
    public var title: String { event.title }
    public var localDateOn: String { event.localDateOn }
    public var actionHint: String { event.actionHint }
}

/// Network DTO, deliberately independent from the Domain FX calculation model.
public struct DashboardExchangeRates: Codable, Equatable, Sendable {
    public let base: String
    public let rates: [String: Double]
    /// Source timestamp in seconds; freshness is based on fetchedAt, never this value.
    public let timestamp: Double
    public let fetchedAt: Date
}

/// Nil means unavailable, not zero/false. Each source fails independently of local bill data.
public struct DashboardRemoteSnapshot: Sendable {
    public var displayCurrency: String?
    public var privacyMode: Bool?
    public var availableCount: Int?
    public var reminders: [DashboardReminder]?
    public var exchangeRates: DashboardExchangeRates?
    public var failures: [DashboardRemoteSource: DashboardRemoteFailure] = [:]

    public init() {}
}

/// Sendable rate cache. The production wrapper is UserDefaults-backed and isolated by key (user).
public protocol DashboardRateCaching: Sendable {
    func read(_ key: String) -> Data?
    func write(_ data: Data, forKey key: String)
    func remove(_ key: String)
}

public struct UserDefaultsRateCache: DashboardRateCaching {
    /// UserDefaults API is thread-safe; this reference is never accessed concurrently by the service actor.
    private nonisolated(unsafe) let defaults: UserDefaults

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    public func read(_ key: String) -> Data? { defaults.data(forKey: key) }
    public func write(_ data: Data, forKey key: String) { defaults.set(data, forKey: key) }
    public func remove(_ key: String) { defaults.removeObject(forKey: key) }
}

public actor DashboardRemoteService {
    public static let ratesTTL: TimeInterval = 6 * 60 * 60
    private let apiClient: ApiClient
    private let session: any NetworkSession
    private let cache: any DashboardRateCaching
    private let now: @Sendable () -> Date
    // A completed request from before logout must not repopulate its cleared cache.
    private var cacheGenerations: [String: Int] = [:]

    public init(apiClient: ApiClient, session: any NetworkSession = URLSession.shared,
                cache: any DashboardRateCaching = UserDefaultsRateCache(),
                now: @escaping @Sendable () -> Date = { Date() }) {
        self.apiClient = apiClient
        self.session = session
        self.cache = cache
        self.now = now
    }

    public func fetch(userId: String) async -> DashboardRemoteSnapshot {
        async let preferences = capture { try await self.fetchPreferences(userId: userId) }
        async let count = capture { try await self.fetchAvailableCount() }
        async let reminders = capture { try await self.fetchReminders() }
        async let rates = capture { try await self.fetchRates(userId: userId) }
        var snapshot = DashboardRemoteSnapshot()
        switch await preferences {
        case .success(let value):
            snapshot.displayCurrency = value.displayCurrency
            snapshot.privacyMode = value.privacyMode
        case .failure(let error): snapshot.failures[.preferences] = error
        }
        switch await count {
        case .success(let value): snapshot.availableCount = value
        case .failure(let error): snapshot.failures[.availableCount] = error
        }
        switch await reminders {
        case .success(let value): snapshot.reminders = value
        case .failure(let error): snapshot.failures[.reminders] = error
        }
        switch await rates {
        case .success(let value): snapshot.exchangeRates = value
        case .failure(let error): snapshot.failures[.exchangeRates] = error
        }
        return snapshot
    }

    public func fetchPreferences(userId: String) async throws -> DashboardDisplayPreferences {
        try validateUserId(userId)
        let value: PreferencesEnvelope = try await apiClient.rpc(
            module: "preferences", function: "getUserPreferences", args: [AnyCodable(userId)])
        return try displayPreferences(value, userId: userId)
    }

    /// Only provided display fields are patched; other user settings stay server-owned.
    public func updatePreferences(userId: String, privacyMode: Bool? = nil,
                                  displayCurrency: String? = nil) async throws -> DashboardDisplayPreferences {
        try validateUserId(userId)
        var display: [String: Any] = [:]
        if let privacyMode { display["privacy_mode"] = privacyMode }
        if let displayCurrency {
            guard let normalized = Self.currencyCode(displayCurrency) else { throw URLError(.badServerResponse) }
            display["default_currency"] = normalized
        }
        guard !display.isEmpty else { throw URLError(.badURL) }
        let value: PreferencesEnvelope = try await apiClient.rpc(
            module: "preferences", function: "updateUserPreferences",
            args: [AnyCodable(userId), AnyCodable(["display_config": display])])
        return try displayPreferences(value, userId: userId)
    }

    public func fetchAvailableCount() async throws -> Int {
        let count: Int = try await apiClient.rpc(module: "dashboard", function: "getOpportunityTodayCount")
        guard count >= 0 else { throw URLError(.badServerResponse) }
        return count
    }

    /// The dashboard previews the first 30 pending reminders; it is not a total-count API.
    public func fetchReminders() async throws -> [DashboardReminder] {
        let page: ReminderPage = try await apiClient.rpc(
            module: "opportunities", function: "getOpportunityReminders", args: [AnyCodable(["limit": 30])])
        return page.items
    }

    /// Returns only fresh rates. Expired/corrupt/future-dated cache entries require a network fetch.
    public func fetchRates(userId: String) async throws -> DashboardExchangeRates {
        try validateUserId(userId)
        let key = cacheKey(userId)
        let current = now()
        if let data = cache.read(key),
           let cached = try? JSONDecoder().decode(DashboardExchangeRates.self, from: data),
           validRates(cached), current.timeIntervalSince(cached.fetchedAt) >= 0,
           current.timeIntervalSince(cached.fetchedAt) < Self.ratesTTL {
            return cached
        }
        let generation = cacheGenerations[userId, default: 0]
        var request = URLRequest(url: URL(string: "https://api.exchangerate.fun/latest")!,
                                 cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 4)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            throw URLError(.badServerResponse)
        }
        try Task.checkCancellation()
        let payload = try JSONDecoder().decode(RatesPayload.self, from: data)
        guard let base = Self.currencyCode(payload.base) else { throw URLError(.badServerResponse) }
        var rates: [String: Double] = [:]
        for (key, value) in payload.rates {
            guard let code = Self.currencyCode(key), let rate = value.number, rate.isFinite, rate > 0 else { continue }
            rates[code] = rate
        }
        let value = DashboardExchangeRates(base: base, rates: rates, timestamp: payload.timestamp ?? 0, fetchedAt: now())
        guard validRates(value) else { throw URLError(.badServerResponse) }
        if generation == cacheGenerations[userId, default: 0] {
            cache.write(try JSONEncoder().encode(value), forKey: key)
        }
        return value
    }

    public func clearCache(userId: String) {
        cacheGenerations[userId, default: 0] += 1
        cache.remove(cacheKey(userId))
    }

    private func cacheKey(_ userId: String) -> String {
        "worldcredit.dashboard.fx.v1." + Data(userId.utf8).base64EncodedString()
    }

    private func validRates(_ value: DashboardExchangeRates) -> Bool {
        Self.currencyCode(value.base) == value.base && value.timestamp.isFinite &&
        value.fetchedAt.timeIntervalSince1970.isFinite && !value.rates.isEmpty &&
        value.rates.allSatisfy { Self.currencyCode($0.key) == $0.key && $0.value.isFinite && $0.value > 0 }
    }

    private func validateUserId(_ userId: String) throws {
        guard !userId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw URLError(.badURL) }
    }

    private static func currencyCode(_ raw: String) -> String? {
        let code = raw.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        return code.utf8.count == 3 && code.utf8.allSatisfy { (65...90).contains($0) } ? code : nil
    }

    private func displayPreferences(_ value: PreferencesEnvelope, userId: String) throws -> DashboardDisplayPreferences {
        guard value.userId == userId, let currency = Self.currencyCode(value.display.currency) else {
            throw URLError(.badServerResponse)
        }
        return DashboardDisplayPreferences(displayCurrency: currency, privacyMode: value.display.privacyMode)
    }

    private func capture<Value: Sendable>(_ operation: @Sendable () async throws -> Value) async -> Result<Value, DashboardRemoteFailure> {
        do { return .success(try await operation()) }
        catch { return .failure(DashboardRemoteFailure(error)) }
    }

    private struct PreferencesEnvelope: Decodable, Sendable {
        struct Display: Decodable, Sendable {
            let privacyMode: Bool
            let currency: String
            enum CodingKeys: String, CodingKey { case privacyMode = "privacy_mode", currency = "default_currency" }
        }
        let userId: String
        let display: Display
        enum CodingKeys: String, CodingKey { case userId = "user_id", display = "display_config" }
    }

    private struct ReminderPage: Decodable, Sendable {
        let items: [DashboardReminder]
    }

    private struct RatesPayload: Decodable {
        let base: String
        let rates: [String: StrictRate]
        let timestamp: Double?
    }

    private struct StrictRate: Decodable {
        let number: Double?
        init(from decoder: Decoder) throws {
            let container = try decoder.singleValueContainer()
            // Intentionally no string/boolean conversion. Invalid entries are excluded.
            number = try? container.decode(Double.self)
        }
    }
}
