import Foundation
import GRDB

public enum CardEditError: LocalizedError, Equatable {
    case cardNotFound(String)
    case invalidBillingDay(Int)
    case invalidCreditLimit(Double)
    case invalidAnnualFee(Double)
    case invalidStatus(String)
    case invalidCardType(String)
    case invalidAccountMode(String)
    case invalidDate(field: String, value: String)

    public var errorDescription: String? {
        switch self {
        case .cardNotFound(let id):
            return "卡片未找到: \(id)"
        case .invalidBillingDay(let day):
            return "账单日必须在 1 到 31 之间: \(day)"
        case .invalidCreditLimit(let limit):
            return "信用额度不能为负数: \(limit)"
        case .invalidAnnualFee(let fee):
            return "年费不能为负数: \(fee)"
        case .invalidStatus(let status):
            return "不支持的卡片状态: \(status)"
        case .invalidCardType(let cardType):
            return "不支持的卡片类型: \(cardType)"
        case .invalidAccountMode(let mode):
            return "不支持的账户模式覆盖: \(mode)"
        case .invalidDate(let field, let value):
            return "\(field)必须是 YYYY-MM-DD 格式的真实日历日: \(value)"
        }
    }
}

public struct CardUpdateInput: Sendable {
    public var nameOverride: String?
    public var creditLimit: Double?
    public var creditLimitOverride: Double?
    public var clearCreditLimitOverride: Bool = false
    public var annualFeeOverride: Double?
    public var clearAnnualFeeOverride: Bool = false
    public var billingDay: Int?
    public var overrideBillingDay: Int?
    public var overrideDueType: PaymentDueType?
    public var overrideDueValue: Int?
    /// Omitted values leave the rule unchanged; this flag clears both fields.
    public var clearDueOverride: Bool = false
    public var cardProductId: String?
    public var cardNumberLast4: String?
    public var holderId: String?
    public var status: String?
    public var cardType: String?
    public var issuedOn: String?
    public var clearIssuedOn: Bool = false
    public var activatedOn: String?
    public var clearActivatedOn: Bool = false
    public var accountModeOverride: String?
    public var clearAccountModeOverride: Bool = false

    public init(
        nameOverride: String? = nil,
        creditLimit: Double? = nil,
        billingDay: Int? = nil,
        overrideBillingDay: Int? = nil,
        overrideDueType: PaymentDueType? = nil,
        overrideDueValue: Int? = nil,
        clearDueOverride: Bool = false,
        cardProductId: String? = nil,
        cardNumberLast4: String? = nil,
        holderId: String? = nil,
        creditLimitOverride: Double? = nil,
        clearCreditLimitOverride: Bool = false,
        annualFeeOverride: Double? = nil,
        clearAnnualFeeOverride: Bool = false,
        status: String? = nil,
        cardType: String? = nil,
        issuedOn: String? = nil,
        clearIssuedOn: Bool = false,
        activatedOn: String? = nil,
        clearActivatedOn: Bool = false,
        accountModeOverride: String? = nil,
        clearAccountModeOverride: Bool = false
    ) {
        self.nameOverride = nameOverride
        self.creditLimit = creditLimit
        self.creditLimitOverride = creditLimitOverride
        self.clearCreditLimitOverride = clearCreditLimitOverride
        self.annualFeeOverride = annualFeeOverride
        self.clearAnnualFeeOverride = clearAnnualFeeOverride
        self.billingDay = billingDay
        self.overrideBillingDay = overrideBillingDay
        self.overrideDueType = overrideDueType
        self.overrideDueValue = overrideDueValue
        self.clearDueOverride = clearDueOverride
        self.cardProductId = cardProductId
        self.cardNumberLast4 = cardNumberLast4
        self.holderId = holderId
        self.status = status
        self.cardType = cardType
        self.issuedOn = issuedOn
        self.clearIssuedOn = clearIssuedOn
        self.activatedOn = activatedOn
        self.clearActivatedOn = clearActivatedOn
        self.accountModeOverride = accountModeOverride
        self.clearAccountModeOverride = clearAccountModeOverride
    }
}

public final class CardEditService: Sendable {
    public let dbManager: DatabaseManager

    private static let allowedStatuses: Set<String> = ["active", "frozen", "cancelled"]
    private static let allowedCardTypes: Set<String> = ["credit", "loan"]
    private static let allowedAccountModes: Set<String> = ["multi", "single"]

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
            guard limit.isFinite && limit >= 0 else { throw CardEditError.invalidCreditLimit(limit) }
        }
        if let limitOverride = input.creditLimitOverride, !input.clearCreditLimitOverride {
            guard limitOverride.isFinite && limitOverride >= 0 else {
                throw CardEditError.invalidCreditLimit(limitOverride)
            }
        }
        if let fee = input.annualFeeOverride, !input.clearAnnualFeeOverride {
            guard fee.isFinite && fee >= 0 else {
                throw CardEditError.invalidAnnualFee(fee)
            }
        }
        if let status = input.status {
            guard Self.allowedStatuses.contains(status) else {
                throw CardEditError.invalidStatus(status)
            }
        }
        if let cardType = input.cardType {
            guard Self.allowedCardTypes.contains(cardType) else {
                throw CardEditError.invalidCardType(cardType)
            }
        }
        if let mode = input.accountModeOverride, !input.clearAccountModeOverride {
            let trimmed = mode.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty && !Self.allowedAccountModes.contains(trimmed) {
                throw CardEditError.invalidAccountMode(trimmed)
            }
        }
        if let issuedOn = input.issuedOn, !input.clearIssuedOn {
            let trimmed = issuedOn.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty && !BillEditService.isValidCalendarDate(trimmed) {
                throw CardEditError.invalidDate(field: "发卡日", value: trimmed)
            }
        }
        if let activatedOn = input.activatedOn, !input.clearActivatedOn {
            let trimmed = activatedOn.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty && !BillEditService.isValidCalendarDate(trimmed) {
                throw CardEditError.invalidDate(field: "激活日", value: trimmed)
            }
        }

        return try await dbManager.dbWriter.write { db in
            guard var card = try CreditCard.fetchOne(db, id: cardId) else {
                throw CardEditError.cardNotFound(cardId)
            }

            var patchDict: [String: Any] = [:]

            if let productId = input.cardProductId, !productId.isEmpty {
                card.cardProductId = productId
                patchDict["card_product_id"] = productId
            }
            if let holderId = input.holderId, !holderId.isEmpty {
                card.holderId = holderId
                patchDict["holder_id"] = holderId
            }
            if let last4 = input.cardNumberLast4 {
                let trimmed = last4.trimmingCharacters(in: .whitespaces)
                card.cardNumberLast4 = trimmed.isEmpty ? nil : trimmed
                patchDict["card_number_last4"] = trimmed.isEmpty ? NSNull() : trimmed
            }
            if let name = input.nameOverride {
                let trimmed = name.trimmingCharacters(in: .whitespaces)
                card.nameOverride = trimmed.isEmpty ? nil : trimmed
                patchDict["name_override"] = trimmed.isEmpty ? NSNull() : trimmed
            }
            if let limit = input.creditLimit {
                card.creditLimit = limit
                patchDict["credit_limit"] = limit
            }
            if input.clearCreditLimitOverride {
                card.creditLimitOverride = nil
                patchDict["credit_limit_override"] = NSNull()
            } else if let limitOverride = input.creditLimitOverride {
                if limitOverride > 0 {
                    card.creditLimitOverride = limitOverride
                    patchDict["credit_limit_override"] = limitOverride
                    if input.creditLimit == nil {
                        card.creditLimit = limitOverride
                    }
                } else {
                    card.creditLimitOverride = nil
                    patchDict["credit_limit_override"] = NSNull()
                    if input.creditLimit == nil {
                        card.creditLimit = 0
                    }
                }
            }
            if input.clearAnnualFeeOverride {
                card.annualFeeOverride = nil
                patchDict["annual_fee_override"] = NSNull()
            } else if let fee = input.annualFeeOverride {
                card.annualFeeOverride = fee
                patchDict["annual_fee_override"] = fee
            }
            if let status = input.status {
                card.status = status
                patchDict["status"] = status
            }
            if let cardType = input.cardType {
                card.cardType = cardType
                patchDict["card_type"] = cardType
            }
            if input.clearIssuedOn {
                card.issuedOn = nil
                patchDict["issued_on"] = NSNull()
            } else if let issuedOn = input.issuedOn {
                let trimmed = issuedOn.trimmingCharacters(in: .whitespacesAndNewlines)
                card.issuedOn = trimmed.isEmpty ? nil : trimmed
                patchDict["issued_on"] = trimmed.isEmpty ? NSNull() : trimmed
            }
            if input.clearActivatedOn {
                card.activatedOn = nil
                patchDict["activated_on"] = NSNull()
            } else if let activatedOn = input.activatedOn {
                let trimmed = activatedOn.trimmingCharacters(in: .whitespacesAndNewlines)
                card.activatedOn = trimmed.isEmpty ? nil : trimmed
                patchDict["activated_on"] = trimmed.isEmpty ? NSNull() : trimmed
            }
            if input.clearAccountModeOverride {
                card.accountModeOverride = nil
                patchDict["account_mode_override"] = NSNull()
            } else if let mode = input.accountModeOverride {
                let trimmed = mode.trimmingCharacters(in: .whitespacesAndNewlines)
                card.accountModeOverride = trimmed.isEmpty ? nil : trimmed
                patchDict["account_mode_override"] = trimmed.isEmpty ? NSNull() : trimmed
            }
            if let day = input.billingDay {
                card.billingDay = day
                patchDict["billing_day"] = day
                // 彻底收口：写入 billing_day 时强制置空 override_billing_day，消除双列遮蔽
                card.overrideBillingDay = nil
                patchDict["override_billing_day"] = NSNull()
            } else if let ovDay = input.overrideBillingDay {
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
