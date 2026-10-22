import Foundation
import Testing
@testable import WorldCreditCore

/// 登录令牌交换：密码与 Google ID token 两条 grant 共用同一个端点与响应契约。
@Suite("Login token exchange")
struct LoginApiTests {
    private let baseURL = URL(string: "https://test.local")!

    private func tokenResponse() -> String {
        #"{"token":"session-token","token_type":"Bearer","expires_in":604800,"user":{"id":"u1","email":"a@b.com","name":"A","role":"member","created_at":"2026-01-01T00:00:00Z"}}"#
    }

    private func ok(_ request: URLRequest) -> (Data, URLResponse) {
        (Data(tokenResponse().utf8), HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
    }

    @Test("Google login posts the id_token and persists the session token")
    func googleGrant() async throws {
        let session = MockNetworkSession { request in
            #expect(request.url?.path == "/api/auth/token")
            #expect(request.httpMethod == "POST")
            #expect(request.value(forHTTPHeaderField: "Content-Type") == "application/json")
            let requestBody = try #require(request.httpBody)
            let body = try #require(JSONSerialization.jsonObject(with: requestBody) as? [String: String])
            #expect(body["grant_type"] == "google")
            #expect(body["id_token"] == "fake.id.token")
            // Google 登录不应携带密码字段
            #expect(body["email"] == nil)
            #expect(body["password"] == nil)
            return self.ok(request)
        }
        let client = ApiClient(baseURL: baseURL, session: session, useKeychain: false)
        let user = try await client.loginWithGoogle(idToken: "fake.id.token")
        #expect(user.email == "a@b.com")
        #expect(client.token == "session-token")
    }

    @Test("Password login still posts the password grant after the shared exchange refactor")
    func passwordGrant() async throws {
        let session = MockNetworkSession { request in
            let requestBody = try #require(request.httpBody)
            let body = try #require(JSONSerialization.jsonObject(with: requestBody) as? [String: String])
            #expect(body["grant_type"] == "password")
            #expect(body["email"] == "a@b.com")
            #expect(body["password"] == "pw")
            #expect(body["id_token"] == nil)
            return self.ok(request)
        }
        let client = ApiClient(baseURL: baseURL, session: session, useKeychain: false)
        let user = try await client.loginWithPassword(email: "a@b.com", password: "pw")
        #expect(user.id == "u1")
        #expect(client.token == "session-token")
    }

    @Test("Server-side rejection surfaces the error message and leaves no token")
    func serverRejection() async throws {
        let session = MockNetworkSession { request in
            let json = #"{"error":"Google ID token 验证失败: bad-audience"}"#
            return (Data(json.utf8), HTTPURLResponse(url: request.url!, statusCode: 401, httpVersion: nil, headerFields: nil)!)
        }
        let client = ApiClient(baseURL: baseURL, session: session, useKeychain: false)
        do {
            _ = try await client.loginWithGoogle(idToken: "fake.id.token")
            Issue.record("Expected Google login to fail")
        } catch {
            let nsError = error as NSError
            #expect(nsError.code == 401)
            #expect(nsError.localizedDescription.contains("bad-audience"))
        }
        #expect(client.token == nil)
    }
}
