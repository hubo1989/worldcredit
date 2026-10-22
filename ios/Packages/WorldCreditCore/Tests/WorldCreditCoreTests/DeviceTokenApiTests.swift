import Foundation
import Testing
@testable import WorldCreditCore

@Suite("Device token API authentication and failures")
struct DeviceTokenApiTests {
    private func response(for request: URLRequest, status: Int = 200, json: String = #"{"data":{"success":true},"error":null}"#) -> (Data, URLResponse) {
        (Data(json.utf8), HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!)
    }

    @Test("Registration sends authenticated RPC arguments")
    func registrationRequest() async throws {
        let session = MockNetworkSession { request in
            #expect(request.url?.path == "/api/rpc/devices/registerToken")
            #expect(request.httpMethod == "POST")
            #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer session-token")
            #expect(request.value(forHTTPHeaderField: "Content-Type") == "application/json")
            let requestBody = try #require(request.httpBody)
            let body = try #require(JSONSerialization.jsonObject(with: requestBody) as? [String: Any])
            let args = try #require(body["args"] as? [[String: String]])
            #expect(args == [["token": "device-token", "platform": "ios", "appVersion": "1.2"]])
            return response(for: request)
        }
        let client = ApiClient(baseURL: URL(string: "https://test.local")!, session: session, token: "session-token", useKeychain: false)
        try await client.registerDeviceToken(token: "device-token", appVersion: "1.2")
    }

    @Test("Logout uses captured credentials after the current session is cleared")
    func logoutCredentialSnapshot() async throws {
        let session = MockNetworkSession { request in
            #expect(request.url?.path == "/api/rpc/devices/unregisterToken")
            #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer before-logout")
            let requestBody = try #require(request.httpBody)
            let body = try #require(JSONSerialization.jsonObject(with: requestBody) as? [String: Any])
            let args = try #require(body["args"] as? [[String: String]])
            #expect(args == [["token": "device-token"]])
            return response(for: request)
        }
        let client = ApiClient(baseURL: URL(string: "https://test.local")!, session: session, token: "before-logout", useKeychain: false)
        let credential = try #require(client.token)
        client.token = nil
        #expect(client.token == nil)
        try await client.unregisterDeviceToken(token: "device-token", authenticationToken: credential)
    }

    @Test("Unauthenticated token requests fail before making a network request", arguments: [true, false])
    func requiresAuthentication(register: Bool) async {
        let session = MockNetworkSession { _ in
            Issue.record("An unauthenticated device token request reached the network")
            throw URLError(.unknown)
        }
        let client = ApiClient(baseURL: URL(string: "https://test.local")!, session: session, useKeychain: false)
        do {
            if register {
                try await client.registerDeviceToken(token: "device-token")
            } else {
                try await client.unregisterDeviceToken(token: "device-token")
            }
            Issue.record("Expected missing credentials to fail")
        } catch {
            #expect((error as NSError).code == 401)
        }
    }

    @Test("HTTP failures retain server error messages", arguments: [401, 403, 500])
    func httpFailure(status: Int) async {
        let session = MockNetworkSession { request in
            response(for: request, status: status, json: #"{"data":null,"error":"设备注册被拒绝"}"#)
        }
        let client = ApiClient(baseURL: URL(string: "https://test.local")!, session: session, token: "session-token", useKeychain: false)
        do {
            try await client.registerDeviceToken(token: "device-token")
            Issue.record("Expected HTTP failure")
        } catch {
            #expect((error as NSError).code == status)
            #expect(error.localizedDescription == "设备注册被拒绝")
        }
    }

    @Test("RPC failure is rejected even when the HTTP response is successful")
    func rpcFailure() async {
        let session = MockNetworkSession { request in
            response(for: request, json: #"{"data":null,"error":"注销未完成"}"#)
        }
        let client = ApiClient(baseURL: URL(string: "https://test.local")!, session: session, token: "session-token", useKeychain: false)
        do {
            try await client.unregisterDeviceToken(token: "device-token")
            Issue.record("Expected RPC failure")
        } catch {
            #expect(error.localizedDescription == "注销未完成")
        }
    }

    @Test("Malformed success bodies cannot be mistaken for successful registration")
    func malformedResponse() async {
        let session = MockNetworkSession { request in
            response(for: request, json: "not JSON")
        }
        let client = ApiClient(baseURL: URL(string: "https://test.local")!, session: session, token: "session-token", useKeychain: false)
        await #expect(throws: DecodingError.self) {
            try await client.registerDeviceToken(token: "device-token")
        }
    }

    @Test("Unregistration propagates transport failures to the lifecycle caller")
    func unregisterNetworkFailure() async {
        let session = MockNetworkSession { _ in throw URLError(.timedOut) }
        let client = ApiClient(baseURL: URL(string: "https://test.local")!, session: session, token: "session-token", useKeychain: false)
        await #expect(throws: URLError(.timedOut)) {
            try await client.unregisterDeviceToken(token: "device-token")
        }
    }
}
