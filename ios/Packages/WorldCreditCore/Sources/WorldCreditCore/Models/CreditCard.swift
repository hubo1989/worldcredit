import Foundation

public struct CreditCard: Codable, Sendable {
    public var id: String
    public var holderId: String
    public var cardProductId: String
    public var billingDay: Int
    public var overrideBillingDay: Int?
    public var overrideDueType: PaymentDueType?
    public var overrideDueValue: Int?
    public var cardNumberLast4: String?
    public var creditLimit: Double
    public var status: String

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
        status: String = "active"
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
    }

    enum CodingKeys: String, CodingKey {
        case id
        case holderId = "holder_id"
        case cardProductId = "card_product_id"
        case billingDay = "billing_day"
        case overrideBillingDay = "override_billing_day"
        case overrideDueType = "override_due_type"
        case overrideDueValue = "override_due_value"
        case cardNumberLast4 = "card_number_last4"
        case creditLimit = "credit_limit"
        case status
    }
}
