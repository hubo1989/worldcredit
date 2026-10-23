import Foundation
import GRDB
import Testing
@testable import WorldCreditCore

@Suite("同步重试与跨启动幂等")
struct SyncRetryTests {
    actor Requests {
        var clients: [String] = []
        var batches: [[String]] = []
        var pulls = 0
        let succeeds: Bool
        init(succeeds: Bool = false) { self.succeeds = succeeds }
        func record(_ request: URLRequest) throws -> Data {
            if request.url?.path == "/api/sync/pull" {
                pulls += 1
                return Data(#"{"cursor":0,"has_more":false,"changes":[],"server_time":"2026-10-23T00:00:00Z"}"#.utf8)
            }
            let body = try #require(JSONSerialization.jsonObject(with: request.httpBody!) as? [String: Any])
            clients.append(try #require(body["client_id"] as? String))
            let mutations = try #require(body["mutations"] as? [[String: Any]])
            let ids = try mutations.map { try #require($0["id"] as? String) }
            batches.append(ids)
            return try JSONSerialization.data(withJSONObject: ["results": ids.map {
                ["id": $0, "ok": succeeds, "permanent": false, "error": "temporarily unavailable"] as [String: Any]
            }])
        }
    }

    private func enqueue(_ manager: DatabaseManager, id: String, createdAt: String, retries: Int = 0) async throws {
        try await manager.dbWriter.write { db in
            try MutationOutbox(id: id, name: "cards.updateCard", argsJson: "[\"card\",{}]", createdAt: createdAt, retryCount: retries).insert(db)
        }
    }

    private func engine(_ manager: DatabaseManager, requests: Requests) -> SyncEngine {
        let session = MockNetworkSession { request in
            let data = try await requests.record(request)
            return (data, HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
        }
        return SyncEngine(dbManager: manager, apiClient: ApiClient(baseURL: URL(string: "https://test.local")!, session: session, token: "session", useKeychain: false))
    }

    @Test("进程重建后保留同一 client_id 重放未确认操作")
    func stableIdentity() async throws {
        let manager = try DatabaseManager.inMemory()
        try await enqueue(manager, id: "m1", createdAt: "2026-10-23T00:00:00Z")
        let requests = Requests()
        let first = engine(manager, requests: requests)
        #expect(!first.clientId.isEmpty)
        try await first.push()
        // 模拟时间已过退避窗口，保留同一个 outbox 并创建全新引擎。
        try await manager.dbWriter.write { db in
            try db.execute(sql: "DELETE FROM sync_meta WHERE key LIKE 'sync_retry_after_%'")
        }
        let second = engine(manager, requests: requests)
        #expect(second.clientId == first.clientId)
        try await second.push()
        let clients = await requests.clients
        #expect(clients.count == 2)
        #expect(clients.first == clients.last)
        #expect(clients.first?.isEmpty == false)
    }

    @Test("单次推送至多一百条操作且保留后续队列")
    func boundedBatch() async throws {
        let manager = try DatabaseManager.inMemory()
        try await manager.dbWriter.write { db in
            for index in 0..<150 {
                try MutationOutbox(id: "m\(index)", name: "cards.updateCard", argsJson: "[\"card\",{}]", createdAt: "2026-10-23T00:00:00Z").insert(db)
            }
        }
        let requests = Requests()
        try await engine(manager, requests: requests).push()
        let batches = await requests.batches
        #expect(batches.count == 1)
        #expect(batches.first?.count == 100)
        #expect(try await manager.dbWriter.read { try MutationOutbox.fetchCount($0) } == 150)
    }

    @Test("一百零一条成功操作连续分两批推送后才拉取")
    func successfulBatchesDrain() async throws {
        let manager = try DatabaseManager.inMemory()
        try await manager.dbWriter.write { db in
            for index in 0..<101 {
                try MutationOutbox(id: "m\(index)", name: "cards.updateCard", argsJson: "[\"card\",{}]").insert(db)
            }
        }
        let requests = Requests(succeeds: true)
        try await engine(manager, requests: requests).sync()
        let batches = await requests.batches
        #expect(batches.map(\.count) == [100, 1])
        #expect(await requests.pulls == 1)
        #expect(try await manager.dbWriter.read { try MutationOutbox.fetchCount($0) } == 0)
    }

    @Test("SQL 与 ISO 时间戳混用时仍按时间顺序推送")
    func mixedTimestampOrder() async throws {
        let manager = try DatabaseManager.inMemory()
        try await enqueue(manager, id: "later", createdAt: "2026-10-23 12:00:00")
        try await enqueue(manager, id: "earlier", createdAt: "2026-10-23T09:00:00Z")
        let requests = Requests()
        try await engine(manager, requests: requests).push()
        let batches = await requests.batches
        #expect(batches.first == ["earlier", "later"])
    }

    @Test("身份初始化数据库失败恢复后同一引擎可继续推送")
    func identityFailureRecovers() async throws {
        let manager = try DatabaseManager.inMemory()
        try await enqueue(manager, id: "m1", createdAt: "2026-10-23T00:00:00Z")
        try await manager.dbWriter.write { db in
            try db.execute(sql: "ALTER TABLE sync_meta RENAME TO temporarily_unavailable_meta")
        }
        let requests = Requests(succeeds: true)
        let sync = engine(manager, requests: requests)
        await #expect(throws: (any Error).self) { try await sync.push() }
        #expect(await requests.batches.isEmpty)
        try await manager.dbWriter.write { db in
            try db.execute(sql: "ALTER TABLE temporarily_unavailable_meta RENAME TO sync_meta")
        }
        try await sync.push()
        #expect(await requests.batches.count == 1)
        #expect(!sync.clientId.isEmpty)
    }

    @Test("瞬时失败退避期间不重发也不删除高重试次数操作")
    func retainAndBackoff() async throws {
        let manager = try DatabaseManager.inMemory()
        try await enqueue(manager, id: "m1", createdAt: "2026-10-23T00:00:00Z", retries: 10)
        let requests = Requests()
        let sync = engine(manager, requests: requests)
        try await sync.push()
        try await sync.push()
        let batches = await requests.batches
        #expect(batches.count == 1)
        let pending = try await manager.dbWriter.read { try MutationOutbox.fetchOne($0, id: "m1") }
        #expect(pending?.retryCount == 11)
        #expect(pending?.lastError == "temporarily unavailable")
    }
}
