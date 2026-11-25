import Foundation

public struct OpportunityUsageHistoryEventDTO: Codable, Equatable, Sendable, Identifiable {
    public let id: String
    public let entityKind: String
    public let entityId: String
    public let eventType: String
    public let reason: String?
    public let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id, reason
        case entityKind = "entity_kind"
        case entityId = "entity_id"
        case eventType = "event_type"
        case createdAt = "created_at"
    }
}

public struct OpportunityUsageHistoryResponseDTO: Codable, Equatable, Sendable {
    public let usages: [OpportunityUsageRecord]
    public let events: [OpportunityUsageHistoryEventDTO]
}

public struct OpportunityAccountSetupResultDTO: Codable, Equatable, Sendable {
    public let id: String?
    public let accountId: String?

    enum CodingKeys: String, CodingKey {
        case id
        case accountId = "account_id"
    }
}

/// 在线专用权益 RPC 封装：用于 `createOpportunityAccount`、`confirmOpportunityEligibility`、`confirmOpeningBalance` 与 `getUsageHistory`。
public struct OpportunityRemoteService: Sendable {
    public let apiClient: ApiClient

    public init(apiClient: ApiClient) {
        self.apiClient = apiClient
    }

    public func createOpportunityAccount(
        definitionId: String,
        holderId: String,
        scopeKind: String,
        cardIds: [String],
        eligibility: String,
        eligibleFromOn: String? = nil,
        note: String? = nil
    ) async throws -> OpportunityAccountSetupResultDTO {
        var input: [String: Any] = [
            "definition_id": definitionId,
            "holder_id": holderId,
            "scope_kind": scopeKind,
            "card_ids": cardIds,
            "eligibility": eligibility,
        ]
        if let eligibleFromOn { input["eligible_from_on"] = eligibleFromOn }
        if let note { input["note"] = note }
        return try await apiClient.rpc(
            module: "opportunities",
            function: "createOpportunityAccount",
            args: [AnyCodable(input)]
        )
    }

    public func confirmOpportunityEligibility(
        accountId: String,
        eligibility: String,
        eligibleFromOn: String? = nil,
        note: String? = nil,
        expectedRevision: Int
    ) async throws {
        var input: [String: Any] = [
            "account_id": accountId,
            "eligibility": eligibility,
            "expected_revision": expectedRevision,
        ]
        if let eligibleFromOn { input["eligible_from_on"] = eligibleFromOn }
        if let note { input["note"] = note }
        try await apiClient.rpcVoid(
            module: "opportunities",
            function: "confirmOpportunityEligibility",
            args: [AnyCodable(input)]
        )
    }

    public func confirmOpeningBalance(
        accountId: String,
        cycleId: String,
        openingUsedCount: Int,
        openingUsedMinor: Int,
        asOfOn: String,
        expectedRevision: Int
    ) async throws {
        let input: [String: Any] = [
            "account_id": accountId,
            "cycle_id": cycleId,
            "opening_used_count": openingUsedCount,
            "opening_used_minor": openingUsedMinor,
            "as_of_on": asOfOn,
            "expected_revision": expectedRevision,
        ]
        try await apiClient.rpcVoid(
            module: "opportunities",
            function: "confirmOpeningBalance",
            args: [AnyCodable(input)]
        )
    }

    public func getUsageHistory(accountId: String) async throws -> OpportunityUsageHistoryResponseDTO {
        let input: [String: Any] = ["account_id": accountId]
        return try await apiClient.rpc(
            module: "opportunities",
            function: "getUsageHistory",
            args: [AnyCodable(input)]
        )
    }
}
