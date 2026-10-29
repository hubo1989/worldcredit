import Foundation
import Testing
@testable import WorldCreditCore

@Suite("Gmail bill sync API")
struct GmailApiTests {
    private func response(for request: URLRequest, status: Int = 200, json: String) -> (Data, URLResponse) {
        (Data(json.utf8), HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!)
    }

    private func makeClient(handler: @escaping @Sendable (URLRequest) async throws -> (Data, URLResponse)) -> ApiClient {
        ApiClient(baseURL: URL(string: "https://test.local")!, session: MockNetworkSession(handler: handler), token: "session-token", useKeychain: false)
    }

    private let connectedJSON = #"{"connected":true,"email":"test-user@example.com","status":"active","last_sync_at":"2026-10-28 12:57:32","last_sync_summary":"扫描 5｜落账单 2｜草稿 1｜跳过 2｜失败 0","last_error":null}"#
    private let disconnectedJSON = #"{"connected":false,"email":null,"status":null,"last_sync_at":null,"last_sync_summary":null,"last_error":null}"#

    @Test("Status issues an authenticated GET and decodes both shapes")
    func statusRequest() async throws {
        let session = MockNetworkSession { request in
            #expect(request.url?.path == "/api/gmail/status")
            #expect(request.httpMethod == "GET")
            #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer session-token")
            return response(for: request, json: self.connectedJSON)
        }
        let status = try await makeClient(handler: session.handler).gmailStatus()
        #expect(status.connected)
        #expect(status.email == "test-user@example.com")
        #expect(status.status == "active")
        #expect(status.lastSyncAt == "2026-10-28 12:57:32")
        #expect(status.lastError == nil)

        let emptySession = MockNetworkSession { request in
            response(for: request, json: self.disconnectedJSON)
        }
        let empty = try await makeClient(handler: emptySession.handler).gmailStatus()
        #expect(!empty.connected)
        #expect(empty.email == nil)
        #expect(empty.status == nil)
    }

    @Test("Connect posts the server auth code and decodes the email")
    func connectRequest() async throws {
        let session = MockNetworkSession { request in
            #expect(request.url?.path == "/api/gmail/connect")
            #expect(request.httpMethod == "POST")
            #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer session-token")
            let body = try #require(JSONSerialization.jsonObject(with: request.httpBody ?? Data()) as? [String: String])
            #expect(body == ["serverAuthCode": "4/0Axxx"])
            return response(for: request, json: #"{"ok":true,"email":"test-user@example.com"}"#)
        }
        let result = try await makeClient(handler: session.handler).gmailConnect(serverAuthCode: "4/0Axxx")
        #expect(result.ok)
        #expect(result.email == "test-user@example.com")
    }

    @Test("Manual sync posts maxMessages and decodes counters with remaining")
    func syncRequest() async throws {
        let session = MockNetworkSession { request in
            #expect(request.url?.path == "/api/gmail/sync")
            #expect(request.httpMethod == "POST")
            #expect(request.timeoutInterval == 120)
            let body = try #require(JSONSerialization.jsonObject(with: request.httpBody ?? Data()) as? [String: Int])
            #expect(body == ["maxMessages": 6])
            return response(for: request, json: #"{"scanned":5,"written":2,"drafted":1,"skipped":2,"failed":0,"errors":[],"remaining":12}"#)
        }
        let result = try await makeClient(handler: session.handler).gmailSync(maxMessages: 6)
        #expect(result.scanned == 5)
        #expect(result.written == 2)
        #expect(result.remaining == 12)
        #expect(result.summaryText == "扫描 5｜落账单 2｜草稿 1｜跳过 2｜失败 0")
    }

    @Test("Sync without maxMessages posts an empty body and tolerates missing remaining")
    func syncWithoutMaxMessages() async throws {
        let session = MockNetworkSession { request in
            #expect((request.httpBody ?? Data()).count == 0)
            return response(for: request, json: #"{"scanned":1,"written":0,"drafted":0,"skipped":1,"failed":0,"errors":[]}"#)
        }
        let result = try await makeClient(handler: session.handler).gmailSync()
        #expect(result.remaining == nil)
        #expect(result.skipped == 1)
    }

    @Test("Merged results accumulate counters and keep the latest remaining")
    func mergedResults() {
        let first = GmailSyncResult(scanned: 6, written: 2, drafted: 1, skipped: 3, failed: 0, remaining: 4)
        let second = GmailSyncResult(scanned: 4, written: 1, drafted: 0, skipped: 2, failed: 1, errors: ["parse"], remaining: 0)
        let merged = first.merged(with: second)
        #expect(merged.scanned == 10)
        #expect(merged.written == 3)
        #expect(merged.drafted == 1)
        #expect(merged.skipped == 5)
        #expect(merged.failed == 1)
        #expect(merged.errors == ["parse"])
        #expect(merged.remaining == 0)
        #expect(merged.summaryText == "扫描 10｜落账单 3｜草稿 1｜跳过 5｜失败 1")
    }

    @Test("Disconnect posts an empty body and requires ok in the payload")
    func disconnectRequest() async throws {
        let session = MockNetworkSession { request in
            #expect(request.url?.path == "/api/gmail/disconnect")
            #expect(request.httpMethod == "POST")
            #expect((request.httpBody ?? Data()).count == 0)
            return response(for: request, json: #"{"ok":true}"#)
        }
        try await makeClient(handler: session.handler).gmailDisconnect()
    }

    @Test("Unauthenticated Gmail requests fail before reaching the network")
    func requiresAuthentication() async {
        let session = MockNetworkSession { _ in
            Issue.record("An unauthenticated Gmail request reached the network")
            throw URLError(.unknown)
        }
        let client = ApiClient(baseURL: URL(string: "https://test.local")!, session: session, useKeychain: false)
        do {
            _ = try await client.gmailStatus()
            Issue.record("Expected missing credentials to fail")
        } catch {
            #expect((error as NSError).code == 401)
        }
        do {
            _ = try await client.gmailConnect(serverAuthCode: "4/0Axxx")
            Issue.record("Expected missing credentials to fail")
        } catch {
            #expect((error as NSError).code == 401)
        }
        do {
            _ = try await client.gmailSync()
            Issue.record("Expected missing credentials to fail")
        } catch {
            #expect((error as NSError).code == 401)
        }
        do {
            try await client.gmailDisconnect()
            Issue.record("Expected missing credentials to fail")
        } catch {
            #expect((error as NSError).code == 401)
        }
    }

    @Test("HTTP failures retain the server error message", arguments: [401, 404, 500])
    func httpFailure(status: Int) async {
        let session = MockNetworkSession { request in
            response(for: request, status: status, json: #"{"error":"Gmail 连接已失效"}"#)
        }
        let client = makeClient(handler: session.handler)
        do {
            _ = try await client.gmailStatus()
            Issue.record("Expected HTTP failure")
        } catch {
            #expect((error as NSError).code == status)
            #expect(error.localizedDescription == "Gmail 连接已失效")
        }
    }
}
