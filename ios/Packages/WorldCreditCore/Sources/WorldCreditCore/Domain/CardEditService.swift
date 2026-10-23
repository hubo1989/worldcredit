import Foundation
import GRDB

public enum CardEditError: LocalizedError, Equatable {
    case cardNotFound(String)
    case invalidBillingDay(Int)
    case invalidCreditLimit(Double)

    public var errorDescription: String? {
        switch self {
        case .cardNotFound(let id):
            return "卡片未找到: \(id)"
        case .invalidBillingDay(let day):
            return "账单日必须在 1 到 31 之间: \(day)"
        case .invalidCreditLimit(let limit):
            return "信用额度不能为负数: \(limit)"
        }
    }
}

public struct CardUpdateInput: Sendable {
    public var nameOverride: String?
    public var creditLimit: Double?
    public var billingDay: Int?
    public var overrideBillingDay: Int?
    public var overrideDueType: PaymentDueType?
    public var overrideDueValue: Int?
    /// Omitted values leave the rule unchanged; this flag clears both fields.
    public var clearDueOverride: Bool = false

    public init(
        nameOverride: String? = nil,
        creditLimit: Double? = nil,
        billingDay: Int? = nil,
        overrideBillingDay: Int? = nil,
        overrideDueType: PaymentDueType? = nil,
        overrideDueValue: Int? = nil
    ) {
        self.nameOverride = nameOverride
        self.creditLimit = creditLimit
        self.billingDay = billingDay
        self.overrideBillingDay = overrideBillingDay
        self.overrideDueType = overrideDueType
        self.overrideDueValue = overrideDueValue
    }
}

public final class CardEditService: Sendable {
    public let dbManager: DatabaseManager

    public init(dbManager: DatabaseManager) {
        self.dbManager = dbManager
    }

    /// 离线更新卡片信息：更新本地 SQLite 并排队写入 mutation_outbox
    @discardableResult
    public func updateCard(cardId: String, input: CardUpdateInput) async throws -> CreditCard {
        if let day = input.billingDay {
            guard day >= 1 && day <= 31 else { throw CardEditError.invalidBillingDay(day) }
        }
        if let ovDay = input.overrideBillingDay {
            guard ovDay >= 1 && ovDay <= 31 else { throw CardEditError.invalidBillingDay(ovDay) }
        }
        if let limit = input.creditLimit {
            guard limit >= 0 else { throw CardEditError.invalidCreditLimit(limit) }
        }

        return try await dbManager.dbWriter.write { db in
            guard var card = try CreditCard.fetchOne(db, id: cardId) else {
                throw CardEditError.cardNotFound(cardId)
            }

            var patchDict: [String: Any] = [:]

            if let name = input.nameOverride {
                card.nameOverride = name.isEmpty ? nil : name
                patchDict["name_override"] = name.isEmpty ? NSNull() : name
            }
            if let limit = input.creditLimit {
                card.creditLimit = limit
                patchDict["credit_limit"] = limit
            }
            if let day = input.billingDay {
                card.billingDay = day
                patchDict["billing_day"] = day
            }
            if let ovDay = input.overrideBillingDay {
                card.overrideBillingDay = ovDay
                patchDict["override_billing_day"] = ovDay
            }
            if input.clearDueOverride {
                card.overrideDueType = nil
                card.overrideDueValue = nil
                patchDict["override_due_type"] = NSNull()
                patchDict["override_due_value"] = NSNull()
            } else {
                if let dueType = input.overrideDueType {
                    card.overrideDueType = dueType
                    patchDict["override_due_type"] = dueType.rawValue
                }
                if let dueValue = input.overrideDueValue {
                    card.overrideDueValue = dueValue
                    patchDict["override_due_value"] = dueValue
                }
            }

            try card.update(db)

            // 写入离线发送队列: [cardId, patchDict]
            let args: [Any] = [cardId, patchDict]
            let argsData = try JSONSerialization.data(withJSONObject: args)
            let argsJson = String(data: argsData, encoding: .utf8) ?? "[]"

            let outboxItem = MutationOutbox(
                id: UUID().uuidString,
                name: "cards.updateCard",
                argsJson: argsJson
            )
            try outboxItem.insert(db)

            return card
        }
    }
}
