import Foundation
import GRDB

public struct CreditCard: Codable, FetchableRecord, TableRecord, PersistableRecord, Sendable, Identifiable {
    public static let databaseTableName = "credit_cards"

    public var id: String
    public var holderId: String
    public var cardProductId: String
    public var cardNumberLast4: String?
    public var creditLimit: Double
    public var billingDay: Int
    public var status: String
    public var cardType: String
    public var loanDueDay: Int?
    public var overrideBillingDay: Int?
    public var overrideDueType: PaymentDueType?
    public var overrideDueValue: Int?
    public var nameOverride: String?
    public var annualFeeOverride: Double?
    public var accountModeOverride: String?
    public var createdAt: String

    public init(
        id: String,
        holderId: String,
        cardProductId: String,
        billingDay: Int,
        overrideBillingDay: Int? = nil,
        overrideDueType: PaymentDueType? = nil,
        overrideDueValue: Int? = nil,
        cardNumberLast4: String? = nil,
        creditLimit: Double = 0,
        status: String = "active",
        cardType: String = "credit",
        loanDueDay: Int? = nil,
        nameOverride: String? = nil,
        annualFeeOverride: Double? = nil,
        accountModeOverride: String? = nil,
        createdAt: String = ISO8601DateFormatter().string(from: Date())
    ) {
        self.id = id
        self.holderId = holderId
        self.cardProductId = cardProductId
        self.billingDay = billingDay
        self.overrideBillingDay = overrideBillingDay
        self.overrideDueType = overrideDueType
        self.overrideDueValue = overrideDueValue
        self.cardNumberLast4 = cardNumberLast4
        self.creditLimit = creditLimit
        self.status = status
        self.cardType = cardType
        self.loanDueDay = loanDueDay
        self.nameOverride = nameOverride
        self.annualFeeOverride = annualFeeOverride
        self.accountModeOverride = accountModeOverride
        self.createdAt = createdAt
    }

    enum CodingKeys: String, CodingKey {
        case id
        case holderId = "holder_id"
        case cardProductId = "card_product_id"
        case cardNumberLast4 = "card_number_last4"
        case creditLimit = "credit_limit"
        case billingDay = "billing_day"
        case status
        case cardType = "card_type"
        case loanDueDay = "loan_due_day"
        case overrideBillingDay = "override_billing_day"
        case overrideDueType = "override_due_type"
        case overrideDueValue = "override_due_value"
        case nameOverride = "name_override"
        case annualFeeOverride = "annual_fee_override"
        case accountModeOverride = "account_mode_override"
        case createdAt = "created_at"
    }
}
