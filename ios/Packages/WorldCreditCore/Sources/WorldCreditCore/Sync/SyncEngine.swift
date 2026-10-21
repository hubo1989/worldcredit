import Foundation
import GRDB

public final class SyncEngine: @unchecked Sendable {
    public let dbManager: DatabaseManager
    public let apiClient: ApiClient
    public let clientId: String

    public init(
        dbManager: DatabaseManager,
        apiClient: ApiClient,
        clientId: String = UUID().uuidString
    ) {
        self.dbManager = dbManager
        self.apiClient = apiClient
        self.clientId = clientId
    }

    public func sync() async throws {
        // Push local mutations first, then pull authoritative server state
        try await push()
        try await pull()
    }

    public func pull() async throws {
        var hasMore = true
        while hasMore {
            let cursor = try await dbManager.dbWriter.read { db in
                let meta = try SyncMeta.fetchOne(db, key: "sync_cursor")
                return Int(meta?.value ?? "0") ?? 0
            }

            let response = try await apiClient.pull(cursor: cursor)
            if response.changes.isEmpty && response.cursor == cursor {
                break
            }

            try await dbManager.dbWriter.write { db in
                for change in response.changes {
                    try self.applyChange(change, in: db)
                }
                try SyncMeta(key: "sync_cursor", value: String(response.cursor)).save(db)
                try SyncMeta(key: "last_synced_at", value: response.serverTime).save(db)
            }

            hasMore = response.hasMore
        }
    }

    public func push() async throws {
        let mutations = try await dbManager.dbWriter.read { db in
            try MutationOutbox.order(Column("created_at").asc).fetchAll(db)
        }
        guard !mutations.isEmpty else { return }

        let payloads = mutations.compactMap { item -> MutationPayload? in
            guard let data = item.argsJson.data(using: .utf8),
                  let args = try? JSONDecoder().decode([AnyCodable].self, from: data) else {
                return nil
            }
            return MutationPayload(id: item.id, name: item.name, args: args)
        }

        let results = try await apiClient.push(clientId: clientId, mutations: payloads)
        let resultMap = Dictionary(uniqueKeysWithValues: results.map { ($0.id, $0) })

        try await dbManager.dbWriter.write { db in
            for item in mutations {
                guard let res = resultMap[item.id] else { continue }
                if res.ok {
                    // Success: remove from outbox
                    try item.delete(db)
                } else if res.permanent == true {
                    // Permanent error (e.g. already paid on web): remove from outbox & rollback
                    try item.delete(db)
                    try self.rollbackMutation(item, in: db)
                } else {
                    // Transient error: increment retry count
                    var updated = item
                    updated.retryCount += 1
                    updated.lastError = res.error
                    try updated.update(db)
                }
            }
        }
    }

    private func applyChange(_ change: PullChangeItem, in db: Database) throws {
        let tbl = change.tbl
        let rowId = change.rowId

        if change.op == "delete" {
            switch tbl {
            case "banks": try Bank.deleteOne(db, id: rowId)
            case "card_products": try CardProduct.deleteOne(db, id: rowId)
            case "card_holders": try CardHolder.deleteOne(db, id: rowId)
            case "credit_cards": try CreditCard.deleteOne(db, id: rowId)
            case "bills": try Bill.deleteOne(db, id: rowId)
            case "payments": try Payment.deleteOne(db, id: rowId)
            default: break
            }
            return
        }

        // Upsert: decode row JSON into model
        guard let rowDict = change.row else { return }
        let jsonData = try JSONEncoder().encode(rowDict)

        switch tbl {
        case "banks":
            if let model = try? JSONDecoder().decode(Bank.self, from: jsonData) {
                try model.save(db)
            }
        case "card_products":
            if let model = try? JSONDecoder().decode(CardProduct.self, from: jsonData) {
                try model.save(db)
            }
        case "card_holders":
            if let model = try? JSONDecoder().decode(CardHolder.self, from: jsonData) {
                try model.save(db)
            }
        case "credit_cards":
            if let model = try? JSONDecoder().decode(CreditCard.self, from: jsonData) {
                try model.save(db)
            }
        case "bills":
            if let model = try? JSONDecoder().decode(Bill.self, from: jsonData) {
                try model.save(db)
            }
        case "payments":
            if let model = try? JSONDecoder().decode(Payment.self, from: jsonData) {
                try model.save(db)
            }
        default: break
        }
    }

    private func rollbackMutation(_ mutation: MutationOutbox, in db: Database) throws {
        // If this was a recordPayment mutation, roll back optimistic payment and recalculate status
        if mutation.name == "bills.recordPayment" {
            guard let data = mutation.argsJson.data(using: .utf8),
                  let args = (try? JSONSerialization.jsonObject(with: data)) as? [[String: Any]],
                  let firstArg = args.first,
                  let payId = firstArg["id"] as? String,
                  let billId = firstArg["bill_id"] as? String else {
                return
            }

            // Delete optimistic payment
            try Payment.deleteOne(db, id: payId)

            // Recalculate bill status from remaining payments
            if var bill = try Bill.fetchOne(db, id: billId) {
                let payments = try Payment.filter(Column("bill_id") == billId).fetchAll(db)
                let totalPaid = payments.reduce(0.0) { $0 + $1.amount }
                if totalPaid >= bill.effectiveAmount - 0.01 {
                    bill.status = "paid"
                } else if totalPaid > 0 {
                    bill.status = "partial"
                } else {
                    bill.status = "unpaid"
                }
                try bill.update(db)
            }
        }
    }
}
