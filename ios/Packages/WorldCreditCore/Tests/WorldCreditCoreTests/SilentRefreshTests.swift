import Foundation
import Testing
@testable import WorldCreditCore

/// 静默续期：refresh token 一次性轮换、失败清理凭据、并发触发只续一次。
@Suite("Silent session refresh")
struct SilentRefreshTests {
    private let baseURL = URL(string: "https://test.local")!

    private func loginBody(refresh: String?) -> String {
        var json = #"{"token":"session-token","token_type":"Bearer","expires_in":604800,"user":{"id":"u1","email":"a@b.com","name":"A","role":"member","created_at":"2026-01-01T00:00:00Z"}}"#
        if let refresh {
            json = json.dropLast() + #","refresh_token":"\#(refresh)"}"#
        }
        return json
    }

    @Test("Login persists the refresh token from the token endpoint")
    func loginStoresRefreshToken() async throws {
        let session = MockNetworkSession { request in
            let body = Data(self.loginBody(refresh: "refresh-1").utf8)
            return (body, HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
        }
        let client = ApiClient(baseURL: baseURL, session: session, useKeychain: false)
        _ = try await client.loginWithPassword(email: "a@b.c", password: "pw")
        #expect(client.token == "session-token")
        #expect(client.refreshToken == "refresh-1")
    }

    @Test("Refresh posts the current token, rotates it and swaps the access token")
    func refreshRotates() async throws {
        let session = MockNetworkSession { request in
            if request.url?.path == "/api/auth/token" {
                let body = Data(self.loginBody(refresh: "refresh-1").utf8)
                return (body, HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
            }
            #expect(request.url?.path == "/api/auth/refresh")
            let body = try #require(JSONSerialization.jsonObject(with: request.httpBody!) as? [String: String])
            #expect(body["refresh_token"] == "refresh-1")
            let payload = Data(self.loginBody(refresh: "refresh-2").utf8)
            return (payload, HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
        }
        let client = ApiClient(baseURL: baseURL, session: session, useKeychain: false)
        _ = try await client.loginWithPassword(email: "a@b.c", password: "pw")

        let user = try await client.refreshSession()
        #expect(user.id == "u1")
        #expect(client.token == "session-token")
        #expect(client.refreshToken == "refresh-2")
    }

    @Test("Failed refresh clears both credentials and surfaces 401")
    func refreshFailureClearsCredentials() async throws {
        let session = MockNetworkSession { request in
            if request.url?.path == "/api/auth/token" {
                let body = Data(self.loginBody(refresh: "refresh-1").utf8)
                return (body, HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
            }
            let body = Data(#"{"error":"refresh token 无效或已过期"}"#.utf8)
            return (body, HTTPURLResponse(url: request.url!, statusCode: 401, httpVersion: nil, headerFields: nil)!)
        }
        let client = ApiClient(baseURL: baseURL, session: session, useKeychain: false)
        _ = try await client.loginWithPassword(email: "a@b.c", password: "pw")
        #expect(client.refreshToken == "refresh-1")

        await #expect(throws: NSError.self) {
            _ = try await client.refreshSession()
        }
        #expect(client.token == nil)
        #expect(client.refreshToken == nil)
    }

    @Test("Logout drops the refresh token alongside the access token")
    func logoutDropsRefreshToken() async throws {
        let session = MockNetworkSession { request in
            let body = Data(self.loginBody(refresh: "refresh-1").utf8)
            return (body, HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
        }
        let client = ApiClient(baseURL: baseURL, session: session, useKeychain: false)
        _ = try await client.loginWithPassword(email: "a@b.c", password: "pw")
        client.token = nil
        #expect(client.token == nil)
        #expect(client.refreshToken == nil)
    }

    @Test("Ten concurrent refreshSession calls coalesce into a single network rotation")
    func concurrentRefreshCoalesces() async throws {
        actor Tracker {
            var refreshRequests = 0
            func recordRefresh() { refreshRequests += 1 }
        }
        let tracker = Tracker()
        let session = MockNetworkSession { request in
            if request.url?.path == "/api/auth/token" {
                let body = Data(self.loginBody(refresh: "refresh-1").utf8)
                return (body, HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
            }
            await tracker.recordRefresh()
            try await Task.sleep(nanoseconds: 20_000_000)
            let rotated = #"{"token":"session-token-2","token_type":"Bearer","expires_in":604800,"user":{"id":"u1","email":"a@b.com","name":"A","role":"member","created_at":"2026-01-01T00:00:00Z"},"refresh_token":"refresh-2"}"#
            return (Data(rotated.utf8), HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
        }
        let client = ApiClient(baseURL: baseURL, session: session, useKeychain: false)
        _ = try await client.loginWithPassword(email: "a@b.c", password: "pw")

        let users = try await withThrowingTaskGroup(of: SessionUser.self) { group in
            for _ in 0..<10 {
                group.addTask { try await client.refreshSession() }
            }
            var list: [SessionUser] = []
            for try await user in group { list.append(user) }
            return list
        }
        #expect(users.count == 10)
        #expect(users.allSatisfy { $0.id == "u1" })
        #expect(await tracker.refreshRequests == 1)
        #expect(client.token == "session-token-2")
        #expect(client.refreshToken == "refresh-2")

        // 传入旧 failedToken 调用时直接复用已轮换凭据，零网络请求
        let reused = try await client.refreshSession(failedToken: "session-token")
        #expect(reused.id == "u1")
        #expect(await tracker.refreshRequests == 1)
    }

    @Test("Transient 503, 429, and timeout refresh errors preserve existing credentials", arguments: [503, 429, -1])
    func transientRefreshFailurePreservesCredentials(mode: Int) async throws {
        let session = MockNetworkSession { request in
            if request.url?.path == "/api/auth/token" {
                let body = Data(self.loginBody(refresh: "refresh-1").utf8)
                return (body, HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
            }
            if mode == -1 {
                throw URLError(.timedOut)
            }
            let body = Data(#"{"error":"服务繁忙"}"#.utf8)
            return (body, HTTPURLResponse(url: request.url!, statusCode: mode, httpVersion: nil, headerFields: nil)!)
        }
        let client = ApiClient(baseURL: baseURL, session: session, useKeychain: false)
        _ = try await client.loginWithPassword(email: "a@b.c", password: "pw")

        await #expect(throws: (any Error).self) {
            _ = try await client.refreshSession()
        }
        #expect(client.token == "session-token")
        #expect(client.refreshToken == "refresh-1")
    }
}
