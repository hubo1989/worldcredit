import Foundation

public final class RecommendationsRemoteService: Sendable {
    public let apiClient: ApiClient

    public init(apiClient: ApiClient) {
        self.apiClient = apiClient
    }

    public func getCardRecommendations(input: PurchaseRecommendationInput) async throws -> RecommendationEngineOutput {
        let payload = try encodeToAnyCodable(input)
        return try await apiClient.rpc(module: "recommendations", function: "getCardRecommendations", args: [payload])
    }

    public func getCardAnnualFeeRoi(
        cardId: String,
        periodMode: String = "current_cycle",
        year: Int? = nil
    ) async throws -> CardAnnualFeeRoiDetail {
        var opts: [String: Any] = ["period_mode": periodMode]
        if let year { opts["year"] = year }
        return try await apiClient.rpc(
            module: "recommendations",
            function: "getCardAnnualFeeRoi",
            args: [AnyCodable(cardId), AnyCodable(opts)]
        )
    }

    public func getFamilyAnnualFeeRoi(
        holderId: String? = nil,
        periodMode: String = "last_12m",
        year: Int? = nil,
        displayCurrency: String? = nil
    ) async throws -> FamilyAnnualFeeRoiBoard {
        var filters: [String: Any] = ["period_mode": periodMode]
        if let holderId { filters["holder_id"] = holderId }
        if let year { filters["year"] = year }
        if let displayCurrency { filters["display_currency"] = displayCurrency }
        return try await apiClient.rpc(
            module: "recommendations",
            function: "getFamilyAnnualFeeRoi",
            args: [AnyCodable(filters)]
        )
    }

    public func getCardCycleSpendEstimate(cardId: String) async throws -> CardCycleSpendEstimate {
        try await apiClient.rpc(
            module: "recommendations",
            function: "getCardCycleSpendEstimate",
            args: [AnyCodable(cardId)]
        )
    }

    public func updateOpportunityValuation(
        targetKind: String,
        targetId: String,
        estimatedUnitValueMinor: Int?,
        estimatedValueCurrency: String?
    ) async throws {
        var payload: [String: Any] = [
            "target_kind": targetKind,
            "target_id": targetId,
        ]
        if let estimatedUnitValueMinor {
            payload["estimated_unit_value_minor"] = estimatedUnitValueMinor
        } else {
            payload["estimated_unit_value_minor"] = NSNull()
        }
        if let estimatedValueCurrency {
            payload["estimated_value_currency"] = estimatedValueCurrency
        } else {
            payload["estimated_value_currency"] = NSNull()
        }
        try await apiClient.rpcVoid(
            module: "recommendations",
            function: "updateOpportunityValuation",
            args: [AnyCodable(payload)]
        )
    }

    private func encodeToAnyCodable<T: Encodable>(_ value: T) throws -> AnyCodable {
        let data = try JSONEncoder().encode(value)
        let obj = try JSONSerialization.jsonObject(with: data, options: [])
        return AnyCodable(obj)
    }
}
