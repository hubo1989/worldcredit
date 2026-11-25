import Foundation
import GRDB
import Testing
@testable import WorldCreditCore

@Suite("Phase 2 Sync 27 Tables, Composite PKs & Optimistic Rollback")
struct SyncPhase2EngineTests {
    private final class MockNetwork: NetworkSession, @unchecked Sendable {
        var handler: ((URLRequest) throws -> (Data, URLResponse))?
        func data(for request: URLRequest) async throws -> (Data, URLResponse) {
            guard let handler else { throw URLError(.badURL) }
            return try handler(request)
        }
    }

    private func makeDB() throws -> DatabaseManager {
        let manager = try DatabaseManager.inMemory()
        try manager.dbWriter.write { db in
            try Bank(id: "b1", name: "招行", shortName: "招行").insert(db)
            try CardProduct(id: "p1", bankId: "b1", bankName: "招行", cardName: "经典白", paymentDueType: .fixed, paymentDueValue: 20).insert(db)
            try CardHolder(id: "h1", createdBy: "u1", managedBy: "u1", name: "Hubert").insert(db)
            try CreditCard(id: "c1", holderId: "h1", cardProductId: "p1", billingDay: 5).insert(db)
        }
        return manager
    }

    @Test("SyncEngine upserts and deletes all 12 new Phase 2 tables including composite PKs")
    func syncPullAndDeleteAllPhase2Tables() async throws {
        let dbManager = try makeDB()
        let net = MockNetwork()
        let client = ApiClient(baseURL: URL(string: "https://example.test")!, session: net, token: "t1", useKeychain: false)
        let syncEngine = SyncEngine(dbManager: dbManager, apiClient: client, clientId: "cid-1")

        let accCardRowId = SyncEngine.compositeRowId("acc1", "c1")
        let userStateRowId = SyncEngine.compositeRowId("u1", "acc1")
        let remStateRowId = SyncEngine.compositeRowId("u1", "op:expiry:acc1:cyc1:1234567890ab")

        let rulesJson = #"{"schema_version":1,"title":"机场贵宾厅","category":"travel","time_zone":"Asia/Shanghai","card_product_ids":["p1"],"open_ended":true,"cycle":{"kind":"monthly"},"allocation":"recurring","count_limit":5,"unit_label":"次","requires_personal_confirmation":false,"workflow_time_basis":"fixed","booking_consumes":"reserve_then_use","cancellation_rule":"confirm_with_issuer","entry":{}}"#
        let taskRulesJson = #"{"schema_version":1,"currency":"CNY","groups":[{"id":"g1","metrics":[{"id":"m1","kind":"count","target_count":3}]}]}"#

        let changes: [[String: Any]] = [
            // Intentionally shuffled reverse-topological order to prove sorting handles FK dependencies
            ["tbl": "notification_history", "row_id": "n1", "op": "upsert", "row": [
                "id": "n1", "user_id": "u1", "notification_key": "k1", "category": "opportunity_expiry",
                "title": "即将过期", "sent_at": "2026-10-20T09:00:00Z", "status": "sent"
            ]],
            ["tbl": "opportunity_reminder_states", "row_id": remStateRowId, "op": "upsert", "row": [
                "user_id": "u1", "event_key": "op:expiry:acc1:cyc1:1234567890ab", "read_steps_json": "[]",
                "snooze_until": "2026-10-22T09:00:00Z", "revision": 1, "updated_at": "2026-10-20T09:00:00Z"
            ]],
            ["tbl": "opportunity_user_states", "row_id": userStateRowId, "op": "upsert", "row": [
                "user_id": "u1", "account_id": "acc1", "followed": 1, "revision": 1, "updated_at": "2026-10-20T09:00:00Z"
            ]],
            ["tbl": "opportunity_fulfillments", "row_id": "ful1", "op": "upsert", "row": [
                "id": "ful1", "holder_id": "h1", "kind": "claim", "account_id": "acc1", "cycle_id": "cyc1",
                "source_key": "claim:acc1:cyc1", "card_id": "c1", "status": "recorded", "quantity": 1, "amount_minor": 0,
                "recorded_on": "2026-10-02", "revision": 1, "created_by": "u1", "updated_by": "u1",
                "created_at": "2026-10-02T00:00:00Z", "updated_at": "2026-10-02T00:00:00Z"
            ]],
            ["tbl": "opportunity_task_cycles", "row_id": "tc1", "op": "upsert", "row": [
                "id": "tc1", "task_id": "t1", "cycle_key": "2026-10", "rules_snapshot_json": taskRulesJson,
                "reward_snapshot_json": "{}", "period_start_on": "2026-10-01", "period_end_before": "2026-11-01",
                "deadline_at": "2026-10-31T23:59:59Z", "updated_at": "2026-10-01T00:00:00Z"
            ]],
            ["tbl": "opportunity_tasks", "row_id": "t1", "op": "upsert", "row": [
                "id": "t1", "holder_id": "h1", "task_type": "monthly_spend", "title": "月刷 3 笔",
                "card_ids_json": #"["c1"]"#, "rules_json": taskRulesJson, "reward_json": "{}",
                "created_by": "u1", "created_at": "2026-10-01T00:00:00Z", "updated_at": "2026-10-01T00:00:00Z"
            ]],
            ["tbl": "opportunity_usages", "row_id": "use1", "op": "upsert", "row": [
                "id": "use1", "account_id": "acc1", "cycle_id": "cyc1", "card_id": "c1", "used_on": "2026-10-10",
                "quantity": 1, "amount_minor": 0, "status": "active", "revision": 1,
                "created_by": "u1", "updated_by": "u1", "created_at": "2026-10-10T00:00:00Z", "updated_at": "2026-10-10T00:00:00Z"
            ]],
            ["tbl": "opportunity_cycles", "row_id": "cyc1", "op": "upsert", "row": [
                "id": "cyc1", "account_id": "acc1", "version_id": "ver1", "version_as_of_on": "2026-10-01",
                "cycle_key": "2026-10", "allocation_kind": "regular", "activation_state": "active",
                "period_start_on": "2026-10-01", "period_end_before": "2026-11-01",
                "usable_start_on": "2026-10-01", "usable_end_before": "2026-11-01", "time_zone": "Asia/Shanghai",
                "count_limit": 5, "used_count": 1, "balance_verified": 1, "created_at": "2026-10-01T00:00:00Z"
            ]],
            ["tbl": "opportunity_account_cards", "row_id": accCardRowId, "op": "upsert", "row": [
                "account_id": "acc1", "definition_id": "def1", "holder_id": "h1", "card_id": "c1"
            ]],
            ["tbl": "opportunity_accounts", "row_id": "acc1", "op": "upsert", "row": [
                "id": "acc1", "definition_id": "def1", "holder_id": "h1", "scope_kind": "card",
                "scope_key": "card:c1", "eligibility": "confirmed", "created_by": "u1", "created_at": "2026-10-01T00:00:00Z"
            ]],
            ["tbl": "opportunity_rule_versions", "row_id": "ver1", "op": "upsert", "row": [
                "id": "ver1", "definition_id": "def1", "version": 1, "effective_from": "2026-01-01",
                "rules_json": rulesJson, "verification": "official_verified", "published_at": "2026-01-01T00:00:00Z"
            ]],
            ["tbl": "opportunity_definitions", "row_id": "def1", "op": "upsert", "row": [
                "id": "def1", "kind": "benefit", "visibility": "shared", "created_at": "2026-01-01T00:00:00Z"
            ]],
        ]

        let pullData = try JSONSerialization.data(withJSONObject: [
            "cursor": 100, "has_more": false, "changes": changes, "server_time": "2026-10-20T10:00:00Z"
        ])
        net.handler = { req in
            let res = HTTPURLResponse(url: req.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            return (pullData, res)
        }

        try await syncEngine.pull()

        try await dbManager.dbWriter.read { (db: Database) throws -> Void in
            #expect(try OpportunityDefinitionRecord.fetchCount(db) == 1)
            #expect(try OpportunityRuleVersionRecord.fetchCount(db) == 1)
            #expect(try OpportunityAccountRecord.fetchCount(db) == 1)
            #expect(try OpportunityAccountCardRecord.fetchCount(db) == 1)
            #expect(try OpportunityCycleRecord.fetchCount(db) == 1)
            #expect(try OpportunityUsageRecord.fetchCount(db) == 1)
            #expect(try OpportunityTaskRecord.fetchCount(db) == 1)
            #expect(try OpportunityTaskCycleRecord.fetchCount(db) == 1)
            #expect(try OpportunityFulfillmentRecord.fetchCount(db) == 1)
            #expect(try OpportunityUserStateRecord.fetchCount(db) == 1)
            #expect(try OpportunityReminderStateRecord.fetchCount(db) == 1)
            #expect(try NotificationHistoryRecord.fetchCount(db) == 1)
            #expect(try SyncMeta.fetchOne(db, key: "sync_isolated_changes") == nil)
        }

        // Now delete the composite PK rows cleanly
        let delData = try JSONSerialization.data(withJSONObject: [
            "cursor": 101, "has_more": false,
            "changes": [
                ["tbl": "opportunity_user_states", "row_id": userStateRowId, "op": "delete"],
                ["tbl": "opportunity_reminder_states", "row_id": remStateRowId, "op": "delete"],
                ["tbl": "opportunity_account_cards", "row_id": accCardRowId, "op": "delete"],
            ],
            "server_time": "2026-10-20T11:00:00Z"
        ])
        net.handler = { req in
            let res = HTTPURLResponse(url: req.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            return (delData, res)
        }
        try await syncEngine.pull()

        try await dbManager.dbWriter.read { (db: Database) throws -> Void in
            #expect(try OpportunityUserStateRecord.fetchCount(db) == 0)
            #expect(try OpportunityReminderStateRecord.fetchCount(db) == 0)
            #expect(try OpportunityAccountCardRecord.fetchCount(db) == 0)
        }
    }

    @Test("Offline opportunity usage permanent rejection restores cycle quota, records notice, and schedules reconcile")
    func optimisticUsageRollbackOnPermanentRejection() async throws {
        let dbManager = try makeDB()
        try await dbManager.dbWriter.write { db in
            try OpportunityDefinitionRecord(id: "d1", kind: "benefit", visibility: "shared").insert(db)
            try OpportunityRuleVersionRecord(id: "v1", definitionId: "d1", version: 1, effectiveFrom: "2026-01-01", rulesJson: "{}").insert(db)
            try OpportunityAccountRecord(id: "acc1", definitionId: "d1", holderId: "h1", scopeKind: "card", scopeKey: "k").insert(db)
            try OpportunityCycleRecord(id: "cyc1", accountId: "acc1", versionId: "v1", versionAsOfOn: "2026-10-01", cycleKey: "2026-10", periodStartOn: "2026-10-01", usableStartOn: "2026-10-01", countLimit: 5, usedCount: 1).insert(db)
        }

        let writeService = OpportunityWriteService(dbManager: dbManager)
        let tempId = try await writeService.recordUsage(
            accountId: "acc1", cycleId: "cyc1", cardId: "c1", usedOn: "2026-10-15", quantity: 2, amountMinor: 0
        )

        // Optimistic state reflected immediately in local DB
        try await dbManager.dbWriter.read { (db: Database) throws -> Void in
            #expect(try OpportunityUsageRecord.fetchOne(db, id: tempId) != nil)
            #expect(try OpportunityCycleRecord.fetchOne(db, id: "cyc1")?.usedCount == 3)
        }

        let net = MockNetwork()
        let client = ApiClient(baseURL: URL(string: "https://example.test")!, session: net, token: "t1", useKeychain: false)
        let syncEngine = SyncEngine(dbManager: dbManager, apiClient: client, clientId: "cid-1")

        net.handler = { req in
            let body = try JSONSerialization.jsonObject(with: req.httpBody!) as! [String: Any]
            let muts = body["mutations"] as! [[String: Any]]
            let mutId = muts[0]["id"] as! String
            let payload = try JSONSerialization.data(withJSONObject: [
                "results": [[
                    "id": mutId, "ok": false, "permanent": true,
                    "error": "本期额度已被他人占用", "code": "QUOTA_EXCEEDED"
                ]]
            ])
            return (payload, HTTPURLResponse(url: req.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
        }

        try await syncEngine.push()

        try await dbManager.dbWriter.read { (db: Database) throws -> Void in
            // Temp row removed, cycle counter restored to 1, outbox empty
            #expect(try OpportunityUsageRecord.fetchOne(db, id: tempId) == nil)
            #expect(try OpportunityCycleRecord.fetchOne(db, id: "cyc1")?.usedCount == 1)
            #expect(try MutationOutbox.fetchCount(db) == 0)
        }

        let notices = await syncEngine.fetchRejectedNotices()
        #expect(notices.count == 1)
        #expect(notices.first?.message == "本期额度已被他人占用")
        #expect(notices.first?.code == "QUOTA_EXCEEDED")
    }

    @Test("Offline createCard and createBill share client UUIDs and hydrate cleanly on sync")
    func offlineCreateCardAndBillCleanupOnSuccess() async throws {
        let dbManager = try makeDB()
        let writeService = OpportunityWriteService(dbManager: dbManager)

        let card = try await writeService.createCardOffline(
            bankId: "b1", cardProductId: "p1", holderId: "h1", cardNumberLast4: "9999", creditLimit: 20000, billingDay: 10, nameOverride: nil
        )
        let bill = try await writeService.createBillOffline(
            input: ApiClient.CreateBillInput(cardId: "c1", billMonth: "2026-10", dueDate: "2026-10-28", billAmount: 888)
        )
        #expect(!card.id.hasPrefix("opt_"))
        #expect(!bill.id.hasPrefix("opt_"))
        #expect(UUID(uuidString: card.id) != nil)
        #expect(UUID(uuidString: bill.id) != nil)

        let net = MockNetwork()
        let client = ApiClient(baseURL: URL(string: "https://example.test")!, session: net, token: "t1", useKeychain: false)
        let syncEngine = SyncEngine(dbManager: dbManager, apiClient: client, clientId: "cid-1")

        net.handler = { req in
            let body = try JSONSerialization.jsonObject(with: req.httpBody!) as! [String: Any]
            let muts = body["mutations"] as! [[String: Any]]
            let resList = muts.map { ["id": $0["id"]!, "ok": true] }
            let payload = try JSONSerialization.data(withJSONObject: ["results": resList])
            return (payload, HTTPURLResponse(url: req.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
        }

        try await syncEngine.push()

        try await dbManager.dbWriter.read { (db: Database) throws -> Void in
            #expect(try CreditCard.fetchOne(db, id: card.id)?.id == card.id)
            #expect(try Bill.fetchOne(db, id: bill.id)?.id == bill.id)
            #expect(try MutationOutbox.fetchCount(db) == 0)
        }
    }

    @Test("Offline createCard followed by offline createBill uses the exact same lowercase UUID card_id in outbox and sync")
    func offlineCreateCardThenBillSharesClientUUID() async throws {
        let manager = try makeDB()
        let writer = OpportunityWriteService(dbManager: manager)

        let card = try await writer.createCardOffline(
            bankId: "b1",
            cardProductId: "p1",
            holderId: "h1",
            cardNumberLast4: "8888",
            creditLimit: 30000,
            billingDay: 12,
            nameOverride: "新白金"
        )
        #expect(!card.id.hasPrefix("opt_"))
        #expect(card.id == card.id.lowercased())
        #expect(UUID(uuidString: card.id) != nil)

        let bill = try await writer.createBillOffline(
            input: .init(cardId: card.id, billMonth: "2026-11", dueDate: "2026-11-28", billAmount: 1500)
        )
        #expect(!bill.id.hasPrefix("opt_"))
        #expect(bill.id == bill.id.lowercased())
        #expect(UUID(uuidString: bill.id) != nil)
        #expect(bill.cardId == card.id)

        // Verify outbox payloads use the exact same lowercase UUID without opt_
        let outbox = try await manager.dbWriter.read { db in
            try MutationOutbox.order(sql: "rowid ASC").fetchAll(db)
        }
        #expect(outbox.count == 2)
        let cardArgs = try #require(JSONSerialization.jsonObject(with: Data(outbox[0].argsJson.utf8)) as? [[String: Any]])
        let billArgs = try #require(JSONSerialization.jsonObject(with: Data(outbox[1].argsJson.utf8)) as? [[String: Any]])
        #expect(cardArgs.first?["id"] as? String == card.id)
        #expect(billArgs.first?["id"] as? String == bill.id)
        #expect(billArgs.first?["card_id"] as? String == card.id)

        // Replay push + pull confirming server receives card.id before/with bill.card_id == card.id
        var serverCardIDs = Set(["c1"])
        let net = MockNetwork()
        net.handler = { req in
            let body = try #require(JSONSerialization.jsonObject(with: req.httpBody!) as? [String: Any])
            if req.url?.path == "/api/sync/push" {
                let muts = try #require(body["mutations"] as? [[String: Any]])
                var results: [[String: Any]] = []
                for mut in muts {
                    let id = try #require(mut["id"] as? String)
                    let name = try #require(mut["name"] as? String)
                    let args = try #require(mut["args"] as? [[String: Any]])
                    let payload = try #require(args.first)
                    if name == "cards.createCard" {
                        let cid = try #require(payload["id"] as? String)
                        serverCardIDs.insert(cid)
                        results.append(["id": id, "ok": true])
                    } else if name == "bills.createBill" {
                        let refCardID = try #require(payload["card_id"] as? String)
                        let ok = serverCardIDs.contains(refCardID)
                        results.append(ok
                            ? ["id": id, "ok": true]
                            : ["id": id, "ok": false, "permanent": true, "code": "NOT_FOUND", "error": "关联的卡片不存在"]
                        )
                    }
                }
                return (
                    try JSONSerialization.data(withJSONObject: ["results": results]),
                    HTTPURLResponse(url: req.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
                )
            }
            return (
                try JSONSerialization.data(withJSONObject: [
                    "cursor": 1,
                    "has_more": false,
                    "server_time": "2026-11-25T00:00:00Z",
                    "changes": [
                        [
                            "tbl": "credit_cards",
                            "row_id": card.id,
                            "op": "upsert",
                            "row": [
                                "id": card.id,
                                "holder_id": "h1",
                                "card_product_id": "p1",
                                "card_number_last4": "8888",
                                "credit_limit": 30000.0,
                                "billing_day": 12,
                                "status": "active",
                                "card_type": "credit",
                                "name_override": "新白金",
                                "created_at": "2026-11-25T00:00:00Z",
                            ],
                        ],
                        [
                            "tbl": "bills",
                            "row_id": bill.id,
                            "op": "upsert",
                            "row": [
                                "id": bill.id,
                                "card_id": card.id,
                                "bill_month": "2026-11",
                                "due_date": "2026-11-28",
                                "bill_amount": 1500.0,
                                "min_payment": 0.0,
                                "status": "unpaid",
                                "created_at": "2026-11-25T00:00:00Z",
                            ],
                        ],
                    ],
                ]),
                HTTPURLResponse(url: req.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            )
        }

        let client = ApiClient(baseURL: URL(string: "https://example.test")!, session: net, token: "t1", useKeychain: false)
        let engine = SyncEngine(dbManager: manager, apiClient: client)
        try await engine.sync()

        let notices = await engine.fetchRejectedNotices()
        #expect(notices.isEmpty)
        try await manager.dbWriter.read { (db: Database) throws -> Void in
            let allCards = try CreditCard.filter(Column("card_number_last4") == "8888").fetchAll(db)
            let allBills = try Bill.filter(Column("card_id") == card.id).fetchAll(db)
            #expect(allCards.count == 1)
            #expect(allCards.first?.id == card.id)
            #expect(allBills.count == 1)
            #expect(allBills.first?.id == bill.id)
        }
    }

    @Test("Offline createCard and createBill persist valid client UUID and preserve it across replays", arguments: ["cards.createCard", "bills.createBill"])
    func offlineCreatePersistsClientUUIDAcrossReplays(_ name: String) async throws {
        let manager = try makeDB()
        let writer = OpportunityWriteService(dbManager: manager)
        if name == "cards.createCard" {
            try await writer.createCardOffline(
                bankId: "b1",
                cardProductId: "p1",
                holderId: "h1",
                cardNumberLast4: "9999",
                creditLimit: 1000,
                billingDay: 5,
                nameOverride: nil
            )
        } else {
            try await writer.createBillOffline(
                input: .init(cardId: "c1", billMonth: "2026-10", dueDate: "2026-10-28", billAmount: 888)
            )
        }

        var seenPayloadIDs: [String] = []
        let net = MockNetwork()
        net.handler = { request in
            let body = try #require(JSONSerialization.jsonObject(with: request.httpBody!) as? [String: Any])
            let mutations = try #require(body["mutations"] as? [[String: Any]])
            let mutation = try #require(mutations.first)
            let args = try #require(mutation["args"] as? [[String: Any]])
            let payload = try #require(args.first)
            let id = try #require(mutation["id"] as? String)
            #expect(mutation["name"] as? String == name)
            let payloadID = try #require(payload["id"] as? String)
            #expect(UUID(uuidString: payloadID) != nil)
            seenPayloadIDs.append(payloadID)

            let ok = seenPayloadIDs.count >= 2
            let result: [String: Any] = ok
                ? ["id": id, "ok": true]
                : ["id": id, "ok": false, "permanent": false, "error": "temporary outage"]
            return (
                try JSONSerialization.data(withJSONObject: ["results": [result]]),
                HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            )
        }

        let client = ApiClient(baseURL: URL(string: "https://example.test")!, session: net, token: "t1", useKeychain: false)
        let engine = SyncEngine(dbManager: manager, apiClient: client)

        // First push fails transiently -> clears retry backoff -> second push replays identical client UUID
        try await engine.push()
        _ = try await manager.dbWriter.write { db in
            try SyncMeta.filter(Column("key").like("sync_retry_after_%")).deleteAll(db)
        }
        try await engine.push()

        #expect(seenPayloadIDs.count == 2)
        #expect(seenPayloadIDs[0] == seenPayloadIDs[1])
    }

    @Test("Permanent CONFLICT with details.existing_bill_id triggers targeted bill reconcile and hydrates winning row")
    func offlineBillConflictReconcilesWinningServerBill() async throws {
        let manager = try makeDB()
        let pending = try await OpportunityWriteService(dbManager: manager).createBillOffline(
            input: .init(cardId: "c1", billMonth: "2026-10", dueDate: "2026-10-28", billAmount: 888)
        )

        var reconciledTargets: [[String: String]] = []
        let net = MockNetwork()
        net.handler = { request in
            let body = try #require(JSONSerialization.jsonObject(with: request.httpBody!) as? [String: Any])
            let response: [String: Any]
            if request.url?.path == "/api/sync/push" {
                let mutations = try #require(body["mutations"] as? [[String: Any]])
                let id = try #require(mutations.first?["id"] as? String)
                response = ["results": [[
                    "id": id,
                    "ok": false,
                    "permanent": true,
                    "code": "CONFLICT",
                    "error": "同卡同月账单已存在",
                    "details": ["existing_bill_id": "winning-bill"],
                ]]]
            } else {
                reconciledTargets = body["reconcile"] as? [[String: String]] ?? []
                response = [
                    "cursor": 1,
                    "has_more": false,
                    "server_time": "2026-10-20T00:00:00Z",
                    "changes": [[
                        "tbl": "bills",
                        "row_id": "winning-bill",
                        "op": "upsert",
                        "row": [
                            "id": "winning-bill",
                            "card_id": "c1",
                            "bill_month": "2026-10",
                            "due_date": "2026-10-28",
                            "bill_amount": 1200.0,
                            "min_payment": 120.0,
                            "status": "unpaid",
                            "created_at": "2026-10-20T00:00:00Z",
                        ],
                    ]],
                ]
            }
            return (
                try JSONSerialization.data(withJSONObject: response),
                HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            )
        }

        let client = ApiClient(baseURL: URL(string: "https://example.test")!, session: net, token: "t1", useKeychain: false)
        let engine = SyncEngine(dbManager: manager, apiClient: client)
        try await engine.sync()

        #expect(reconciledTargets.contains(["tbl": "bills", "row_id": "winning-bill"]))
        try await manager.dbWriter.read { (db: Database) throws -> Void in
            #expect(try Bill.fetchOne(db, id: pending.id) == nil)
            let winner = try #require(try Bill.fetchOne(db, id: "winning-bill"))
            #expect(winner.billAmount == 1200.0)
            #expect(try SyncMeta.fetchOne(db, key: "sync_reconcile_targets")?.value == "[]")
        }
        let notices = await engine.fetchRejectedNotices()
        #expect(notices.first?.code == "CONFLICT")
    }
}
