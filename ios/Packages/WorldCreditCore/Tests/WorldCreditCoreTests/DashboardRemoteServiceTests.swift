import Foundation
import Testing
@testable import WorldCreditCore

@Suite("Dashboard remote sources, RPC contracts and isolated FX cache")
struct DashboardRemoteServiceTests {
    private let preferences = #"{"data":{"user_id":"alice","display_config":{"privacy_mode":true,"default_currency":"USD","show_min_payment":true},"reminder_config":{}},"error":null}"#
    private let reminders = #"{"data":{"items":[{"event":{"event_key":"op:expiry:1","kind":"cycle_expiry","account_id":"a1","cycle_id":null,"title":"机场贵宾厅","local_date_on":"2026-10-23","time_zone":"Asia/Shanghai","deadline_before":"2026-10-24","action_hint":"使用权益","needs_review":false},"state":{"read_steps":[],"dismissed_at":null,"snooze_until":null,"revision":0}}],"next_cursor":"more"},"error":null}"#
    private let rates = #"{"base":"USD","timestamp":1792713600,"rates":{"USD":1,"CNY":7.1,"HKD":7.8}}"#

    private func response(_ request: URLRequest, _ json: String, status: Int = 200) -> (Data, URLResponse) {
        (Data(json.utf8), HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!)
    }

    private func client(_ session: any NetworkSession, token: String? = "session-token") -> ApiClient {
        ApiClient(baseURL: URL(string: "https://test.local")!, session: session, token: token, useKeychain: false)
    }

    private func isolatedDefaults() -> UserDefaults {
        UserDefaults(suiteName: "DashboardRemoteTests.\(UUID().uuidString)")!
    }

    @Test("All sources decode real server envelopes and send exact authenticated RPC arguments")
    func fetchContract() async throws {
        let session = MockNetworkSession { request in
            if request.url?.host == "api.exchangerate.fun" {
                #expect(request.httpMethod == "GET")
                #expect(request.timeoutInterval == 4)
                #expect(request.value(forHTTPHeaderField: "Authorization") == nil)
                #expect(request.cachePolicy == .reloadIgnoringLocalCacheData)
                return response(request, rates)
            }
            #expect(request.httpMethod == "POST")
            #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer session-token")
            #expect(request.value(forHTTPHeaderField: "Content-Type") == "application/json")
            let requestBody = try #require(request.httpBody)
            let body = try #require(JSONSerialization.jsonObject(with: requestBody) as? [String: Any])
            let args = try #require(body["args"] as? [Any])
            switch request.url!.path {
            case "/api/rpc/preferences/getUserPreferences":
                #expect(args as? [String] == ["alice"])
                return response(request, preferences)
            case "/api/rpc/dashboard/getOpportunityTodayCount":
                #expect(args.isEmpty)
                return response(request, #"{"data":7,"error":null}"#)
            case "/api/rpc/opportunities/getOpportunityReminders":
                #expect((args.first as? [String: Any])?["limit"] as? Int == 30)
                return response(request, reminders)
            default:
                Issue.record("Unexpected path \(request.url!.path)")
                throw URLError(.badURL)
            }
        }
        let service = DashboardRemoteService(apiClient: client(session), session: session, cache: UserDefaultsRateCache(defaults: isolatedDefaults()))
        let result = await service.fetch(userId: "alice")
        #expect(result.failures.isEmpty)
        #expect(result.displayCurrency == "USD")
        #expect(result.privacyMode == true)
        #expect(result.availableCount == 7)
        #expect(result.reminders?.first?.event.title == "机场贵宾厅")
        #expect(result.reminders?.first?.event.localDateOn == "2026-10-23")
        #expect(result.reminders?.first?.state.revision == 0)
        #expect(result.exchangeRates?.rates["CNY"] == 7.1)
    }

    @Test("Each failed source preserves every other successful source", arguments: DashboardRemoteSource.allCases)
    func partialFailure(source: DashboardRemoteSource) async {
        let session = MockNetworkSession { request in
            let actual: DashboardRemoteSource
            let json: String
            switch request.url!.lastPathComponent {
            case "getUserPreferences": actual = .preferences; json = preferences
            case "getOpportunityTodayCount": actual = .availableCount; json = #"{"data":0,"error":null}"#
            case "getOpportunityReminders": actual = .reminders; json = reminders
            default: actual = .exchangeRates; json = rates
            }
            if actual == source { throw URLError(.timedOut) }
            return response(request, json)
        }
        let service = DashboardRemoteService(apiClient: client(session), session: session, cache: UserDefaultsRateCache(defaults: isolatedDefaults()))
        let result = await service.fetch(userId: "alice")
        #expect(Set(result.failures.keys) == [source])
        #expect((result.displayCurrency == nil) == (source == .preferences))
        #expect((result.privacyMode == nil) == (source == .preferences))
        #expect((result.availableCount == nil) == (source == .availableCount))
        #expect((result.reminders == nil) == (source == .reminders))
        #expect((result.exchangeRates == nil) == (source == .exchangeRates))
    }

    @Test("Total outage returns explicit failures, never fabricated zero or false")
    func allSourcesFail() async {
        let session = MockNetworkSession { _ in throw URLError(.notConnectedToInternet) }
        let service = DashboardRemoteService(apiClient: client(session), session: session, cache: UserDefaultsRateCache(defaults: isolatedDefaults()))
        let result = await service.fetch(userId: "alice")
        #expect(result.failures.count == 4)
        #expect(result.availableCount == nil && result.reminders == nil)
        #expect(result.privacyMode == nil && result.displayCurrency == nil && result.exchangeRates == nil)
    }

    @Test("Display updates patch only provided fields", arguments: [true, false])
    func updatePreferences(privacyOnly: Bool) async throws {
        let session = MockNetworkSession { request in
            #expect(request.url?.path == "/api/rpc/preferences/updateUserPreferences")
            let requestBody = try #require(request.httpBody)
            let body = try #require(JSONSerialization.jsonObject(with: requestBody) as? [String: Any])
            let args = try #require(body["args"] as? [Any])
            #expect(args.count == 2)
            #expect(args[0] as? String == "alice")
            let patch = try #require(args[1] as? [String: Any])
            #expect(Set(patch.keys) == ["display_config"])
            let display = try #require(patch["display_config"] as? [String: Any])
            #expect(display.count == 1)
            if privacyOnly { #expect(display["privacy_mode"] as? Bool == true) }
            else { #expect(display["default_currency"] as? String == "USD") }
            return response(request, preferences)
        }
        let service = DashboardRemoteService(apiClient: client(session), cache: UserDefaultsRateCache(defaults: isolatedDefaults()))
        let result = try await service.updatePreferences(userId: "alice", privacyMode: privacyOnly ? true : nil,
                                                         displayCurrency: privacyOnly ? nil : " usd ")
        #expect(result.displayCurrency == "USD" && result.privacyMode)
    }

    @Test("RPC rejects HTTP, envelope, malformed and missing-data failures", arguments: [401, 403, 500, 200, 201, 202])
    func rpcFailures(status: Int) async {
        let session = MockNetworkSession { request in
            let json = status == 201 ? "not json" : status == 202 ? #"{"data":null,"error":null}"# : #"{"data":null,"error":"拒绝请求"}"#
            return response(request, json, status: status)
        }
        let service = DashboardRemoteService(apiClient: client(session), cache: UserDefaultsRateCache(defaults: isolatedDefaults()))
        await #expect(throws: (any Error).self) { try await service.fetchAvailableCount() }
    }

    @Test("Missing authentication fails without reaching the network")
    func noAuthentication() async {
        let session = MockNetworkSession { _ in
            Issue.record("Unauthenticated RPC reached network")
            throw URLError(.unknown)
        }
        let service = DashboardRemoteService(apiClient: client(session, token: nil), cache: UserDefaultsRateCache(defaults: isolatedDefaults()))
        await #expect(throws: (any Error).self) { try await service.fetchPreferences(userId: "alice") }
    }

    @Test("Preference ownership and invalid count are rejected")
    func invalidRpcData() async {
        let session = MockNetworkSession { request in
            response(request, request.url?.lastPathComponent == "getUserPreferences" ? preferences : #"{"data":-1,"error":null}"#)
        }
        let service = DashboardRemoteService(apiClient: client(session), cache: UserDefaultsRateCache(defaults: isolatedDefaults()))
        await #expect(throws: (any Error).self) { try await service.fetchPreferences(userId: "bob") }
        await #expect(throws: (any Error).self) { try await service.fetchAvailableCount() }
    }

    @Test("FX cache survives service recreation, retains timestamp and expires at six hours")
    func ratesTTL() async throws {
        let defaults = isolatedDefaults()
        let clock = Date(timeIntervalSince1970: 1_800_000_000)
        let session = MockNetworkSession { request in response(request, rates) }
        let first = DashboardRemoteService(apiClient: client(session), session: session, cache: UserDefaultsRateCache(defaults: defaults), now: { clock })
        let original = try await first.fetchRates(userId: "alice")
        #expect(original.fetchedAt == clock)
        let offline = MockNetworkSession { _ in throw URLError(.notConnectedToInternet) }
        let cached = DashboardRemoteService(apiClient: client(offline), session: offline, cache: UserDefaultsRateCache(defaults: defaults),
                                            now: { clock.addingTimeInterval(21_599) })
        #expect(try await cached.fetchRates(userId: "alice") == original)
        let expired = DashboardRemoteService(apiClient: client(offline), session: offline, cache: UserDefaultsRateCache(defaults: defaults),
                                             now: { clock.addingTimeInterval(21_600) })
        await #expect(throws: URLError(.notConnectedToInternet)) { try await expired.fetchRates(userId: "alice") }
        let backwards = DashboardRemoteService(apiClient: client(offline), session: offline, cache: UserDefaultsRateCache(defaults: defaults),
                                               now: { clock.addingTimeInterval(-1) })
        await #expect(throws: URLError(.notConnectedToInternet)) { try await backwards.fetchRates(userId: "alice") }
    }

    @Test("FX cache never crosses users and stores no credentials")
    func ratesUserIsolation() async throws {
        let defaults = isolatedDefaults()
        let online = MockNetworkSession { request in response(request, rates) }
        let service = DashboardRemoteService(apiClient: client(online), session: online, cache: UserDefaultsRateCache(defaults: defaults))
        _ = try await service.fetchRates(userId: "alice")
        let offline = MockNetworkSession { _ in throw URLError(.notConnectedToInternet) }
        let other = DashboardRemoteService(apiClient: client(offline), session: offline, cache: UserDefaultsRateCache(defaults: defaults))
        await #expect(throws: URLError(.notConnectedToInternet)) { try await other.fetchRates(userId: "bob") }
        let stored = defaults.dictionaryRepresentation().filter { $0.key.hasPrefix("worldcredit.dashboard.") }
        #expect(stored.count == 1)
        for value in stored.values {
            let data = try #require(value as? Data)
            #expect(String(data: data, encoding: .utf8)?.contains("session-token") == false)
        }
    }

    @Test("FX invalid entries are excluded without coercing strings or booleans")
    func strictRates() async throws {
        let session = MockNetworkSession { request in
            response(request, #"{"base":" usd ","timestamp":123,"fetched_at":9999999999999,"rates":{"usd":1,"CNY":7.1,"HKD":0,"EUR":-1,"GBP":"1.3","JPY":true,"BADCODE":2}}"#)
        }
        let now = Date(timeIntervalSince1970: 1000)
        let service = DashboardRemoteService(apiClient: client(session), session: session, cache: UserDefaultsRateCache(defaults: isolatedDefaults()), now: { now })
        let result = try await service.fetchRates(userId: "alice")
        #expect(result.base == "USD")
        #expect(result.rates == ["USD": 1, "CNY": 7.1])
        #expect(result.fetchedAt == now)
    }

    @Test("Invalid FX bodies cannot create a cache", arguments: [
        #"{"base":"USD","rates":{}}"#,
        #"{"base":"USD","rates":{"CNY":0}}"#,
        #"{"base":"USD","rates":{"CNY":1e999}}"#,
        #"{"base":"bad!","rates":{"CNY":7}}"#,
        "null", "garbled"
    ])
    func invalidRates(json: String) async {
        let session = MockNetworkSession { request in response(request, json) }
        let defaults = isolatedDefaults()
        let service = DashboardRemoteService(apiClient: client(session), session: session, cache: UserDefaultsRateCache(defaults: defaults))
        await #expect(throws: (any Error).self) { try await service.fetchRates(userId: "alice") }
        #expect(defaults.dictionaryRepresentation().filter { $0.key.hasPrefix("worldcredit.dashboard.") }.isEmpty)
    }

    @Test("Session restoration reads authenticated user without changing credentials")
    func restoreSession() async throws {
        let session = MockNetworkSession { request in
            #expect(request.url?.path == "/api/auth/session")
            #expect(request.httpMethod == "GET")
            #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer session-token")
            return response(request, #"{"user":{"id":"alice","email":"a@example.test","role":"member","created_at":"2026-01-01","name":null}}"#)
        }
        let api = client(session)
        #expect(try await api.fetchSessionUser().id == "alice")
        #expect(api.token == "session-token")
    }

    @Test("Null session is treated as unauthenticated")
    func missingSession() async {
        let session = MockNetworkSession { request in response(request, #"{"user":null}"#) }
        await #expect(throws: (any Error).self) { try await client(session).fetchSessionUser() }
    }

    @Test("Clearing one user's cache preserves other users")
    func clearCache() async throws {
        let defaults = isolatedDefaults()
        let session = MockNetworkSession { request in response(request, rates) }
        let service = DashboardRemoteService(apiClient: client(session), session: session, cache: UserDefaultsRateCache(defaults: defaults))
        _ = try await service.fetchRates(userId: "alice")
        _ = try await service.fetchRates(userId: "bob")
        await service.clearCache(userId: "alice")
        let offline = MockNetworkSession { _ in throw URLError(.notConnectedToInternet) }
        let reader = DashboardRemoteService(apiClient: client(offline), session: offline, cache: UserDefaultsRateCache(defaults: defaults))
        await #expect(throws: URLError(.notConnectedToInternet)) { try await reader.fetchRates(userId: "alice") }
        #expect(try await reader.fetchRates(userId: "bob").base == "USD")
    }

    @Test("FX HTTP errors are not cached even with a valid body")
    func ratesHTTPFailure() async {
        let session = MockNetworkSession { request in response(request, rates, status: 503) }
        let service = DashboardRemoteService(apiClient: client(session), session: session, cache: UserDefaultsRateCache(defaults: isolatedDefaults()))
        await #expect(throws: (any Error).self) { try await service.fetchRates(userId: "alice") }
    }
}
