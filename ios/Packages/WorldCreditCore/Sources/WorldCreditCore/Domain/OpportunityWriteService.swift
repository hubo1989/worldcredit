import Foundation
import GRDB

public enum OpportunityWriteError: LocalizedError, Equatable {
    case invalidQuantity
    case invalidAmount
    case invalidDate(String)
    case emptyReason
    case recordNotFound(String)
    case invalidState(String)

    public var errorDescription: String? {
        switch self {
        case .invalidQuantity: return "使用次数必须是正整数"
        case .invalidAmount: return "金额必须是非负整数"
        case .invalidDate(let v): return "日期不合法（需 YYYY-MM-DD）：\(v)"
        case .emptyReason: return "请输入修改/作废原因"
        case .recordNotFound(let k): return "未找到本地记录：\(k)"
        case .invalidState(let s): return s
        }
    }
}

public struct OpportunityWriteService: Sendable {
    public let dbManager: DatabaseManager

    public init(dbManager: DatabaseManager) {
        self.dbManager = dbManager
    }

    private func nowISO() -> String {
        ISO8601DateFormatter().string(from: Date())
    }

    private func encodeArgs(_ args: [AnyCodable]) throws -> String {
        let data = try JSONEncoder().encode(args)
        return String(decoding: data, as: UTF8.self)
    }

    // MARK: - 1. Record Usage

    @discardableResult
    public func recordUsage(
        accountId: String,
        cycleId: String,
        cardId: String,
        usedOn: String,
        quantity: Int,
        amountMinor: Int,
        note: String? = nil,
        actorUserId: String = "",
        requestKey: String = UUID().uuidString.lowercased()
    ) async throws -> String {
        guard quantity > 0 else { throw OpportunityWriteError.invalidQuantity }
        guard amountMinor >= 0 else { throw OpportunityWriteError.invalidAmount }
        guard OpportunityDates.isValidCivilDate(usedOn) else { throw OpportunityWriteError.invalidDate(usedOn) }

        let mutId = UUID().uuidString.lowercased()
        let tempId = "opt_\(mutId)"
        let now = nowISO()

        try await dbManager.dbWriter.write { db in
            guard var cycle = try OpportunityCycleRecord.fetchOne(db, id: cycleId),
                  cycle.accountId == accountId else {
                throw OpportunityWriteError.recordNotFound(cycleId)
            }
            if let limit = cycle.countLimit,
               cycle.openingUsedCount + cycle.usedCount + cycle.reservedCount + quantity > limit {
                throw OpportunityWriteError.invalidState("超出本期可用次数上限")
            }
            if let limitMinor = cycle.amountLimitMinor,
               cycle.openingUsedMinor + cycle.usedMinor + cycle.reservedMinor + amountMinor > limitMinor {
                throw OpportunityWriteError.invalidState("超出本期可用金额上限")
            }

            try SyncEngine.saveOptimisticSnapshot(
                SyncEngine.OptimisticSnapshot(sourceCycle: cycle),
                forMutationId: mutId,
                in: db
            )

            let usage = OpportunityUsageRecord(
                id: tempId,
                accountId: accountId,
                cycleId: cycleId,
                cardId: cardId,
                usedOn: usedOn,
                quantity: quantity,
                amountMinor: amountMinor,
                note: note,
                status: "active",
                revision: 1,
                createdBy: actorUserId,
                updatedBy: actorUserId,
                createdAt: now,
                updatedAt: now
            )
            try usage.insert(db)

            cycle.usedCount += quantity
            cycle.usedMinor += amountMinor
            cycle.revision += 1
            try cycle.update(db)

            var input: [String: Any] = [
                "account_id": accountId,
                "cycle_id": cycleId,
                "card_id": cardId,
                "used_on": usedOn,
                "quantity": quantity,
                "amount_minor": amountMinor,
                "request_key": requestKey,
            ]
            input["note"] = note ?? NSNull()
            try MutationOutbox(
                id: mutId,
                name: "opportunities.recordOpportunityUsage",
                argsJson: try encodeArgs([AnyCodable(input)]),
                createdAt: now
            ).insert(db)
        }
        return tempId
    }

    // MARK: - 2. Correct Usage

    public func correctUsage(
        usageId: String,
        usedOn: String? = nil,
        cycleId: String? = nil,
        cardId: String? = nil,
        quantity: Int? = nil,
        amountMinor: Int? = nil,
        note: String? = nil,
        clearNote: Bool = false,
        reason: String,
        expectedRevision: Int,
        actorUserId: String = "",
        requestKey: String = UUID().uuidString.lowercased()
    ) async throws {
        let trimmedReason = reason.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedReason.isEmpty else { throw OpportunityWriteError.emptyReason }
        if let usedOn, !OpportunityDates.isValidCivilDate(usedOn) {
            throw OpportunityWriteError.invalidDate(usedOn)
        }
        if let quantity, quantity <= 0 { throw OpportunityWriteError.invalidQuantity }
        if let amountMinor, amountMinor < 0 { throw OpportunityWriteError.invalidAmount }

        let mutId = UUID().uuidString.lowercased()
        let now = nowISO()

        try await dbManager.dbWriter.write { db in
            guard var usage = try OpportunityUsageRecord.fetchOne(db, id: usageId) else {
                throw OpportunityWriteError.recordNotFound(usageId)
            }
            guard var sourceCycle = try OpportunityCycleRecord.fetchOne(db, id: usage.cycleId) else {
                throw OpportunityWriteError.recordNotFound(usage.cycleId)
            }
            let targetCycleId = cycleId ?? usage.cycleId
            var targetCycle: OpportunityCycleRecord? = (targetCycleId == sourceCycle.id)
                ? nil
                : try OpportunityCycleRecord.fetchOne(db, id: targetCycleId)

            try SyncEngine.saveOptimisticSnapshot(
                SyncEngine.OptimisticSnapshot(
                    usage: usage,
                    sourceCycle: sourceCycle,
                    targetCycle: targetCycle
                ),
                forMutationId: mutId,
                in: db
            )

            let oldQty = usage.quantity
            let oldMinor = usage.amountMinor
            let newQty = quantity ?? oldQty
            let newMinor = amountMinor ?? oldMinor

            if usage.status == "active" {
                if var t = targetCycle {
                    sourceCycle.usedCount = max(0, sourceCycle.usedCount - oldQty)
                    sourceCycle.usedMinor = max(0, sourceCycle.usedMinor - oldMinor)
                    sourceCycle.revision += 1
                    t.usedCount += newQty
                    t.usedMinor += newMinor
                    t.revision += 1
                    try sourceCycle.update(db)
                    try t.update(db)
                    targetCycle = t
                } else {
                    sourceCycle.usedCount = max(0, sourceCycle.usedCount - oldQty + newQty)
                    sourceCycle.usedMinor = max(0, sourceCycle.usedMinor - oldMinor + newMinor)
                    sourceCycle.revision += 1
                    try sourceCycle.update(db)
                }
            }

            if let usedOn { usage.usedOn = usedOn }
            if let cycleId { usage.cycleId = cycleId }
            if let cardId { usage.cardId = cardId }
            usage.quantity = newQty
            usage.amountMinor = newMinor
            if clearNote {
                usage.note = nil
            } else if let note {
                usage.note = note
            }
            usage.revision += 1
            usage.updatedBy = actorUserId
            usage.updatedAt = now
            try usage.update(db)

            var input: [String: Any] = [
                "usage_id": usageId,
                "reason": trimmedReason,
                "expected_revision": expectedRevision,
                "request_key": requestKey,
            ]
            if let usedOn { input["used_on"] = usedOn }
            if let cycleId { input["cycle_id"] = cycleId }
            if let cardId { input["card_id"] = cardId }
            if let quantity { input["quantity"] = quantity }
            if let amountMinor { input["amount_minor"] = amountMinor }
            if clearNote {
                input["note"] = NSNull()
            } else if let note {
                input["note"] = note
            }

            try MutationOutbox(
                id: mutId,
                name: "opportunities.correctOpportunityUsage",
                argsJson: try encodeArgs([AnyCodable(input)]),
                createdAt: now
            ).insert(db)
        }
    }

    // MARK: - 3. Void Usage

    public func voidUsage(
        usageId: String,
        reason: String,
        expectedRevision: Int,
        actorUserId: String = "",
        requestKey: String = UUID().uuidString.lowercased()
    ) async throws {
        let trimmedReason = reason.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedReason.isEmpty else { throw OpportunityWriteError.emptyReason }
        let mutId = UUID().uuidString.lowercased()
        let now = nowISO()

        try await dbManager.dbWriter.write { db in
            guard var usage = try OpportunityUsageRecord.fetchOne(db, id: usageId) else {
                throw OpportunityWriteError.recordNotFound(usageId)
            }
            guard var cycle = try OpportunityCycleRecord.fetchOne(db, id: usage.cycleId) else {
                throw OpportunityWriteError.recordNotFound(usage.cycleId)
            }
            try SyncEngine.saveOptimisticSnapshot(
                SyncEngine.OptimisticSnapshot(usage: usage, sourceCycle: cycle),
                forMutationId: mutId,
                in: db
            )

            if usage.status == "active" {
                cycle.usedCount = max(0, cycle.usedCount - usage.quantity)
                cycle.usedMinor = max(0, cycle.usedMinor - usage.amountMinor)
                cycle.revision += 1
                try cycle.update(db)
            }
            usage.status = "voided"
            usage.revision += 1
            usage.updatedBy = actorUserId
            usage.updatedAt = now
            try usage.update(db)

            let input: [String: Any] = [
                "usage_id": usageId,
                "reason": trimmedReason,
                "expected_revision": expectedRevision,
                "request_key": requestKey,
            ]
            try MutationOutbox(
                id: mutId,
                name: "opportunities.voidOpportunityUsage",
                argsJson: try encodeArgs([AnyCodable(input)]),
                createdAt: now
            ).insert(db)
        }
    }

    // MARK: - 4. Record Claim

    @discardableResult
    public func recordClaim(
        accountId: String,
        cycleId: String,
        cardId: String,
        claimedOn: String,
        holderId: String,
        note: String? = nil,
        actorUserId: String = "",
        requestKey: String = UUID().uuidString.lowercased()
    ) async throws -> String {
        guard OpportunityDates.isValidCivilDate(claimedOn) else { throw OpportunityWriteError.invalidDate(claimedOn) }
        let mutId = UUID().uuidString.lowercased()
        let tempId = "opt_\(mutId)"
        let now = nowISO()

        try await dbManager.dbWriter.write { db in
            guard var cycle = try OpportunityCycleRecord.fetchOne(db, id: cycleId) else {
                throw OpportunityWriteError.recordNotFound(cycleId)
            }
            try SyncEngine.saveOptimisticSnapshot(
                SyncEngine.OptimisticSnapshot(sourceCycle: cycle),
                forMutationId: mutId,
                in: db
            )

            cycle.activationState = "active"
            cycle.revision += 1
            try cycle.update(db)

            let fulfillment = OpportunityFulfillmentRecord(
                id: tempId,
                holderId: holderId,
                kind: "claim",
                accountId: accountId,
                cycleId: cycleId,
                sourceKey: "claim:\(accountId):\(cycleId)",
                cardId: cardId,
                status: "recorded",
                quantity: 1,
                amountMinor: 0,
                recordedOn: claimedOn,
                note: note,
                revision: 1,
                createdBy: actorUserId,
                updatedBy: actorUserId,
                createdAt: now,
                updatedAt: now
            )
            try fulfillment.insert(db)

            var input: [String: Any] = [
                "account_id": accountId,
                "cycle_id": cycleId,
                "card_id": cardId,
                "claimed_on": claimedOn,
                "request_key": requestKey,
            ]
            input["note"] = note ?? NSNull()
            try MutationOutbox(
                id: mutId,
                name: "opportunities.recordOpportunityClaim",
                argsJson: try encodeArgs([AnyCodable(input)]),
                createdAt: now
            ).insert(db)
        }
        return tempId
    }

    // MARK: - 5. Void Claim

    public func voidClaim(
        fulfillmentId: String,
        reason: String,
        expectedRevision: Int,
        actorUserId: String = "",
        requestKey: String = UUID().uuidString.lowercased()
    ) async throws {
        let trimmedReason = reason.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedReason.isEmpty else { throw OpportunityWriteError.emptyReason }
        let mutId = UUID().uuidString.lowercased()
        let now = nowISO()

        try await dbManager.dbWriter.write { db in
            guard var fulfillment = try OpportunityFulfillmentRecord.fetchOne(db, id: fulfillmentId) else {
                throw OpportunityWriteError.recordNotFound(fulfillmentId)
            }
            var cycle = try fulfillment.cycleId.flatMap { try OpportunityCycleRecord.fetchOne(db, id: $0) }
            try SyncEngine.saveOptimisticSnapshot(
                SyncEngine.OptimisticSnapshot(sourceCycle: cycle, fulfillment: fulfillment),
                forMutationId: mutId,
                in: db
            )

            fulfillment.status = "cancelled"
            fulfillment.revision += 1
            fulfillment.updatedBy = actorUserId
            fulfillment.updatedAt = now
            try fulfillment.update(db)

            if var c = cycle {
                c.activationState = "pending_claim"
                c.revision += 1
                try c.update(db)
                cycle = c
            }

            let input: [String: Any] = [
                "fulfillment_id": fulfillmentId,
                "reason": trimmedReason,
                "expected_revision": expectedRevision,
                "request_key": requestKey,
            ]
            try MutationOutbox(
                id: mutId,
                name: "opportunities.voidOpportunityClaim",
                argsJson: try encodeArgs([AnyCodable(input)]),
                createdAt: now
            ).insert(db)
        }
    }

    // MARK: - 6. Record Booking

    @discardableResult
    public func recordBooking(
        accountId: String,
        cycleId: String,
        cardId: String,
        holderId: String,
        serviceAt: String,
        serviceTimeZone: String = "Asia/Shanghai",
        quantity: Int,
        amountMinor: Int,
        note: String? = nil,
        actorUserId: String = "",
        requestKey: String = UUID().uuidString.lowercased()
    ) async throws -> String {
        guard quantity > 0 else { throw OpportunityWriteError.invalidQuantity }
        guard amountMinor >= 0 else { throw OpportunityWriteError.invalidAmount }
        let mutId = UUID().uuidString.lowercased()
        let tempId = "opt_\(mutId)"
        let now = nowISO()
        let recordedOn = OpportunityDates.localDateInZone(Date(), timeZone: serviceTimeZone)

        try await dbManager.dbWriter.write { db in
            guard var cycle = try OpportunityCycleRecord.fetchOne(db, id: cycleId) else {
                throw OpportunityWriteError.recordNotFound(cycleId)
            }
            if let limit = cycle.countLimit,
               cycle.openingUsedCount + cycle.usedCount + cycle.reservedCount + quantity > limit {
                throw OpportunityWriteError.invalidState("超出本期可预约次数上限")
            }
            if let limitMinor = cycle.amountLimitMinor,
               cycle.openingUsedMinor + cycle.usedMinor + cycle.reservedMinor + amountMinor > limitMinor {
                throw OpportunityWriteError.invalidState("超出本期可预约金额上限")
            }

            try SyncEngine.saveOptimisticSnapshot(
                SyncEngine.OptimisticSnapshot(sourceCycle: cycle),
                forMutationId: mutId,
                in: db
            )

            cycle.reservedCount += quantity
            cycle.reservedMinor += amountMinor
            cycle.revision += 1
            try cycle.update(db)

            let fulfillment = OpportunityFulfillmentRecord(
                id: tempId,
                holderId: holderId,
                kind: "booking",
                accountId: accountId,
                cycleId: cycleId,
                sourceKey: "booking:\(tempId)",
                cardId: cardId,
                status: "recorded",
                quantity: quantity,
                amountMinor: amountMinor,
                recordedOn: recordedOn,
                serviceAt: serviceAt,
                serviceTimeZone: serviceTimeZone,
                note: note,
                revision: 1,
                createdBy: actorUserId,
                updatedBy: actorUserId,
                createdAt: now,
                updatedAt: now
            )
            try fulfillment.insert(db)

            var input: [String: Any] = [
                "account_id": accountId,
                "cycle_id": cycleId,
                "card_id": cardId,
                "service_at": serviceAt,
                "service_time_zone": serviceTimeZone,
                "quantity": quantity,
                "amount_minor": amountMinor,
                "request_key": requestKey,
            ]
            input["note"] = note ?? NSNull()
            try MutationOutbox(
                id: mutId,
                name: "opportunities.recordOpportunityBooking",
                argsJson: try encodeArgs([AnyCodable(input)]),
                createdAt: now
            ).insert(db)
        }
        return tempId
    }

    // MARK: - 7. Complete Booking

    public func completeBooking(
        fulfillmentId: String,
        usedOn: String,
        expectedRevision: Int,
        actorUserId: String = "",
        requestKey: String = UUID().uuidString.lowercased()
    ) async throws {
        guard OpportunityDates.isValidCivilDate(usedOn) else { throw OpportunityWriteError.invalidDate(usedOn) }
        let mutId = UUID().uuidString.lowercased()
        let tempUsageId = "opt_\(mutId)"
        let now = nowISO()

        try await dbManager.dbWriter.write { db in
            guard var fulfillment = try OpportunityFulfillmentRecord.fetchOne(db, id: fulfillmentId),
                  let accountId = fulfillment.accountId,
                  let cycleId = fulfillment.cycleId,
                  let cardId = fulfillment.cardId else {
                throw OpportunityWriteError.recordNotFound(fulfillmentId)
            }
            var cycle = try OpportunityCycleRecord.fetchOne(db, id: cycleId)
            try SyncEngine.saveOptimisticSnapshot(
                SyncEngine.OptimisticSnapshot(sourceCycle: cycle, fulfillment: fulfillment),
                forMutationId: mutId,
                in: db
            )

            let usage = OpportunityUsageRecord(
                id: tempUsageId,
                accountId: accountId,
                cycleId: cycleId,
                cardId: cardId,
                usedOn: usedOn,
                quantity: fulfillment.quantity,
                amountMinor: fulfillment.amountMinor,
                note: fulfillment.note,
                status: "active",
                revision: 1,
                createdBy: actorUserId,
                updatedBy: actorUserId,
                createdAt: now,
                updatedAt: now
            )
            try usage.insert(db)

            if var c = cycle {
                c.reservedCount = max(0, c.reservedCount - fulfillment.quantity)
                c.reservedMinor = max(0, c.reservedMinor - fulfillment.amountMinor)
                c.usedCount += fulfillment.quantity
                c.usedMinor += fulfillment.amountMinor
                c.revision += 1
                try c.update(db)
                cycle = c
            }

            fulfillment.status = "used"
            fulfillment.usageId = tempUsageId
            fulfillment.revision += 1
            fulfillment.updatedBy = actorUserId
            fulfillment.updatedAt = now
            try fulfillment.update(db)

            let input: [String: Any] = [
                "fulfillment_id": fulfillmentId,
                "used_on": usedOn,
                "expected_revision": expectedRevision,
                "request_key": requestKey,
            ]
            try MutationOutbox(
                id: mutId,
                name: "opportunities.completeOpportunityBooking",
                argsJson: try encodeArgs([AnyCodable(input)]),
                createdAt: now
            ).insert(db)
        }
    }

    // MARK: - 8. Cancel Booking

    public func cancelBooking(
        fulfillmentId: String,
        settlement: String,
        reason: String,
        expectedRevision: Int,
        actorUserId: String = "",
        requestKey: String = UUID().uuidString.lowercased()
    ) async throws {
        let trimmedReason = reason.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedReason.isEmpty else { throw OpportunityWriteError.emptyReason }
        let mutId = UUID().uuidString.lowercased()
        let now = nowISO()

        try await dbManager.dbWriter.write { db in
            guard var fulfillment = try OpportunityFulfillmentRecord.fetchOne(db, id: fulfillmentId) else {
                throw OpportunityWriteError.recordNotFound(fulfillmentId)
            }
            var cycle = try fulfillment.cycleId.flatMap { try OpportunityCycleRecord.fetchOne(db, id: $0) }
            try SyncEngine.saveOptimisticSnapshot(
                SyncEngine.OptimisticSnapshot(sourceCycle: cycle, fulfillment: fulfillment),
                forMutationId: mutId,
                in: db
            )

            if var c = cycle {
                if settlement == "returned" {
                    if fulfillment.status == "recorded" {
                        c.reservedCount = max(0, c.reservedCount - fulfillment.quantity)
                        c.reservedMinor = max(0, c.reservedMinor - fulfillment.amountMinor)
                    } else if fulfillment.status == "pending_settlement" {
                        // already in pending_settlement or reserved; release safely
                        c.reservedCount = max(0, c.reservedCount - fulfillment.quantity)
                        c.reservedMinor = max(0, c.reservedMinor - fulfillment.amountMinor)
                    }
                } else if settlement == "charged" {
                    c.reservedCount = max(0, c.reservedCount - fulfillment.quantity)
                    c.reservedMinor = max(0, c.reservedMinor - fulfillment.amountMinor)
                    c.usedCount += fulfillment.quantity
                    c.usedMinor += fulfillment.amountMinor
                }
                c.revision += 1
                try c.update(db)
                cycle = c
            }

            fulfillment.settlement = settlement
            fulfillment.status = (settlement == "unknown") ? "pending_settlement" : "cancelled"
            fulfillment.revision += 1
            fulfillment.updatedBy = actorUserId
            fulfillment.updatedAt = now
            try fulfillment.update(db)

            let input: [String: Any] = [
                "fulfillment_id": fulfillmentId,
                "settlement": settlement,
                "reason": trimmedReason,
                "expected_revision": expectedRevision,
                "request_key": requestKey,
            ]
            try MutationOutbox(
                id: mutId,
                name: "opportunities.cancelOpportunityBooking",
                argsJson: try encodeArgs([AnyCodable(input)]),
                createdAt: now
            ).insert(db)
        }
    }

    // MARK: - 9. Update Manual Task Progress

    public func updateTaskProgress(
        taskCycleId: String,
        progress: ManualProgress,
        reason: String,
        expectedRevision: Int,
        actorUserId: String = "",
        requestKey: String = UUID().uuidString.lowercased()
    ) async throws {
        let trimmedReason = reason.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedReason.isEmpty else { throw OpportunityWriteError.emptyReason }
        guard OpportunityDates.isValidCivilDate(progress.asOfOn) else {
            throw OpportunityWriteError.invalidDate(progress.asOfOn)
        }
        let mutId = UUID().uuidString.lowercased()
        let now = nowISO()

        try await dbManager.dbWriter.write { db in
            guard var tc = try OpportunityTaskCycleRecord.fetchOne(db, id: taskCycleId) else {
                throw OpportunityWriteError.recordNotFound(taskCycleId)
            }
            try SyncEngine.saveOptimisticSnapshot(
                SyncEngine.OptimisticSnapshot(taskCycle: tc),
                forMutationId: mutId,
                in: db
            )

            let encodedProgressData = try JSONEncoder().encode(progress)
            tc.progressJson = String(decoding: encodedProgressData, as: UTF8.self)
            tc.asOfOn = progress.asOfOn
            tc.revision += 1
            tc.updatedBy = actorUserId
            tc.updatedAt = now
            try tc.update(db)

            let progressObj = try JSONSerialization.jsonObject(with: encodedProgressData)
            let input: [String: Any] = [
                "task_cycle_id": taskCycleId,
                "progress": progressObj,
                "reason": trimmedReason,
                "expected_revision": expectedRevision,
                "request_key": requestKey,
            ]
            try MutationOutbox(
                id: mutId,
                name: "opportunities.updateManualTaskProgress",
                argsJson: try encodeArgs([AnyCodable(input)]),
                createdAt: now
            ).insert(db)
        }
    }

    // MARK: - 10. Record Task Reward Received

    @discardableResult
    public func recordTaskRewardReceived(
        taskCycleId: String,
        rewardKey: String,
        receivedOn: String,
        holderId: String,
        accountId: String? = nil,
        usableStartOn: String? = nil,
        usableEndBefore: String? = nil,
        note: String? = nil,
        actorUserId: String = "",
        requestKey: String = UUID().uuidString.lowercased()
    ) async throws -> String {
        guard OpportunityDates.isValidCivilDate(receivedOn) else {
            throw OpportunityWriteError.invalidDate(receivedOn)
        }
        let mutId = UUID().uuidString.lowercased()
        let tempId = "opt_\(mutId)"
        let now = nowISO()

        try await dbManager.dbWriter.write { db in
            guard let tc = try OpportunityTaskCycleRecord.fetchOne(db, id: taskCycleId) else {
                throw OpportunityWriteError.recordNotFound(taskCycleId)
            }
            try SyncEngine.saveOptimisticSnapshot(
                SyncEngine.OptimisticSnapshot(taskCycle: tc),
                forMutationId: mutId,
                in: db
            )

            let fulfillment = OpportunityFulfillmentRecord(
                id: tempId,
                holderId: holderId,
                kind: accountId == nil ? "task_result" : "grant",
                accountId: accountId,
                cycleId: nil,
                taskCycleId: taskCycleId,
                rewardKey: rewardKey,
                sourceKey: "reward:\(taskCycleId):\(rewardKey)",
                status: "recorded",
                quantity: 1,
                amountMinor: 0,
                recordedOn: receivedOn,
                note: note,
                revision: 1,
                createdBy: actorUserId,
                updatedBy: actorUserId,
                createdAt: now,
                updatedAt: now
            )
            try fulfillment.insert(db)

            var input: [String: Any] = [
                "task_cycle_id": taskCycleId,
                "reward_key": rewardKey,
                "received_on": receivedOn,
                "request_key": requestKey,
            ]
            input["account_id"] = accountId ?? NSNull()
            input["usable_start_on"] = usableStartOn ?? NSNull()
            input["usable_end_before"] = usableEndBefore ?? NSNull()
            input["note"] = note ?? NSNull()
            try MutationOutbox(
                id: mutId,
                name: "opportunities.recordTaskRewardReceived",
                argsJson: try encodeArgs([AnyCodable(input)]),
                createdAt: now
            ).insert(db)
        }
        return tempId
    }

    // MARK: - 11. Set Opportunity Followed

    public func setFollowed(
        userId: String,
        accountId: String,
        followed: Bool,
        expectedRevision: Int? = nil
    ) async throws {
        let mutId = UUID().uuidString.lowercased()
        let now = nowISO()

        try await dbManager.dbWriter.write { db in
            let existing = try OpportunityUserStateRecord
                .filter(Column("user_id") == userId && Column("account_id") == accountId)
                .fetchOne(db)

            try SyncEngine.saveOptimisticSnapshot(
                SyncEngine.OptimisticSnapshot(userState: existing, userStateKey: [userId, accountId]),
                forMutationId: mutId,
                in: db
            )

            var record = existing ?? OpportunityUserStateRecord(userId: userId, accountId: accountId, followed: followed, revision: 0, updatedAt: now)
            record.followed = followed
            record.revision = (existing?.revision ?? 0) + 1
            record.updatedAt = now
            try record.save(db)

            var input: [String: Any] = [
                "account_id": accountId,
                "followed": followed,
            ]
            if let expectedRevision { input["expected_revision"] = expectedRevision }
            try MutationOutbox(
                id: mutId,
                name: "opportunities.setOpportunityFollowed",
                argsJson: try encodeArgs([AnyCodable(input)]),
                createdAt: now
            ).insert(db)
        }
    }

    // MARK: - 12. Update Reminder State

    public func updateReminderState(
        userId: String,
        eventKey: String,
        action: String,
        step: String? = nil,
        untilAt: String? = nil,
        deadlineUtc: String? = nil,
        expectedRevision: Int? = nil
    ) async throws {
        let mutId = UUID().uuidString.lowercased()
        let now = nowISO()

        try await dbManager.dbWriter.write { db in
            let existing = try OpportunityReminderStateRecord
                .filter(Column("user_id") == userId && Column("event_key") == eventKey)
                .fetchOne(db)

            try SyncEngine.saveOptimisticSnapshot(
                SyncEngine.OptimisticSnapshot(reminderState: existing, reminderStateKey: [userId, eventKey]),
                forMutationId: mutId,
                in: db
            )

            var record = existing ?? OpportunityReminderStateRecord(userId: userId, eventKey: eventKey, revision: 0, updatedAt: now)
            switch action {
            case "dismiss":
                record.dismissedAt = now
                record.snoozeUntil = nil
            case "snooze":
                record.snoozeUntil = untilAt
            case "restore":
                record.dismissedAt = nil
                record.snoozeUntil = nil
            case "read":
                if let step {
                    var steps = (try? JSONDecoder().decode([String].self, from: Data(record.readStepsJson.utf8))) ?? []
                    if !steps.contains(step) { steps.append(step) }
                    if let d = try? JSONEncoder().encode(steps) {
                        record.readStepsJson = String(decoding: d, as: UTF8.self)
                    }
                }
            default:
                break
            }
            record.revision = (existing?.revision ?? 0) + 1
            record.updatedAt = now
            try record.save(db)

            var input: [String: Any] = [
                "event_key": eventKey,
                "action": action,
            ]
            if let step { input["step"] = step }
            if let untilAt { input["until_at"] = untilAt }
            if let deadlineUtc { input["deadline_utc"] = deadlineUtc }
            if let expectedRevision { input["expected_revision"] = expectedRevision }
            try MutationOutbox(
                id: mutId,
                name: "opportunities.updateOpportunityReminderState",
                argsJson: try encodeArgs([AnyCodable(input)]),
                createdAt: now
            ).insert(db)
        }
    }

    // MARK: - Notification Optimistic Delete

    public func deleteNotification(notificationId: String) async throws {
        let mutId = UUID().uuidString.lowercased()
        let now = nowISO()

        try await dbManager.dbWriter.write { db in
            let existing = try NotificationHistoryRecord.fetchOne(db, id: notificationId)
            if let existing {
                try SyncEngine.saveOptimisticSnapshot(
                    SyncEngine.OptimisticSnapshot(notification: existing),
                    forMutationId: mutId,
                    in: db
                )
                var updated = existing
                updated.deletedAt = now
                try updated.save(db)
            }
            try MutationOutbox(
                id: mutId,
                name: "notifications.deleteNotification",
                argsJson: try encodeArgs([AnyCodable(notificationId)]),
                createdAt: now
            ).insert(db)
        }
    }

    // MARK: - Phase 1 Offline Creation Fallback (`cards.createCard` & `bills.createBill`)

    @discardableResult
    public func createCardOffline(
        bankId: String?,
        cardProductId: String,
        holderId: String,
        cardNumberLast4: String?,
        creditLimit: Double,
        billingDay: Int,
        nameOverride: String?
    ) async throws -> CreditCard {
        let mutId = UUID().uuidString.lowercased()
        let clientCardId = UUID().uuidString.lowercased()
        let now = nowISO()

        return try await dbManager.dbWriter.write { db in
            let card = CreditCard(
                id: clientCardId,
                holderId: holderId,
                cardProductId: cardProductId,
                billingDay: billingDay,
                cardNumberLast4: cardNumberLast4,
                creditLimit: creditLimit,
                status: "active",
                cardType: "credit",
                nameOverride: nameOverride,
                createdAt: now
            )
            try card.insert(db)

            var payload: [String: Any] = [
                "id": clientCardId,
                "card_product_id": cardProductId,
                "holder_id": holderId,
                "credit_limit": creditLimit,
                "billing_day": billingDay,
                "status": "active",
                "card_type": "credit",
            ]
            if let bankId, !bankId.isEmpty { payload["bank_id"] = bankId }
            if let cardNumberLast4, !cardNumberLast4.isEmpty { payload["card_number_last4"] = cardNumberLast4 }
            if let nameOverride, !nameOverride.isEmpty { payload["name_override"] = nameOverride }

            try MutationOutbox(
                id: mutId,
                name: "cards.createCard",
                argsJson: try encodeArgs([AnyCodable(payload)]),
                createdAt: now
            ).insert(db)
            return card
        }
    }

    @discardableResult
    public func createBillOffline(input: ApiClient.CreateBillInput) async throws -> Bill {
        let mutId = UUID().uuidString.lowercased()
        let clientBillId = input.id.flatMap { UUID(uuidString: $0) != nil ? $0.lowercased() : nil }
            ?? UUID().uuidString.lowercased()
        let now = nowISO()

        return try await dbManager.dbWriter.write { db in
            let bill = Bill(
                id: clientBillId,
                cardId: input.cardId,
                billMonth: input.billMonth,
                statementStart: input.statementStart,
                statementEnd: input.statementEnd,
                statementDate: input.statementDate,
                billAmount: input.billAmount,
                minPayment: input.minPayment,
                dueDate: input.dueDate,
                status: input.status,
                createdAt: now,
                accountId: input.accountId
            )
            try bill.insert(db)

            let data = try JSONEncoder().encode(input)
            var payload = (try JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
            payload["id"] = clientBillId
            try MutationOutbox(
                id: mutId,
                name: "bills.createBill",
                argsJson: try encodeArgs([AnyCodable(payload)]),
                createdAt: now
            ).insert(db)
            return bill
        }
    }
}
