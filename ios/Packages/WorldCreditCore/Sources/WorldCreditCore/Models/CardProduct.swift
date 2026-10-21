import Foundation

public enum PaymentDueType: String, Codable, Sendable {
    case fixed
    case afterBilling = "after_billing"
    case fixedBeforeBilling = "fixed_before_billing"
}

public struct CardProduct: Codable, Sendable {
    public var id: String
    public var bankId: String?
    public var cardName: String
    public var paymentDueType: PaymentDueType
    public var paymentDueValue: Int

    public init(
        id: String,
        bankId: String? = nil,
        cardName: String,
        paymentDueType: PaymentDueType,
        paymentDueValue: Int
    ) {
        self.id = id
        self.bankId = bankId
        self.cardName = cardName
        self.paymentDueType = paymentDueType
        self.paymentDueValue = paymentDueValue
    }

    enum CodingKeys: String, CodingKey {
        case id
        case bankId = "bank_id"
        case cardName = "card_name"
        case paymentDueType = "payment_due_type"
        case paymentDueValue = "payment_due_value"
    }
}
