import Foundation
import GRDB

public enum SyncError: LocalizedError {
    case pendingMutations
    case invalidChange(table: String, rowID: String)
    case invalidCursor
    case incompleteReconciliation
    case invalidMutation(String)
    case duplicateMutationResult

    public var errorDescription: String? {
        switch self {
        case .pendingMutations: return "本地改动尚未提交，将在下次同步重试"
        case let .invalidChange(table, rowID): return "同步数据格式错误：\(table)/\(rowID)"
        case .invalidCursor: return "服务器返回了无效的同步游标"
        case .incompleteReconciliation: return "尚未收到需要恢复的服务器数据，将在下次同步重试"
        case let .invalidMutation(id): return "本地待提交操作格式错误：\(id)"
        case .duplicateMutationResult: return "服务器返回了重复的同步操作结果"
        }
    }
}

public final class SyncEngine: @unchecked Sendable {
    public let dbManager: DatabaseManager
    public let apiClient: ApiClient
    /// 兼容读取入口；持久化失败时 push 会报告错误，不使用未确认的身份发请求。
    public var clientId: String { identityLock.withLock { storedClientId } }
    private let identityLock = NSLock()
    private var storedClientId: String
    private let clientIdOverride: String?
    private static let reconcileMetaKey = "sync_reconcile_targets"
    /// 被隔离的坏变更（解码失败/约束冲突等）落在这里，丢弃但留痕，便于排查。
    private static let isolatedChangesMetaKey = "sync_isolated_changes"
    private static let isolatedChangesCap = 50
    private static let supportedTables: Set<String> = ["banks", "card_products", "card_holders", "credit_cards", "bills", "payments"]

    public init(
        dbManager: DatabaseManager,
        apiClient: ApiClient,
        clientId: String? = nil
    ) {
        self.dbManager = dbManager
        self.apiClient = apiClient
        let identity: Result<String, any Error> = Result {
            if let clientId { return clientId }
            return try dbManager.dbWriter.write { db in
                if let saved = try SyncMeta.fetchOne(db, key: "sync_client_id"), !saved.value.isEmpty {
                    return saved.value
                }
                let fresh = UUID().uuidString
                try SyncMeta(key: "sync_client_id", value: fresh).save(db)
                return fresh
            }
        }
        self.clientIdOverride = clientId
        self.storedClientId = (try? identity.get()) ?? ""
    }

    public func sync() async throws {
        // 清空所有成功批次；没有进展时停止，保留退避或失败中的操作。
        var pending = try await dbManager.dbWriter.read { try MutationOutbox.fetchCount($0) }
        repeat {
            try await push()
            let remaining = try await dbManager.dbWriter.read { try MutationOutbox.fetchCount($0) }
            if remaining == 0 { break }
            guard remaining < pending else { throw SyncError.pendingMutations }
            pending = remaining
        } while true
        try await pull()
    }

    public func pull() async throws {
        var hasMore = true
        while hasMore {
            let (cursor, targets) = try await dbManager.dbWriter.read { db in
                try self.requireEmptyOutbox(in: db)
                let meta = try SyncMeta.fetchOne(db, key: "sync_cursor")
                return (Int(meta?.value ?? "0") ?? 0, Array(try self.reconcileTargets(in: db).prefix(100)))
            }

            let response = try await apiClient.pull(cursor: cursor, reconcile: targets)
            guard response.cursor >= cursor else { throw SyncError.invalidCursor }
            guard !response.hasMore || response.cursor > cursor else { throw SyncError.invalidCursor }
            let returnedTargets = Set(response.changes.map { SyncReconcileTarget(tbl: $0.tbl, rowId: $0.rowId) })
            let acknowledged = Set(targets).intersection(returnedTargets)
            if !targets.isEmpty && acknowledged.isEmpty { throw SyncError.incompleteReconciliation }
            let stillNeedsRecovery = try await dbManager.dbWriter.write { db in
                // An edit may have been queued while the network request was in flight.
                try self.requireEmptyOutbox(in: db)
                // 按条隔离：单条 applyChange 失败不中断整批。整批单事务下任一条
                // 解码失败/外键约束抛错都会回滚全部并卡住 sync_cursor，同变更被
                // 永久重放、同步永久死锁。这里隔离坏行（记录后继续），保证游标
                // 总能前进；全部成功或部分隔离都提交事务并保存 cursor。
                var isolated: [[String: String]] = []
                for change in response.changes {
                    do {
                        try self.applyChange(change, in: db)
                    } catch {
                        isolated.append([
                            "tbl": change.tbl,
                            "row_id": change.rowId,
                            "error": error.localizedDescription,
                        ])
                    }
                }
                if !isolated.isEmpty {
                    try self.appendIsolatedChanges(isolated, in: db)
                }
                let remaining = try self.reconcileTargets(in: db).filter { !acknowledged.contains($0) }
                if !targets.isEmpty { try self.saveReconcileTargets(remaining, in: db) }
                try SyncMeta(key: "sync_cursor", value: String(response.cursor)).save(db)
                try SyncMeta(key: "last_synced_at", value: response.serverTime).save(db)
                return !remaining.isEmpty
            }

            hasMore = response.hasMore || stillNeedsRecovery
        }
    }

    public func push() async throws {
        let clientId = try await dbManager.dbWriter.write { db in
            if let override = self.clientIdOverride { return override }
            if let saved = try SyncMeta.fetchOne(db, key: "sync_client_id"), !saved.value.isEmpty {
                return saved.value
            }
            let fresh = UUID().uuidString
            try SyncMeta(key: "sync_client_id", value: fresh).save(db)
            return fresh
        }
        identityLock.withLock { storedClientId = clientId }
        let mutations = try await dbManager.dbWriter.read { db in
            // 两种历史时间格式都转为实际时间排序；相同时按入队顺序处理。
            let candidates = try MutationOutbox.order(sql: "julianday(created_at) ASC, rowid ASC").limit(100).fetchAll(db)
            var ready: [MutationOutbox] = []
            for item in candidates {
                if let value = try SyncMeta.fetchOne(db, key: "sync_retry_after_\(item.id)")?.value,
                   let retryAt = Double(value), retryAt > Date().timeIntervalSince1970 {
                    break // 保持 FIFO，后续操作不越过退避中的操作。
                }
                ready.append(item)
            }
            return ready
        }
        guard !mutations.isEmpty else { return }

        let payloads = try mutations.map { item -> MutationPayload in
            guard let data = item.argsJson.data(using: .utf8) else { throw SyncError.invalidMutation(item.id) }
            let args = try JSONDecoder().decode([AnyCodable].self, from: data)
            return MutationPayload(id: item.id, name: item.name, args: args)
        }

        let results = try await apiClient.push(clientId: clientId, mutations: payloads)
        var resultMap: [String: MutationPushResult] = [:]
        for result in results {
            guard resultMap.updateValue(result, forKey: result.id) == nil else { throw SyncError.duplicateMutationResult }
        }
        let resultsByID = resultMap

        try await dbManager.dbWriter.write { db in
            for item in mutations {
                guard let res = resultsByID[item.id] else { continue }
                if res.ok {
                    // Success: remove from outbox
                    try SyncMeta.deleteOne(db, key: "sync_retry_after_\(item.id)")
                    try item.delete(db)
                } else if res.permanent == true {
                    // Persist recovery before dropping the mutation, even if the server row
                    // has not changed since our last cursor or the app exits before pull.
                    let additions: [SyncReconcileTarget]
                    do {
                        additions = try self.targetsForRejectedMutation(item)
                    } catch {
                        // 解析失败（mutation 名/args 形状漂移）只标记该条并继续其余条目，
                        // 绝不能抛出导致整个事务回滚：服务端已幂等记录永久拒绝，
                        // 回滚会让 outbox 原样保留，重试再次拿到同样 permanent 再次 throw，
                        // 形成死锁。这里按 transient 口径记 retryCount/lastError 后 update；
                        // delete 与 rollbackMutation 的原有语义仅适用于能完成解析的条目。
                        var updated = item
                        updated.retryCount += 1
                        updated.lastError = error.localizedDescription
                        try updated.update(db)
                        continue
                    }
                    let pending = try self.reconcileTargets(in: db)
                    var targets = pending
                    for target in additions where !targets.contains(target) { targets.append(target) }
                    try self.saveReconcileTargets(targets, in: db)
                    try SyncMeta.deleteOne(db, key: "sync_retry_after_\(item.id)")
                    try item.delete(db)
                    try self.rollbackMutation(item, in: db)
                } else {
                    // Transient error: increment retry count
                    var updated = item
                    updated.retryCount += 1
                    updated.lastError = res.error
                    try updated.update(db)
                    let delay = min(3600.0, 5.0 * pow(2.0, Double(min(updated.retryCount - 1, 10))))
                    try SyncMeta(key: "sync_retry_after_\(item.id)",
                                 value: String(Date().timeIntervalSince1970 + delay)).save(db)
                }
            }
        }
    }

    private func applyChange(_ change: PullChangeItem, in db: Database) throws {
        let tbl = change.tbl
        let rowId = change.rowId
        // The server also sends entities this version of the app does not display yet.
        guard Self.supportedTables.contains(tbl) else { return }
        guard !rowId.isEmpty else { throw SyncError.invalidChange(table: tbl, rowID: rowId) }

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

        guard change.op == "upsert", let rowDict = change.row,
              rowDict["id"]?.value as? String == rowId else {
            throw SyncError.invalidChange(table: tbl, rowID: rowId)
        }
        let jsonData = try JSONEncoder().encode(rowDict)

        switch tbl {
        case "banks":
            try JSONDecoder().decode(Bank.self, from: jsonData).save(db)
        case "card_products":
            try JSONDecoder().decode(CardProduct.self, from: jsonData).save(db)
        case "card_holders":
            try JSONDecoder().decode(CardHolder.self, from: jsonData).save(db)
        case "credit_cards":
            try JSONDecoder().decode(CreditCard.self, from: jsonData).save(db)
        case "bills":
            try JSONDecoder().decode(Bill.self, from: jsonData).save(db)
        case "payments":
            try JSONDecoder().decode(Payment.self, from: jsonData).save(db)
        default: break
        }
    }

    private func requireEmptyOutbox(in db: Database) throws {
        guard try MutationOutbox.fetchCount(db) == 0 else { throw SyncError.pendingMutations }
    }

    private func reconcileTargets(in db: Database) throws -> [SyncReconcileTarget] {
        guard let value = try SyncMeta.fetchOne(db, key: Self.reconcileMetaKey)?.value else { return [] }
        return try JSONDecoder().decode([SyncReconcileTarget].self, from: Data(value.utf8))
    }

    private func saveReconcileTargets(_ targets: [SyncReconcileTarget], in db: Database) throws {
        let data = try JSONEncoder().encode(targets)
        try SyncMeta(key: Self.reconcileMetaKey, value: String(decoding: data, as: UTF8.self)).save(db)
    }

    /// 把被隔离的坏变更追加进 `sync_isolated_changes`（JSON 数组，超上限丢最旧）。
    private func appendIsolatedChanges(_ records: [[String: String]], in db: Database) throws {
        var existing: [[String: String]] = []
        if let value = try SyncMeta.fetchOne(db, key: Self.isolatedChangesMetaKey)?.value,
           let decoded = try? JSONDecoder().decode([[String: String]].self, from: Data(value.utf8)) {
            existing = decoded
        }
        existing.append(contentsOf: records)
        if existing.count > Self.isolatedChangesCap {
            existing.removeFirst(existing.count - Self.isolatedChangesCap)
        }
        let data = try JSONEncoder().encode(existing)
        try SyncMeta(key: Self.isolatedChangesMetaKey,
                     value: String(decoding: data, as: UTF8.self)).save(db)
    }

    private func targetsForRejectedMutation(_ item: MutationOutbox) throws -> [SyncReconcileTarget] {
        let args = try JSONDecoder().decode([AnyCodable].self, from: Data(item.argsJson.utf8))
        switch item.name {
        case "bills.recordPayment":
            guard let input = args.first?.value as? [String: Any],
                  let billID = input["bill_id"] as? String, let paymentID = input["id"] as? String else {
                throw SyncError.invalidMutation(item.id)
            }
            return [.init(tbl: "bills", rowId: billID), .init(tbl: "payments", rowId: paymentID)]
        case "bills.setBillAmountOverride", "cards.updateCard":
            guard let id = args.first?.value as? String else { throw SyncError.invalidMutation(item.id) }
            return [.init(tbl: item.name == "cards.updateCard" ? "credit_cards" : "bills", rowId: id)]
        default:
            throw SyncError.invalidMutation(item.id)
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
