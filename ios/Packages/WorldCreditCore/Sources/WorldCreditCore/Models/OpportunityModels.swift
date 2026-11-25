import Foundation
import GRDB

// MARK: - 12 Phase-2 Syncable GRDB Models

public struct OpportunityDefinitionRecord: Codable, FetchableRecord, TableRecord, PersistableRecord, Sendable, Equatable, Identifiable {
    public static let databaseTableName = "opportunity_definitions"

    public var id: String
    public var kind: String
    public var legacyBenefitId: String?
    public var legacyPromoId: String?
    public var visibility: String
    public var privateHolderId: String?
    public var status: String
    public var terminatedAt: String?
    public var terminationReason: String?
    public var revision: Int
    public var createdBy: String?
    public var createdAt: String

    public init(
        id: String,
        kind: String,
        legacyBenefitId: String? = nil,
        legacyPromoId: String? = nil,
        visibility: String,
        privateHolderId: String? = nil,
        status: String = "active",
        terminatedAt: String? = nil,
        terminationReason: String? = nil,
        revision: Int = 1,
        createdBy: String? = nil,
        createdAt: String = ""
    ) {
        self.id = id
        self.kind = kind
        self.legacyBenefitId = legacyBenefitId
        self.legacyPromoId = legacyPromoId
        self.visibility = visibility
        self.privateHolderId = privateHolderId
        self.status = status
        self.terminatedAt = terminatedAt
        self.terminationReason = terminationReason
        self.revision = revision
        self.createdBy = createdBy
        self.createdAt = createdAt
    }

    enum CodingKeys: String, CodingKey {
        case id, kind, visibility, status, revision
        case legacyBenefitId = "legacy_benefit_id"
        case legacyPromoId = "legacy_promo_id"
        case privateHolderId = "private_holder_id"
        case terminatedAt = "terminated_at"
        case terminationReason = "termination_reason"
        case createdBy = "created_by"
        case createdAt = "created_at"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        kind = try c.decode(String.self, forKey: .kind)
        legacyBenefitId = try c.decodeIfPresent(String.self, forKey: .legacyBenefitId)
        legacyPromoId = try c.decodeIfPresent(String.self, forKey: .legacyPromoId)
        visibility = try c.decode(String.self, forKey: .visibility)
        privateHolderId = try c.decodeIfPresent(String.self, forKey: .privateHolderId)
        status = try c.decodeIfPresent(String.self, forKey: .status) ?? "active"
        terminatedAt = try c.decodeIfPresent(String.self, forKey: .terminatedAt)
        terminationReason = try c.decodeIfPresent(String.self, forKey: .terminationReason)
        revision = try c.decodeIfPresent(Int.self, forKey: .revision) ?? 1
        createdBy = try c.decodeIfPresent(String.self, forKey: .createdBy)
        createdAt = try c.decodeIfPresent(String.self, forKey: .createdAt) ?? ""
    }
}

public struct OpportunityRuleVersionRecord: Codable, FetchableRecord, TableRecord, PersistableRecord, Sendable, Equatable, Identifiable {
    public static let databaseTableName = "opportunity_rule_versions"

    public var id: String
    public var definitionId: String
    public var version: Int
    public var effectiveFrom: String
    public var effectiveUntilBefore: String?
    public var rulesJson: String
    public var verification: String
    public var sourceUrl: String?
    public var sourceExcerpt: String?
    public var checkedAt: String?
    public var checkedBy: String?
    public var publishedAt: String

    public init(
        id: String,
        definitionId: String,
        version: Int,
        effectiveFrom: String,
        effectiveUntilBefore: String? = nil,
        rulesJson: String,
        verification: String = "unverified",
        sourceUrl: String? = nil,
        sourceExcerpt: String? = nil,
        checkedAt: String? = nil,
        checkedBy: String? = nil,
        publishedAt: String = ""
    ) {
        self.id = id
        self.definitionId = definitionId
        self.version = version
        self.effectiveFrom = effectiveFrom
        self.effectiveUntilBefore = effectiveUntilBefore
        self.rulesJson = rulesJson
        self.verification = verification
        self.sourceUrl = sourceUrl
        self.sourceExcerpt = sourceExcerpt
        self.checkedAt = checkedAt
        self.checkedBy = checkedBy
        self.publishedAt = publishedAt
    }

    enum CodingKeys: String, CodingKey {
        case id, version, verification
        case definitionId = "definition_id"
        case effectiveFrom = "effective_from"
        case effectiveUntilBefore = "effective_until_before"
        case rulesJson = "rules_json"
        case sourceUrl = "source_url"
        case sourceExcerpt = "source_excerpt"
        case checkedAt = "checked_at"
        case checkedBy = "checked_by"
        case publishedAt = "published_at"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        definitionId = try c.decode(String.self, forKey: .definitionId)
        version = try c.decode(Int.self, forKey: .version)
        effectiveFrom = try c.decode(String.self, forKey: .effectiveFrom)
        effectiveUntilBefore = try c.decodeIfPresent(String.self, forKey: .effectiveUntilBefore)
        rulesJson = try c.decode(String.self, forKey: .rulesJson)
        verification = try c.decodeIfPresent(String.self, forKey: .verification) ?? "unverified"
        sourceUrl = try c.decodeIfPresent(String.self, forKey: .sourceUrl)
        sourceExcerpt = try c.decodeIfPresent(String.self, forKey: .sourceExcerpt)
        checkedAt = try c.decodeIfPresent(String.self, forKey: .checkedAt)
        checkedBy = try c.decodeIfPresent(String.self, forKey: .checkedBy)
        publishedAt = try c.decodeIfPresent(String.self, forKey: .publishedAt) ?? ""
    }
}

public struct OpportunityAccountRecord: Codable, FetchableRecord, TableRecord, PersistableRecord, Sendable, Equatable, Identifiable {
    public static let databaseTableName = "opportunity_accounts"

    public var id: String
    public var definitionId: String
    public var holderId: String
    public var scopeKind: String
    public var scopeKey: String
    public var eligibility: String
    public var eligibilityNote: String?
    public var eligibilityConfirmedBy: String?
    public var eligibilityConfirmedAt: String?
    public var eligibleFromOn: String?
    public var status: String
    public var revision: Int
    public var createdBy: String
    public var createdAt: String

    public init(
        id: String,
        definitionId: String,
        holderId: String,
        scopeKind: String,
        scopeKey: String,
        eligibility: String = "unknown",
        eligibilityNote: String? = nil,
        eligibilityConfirmedBy: String? = nil,
        eligibilityConfirmedAt: String? = nil,
        eligibleFromOn: String? = nil,
        status: String = "active",
        revision: Int = 1,
        createdBy: String = "",
        createdAt: String = ""
    ) {
        self.id = id
        self.definitionId = definitionId
        self.holderId = holderId
        self.scopeKind = scopeKind
        self.scopeKey = scopeKey
        self.eligibility = eligibility
        self.eligibilityNote = eligibilityNote
        self.eligibilityConfirmedBy = eligibilityConfirmedBy
        self.eligibilityConfirmedAt = eligibilityConfirmedAt
        self.eligibleFromOn = eligibleFromOn
        self.status = status
        self.revision = revision
        self.createdBy = createdBy
        self.createdAt = createdAt
    }

    enum CodingKeys: String, CodingKey {
        case id, eligibility, status, revision
        case definitionId = "definition_id"
        case holderId = "holder_id"
        case scopeKind = "scope_kind"
        case scopeKey = "scope_key"
        case eligibilityNote = "eligibility_note"
        case eligibilityConfirmedBy = "eligibility_confirmed_by"
        case eligibilityConfirmedAt = "eligibility_confirmed_at"
        case eligibleFromOn = "eligible_from_on"
        case createdBy = "created_by"
        case createdAt = "created_at"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        definitionId = try c.decode(String.self, forKey: .definitionId)
        holderId = try c.decode(String.self, forKey: .holderId)
        scopeKind = try c.decode(String.self, forKey: .scopeKind)
        scopeKey = try c.decode(String.self, forKey: .scopeKey)
        eligibility = try c.decodeIfPresent(String.self, forKey: .eligibility) ?? "unknown"
        eligibilityNote = try c.decodeIfPresent(String.self, forKey: .eligibilityNote)
        eligibilityConfirmedBy = try c.decodeIfPresent(String.self, forKey: .eligibilityConfirmedBy)
        eligibilityConfirmedAt = try c.decodeIfPresent(String.self, forKey: .eligibilityConfirmedAt)
        eligibleFromOn = try c.decodeIfPresent(String.self, forKey: .eligibleFromOn)
        status = try c.decodeIfPresent(String.self, forKey: .status) ?? "active"
        revision = try c.decodeIfPresent(Int.self, forKey: .revision) ?? 1
        createdBy = try c.decodeIfPresent(String.self, forKey: .createdBy) ?? ""
        createdAt = try c.decodeIfPresent(String.self, forKey: .createdAt) ?? ""
    }
}

public struct OpportunityAccountCardRecord: Codable, FetchableRecord, TableRecord, PersistableRecord, Sendable, Equatable {
    public static let databaseTableName = "opportunity_account_cards"

    public var accountId: String
    public var definitionId: String
    public var holderId: String
    public var cardId: String
    public var retiredAt: String?

    public init(
        accountId: String,
        definitionId: String,
        holderId: String,
        cardId: String,
        retiredAt: String? = nil
    ) {
        self.accountId = accountId
        self.definitionId = definitionId
        self.holderId = holderId
        self.cardId = cardId
        self.retiredAt = retiredAt
    }

    enum CodingKeys: String, CodingKey {
        case accountId = "account_id"
        case definitionId = "definition_id"
        case holderId = "holder_id"
        case cardId = "card_id"
        case retiredAt = "retired_at"
    }
}

public struct OpportunityCycleRecord: Codable, FetchableRecord, TableRecord, PersistableRecord, Sendable, Equatable, Identifiable {
    public static let databaseTableName = "opportunity_cycles"

    public var id: String
    public var accountId: String
    public var versionId: String
    public var versionAsOfOn: String
    public var cycleKey: String
    public var allocationKind: String
    public var activationState: String
    public var periodStartOn: String
    public var periodEndBefore: String?
    public var usableStartOn: String
    public var usableEndBefore: String?
    public var timeZone: String
    public var countLimit: Int?
    public var amountLimitMinor: Int?
    public var currency: String?
    public var workflowJson: String
    public var openingUsedCount: Int
    public var openingUsedMinor: Int
    public var usedCount: Int
    public var usedMinor: Int
    public var reservedCount: Int
    public var reservedMinor: Int
    public var balanceVerified: Bool
    public var verifiedBy: String?
    public var verifiedAt: String?
    public var openingAsOfOn: String?
    public var revision: Int
    public var createdAt: String

    public init(
        id: String,
        accountId: String,
        versionId: String,
        versionAsOfOn: String,
        cycleKey: String,
        allocationKind: String = "regular",
        activationState: String = "active",
        periodStartOn: String,
        periodEndBefore: String? = nil,
        usableStartOn: String,
        usableEndBefore: String? = nil,
        timeZone: String = "Asia/Shanghai",
        countLimit: Int? = nil,
        amountLimitMinor: Int? = nil,
        currency: String? = nil,
        workflowJson: String = "{}",
        openingUsedCount: Int = 0,
        openingUsedMinor: Int = 0,
        usedCount: Int = 0,
        usedMinor: Int = 0,
        reservedCount: Int = 0,
        reservedMinor: Int = 0,
        balanceVerified: Bool = false,
        verifiedBy: String? = nil,
        verifiedAt: String? = nil,
        openingAsOfOn: String? = nil,
        revision: Int = 1,
        createdAt: String = ""
    ) {
        self.id = id
        self.accountId = accountId
        self.versionId = versionId
        self.versionAsOfOn = versionAsOfOn
        self.cycleKey = cycleKey
        self.allocationKind = allocationKind
        self.activationState = activationState
        self.periodStartOn = periodStartOn
        self.periodEndBefore = periodEndBefore
        self.usableStartOn = usableStartOn
        self.usableEndBefore = usableEndBefore
        self.timeZone = timeZone
        self.countLimit = countLimit
        self.amountLimitMinor = amountLimitMinor
        self.currency = currency
        self.workflowJson = workflowJson
        self.openingUsedCount = openingUsedCount
        self.openingUsedMinor = openingUsedMinor
        self.usedCount = usedCount
        self.usedMinor = usedMinor
        self.reservedCount = reservedCount
        self.reservedMinor = reservedMinor
        self.balanceVerified = balanceVerified
        self.verifiedBy = verifiedBy
        self.verifiedAt = verifiedAt
        self.openingAsOfOn = openingAsOfOn
        self.revision = revision
        self.createdAt = createdAt
    }

    enum CodingKeys: String, CodingKey {
        case id, currency, revision
        case accountId = "account_id"
        case versionId = "version_id"
        case versionAsOfOn = "version_as_of_on"
        case cycleKey = "cycle_key"
        case allocationKind = "allocation_kind"
        case activationState = "activation_state"
        case periodStartOn = "period_start_on"
        case periodEndBefore = "period_end_before"
        case usableStartOn = "usable_start_on"
        case usableEndBefore = "usable_end_before"
        case timeZone = "time_zone"
        case countLimit = "count_limit"
        case amountLimitMinor = "amount_limit_minor"
        case workflowJson = "workflow_json"
        case openingUsedCount = "opening_used_count"
        case openingUsedMinor = "opening_used_minor"
        case usedCount = "used_count"
        case usedMinor = "used_minor"
        case reservedCount = "reserved_count"
        case reservedMinor = "reserved_minor"
        case balanceVerified = "balance_verified"
        case verifiedBy = "verified_by"
        case verifiedAt = "verified_at"
        case openingAsOfOn = "opening_as_of_on"
        case createdAt = "created_at"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        accountId = try c.decode(String.self, forKey: .accountId)
        versionId = try c.decode(String.self, forKey: .versionId)
        versionAsOfOn = try c.decode(String.self, forKey: .versionAsOfOn)
        cycleKey = try c.decode(String.self, forKey: .cycleKey)
        allocationKind = try c.decodeIfPresent(String.self, forKey: .allocationKind) ?? "regular"
        activationState = try c.decodeIfPresent(String.self, forKey: .activationState) ?? "active"
        periodStartOn = try c.decode(String.self, forKey: .periodStartOn)
        periodEndBefore = try c.decodeIfPresent(String.self, forKey: .periodEndBefore)
        usableStartOn = try c.decode(String.self, forKey: .usableStartOn)
        usableEndBefore = try c.decodeIfPresent(String.self, forKey: .usableEndBefore)
        timeZone = try c.decodeIfPresent(String.self, forKey: .timeZone) ?? "Asia/Shanghai"
        countLimit = try c.decodeIfPresent(Int.self, forKey: .countLimit)
        amountLimitMinor = try c.decodeIfPresent(Int.self, forKey: .amountLimitMinor)
        currency = try c.decodeIfPresent(String.self, forKey: .currency)
        workflowJson = try c.decodeIfPresent(String.self, forKey: .workflowJson) ?? "{}"
        openingUsedCount = try c.decodeIfPresent(Int.self, forKey: .openingUsedCount) ?? 0
        openingUsedMinor = try c.decodeIfPresent(Int.self, forKey: .openingUsedMinor) ?? 0
        usedCount = try c.decodeIfPresent(Int.self, forKey: .usedCount) ?? 0
        usedMinor = try c.decodeIfPresent(Int.self, forKey: .usedMinor) ?? 0
        reservedCount = try c.decodeIfPresent(Int.self, forKey: .reservedCount) ?? 0
        reservedMinor = try c.decodeIfPresent(Int.self, forKey: .reservedMinor) ?? 0
        balanceVerified = try c.decodeFlexibleBoolIfPresent(forKey: .balanceVerified) ?? false
        verifiedBy = try c.decodeIfPresent(String.self, forKey: .verifiedBy)
        verifiedAt = try c.decodeIfPresent(String.self, forKey: .verifiedAt)
        openingAsOfOn = try c.decodeIfPresent(String.self, forKey: .openingAsOfOn)
        revision = try c.decodeIfPresent(Int.self, forKey: .revision) ?? 1
        createdAt = try c.decodeIfPresent(String.self, forKey: .createdAt) ?? ""
    }
}

public struct OpportunityUsageRecord: Codable, FetchableRecord, TableRecord, PersistableRecord, Sendable, Equatable, Identifiable {
    public static let databaseTableName = "opportunity_usages"

    public var id: String
    public var accountId: String
    public var cycleId: String
    public var cardId: String
    public var usedOn: String
    public var quantity: Int
    public var amountMinor: Int
    public var note: String?
    public var status: String
    public var revision: Int
    public var createdBy: String
    public var updatedBy: String
    public var createdAt: String
    public var updatedAt: String

    public init(
        id: String,
        accountId: String,
        cycleId: String,
        cardId: String,
        usedOn: String,
        quantity: Int = 1,
        amountMinor: Int = 0,
        note: String? = nil,
        status: String = "active",
        revision: Int = 1,
        createdBy: String = "",
        updatedBy: String = "",
        createdAt: String = "",
        updatedAt: String = ""
    ) {
        self.id = id
        self.accountId = accountId
        self.cycleId = cycleId
        self.cardId = cardId
        self.usedOn = usedOn
        self.quantity = quantity
        self.amountMinor = amountMinor
        self.note = note
        self.status = status
        self.revision = revision
        self.createdBy = createdBy
        self.updatedBy = updatedBy
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    enum CodingKeys: String, CodingKey {
        case id, quantity, note, status, revision
        case accountId = "account_id"
        case cycleId = "cycle_id"
        case cardId = "card_id"
        case usedOn = "used_on"
        case amountMinor = "amount_minor"
        case createdBy = "created_by"
        case updatedBy = "updated_by"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        accountId = try c.decode(String.self, forKey: .accountId)
        cycleId = try c.decode(String.self, forKey: .cycleId)
        cardId = try c.decode(String.self, forKey: .cardId)
        usedOn = try c.decode(String.self, forKey: .usedOn)
        quantity = try c.decodeIfPresent(Int.self, forKey: .quantity) ?? 1
        amountMinor = try c.decodeIfPresent(Int.self, forKey: .amountMinor) ?? 0
        note = try c.decodeIfPresent(String.self, forKey: .note)
        status = try c.decodeIfPresent(String.self, forKey: .status) ?? "active"
        revision = try c.decodeIfPresent(Int.self, forKey: .revision) ?? 1
        createdBy = try c.decodeIfPresent(String.self, forKey: .createdBy) ?? ""
        updatedBy = try c.decodeIfPresent(String.self, forKey: .updatedBy) ?? ""
        createdAt = try c.decodeIfPresent(String.self, forKey: .createdAt) ?? ""
        updatedAt = try c.decodeIfPresent(String.self, forKey: .updatedAt) ?? ""
    }
}

public struct OpportunityFulfillmentRecord: Codable, FetchableRecord, TableRecord, PersistableRecord, Sendable, Equatable, Identifiable {
    public static let databaseTableName = "opportunity_fulfillments"

    public var id: String
    public var holderId: String
    public var kind: String
    public var accountId: String?
    public var cycleId: String?
    public var taskCycleId: String?
    public var rewardKey: String?
    public var sourceKey: String
    public var cardId: String?
    public var status: String
    public var quantity: Int
    public var amountMinor: Int
    public var recordedOn: String
    public var serviceAt: String?
    public var serviceTimeZone: String?
    public var externalReference: String?
    public var entryJson: String
    public var settlement: String?
    public var usageId: String?
    public var note: String?
    public var revision: Int
    public var createdBy: String
    public var updatedBy: String
    public var createdAt: String
    public var updatedAt: String

    public init(
        id: String,
        holderId: String,
        kind: String,
        accountId: String? = nil,
        cycleId: String? = nil,
        taskCycleId: String? = nil,
        rewardKey: String? = nil,
        sourceKey: String,
        cardId: String? = nil,
        status: String = "recorded",
        quantity: Int = 1,
        amountMinor: Int = 0,
        recordedOn: String,
        serviceAt: String? = nil,
        serviceTimeZone: String? = nil,
        externalReference: String? = nil,
        entryJson: String = "{}",
        settlement: String? = nil,
        usageId: String? = nil,
        note: String? = nil,
        revision: Int = 1,
        createdBy: String = "",
        updatedBy: String = "",
        createdAt: String = "",
        updatedAt: String = ""
    ) {
        self.id = id
        self.holderId = holderId
        self.kind = kind
        self.accountId = accountId
        self.cycleId = cycleId
        self.taskCycleId = taskCycleId
        self.rewardKey = rewardKey
        self.sourceKey = sourceKey
        self.cardId = cardId
        self.status = status
        self.quantity = quantity
        self.amountMinor = amountMinor
        self.recordedOn = recordedOn
        self.serviceAt = serviceAt
        self.serviceTimeZone = serviceTimeZone
        self.externalReference = externalReference
        self.entryJson = entryJson
        self.settlement = settlement
        self.usageId = usageId
        self.note = note
        self.revision = revision
        self.createdBy = createdBy
        self.updatedBy = updatedBy
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    enum CodingKeys: String, CodingKey {
        case id, kind, status, quantity, settlement, note, revision
        case holderId = "holder_id"
        case accountId = "account_id"
        case cycleId = "cycle_id"
        case taskCycleId = "task_cycle_id"
        case rewardKey = "reward_key"
        case sourceKey = "source_key"
        case cardId = "card_id"
        case amountMinor = "amount_minor"
        case recordedOn = "recorded_on"
        case serviceAt = "service_at"
        case serviceTimeZone = "service_time_zone"
        case externalReference = "external_reference"
        case entryJson = "entry_json"
        case usageId = "usage_id"
        case createdBy = "created_by"
        case updatedBy = "updated_by"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        holderId = try c.decode(String.self, forKey: .holderId)
        kind = try c.decode(String.self, forKey: .kind)
        accountId = try c.decodeIfPresent(String.self, forKey: .accountId)
        cycleId = try c.decodeIfPresent(String.self, forKey: .cycleId)
        taskCycleId = try c.decodeIfPresent(String.self, forKey: .taskCycleId)
        rewardKey = try c.decodeIfPresent(String.self, forKey: .rewardKey)
        sourceKey = try c.decode(String.self, forKey: .sourceKey)
        cardId = try c.decodeIfPresent(String.self, forKey: .cardId)
        status = try c.decode(String.self, forKey: .status)
        quantity = try c.decodeIfPresent(Int.self, forKey: .quantity) ?? 1
        amountMinor = try c.decodeIfPresent(Int.self, forKey: .amountMinor) ?? 0
        recordedOn = try c.decode(String.self, forKey: .recordedOn)
        serviceAt = try c.decodeIfPresent(String.self, forKey: .serviceAt)
        serviceTimeZone = try c.decodeIfPresent(String.self, forKey: .serviceTimeZone)
        externalReference = try c.decodeIfPresent(String.self, forKey: .externalReference)
        entryJson = try c.decodeIfPresent(String.self, forKey: .entryJson) ?? "{}"
        settlement = try c.decodeIfPresent(String.self, forKey: .settlement)
        usageId = try c.decodeIfPresent(String.self, forKey: .usageId)
        note = try c.decodeIfPresent(String.self, forKey: .note)
        revision = try c.decodeIfPresent(Int.self, forKey: .revision) ?? 1
        createdBy = try c.decodeIfPresent(String.self, forKey: .createdBy) ?? ""
        updatedBy = try c.decodeIfPresent(String.self, forKey: .updatedBy) ?? ""
        createdAt = try c.decodeIfPresent(String.self, forKey: .createdAt) ?? ""
        updatedAt = try c.decodeIfPresent(String.self, forKey: .updatedAt) ?? ""
    }
}

public struct OpportunityTaskRecord: Codable, FetchableRecord, TableRecord, PersistableRecord, Sendable, Equatable, Identifiable {
    public static let databaseTableName = "opportunity_tasks"

    public var id: String
    public var holderId: String
    public var taskType: String
    public var title: String
    public var cardIdsJson: String
    public var rulesJson: String
    public var rewardJson: String
    public var status: String
    public var revision: Int
    public var createdBy: String
    public var createdAt: String
    public var updatedAt: String

    public init(
        id: String,
        holderId: String,
        taskType: String,
        title: String,
        cardIdsJson: String,
        rulesJson: String,
        rewardJson: String,
        status: String = "active",
        revision: Int = 1,
        createdBy: String = "",
        createdAt: String = "",
        updatedAt: String = ""
    ) {
        self.id = id
        self.holderId = holderId
        self.taskType = taskType
        self.title = title
        self.cardIdsJson = cardIdsJson
        self.rulesJson = rulesJson
        self.rewardJson = rewardJson
        self.status = status
        self.revision = revision
        self.createdBy = createdBy
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    enum CodingKeys: String, CodingKey {
        case id, title, status, revision
        case holderId = "holder_id"
        case taskType = "task_type"
        case cardIdsJson = "card_ids_json"
        case rulesJson = "rules_json"
        case rewardJson = "reward_json"
        case createdBy = "created_by"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        holderId = try c.decode(String.self, forKey: .holderId)
        taskType = try c.decode(String.self, forKey: .taskType)
        title = try c.decode(String.self, forKey: .title)
        cardIdsJson = try c.decodeIfPresent(String.self, forKey: .cardIdsJson) ?? "[]"
        rulesJson = try c.decode(String.self, forKey: .rulesJson)
        rewardJson = try c.decode(String.self, forKey: .rewardJson)
        status = try c.decodeIfPresent(String.self, forKey: .status) ?? "active"
        revision = try c.decodeIfPresent(Int.self, forKey: .revision) ?? 1
        createdBy = try c.decodeIfPresent(String.self, forKey: .createdBy) ?? ""
        createdAt = try c.decodeIfPresent(String.self, forKey: .createdAt) ?? ""
        updatedAt = try c.decodeIfPresent(String.self, forKey: .updatedAt) ?? ""
    }
}

public struct OpportunityTaskCycleRecord: Codable, FetchableRecord, TableRecord, PersistableRecord, Sendable, Equatable, Identifiable {
    public static let databaseTableName = "opportunity_task_cycles"

    public var id: String
    public var taskId: String
    public var cycleKey: String
    public var rulesSnapshotJson: String
    public var rewardSnapshotJson: String
    public var periodStartOn: String
    public var periodEndBefore: String
    public var deadlineAt: String
    public var expectedFromOn: String?
    public var expectedUntilBefore: String?
    public var progressJson: String
    public var asOfOn: String?
    public var revision: Int
    public var updatedBy: String?
    public var updatedAt: String

    public init(
        id: String,
        taskId: String,
        cycleKey: String,
        rulesSnapshotJson: String,
        rewardSnapshotJson: String,
        periodStartOn: String,
        periodEndBefore: String,
        deadlineAt: String,
        expectedFromOn: String? = nil,
        expectedUntilBefore: String? = nil,
        progressJson: String = "{}",
        asOfOn: String? = nil,
        revision: Int = 1,
        updatedBy: String? = nil,
        updatedAt: String = ""
    ) {
        self.id = id
        self.taskId = taskId
        self.cycleKey = cycleKey
        self.rulesSnapshotJson = rulesSnapshotJson
        self.rewardSnapshotJson = rewardSnapshotJson
        self.periodStartOn = periodStartOn
        self.periodEndBefore = periodEndBefore
        self.deadlineAt = deadlineAt
        self.expectedFromOn = expectedFromOn
        self.expectedUntilBefore = expectedUntilBefore
        self.progressJson = progressJson
        self.asOfOn = asOfOn
        self.revision = revision
        self.updatedBy = updatedBy
        self.updatedAt = updatedAt
    }

    enum CodingKeys: String, CodingKey {
        case id, revision
        case taskId = "task_id"
        case cycleKey = "cycle_key"
        case rulesSnapshotJson = "rules_snapshot_json"
        case rewardSnapshotJson = "reward_snapshot_json"
        case periodStartOn = "period_start_on"
        case periodEndBefore = "period_end_before"
        case deadlineAt = "deadline_at"
        case expectedFromOn = "expected_from_on"
        case expectedUntilBefore = "expected_until_before"
        case progressJson = "progress_json"
        case asOfOn = "as_of_on"
        case updatedBy = "updated_by"
        case updatedAt = "updated_at"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        taskId = try c.decode(String.self, forKey: .taskId)
        cycleKey = try c.decode(String.self, forKey: .cycleKey)
        rulesSnapshotJson = try c.decode(String.self, forKey: .rulesSnapshotJson)
        rewardSnapshotJson = try c.decode(String.self, forKey: .rewardSnapshotJson)
        periodStartOn = try c.decode(String.self, forKey: .periodStartOn)
        periodEndBefore = try c.decode(String.self, forKey: .periodEndBefore)
        deadlineAt = try c.decode(String.self, forKey: .deadlineAt)
        expectedFromOn = try c.decodeIfPresent(String.self, forKey: .expectedFromOn)
        expectedUntilBefore = try c.decodeIfPresent(String.self, forKey: .expectedUntilBefore)
        progressJson = try c.decodeIfPresent(String.self, forKey: .progressJson) ?? "{}"
        asOfOn = try c.decodeIfPresent(String.self, forKey: .asOfOn)
        revision = try c.decodeIfPresent(Int.self, forKey: .revision) ?? 1
        updatedBy = try c.decodeIfPresent(String.self, forKey: .updatedBy)
        updatedAt = try c.decodeIfPresent(String.self, forKey: .updatedAt) ?? ""
    }
}

public struct OpportunityUserStateRecord: Codable, FetchableRecord, TableRecord, PersistableRecord, Sendable, Equatable {
    public static let databaseTableName = "opportunity_user_states"

    public var userId: String
    public var accountId: String
    public var followed: Bool
    public var revision: Int
    public var updatedAt: String

    public init(
        userId: String,
        accountId: String,
        followed: Bool = false,
        revision: Int = 1,
        updatedAt: String = ""
    ) {
        self.userId = userId
        self.accountId = accountId
        self.followed = followed
        self.revision = revision
        self.updatedAt = updatedAt
    }

    enum CodingKeys: String, CodingKey {
        case followed, revision
        case userId = "user_id"
        case accountId = "account_id"
        case updatedAt = "updated_at"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        userId = try c.decode(String.self, forKey: .userId)
        accountId = try c.decode(String.self, forKey: .accountId)
        followed = try c.decodeFlexibleBoolIfPresent(forKey: .followed) ?? false
        revision = try c.decodeIfPresent(Int.self, forKey: .revision) ?? 1
        updatedAt = try c.decodeIfPresent(String.self, forKey: .updatedAt) ?? ""
    }
}

public struct OpportunityReminderStateRecord: Codable, FetchableRecord, TableRecord, PersistableRecord, Sendable, Equatable {
    public static let databaseTableName = "opportunity_reminder_states"

    public var userId: String
    public var eventKey: String
    public var readStepsJson: String
    public var dismissedAt: String?
    public var snoozeUntil: String?
    public var revision: Int
    public var updatedAt: String

    public init(
        userId: String,
        eventKey: String,
        readStepsJson: String = "[]",
        dismissedAt: String? = nil,
        snoozeUntil: String? = nil,
        revision: Int = 1,
        updatedAt: String = ""
    ) {
        self.userId = userId
        self.eventKey = eventKey
        self.readStepsJson = readStepsJson
        self.dismissedAt = dismissedAt
        self.snoozeUntil = snoozeUntil
        self.revision = revision
        self.updatedAt = updatedAt
    }

    enum CodingKeys: String, CodingKey {
        case revision
        case userId = "user_id"
        case eventKey = "event_key"
        case readStepsJson = "read_steps_json"
        case dismissedAt = "dismissed_at"
        case snoozeUntil = "snooze_until"
        case updatedAt = "updated_at"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        userId = try c.decode(String.self, forKey: .userId)
        eventKey = try c.decode(String.self, forKey: .eventKey)
        readStepsJson = try c.decodeIfPresent(String.self, forKey: .readStepsJson) ?? "[]"
        dismissedAt = try c.decodeIfPresent(String.self, forKey: .dismissedAt)
        snoozeUntil = try c.decodeIfPresent(String.self, forKey: .snoozeUntil)
        revision = try c.decodeIfPresent(Int.self, forKey: .revision) ?? 1
        updatedAt = try c.decodeIfPresent(String.self, forKey: .updatedAt) ?? ""
    }
}

public struct NotificationHistoryRecord: Codable, FetchableRecord, TableRecord, PersistableRecord, Sendable, Equatable, Identifiable {
    public static let databaseTableName = "notification_history"

    public var id: String
    public var userId: String
    public var notificationKey: String
    public var category: String
    public var title: String
    public var body: String?
    public var targetUrl: String?
    public var metadataJson: String?
    public var sentAt: String
    public var status: String
    public var error: String?
    public var readAt: String?
    public var deletedAt: String?
    public var pushSentAt: String?

    public init(
        id: String,
        userId: String,
        notificationKey: String,
        category: String = "system",
        title: String,
        body: String? = nil,
        targetUrl: String? = nil,
        metadataJson: String? = nil,
        sentAt: String = "",
        status: String = "sent",
        error: String? = nil,
        readAt: String? = nil,
        deletedAt: String? = nil,
        pushSentAt: String? = nil
    ) {
        self.id = id
        self.userId = userId
        self.notificationKey = notificationKey
        self.category = category
        self.title = title
        self.body = body
        self.targetUrl = targetUrl
        self.metadataJson = metadataJson
        self.sentAt = sentAt
        self.status = status
        self.error = error
        self.readAt = readAt
        self.deletedAt = deletedAt
        self.pushSentAt = pushSentAt
    }

    enum CodingKeys: String, CodingKey {
        case id, category, title, body, status, error
        case userId = "user_id"
        case notificationKey = "notification_key"
        case targetUrl = "target_url"
        case metadataJson = "metadata_json"
        case sentAt = "sent_at"
        case readAt = "read_at"
        case deletedAt = "deleted_at"
        case pushSentAt = "push_sent_at"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        userId = try c.decode(String.self, forKey: .userId)
        notificationKey = try c.decode(String.self, forKey: .notificationKey)
        category = try c.decodeIfPresent(String.self, forKey: .category) ?? "system"
        title = try c.decode(String.self, forKey: .title)
        body = try c.decodeIfPresent(String.self, forKey: .body)
        targetUrl = try c.decodeIfPresent(String.self, forKey: .targetUrl)
        metadataJson = try c.decodeIfPresent(String.self, forKey: .metadataJson)
        sentAt = try c.decodeIfPresent(String.self, forKey: .sentAt) ?? ""
        status = try c.decodeIfPresent(String.self, forKey: .status) ?? "sent"
        error = try c.decodeIfPresent(String.self, forKey: .error)
        readAt = try c.decodeIfPresent(String.self, forKey: .readAt)
        deletedAt = try c.decodeIfPresent(String.self, forKey: .deletedAt)
        pushSentAt = try c.decodeIfPresent(String.self, forKey: .pushSentAt)
    }

    public func toUserNotificationItem() -> UserNotificationItem {
        UserNotificationItem(
            id: id,
            userId: userId,
            notificationKey: notificationKey,
            category: NotificationCategory(rawValue: category),
            title: title,
            body: body,
            targetUrl: targetUrl,
            metadataJson: metadataJson,
            sentAt: sentAt,
            status: status,
            error: error,
            readAt: readAt,
            deletedAt: deletedAt,
            pushSentAt: pushSentAt
        )
    }
}

// MARK: - Rule & Task JSON Payload Value Types

public struct RuleCycleSpec: Codable, Equatable, Sendable {
    public var kind: String // daily | weekly | monthly | annual | anniversary | one_time
    public var anchorMonth: Int?
    public var anchorDay: Int?
    public var anchorSource: String? // issued_on | activated_on

    public init(kind: String, anchorMonth: Int? = nil, anchorDay: Int? = nil, anchorSource: String? = nil) {
        self.kind = kind
        self.anchorMonth = anchorMonth
        self.anchorDay = anchorDay
        self.anchorSource = anchorSource
    }

    enum CodingKeys: String, CodingKey {
        case kind
        case anchorMonth = "anchor_month"
        case anchorDay = "anchor_day"
        case anchorSource = "anchor_source"
    }
}

public struct ClaimWindowSpec: Codable, Equatable, Sendable {
    public var startsAt: String?
    public var endsAt: String?

    public init(startsAt: String? = nil, endsAt: String? = nil) {
        self.startsAt = startsAt
        self.endsAt = endsAt
    }

    enum CodingKeys: String, CodingKey {
        case startsAt = "starts_at"
        case endsAt = "ends_at"
    }
}

public struct BookingWindowSpec: Codable, Equatable, Sendable {
    public var opensAt: String?
    public var closesAt: String?

    public init(opensAt: String? = nil, closesAt: String? = nil) {
        self.opensAt = opensAt
        self.closesAt = closesAt
    }

    enum CodingKeys: String, CodingKey {
        case opensAt = "opens_at"
        case closesAt = "closes_at"
    }
}

public struct RuleEntrySpec: Codable, Equatable, Sendable {
    public var websiteUrl: String?
    public var appName: String?
    public var appPath: String?

    public init(websiteUrl: String? = nil, appName: String? = nil, appPath: String? = nil) {
        self.websiteUrl = websiteUrl
        self.appName = appName
        self.appPath = appPath
    }

    enum CodingKeys: String, CodingKey {
        case websiteUrl = "website_url"
        case appName = "app_name"
        case appPath = "app_path"
    }
}

public struct RuleSnapshotV1: Codable, Equatable, Sendable {
    public var schemaVersion: Int
    public var title: String
    public var description: String?
    public var category: String
    public var timeZone: String
    public var bankId: String?
    public var cardProductIds: [String]
    public var validFrom: String?
    public var validUntilBefore: String?
    public var openEnded: Bool
    public var weekdays: [Int]?
    public var cycle: RuleCycleSpec
    public var allocation: String // recurring | claim_gated | grant_only
    public var countLimit: Int?
    public var amountLimitMinor: Int?
    public var currency: String?
    public var unitLabel: String
    public var eligibilityText: String?
    public var requiresPersonalConfirmation: Bool
    public var claimWindow: ClaimWindowSpec?
    public var bookingWindow: BookingWindowSpec?
    public var workflowTimeBasis: String
    public var bookingConsumes: String
    public var cancellationRule: String
    public var entry: RuleEntrySpec

    public init(
        schemaVersion: Int = 1,
        title: String,
        description: String? = nil,
        category: String = "other",
        timeZone: String = "Asia/Shanghai",
        bankId: String? = nil,
        cardProductIds: [String] = [],
        validFrom: String? = nil,
        validUntilBefore: String? = nil,
        openEnded: Bool = true,
        weekdays: [Int]? = nil,
        cycle: RuleCycleSpec = RuleCycleSpec(kind: "monthly"),
        allocation: String = "recurring",
        countLimit: Int? = nil,
        amountLimitMinor: Int? = nil,
        currency: String? = nil,
        unitLabel: String = "次",
        eligibilityText: String? = nil,
        requiresPersonalConfirmation: Bool = false,
        claimWindow: ClaimWindowSpec? = nil,
        bookingWindow: BookingWindowSpec? = nil,
        workflowTimeBasis: String = "fixed",
        bookingConsumes: String = "reserve_then_use",
        cancellationRule: String = "confirm_with_issuer",
        entry: RuleEntrySpec = RuleEntrySpec()
    ) {
        self.schemaVersion = schemaVersion
        self.title = title
        self.description = description
        self.category = category
        self.timeZone = timeZone
        self.bankId = bankId
        self.cardProductIds = cardProductIds
        self.validFrom = validFrom
        self.validUntilBefore = validUntilBefore
        self.openEnded = openEnded
        self.weekdays = weekdays
        self.cycle = cycle
        self.allocation = allocation
        self.countLimit = countLimit
        self.amountLimitMinor = amountLimitMinor
        self.currency = currency
        self.unitLabel = unitLabel
        self.eligibilityText = eligibilityText
        self.requiresPersonalConfirmation = requiresPersonalConfirmation
        self.claimWindow = claimWindow
        self.bookingWindow = bookingWindow
        self.workflowTimeBasis = workflowTimeBasis
        self.bookingConsumes = bookingConsumes
        self.cancellationRule = cancellationRule
        self.entry = entry
    }

    enum CodingKeys: String, CodingKey {
        case title, description, category, weekdays, cycle, allocation, currency, entry
        case schemaVersion = "schema_version"
        case timeZone = "time_zone"
        case bankId = "bank_id"
        case cardProductIds = "card_product_ids"
        case validFrom = "valid_from"
        case validUntilBefore = "valid_until_before"
        case openEnded = "open_ended"
        case countLimit = "count_limit"
        case amountLimitMinor = "amount_limit_minor"
        case unitLabel = "unit_label"
        case eligibilityText = "eligibility_text"
        case requiresPersonalConfirmation = "requires_personal_confirmation"
        case claimWindow = "claim_window"
        case bookingWindow = "booking_window"
        case workflowTimeBasis = "workflow_time_basis"
        case bookingConsumes = "booking_consumes"
        case cancellationRule = "cancellation_rule"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        schemaVersion = try c.decodeIfPresent(Int.self, forKey: .schemaVersion) ?? 1
        title = try c.decode(String.self, forKey: .title)
        description = try c.decodeIfPresent(String.self, forKey: .description)
        category = try c.decodeIfPresent(String.self, forKey: .category) ?? "other"
        timeZone = try c.decodeIfPresent(String.self, forKey: .timeZone) ?? "Asia/Shanghai"
        bankId = try c.decodeIfPresent(String.self, forKey: .bankId)
        cardProductIds = try c.decodeIfPresent([String].self, forKey: .cardProductIds) ?? []
        validFrom = try c.decodeIfPresent(String.self, forKey: .validFrom)
        validUntilBefore = try c.decodeIfPresent(String.self, forKey: .validUntilBefore)
        openEnded = try c.decodeIfPresent(Bool.self, forKey: .openEnded) ?? true
        weekdays = try c.decodeIfPresent([Int].self, forKey: .weekdays)
        cycle = try c.decode(RuleCycleSpec.self, forKey: .cycle)
        allocation = try c.decodeIfPresent(String.self, forKey: .allocation) ?? "recurring"
        countLimit = try c.decodeIfPresent(Int.self, forKey: .countLimit)
        amountLimitMinor = try c.decodeIfPresent(Int.self, forKey: .amountLimitMinor)
        currency = try c.decodeIfPresent(String.self, forKey: .currency)
        unitLabel = try c.decodeIfPresent(String.self, forKey: .unitLabel) ?? "次"
        eligibilityText = try c.decodeIfPresent(String.self, forKey: .eligibilityText)
        requiresPersonalConfirmation = try c.decodeIfPresent(Bool.self, forKey: .requiresPersonalConfirmation) ?? false
        claimWindow = try c.decodeIfPresent(ClaimWindowSpec.self, forKey: .claimWindow)
        bookingWindow = try c.decodeIfPresent(BookingWindowSpec.self, forKey: .bookingWindow)
        workflowTimeBasis = try c.decodeIfPresent(String.self, forKey: .workflowTimeBasis) ?? "fixed"
        bookingConsumes = try c.decodeIfPresent(String.self, forKey: .bookingConsumes) ?? "reserve_then_use"
        cancellationRule = try c.decodeIfPresent(String.self, forKey: .cancellationRule) ?? "confirm_with_issuer"
        entry = try c.decodeIfPresent(RuleEntrySpec.self, forKey: .entry) ?? RuleEntrySpec()
    }
}

public struct TaskConditionMetric: Codable, Equatable, Sendable, Identifiable {
    public var id: String
    public var kind: String // amount | count | check
    public var targetMinor: Int?
    public var targetCount: Int?
    public var perTxnMinMinor: Int?
    public var label: String?

    public init(
        id: String,
        kind: String,
        targetMinor: Int? = nil,
        targetCount: Int? = nil,
        perTxnMinMinor: Int? = nil,
        label: String? = nil
    ) {
        self.id = id
        self.kind = kind
        self.targetMinor = targetMinor
        self.targetCount = targetCount
        self.perTxnMinMinor = perTxnMinMinor
        self.label = label
    }

    enum CodingKeys: String, CodingKey {
        case id, kind, label
        case targetMinor = "target_minor"
        case targetCount = "target_count"
        case perTxnMinMinor = "per_txn_min_minor"
    }
}

public struct TaskConditionGroup: Codable, Equatable, Sendable, Identifiable {
    public var id: String
    public var metrics: [TaskConditionMetric]

    public init(id: String, metrics: [TaskConditionMetric]) {
        self.id = id
        self.metrics = metrics
    }
}

public struct TaskConditionsV1: Codable, Equatable, Sendable {
    public var schemaVersion: Int
    public var currency: String
    public var groups: [TaskConditionGroup]
    public var eligibleSpendNotes: String?

    public init(
        schemaVersion: Int = 1,
        currency: String = "CNY",
        groups: [TaskConditionGroup] = [],
        eligibleSpendNotes: String? = nil
    ) {
        self.schemaVersion = schemaVersion
        self.currency = currency
        self.groups = groups
        self.eligibleSpendNotes = eligibleSpendNotes
    }

    enum CodingKeys: String, CodingKey {
        case currency, groups
        case schemaVersion = "schema_version"
        case eligibleSpendNotes = "eligible_spend_notes"
    }
}

public enum ProgressMetricValue: Codable, Equatable, Sendable {
    case number(Double)
    case bool(Bool)

    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        // iOS ≤ 17 的 Foundation JSONDecoder 会把任意数字（如 50000 / 0 / 1）误解为 Bool，
        // 而 Double.self 会严格拒绝 true/false；因此先解 Double 再解 Bool，避免数值进度被清零。
        if let n = try? c.decode(Double.self) {
            self = .number(n)
            return
        }
        if let b = try? c.decode(Bool.self) {
            self = .bool(b)
            return
        }
        throw DecodingError.typeMismatch(ProgressMetricValue.self, .init(codingPath: c.codingPath, debugDescription: "Expected number or bool"))
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .number(let n): try c.encode(n)
        case .bool(let b): try c.encode(b)
        }
    }

    public var numericValue: Double? {
        if case .number(let n) = self { return n }
        return nil
    }

    public var boolValue: Bool? {
        if case .bool(let b) = self { return b }
        return nil
    }
}

public struct ManualProgress: Codable, Equatable, Sendable {
    public var asOfOn: String
    public var metricValues: [String: ProgressMetricValue]
    public var note: String?

    public init(asOfOn: String, metricValues: [String: ProgressMetricValue] = [:], note: String? = nil) {
        self.asOfOn = asOfOn
        self.metricValues = metricValues
        self.note = note
    }

    enum CodingKeys: String, CodingKey {
        case note
        case asOfOn = "as_of_on"
        case metricValues = "metric_values"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        asOfOn = try c.decode(String.self, forKey: .asOfOn)
        metricValues = try c.decodeIfPresent([String: ProgressMetricValue].self, forKey: .metricValues) ?? [:]
        note = try c.decodeIfPresent(String.self, forKey: .note)
    }
}

public struct TaskRewardPlan: Codable, Equatable, Sendable {
    public var kind: String // quota | non_quota
    public var title: String
    public var rewardKey: String?
    public var accountId: String?
    public var count: Int?
    public var amountMinor: Int?
    public var currency: String?

    public init(
        kind: String,
        title: String,
        rewardKey: String? = nil,
        accountId: String? = nil,
        count: Int? = nil,
        amountMinor: Int? = nil,
        currency: String? = nil
    ) {
        self.kind = kind
        self.title = title
        self.rewardKey = rewardKey
        self.accountId = accountId
        self.count = count
        self.amountMinor = amountMinor
        self.currency = currency
    }

    enum CodingKeys: String, CodingKey {
        case kind, title, count, currency
        case rewardKey = "reward_key"
        case accountId = "account_id"
        case amountMinor = "amount_minor"
    }
}

/// 同步/提交被服务端永久拒绝后的可展示通知（持久化在 sync_meta `sync_rejected_notices` 中）。
public struct SyncRejectedNotice: Codable, Equatable, Sendable, Identifiable {
    public var id: String
    public var mutationId: String
    public var mutationName: String
    public var message: String
    public var code: String?
    public var createdAt: String

    public init(
        id: String = UUID().uuidString.lowercased(),
        mutationId: String,
        mutationName: String,
        message: String,
        code: String? = nil,
        createdAt: String = ISO8601DateFormatter().string(from: Date())
    ) {
        self.id = id
        self.mutationId = mutationId
        self.mutationName = mutationName
        self.message = message
        self.code = code
        self.createdAt = createdAt
    }

    enum CodingKeys: String, CodingKey {
        case id, message, code
        case mutationId = "mutation_id"
        case mutationName = "mutation_name"
        case createdAt = "created_at"
    }
}
