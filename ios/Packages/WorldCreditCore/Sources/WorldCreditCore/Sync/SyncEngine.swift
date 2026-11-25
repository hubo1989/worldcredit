import Foundation
import GRDB

public enum SyncError: LocalizedError {
    case pendingMutations
    case invalidChange(table: String, rowID: String)
    case invalidCursor
    case incompleteReconciliation
    case invalidMutation(String)
    case duplicateMutationResult
    case sessionExpired

    public var errorDescription: String? {
        switch self {
        case .pendingMutations: return "本地改动尚未提交，将在下次同步重试"
        case let .invalidChange(table, rowID): return "同步数据格式错误：\(table)/\(rowID)"
        case .invalidCursor: return "服务器返回了无效的同步游标"
        case .incompleteReconciliation: return "尚未收到需要恢复的服务器数据，将在下次同步重试"
        case let .invalidMutation(id): return "本地待提交操作格式错误：\(id)"
        case .duplicateMutationResult: return "服务器返回了重复的同步操作结果"
        case .sessionExpired: return "会话已结束，已取消本次同步"
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
    private let sessionLock = NSLock()
    private var sessionIsActive = true
    private static let reconcileMetaKey = "sync_reconcile_targets"
    /// 被隔离的坏变更（解码失败/约束冲突等）落在这里，丢弃但留痕，便于排查。
    private static let isolatedChangesMetaKey = "sync_isolated_changes"
    private static let isolatedChangesCap = 50
    public static let optimisticSnapshotsMetaKey = "sync_optimistic_snapshots"
    public static let rejectedNoticesMetaKey = "sync_rejected_notices"
    public static let rejectedNoticesCap = 20

    private static let supportedTables: Set<String> = [
        "banks",
        "card_products",
        "benefits",
        "promos",
        "card_holders",
        "credit_accounts",
        "credit_cards",
        "bills",
        "bill_card_subtotals",
        "payments",
        "user_preferences",
        "notification_preferences",
        "recurring_payables",
        "recurring_payable_payments",
        "payable_custom_categories",
        "opportunity_definitions",
        "opportunity_rule_versions",
        "opportunity_accounts",
        "opportunity_account_cards",
        "opportunity_cycles",
        "opportunity_usages",
        "opportunity_tasks",
        "opportunity_task_cycles",
        "opportunity_fulfillments",
        "opportunity_user_states",
        "opportunity_reminder_states",
        "notification_history",
    ]

    private static let tableUpsertOrder: [String: Int] = [
        "banks": 0,
        "card_products": 1,
        "benefits": 2,
        "promos": 3,
        "card_holders": 4,
        "credit_accounts": 5,
        "credit_cards": 6,
        "bills": 7,
        "bill_card_subtotals": 8,
        "payments": 9,
        "user_preferences": 10,
        "notification_preferences": 11,
        "payable_custom_categories": 12,
        "recurring_payables": 13,
        "recurring_payable_payments": 14,
        "opportunity_definitions": 15,
        "opportunity_rule_versions": 16,
        "opportunity_accounts": 17,
        "opportunity_account_cards": 18,
        "opportunity_cycles": 19,
        "opportunity_usages": 20,
        "opportunity_tasks": 21,
        "opportunity_task_cycles": 22,
        "opportunity_fulfillments": 23,
        "opportunity_user_states": 24,
        "opportunity_reminder_states": 25,
        "notification_history": 26,
    ]

    private static func pkColumn(for table: String) -> String {
        switch table {
        case "user_preferences", "notification_preferences":
            return "user_id"
        default:
            return "id"
        }
    }

    private static func compositePkColumns(for table: String) -> (String, String)? {
        switch table {
        case "opportunity_account_cards":
            return ("account_id", "card_id")
        case "opportunity_user_states":
            return ("user_id", "account_id")
        case "opportunity_reminder_states":
            return ("user_id", "event_key")
        default:
            return nil
        }
    }

    /// 按服务端 D1 `json_array(col1, col2)` 口径拼接复合主键 row_id。
    public static func compositeRowId(_ col1: String, _ col2: String) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: [col1, col2], options: []),
              let str = String(data: data, encoding: .utf8) else {
            return "[\"\(col1)\",\"\(col2)\"]"
        }
        return str
    }

    private static func decodeCompositeRowId(_ rowId: String) -> (String, String)? {
        guard let data = rowId.data(using: .utf8),
              let arr = try? JSONSerialization.jsonObject(with: data) as? [String],
              arr.count == 2 else {
            return nil
        }
        return (arr[0], arr[1])
    }

    private static func orderedChangesForApply(_ changes: [PullChangeItem]) -> [PullChangeItem] {
        let indexed = changes.enumerated().map { ($0.offset, $0.element) }
        return indexed.sorted { lhs, rhs in
            func rank(_ change: PullChangeItem) -> (Int, Int) {
                let order = tableUpsertOrder[change.tbl] ?? Int.max
                switch change.op {
                case "delete":
                    // Deletes first, children before parents.
                    return (0, order == Int.max ? Int.max : -order)
                case "upsert":
                    // Upserts next, parents before children.
                    return (1, order)
                default:
                    // Unknown ops preserve relative order so isolation still records them.
                    return (2, 0)
                }
            }
            let r1 = rank(lhs.1)
            let r2 = rank(rhs.1)
            if r1 != r2 { return r1 < r2 }
            return lhs.0 < rhs.0
        }.map(\.1)
    }

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

    /// 登出时调用。失效不可逆，后续登录必须由 AppState 创建新的引擎。
    public func invalidateSession() {
        sessionLock.withLock { sessionIsActive = false }
    }

    private func requireActiveSession() throws {
        guard sessionLock.withLock({ sessionIsActive }) else { throw SyncError.sessionExpired }
        try Task.checkCancellation()
    }

    public func sync() async throws {
        try requireActiveSession()
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

            // 请求前检查；失效或已取消后不得发新请求。
            try requireActiveSession()

            let response = try await apiClient.pull(cursor: cursor, reconcile: targets)
            guard response.cursor >= cursor else { throw SyncError.invalidCursor }
            guard !response.hasMore || response.cursor > cursor else { throw SyncError.invalidCursor }
            let returnedTargets = Set(response.changes.map { SyncReconcileTarget(tbl: $0.tbl, rowId: $0.rowId) })
            let acknowledged = Set(targets).intersection(returnedTargets)
            if !targets.isEmpty && acknowledged.isEmpty { throw SyncError.incompleteReconciliation }

            // 网络返回后及事务写前再次检查，取消不会写入服务端结果。
            try requireActiveSession()
            try requireActiveSession()
            let stillNeedsRecovery = try await dbManager.dbWriter.write { db in
                // 同步检查不能跨 async 边界；写入前失效会回滚整个事务。
                guard self.sessionLock.withLock({ self.sessionIsActive }) else {
                    throw SyncError.sessionExpired
                }
                // An edit may have been queued while the network request was in flight.
                try self.requireEmptyOutbox(in: db)
                // 按条隔离：单条 applyChange 失败不中断整批。整批单事务下任一条
                // 解码失败/外键约束抛错都会回滚全部并卡住 sync_cursor，同变更被
                // 永久重放、同步永久死锁。这里隔离坏行（记录后继续），保证游标
                // 总能前进；全部成功或部分隔离都提交事务并保存 cursor。
                var isolated: [[String: String]] = []
                for change in Self.orderedChangesForApply(response.changes) {
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

        // 只在发请求前检查，不读取 ApiClient.token：旧请求即使晚返回也不会用新账号凭据。
        try requireActiveSession()
        let results = try await apiClient.push(clientId: clientId, mutations: payloads)
        var resultMap: [String: MutationPushResult] = [:]
        for result in results {
            guard resultMap.updateValue(result, forKey: result.id) == nil else { throw SyncError.duplicateMutationResult }
        }
        let resultsByID = resultMap

        try requireActiveSession()
        try await dbManager.dbWriter.write { db in
            // 此处必须保持同步检查：NSLock 和 SQLite 状态在事务内可一致读取。
            guard self.sessionLock.withLock({ self.sessionIsActive }) else {
                throw SyncError.sessionExpired
            }
            for item in mutations {
                guard let res = resultsByID[item.id] else { continue }
                if res.ok {
                    // Success: remove from outbox & clean up temporary optimistic artifacts
                    try SyncMeta.deleteOne(db, key: "sync_retry_after_\(item.id)")
                    try item.delete(db)
                    try self.cleanupOptimisticArtifactsOnSuccess(item, in: db)
                    try self.removeOptimisticSnapshot(forMutationId: item.id, in: db)
                } else if res.permanent == true {
                    // Persist recovery before dropping the mutation, even if the server row
                    // has not changed since our last cursor or the app exits before pull.
                    let additions: [SyncReconcileTarget]
                    do {
                        additions = try self.targetsForRejectedMutation(item, result: res, in: db)
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
                    try self.removeOptimisticSnapshot(forMutationId: item.id, in: db)
                    try self.appendRejectedNotice(
                        SyncRejectedNotice(
                            mutationId: item.id,
                            mutationName: item.name,
                            message: res.error ?? "服务端拒绝了离线提交的修改，已恢复本地数据",
                            code: res.code
                        ),
                        in: db
                    )
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
            case "benefits": try BenefitRecord.deleteOne(db, id: rowId)
            case "promos": try PromoRecord.deleteOne(db, id: rowId)
            case "card_holders": try CardHolder.deleteOne(db, id: rowId)
            case "credit_accounts": try CreditAccount.deleteOne(db, id: rowId)
            case "credit_cards": try CreditCard.deleteOne(db, id: rowId)
            case "bills": try Bill.deleteOne(db, id: rowId)
            case "bill_card_subtotals": try BillCardSubtotal.deleteOne(db, id: rowId)
            case "payments": try Payment.deleteOne(db, id: rowId)
            case "user_preferences":
                try UserPreferenceRecord.filter(Column("user_id") == rowId).deleteAll(db)
            case "notification_preferences":
                try NotificationPreferenceRecord.filter(Column("user_id") == rowId).deleteAll(db)
            case "recurring_payables": try RecurringPayableRecord.deleteOne(db, id: rowId)
            case "recurring_payable_payments": try RecurringPayablePaymentRecord.deleteOne(db, id: rowId)
            case "payable_custom_categories": try PayableCustomCategoryRecord.deleteOne(db, id: rowId)
            case "opportunity_definitions": try OpportunityDefinitionRecord.deleteOne(db, id: rowId)
            case "opportunity_rule_versions": try OpportunityRuleVersionRecord.deleteOne(db, id: rowId)
            case "opportunity_accounts": try OpportunityAccountRecord.deleteOne(db, id: rowId)
            case "opportunity_account_cards":
                guard let (col1, col2) = Self.decodeCompositeRowId(rowId) else {
                    throw SyncError.invalidChange(table: tbl, rowID: rowId)
                }
                try OpportunityAccountCardRecord
                    .filter(Column("account_id") == col1 && Column("card_id") == col2)
                    .deleteAll(db)
            case "opportunity_cycles": try OpportunityCycleRecord.deleteOne(db, id: rowId)
            case "opportunity_usages": try OpportunityUsageRecord.deleteOne(db, id: rowId)
            case "opportunity_tasks": try OpportunityTaskRecord.deleteOne(db, id: rowId)
            case "opportunity_task_cycles": try OpportunityTaskCycleRecord.deleteOne(db, id: rowId)
            case "opportunity_fulfillments": try OpportunityFulfillmentRecord.deleteOne(db, id: rowId)
            case "opportunity_user_states":
                guard let (col1, col2) = Self.decodeCompositeRowId(rowId) else {
                    throw SyncError.invalidChange(table: tbl, rowID: rowId)
                }
                try OpportunityUserStateRecord
                    .filter(Column("user_id") == col1 && Column("account_id") == col2)
                    .deleteAll(db)
            case "opportunity_reminder_states":
                guard let (col1, col2) = Self.decodeCompositeRowId(rowId) else {
                    throw SyncError.invalidChange(table: tbl, rowID: rowId)
                }
                try OpportunityReminderStateRecord
                    .filter(Column("user_id") == col1 && Column("event_key") == col2)
                    .deleteAll(db)
            case "notification_history": try NotificationHistoryRecord.deleteOne(db, id: rowId)
            default: break
            }
            return
        }

        guard change.op == "upsert", let rowDict = change.row else {
            throw SyncError.invalidChange(table: tbl, rowID: rowId)
        }
        if let (c1, c2) = Self.compositePkColumns(for: tbl) {
            guard let (v1, v2) = Self.decodeCompositeRowId(rowId),
                  rowDict[c1]?.value as? String == v1,
                  rowDict[c2]?.value as? String == v2 else {
                throw SyncError.invalidChange(table: tbl, rowID: rowId)
            }
        } else {
            let pkCol = Self.pkColumn(for: tbl)
            guard rowDict[pkCol]?.value as? String == rowId else {
                throw SyncError.invalidChange(table: tbl, rowID: rowId)
            }
        }
        let jsonData = try JSONEncoder().encode(rowDict)
        let decoder = JSONDecoder()

        switch tbl {
        case "banks":
            try decoder.decode(Bank.self, from: jsonData).save(db)
        case "card_products":
            try decoder.decode(CardProduct.self, from: jsonData).save(db)
        case "benefits":
            try decoder.decode(BenefitRecord.self, from: jsonData).save(db)
        case "promos":
            try decoder.decode(PromoRecord.self, from: jsonData).save(db)
        case "card_holders":
            try decoder.decode(CardHolder.self, from: jsonData).save(db)
        case "credit_accounts":
            try decoder.decode(CreditAccount.self, from: jsonData).save(db)
        case "credit_cards":
            try decoder.decode(CreditCard.self, from: jsonData).save(db)
        case "bills":
            try decoder.decode(Bill.self, from: jsonData).save(db)
        case "bill_card_subtotals":
            try decoder.decode(BillCardSubtotal.self, from: jsonData).save(db)
        case "payments":
            try decoder.decode(Payment.self, from: jsonData).save(db)
        case "user_preferences":
            try decoder.decode(UserPreferenceRecord.self, from: jsonData).save(db)
        case "notification_preferences":
            try decoder.decode(NotificationPreferenceRecord.self, from: jsonData).save(db)
        case "recurring_payables":
            try decoder.decode(RecurringPayableRecord.self, from: jsonData).save(db)
        case "recurring_payable_payments":
            try decoder.decode(RecurringPayablePaymentRecord.self, from: jsonData).save(db)
        case "payable_custom_categories":
            try decoder.decode(PayableCustomCategoryRecord.self, from: jsonData).save(db)
        case "opportunity_definitions":
            try decoder.decode(OpportunityDefinitionRecord.self, from: jsonData).save(db)
        case "opportunity_rule_versions":
            try decoder.decode(OpportunityRuleVersionRecord.self, from: jsonData).save(db)
        case "opportunity_accounts":
            try decoder.decode(OpportunityAccountRecord.self, from: jsonData).save(db)
        case "opportunity_account_cards":
            try decoder.decode(OpportunityAccountCardRecord.self, from: jsonData).save(db)
        case "opportunity_cycles":
            try decoder.decode(OpportunityCycleRecord.self, from: jsonData).save(db)
        case "opportunity_usages":
            try decoder.decode(OpportunityUsageRecord.self, from: jsonData).save(db)
        case "opportunity_tasks":
            try decoder.decode(OpportunityTaskRecord.self, from: jsonData).save(db)
        case "opportunity_task_cycles":
            try decoder.decode(OpportunityTaskCycleRecord.self, from: jsonData).save(db)
        case "opportunity_fulfillments":
            try decoder.decode(OpportunityFulfillmentRecord.self, from: jsonData).save(db)
        case "opportunity_user_states":
            try decoder.decode(OpportunityUserStateRecord.self, from: jsonData).save(db)
        case "opportunity_reminder_states":
            try decoder.decode(OpportunityReminderStateRecord.self, from: jsonData).save(db)
        case "notification_history":
            try decoder.decode(NotificationHistoryRecord.self, from: jsonData).save(db)
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

    /// 读取持久化在 `sync_meta` 中的永久拒绝通知列表（按写入顺序，最多保留 20 条）。
    public func fetchRejectedNotices() async -> [SyncRejectedNotice] {
        (try? await dbManager.dbWriter.read { db in
            try self.rejectedNotices(in: db)
        }) ?? []
    }

    public func clearRejectedNotices() async throws {
        _ = try await dbManager.dbWriter.write { db in
            try SyncMeta.deleteOne(db, key: Self.rejectedNoticesMetaKey)
        }
    }

    private func rejectedNotices(in db: Database) throws -> [SyncRejectedNotice] {
        guard let value = try SyncMeta.fetchOne(db, key: Self.rejectedNoticesMetaKey)?.value,
              let data = value.data(using: .utf8),
              let decoded = try? JSONDecoder().decode([SyncRejectedNotice].self, from: data) else {
            return []
        }
        return decoded
    }

    private func appendRejectedNotice(_ notice: SyncRejectedNotice, in db: Database) throws {
        var existing = try rejectedNotices(in: db)
        existing.append(notice)
        if existing.count > Self.rejectedNoticesCap {
            existing.removeFirst(existing.count - Self.rejectedNoticesCap)
        }
        let data = try JSONEncoder().encode(existing)
        try SyncMeta(
            key: Self.rejectedNoticesMetaKey,
            value: String(decoding: data, as: UTF8.self)
        ).save(db)
    }

    // MARK: - Optimistic Rollback Snapshots

    public struct OptimisticSnapshot: Codable, Sendable {
        public var usage: OpportunityUsageRecord?
        public var sourceCycle: OpportunityCycleRecord?
        public var targetCycle: OpportunityCycleRecord?
        public var fulfillment: OpportunityFulfillmentRecord?
        public var taskCycle: OpportunityTaskCycleRecord?
        public var userState: OpportunityUserStateRecord?
        public var userStateKey: [String]?
        public var reminderState: OpportunityReminderStateRecord?
        public var reminderStateKey: [String]?
        public var notification: NotificationHistoryRecord?

        public init(
            usage: OpportunityUsageRecord? = nil,
            sourceCycle: OpportunityCycleRecord? = nil,
            targetCycle: OpportunityCycleRecord? = nil,
            fulfillment: OpportunityFulfillmentRecord? = nil,
            taskCycle: OpportunityTaskCycleRecord? = nil,
            userState: OpportunityUserStateRecord? = nil,
            userStateKey: [String]? = nil,
            reminderState: OpportunityReminderStateRecord? = nil,
            reminderStateKey: [String]? = nil,
            notification: NotificationHistoryRecord? = nil
        ) {
            self.usage = usage
            self.sourceCycle = sourceCycle
            self.targetCycle = targetCycle
            self.fulfillment = fulfillment
            self.taskCycle = taskCycle
            self.userState = userState
            self.userStateKey = userStateKey
            self.reminderState = reminderState
            self.reminderStateKey = reminderStateKey
            self.notification = notification
        }
    }

    public static func saveOptimisticSnapshot(
        _ snapshot: OptimisticSnapshot,
        forMutationId mutationId: String,
        in db: Database
    ) throws {
        var dict = loadAllOptimisticSnapshots(in: db)
        let encoded = try JSONEncoder().encode(snapshot)
        dict[mutationId] = String(decoding: encoded, as: UTF8.self)
        let wrapper = try JSONEncoder().encode(dict)
        try SyncMeta(key: optimisticSnapshotsMetaKey, value: String(decoding: wrapper, as: UTF8.self)).save(db)
    }

    private static func loadAllOptimisticSnapshots(in db: Database) -> [String: String] {
        guard let raw = (try? SyncMeta.fetchOne(db, key: optimisticSnapshotsMetaKey))?.value,
              let data = raw.data(using: .utf8),
              let dict = try? JSONDecoder().decode([String: String].self, from: data) else {
            return [:]
        }
        return dict
    }

    private func loadOptimisticSnapshot(forMutationId mutationId: String, in db: Database) -> OptimisticSnapshot? {
        guard let jsonStr = Self.loadAllOptimisticSnapshots(in: db)[mutationId],
              let data = jsonStr.data(using: .utf8) else {
            return nil
        }
        return try? JSONDecoder().decode(OptimisticSnapshot.self, from: data)
    }

    private func removeOptimisticSnapshot(forMutationId mutationId: String, in db: Database) throws {
        var dict = Self.loadAllOptimisticSnapshots(in: db)
        guard dict.removeValue(forKey: mutationId) != nil else { return }
        if dict.isEmpty {
            try SyncMeta.deleteOne(db, key: Self.optimisticSnapshotsMetaKey)
        } else {
            let wrapper = try JSONEncoder().encode(dict)
            try SyncMeta(key: Self.optimisticSnapshotsMetaKey, value: String(decoding: wrapper, as: UTF8.self)).save(db)
        }
    }

    private func cleanupOptimisticArtifactsOnSuccess(_ mutation: MutationOutbox, in db: Database) throws {
        let tempId = "opt_\(mutation.id)"
        switch mutation.name {
        case "cards.createCard":
            try CreditCard.deleteOne(db, id: tempId)
            try CreditAccount.deleteOne(db, id: "opt_acc_\(mutation.id)")
        case "bills.createBill":
            try Bill.deleteOne(db, id: tempId)
        case "opportunities.recordOpportunityUsage",
             "opportunities.completeOpportunityBooking":
            try OpportunityUsageRecord.deleteOne(db, id: tempId)
        case "opportunities.recordOpportunityClaim",
             "opportunities.recordOpportunityBooking",
             "opportunities.recordTaskRewardReceived":
            try OpportunityFulfillmentRecord.deleteOne(db, id: tempId)
        default:
            break
        }
    }

    private func targetsForRejectedMutation(
        _ item: MutationOutbox,
        result: MutationPushResult? = nil,
        in db: Database
    ) throws -> [SyncReconcileTarget] {
        let args = try JSONDecoder().decode([AnyCodable].self, from: Data(item.argsJson.utf8))
        switch item.name {
        case "bills.recordPayment":
            guard let input = args.first?.value as? [String: Any],
                  let billID = input["bill_id"] as? String, let paymentID = input["id"] as? String else {
                throw SyncError.invalidMutation(item.id)
            }
            return [.init(tbl: "bills", rowId: billID), .init(tbl: "payments", rowId: paymentID)]
        case "bills.setBillAmountOverride", "bills.updateBillFields", "bills.clearOverride":
            guard let id = args.first?.value as? String, !id.trimmingCharacters(in: .whitespaces).isEmpty else {
                throw SyncError.invalidMutation(item.id)
            }
            return [.init(tbl: "bills", rowId: id)]
        case "cards.updateCard":
            guard let id = args.first?.value as? String, !id.trimmingCharacters(in: .whitespaces).isEmpty else {
                throw SyncError.invalidMutation(item.id)
            }
            return [.init(tbl: "credit_cards", rowId: id)]
        case "cards.createCard":
            if let existingCardId = result?.details?.existingCardId?.trimmingCharacters(in: .whitespacesAndNewlines),
               !existingCardId.isEmpty {
                return [.init(tbl: "credit_cards", rowId: existingCardId)]
            }
            return []
        case "bills.createBill":
            if let existingBillId = result?.details?.existingBillId?.trimmingCharacters(in: .whitespacesAndNewlines),
               !existingBillId.isEmpty {
                return [.init(tbl: "bills", rowId: existingBillId)]
            }
            return []
        case "payments.updatePayment":
            guard let paymentId = args.first?.value as? String, !paymentId.trimmingCharacters(in: .whitespaces).isEmpty else {
                throw SyncError.invalidMutation(item.id)
            }
            var targets = [SyncReconcileTarget(tbl: "payments", rowId: paymentId)]
            if let existing = try Payment.fetchOne(db, id: paymentId) {
                targets.append(SyncReconcileTarget(tbl: "bills", rowId: existing.billId))
            }
            return targets
        case "payables.updateRecurringPayable":
            guard let id = args.first?.value as? String, !id.trimmingCharacters(in: .whitespaces).isEmpty else {
                throw SyncError.invalidMutation(item.id)
            }
            return [.init(tbl: "recurring_payables", rowId: id)]
        case "payables.createRecurringPayable",
             "notifications.markNotificationRead",
             "notifications.markAllNotificationsRead":
            // Either server-generated ID or table outside SYNCABLE_TABLES: drop cleanly without invalid reconcile targets.
            return []
        case "notifications.deleteNotification":
            guard let notifId = args.first?.value as? String, !notifId.trimmingCharacters(in: .whitespaces).isEmpty else {
                throw SyncError.invalidMutation(item.id)
            }
            return [.init(tbl: "notification_history", rowId: notifId)]
        case "preferences.updateUserPreferences":
            if let userId = args.first?.value as? String, !userId.trimmingCharacters(in: .whitespaces).isEmpty {
                return [.init(tbl: "user_preferences", rowId: userId)]
            }
            if let local = try UserPreferenceRecord.fetchOne(db), !local.userId.isEmpty {
                return [.init(tbl: "user_preferences", rowId: local.userId)]
            }
            return []
        case "opportunities.recordOpportunityUsage":
            guard let input = args.first?.value as? [String: Any],
                  let accountId = input["account_id"] as? String,
                  let cycleId = input["cycle_id"] as? String else {
                throw SyncError.invalidMutation(item.id)
            }
            return [
                .init(tbl: "opportunity_accounts", rowId: accountId),
                .init(tbl: "opportunity_cycles", rowId: cycleId),
            ]
        case "opportunities.correctOpportunityUsage":
            guard let input = args.first?.value as? [String: Any],
                  let usageId = input["usage_id"] as? String else {
                throw SyncError.invalidMutation(item.id)
            }
            var targets = [SyncReconcileTarget(tbl: "opportunity_usages", rowId: usageId)]
            if let existing = try OpportunityUsageRecord.fetchOne(db, id: usageId) {
                targets.append(.init(tbl: "opportunity_cycles", rowId: existing.cycleId))
            }
            if let newCycleId = input["cycle_id"] as? String, !newCycleId.isEmpty {
                targets.append(.init(tbl: "opportunity_cycles", rowId: newCycleId))
            }
            return targets
        case "opportunities.voidOpportunityUsage":
            guard let input = args.first?.value as? [String: Any],
                  let usageId = input["usage_id"] as? String else {
                throw SyncError.invalidMutation(item.id)
            }
            var targets = [SyncReconcileTarget(tbl: "opportunity_usages", rowId: usageId)]
            if let existing = try OpportunityUsageRecord.fetchOne(db, id: usageId) {
                targets.append(.init(tbl: "opportunity_cycles", rowId: existing.cycleId))
            }
            return targets
        case "opportunities.recordOpportunityClaim",
             "opportunities.recordOpportunityBooking":
            guard let input = args.first?.value as? [String: Any],
                  let accountId = input["account_id"] as? String,
                  let cycleId = input["cycle_id"] as? String else {
                throw SyncError.invalidMutation(item.id)
            }
            return [
                .init(tbl: "opportunity_accounts", rowId: accountId),
                .init(tbl: "opportunity_cycles", rowId: cycleId),
            ]
        case "opportunities.voidOpportunityClaim",
             "opportunities.completeOpportunityBooking",
             "opportunities.cancelOpportunityBooking":
            guard let input = args.first?.value as? [String: Any],
                  let fulfillmentId = input["fulfillment_id"] as? String else {
                throw SyncError.invalidMutation(item.id)
            }
            var targets = [SyncReconcileTarget(tbl: "opportunity_fulfillments", rowId: fulfillmentId)]
            if let existing = try OpportunityFulfillmentRecord.fetchOne(db, id: fulfillmentId),
               let cycleId = existing.cycleId {
                targets.append(.init(tbl: "opportunity_cycles", rowId: cycleId))
            }
            return targets
        case "opportunities.updateManualTaskProgress":
            guard let input = args.first?.value as? [String: Any],
                  let taskCycleId = input["task_cycle_id"] as? String else {
                throw SyncError.invalidMutation(item.id)
            }
            return [.init(tbl: "opportunity_task_cycles", rowId: taskCycleId)]
        case "opportunities.recordTaskRewardReceived":
            guard let input = args.first?.value as? [String: Any],
                  let taskCycleId = input["task_cycle_id"] as? String else {
                throw SyncError.invalidMutation(item.id)
            }
            var targets = [SyncReconcileTarget(tbl: "opportunity_task_cycles", rowId: taskCycleId)]
            if let accountId = input["account_id"] as? String, !accountId.isEmpty {
                targets.append(.init(tbl: "opportunity_accounts", rowId: accountId))
            }
            return targets
        case "opportunities.setOpportunityFollowed":
            guard let input = args.first?.value as? [String: Any],
                  let accountId = input["account_id"] as? String else {
                throw SyncError.invalidMutation(item.id)
            }
            if let userId = loadOptimisticSnapshot(forMutationId: item.id, in: db)?.userStateKey?.first,
               !userId.isEmpty {
                return [.init(tbl: "opportunity_user_states", rowId: Self.compositeRowId(userId, accountId))]
            }
            return [.init(tbl: "opportunity_accounts", rowId: accountId)]
        case "opportunities.updateOpportunityReminderState":
            guard let input = args.first?.value as? [String: Any],
                  let eventKey = input["event_key"] as? String else {
                throw SyncError.invalidMutation(item.id)
            }
            if let userId = loadOptimisticSnapshot(forMutationId: item.id, in: db)?.reminderStateKey?.first,
               !userId.isEmpty {
                return [.init(tbl: "opportunity_reminder_states", rowId: Self.compositeRowId(userId, eventKey))]
            }
            return []
        default:
            throw SyncError.invalidMutation(item.id)
        }
    }

    private func rollbackMutation(_ mutation: MutationOutbox, in db: Database) throws {
        let tempId = "opt_\(mutation.id)"

        // 1. Delete optimistic newly-created temporary rows
        switch mutation.name {
        case "cards.createCard":
            try CreditCard.deleteOne(db, id: tempId)
            try CreditAccount.deleteOne(db, id: "opt_acc_\(mutation.id)")
            return
        case "bills.createBill":
            try Bill.deleteOne(db, id: tempId)
            return
        case "bills.recordPayment":
            guard let data = mutation.argsJson.data(using: .utf8),
                  let args = (try? JSONSerialization.jsonObject(with: data)) as? [[String: Any]],
                  let firstArg = args.first,
                  let payId = firstArg["id"] as? String,
                  let billId = firstArg["bill_id"] as? String else {
                return
            }
            try Payment.deleteOne(db, id: payId)
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
            return
        default:
            break
        }

        // 2. Restore Phase-2 snapshots (and remove any temp rows created optimistically)
        switch mutation.name {
        case "opportunities.recordOpportunityUsage":
            try OpportunityUsageRecord.deleteOne(db, id: tempId)
        case "opportunities.completeOpportunityBooking":
            try OpportunityUsageRecord.deleteOne(db, id: tempId)
        case "opportunities.recordOpportunityClaim",
             "opportunities.recordOpportunityBooking",
             "opportunities.recordTaskRewardReceived":
            try OpportunityFulfillmentRecord.deleteOne(db, id: tempId)
        default:
            break
        }

        guard let snapshot = loadOptimisticSnapshot(forMutationId: mutation.id, in: db) else {
            return
        }
        if let usage = snapshot.usage { try usage.save(db) }
        if let sourceCycle = snapshot.sourceCycle { try sourceCycle.save(db) }
        if let targetCycle = snapshot.targetCycle { try targetCycle.save(db) }
        if let fulfillment = snapshot.fulfillment { try fulfillment.save(db) }
        if let taskCycle = snapshot.taskCycle { try taskCycle.save(db) }
        if let key = snapshot.userStateKey, key.count == 2 {
            if let userState = snapshot.userState {
                try userState.save(db)
            } else {
                try OpportunityUserStateRecord
                    .filter(Column("user_id") == key[0] && Column("account_id") == key[1])
                    .deleteAll(db)
            }
        }
        if let key = snapshot.reminderStateKey, key.count == 2 {
            if let remState = snapshot.reminderState {
                try remState.save(db)
            } else {
                try OpportunityReminderStateRecord
                    .filter(Column("user_id") == key[0] && Column("event_key") == key[1])
                    .deleteAll(db)
            }
        }
        if let notif = snapshot.notification { try notif.save(db) }
    }
}
