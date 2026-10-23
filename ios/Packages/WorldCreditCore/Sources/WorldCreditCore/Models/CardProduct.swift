import Foundation
import GRDB

public enum PaymentDueType: String, Codable, Sendable, DatabaseValueConvertible {
    case fixed
    case afterBilling = "after_billing"
    case fixedBeforeBilling = "fixed_before_billing"
}

public struct CardProduct: Codable, FetchableRecord, TableRecord, PersistableRecord, Sendable, Identifiable {
    public static let databaseTableName = "card_products"

    public var id: String
    public var bankId: String?
    public var bankName: String
    public var cardName: String
    public var cardType: String
    public var currency: String
    public var paymentDueType: PaymentDueType
    public var paymentDueValue: Int
    public var annualFee: Double?
    public var cardArtUrl: String?

    public init(
        id: String,
        bankId: String? = nil,
        bankName: String = "",
        cardName: String,
        cardType: String = "credit",
        currency: String = "CNY",
        paymentDueType: PaymentDueType,
        paymentDueValue: Int,
        annualFee: Double? = nil,
        cardArtUrl: String? = nil
    ) {
        self.id = id
        self.bankId = bankId
        self.bankName = bankName
        self.cardName = cardName
        self.cardType = cardType
        self.currency = currency
        self.paymentDueType = paymentDueType
        self.paymentDueValue = paymentDueValue
        self.annualFee = annualFee
        self.cardArtUrl = cardArtUrl
    }

    public init(from decoder: Decoder) throws {
        let row = try decoder.container(keyedBy: CodingKeys.self)
        id = try row.decode(String.self, forKey: .id)
        bankId = try row.decodeIfPresent(String.self, forKey: .bankId)
        bankName = try row.decode(String.self, forKey: .bankName)
        cardName = try row.decode(String.self, forKey: .cardName)
        // D1 products describe credit card templates; card_type exists only on the owned card.
        cardType = try row.decodeIfPresent(String.self, forKey: .cardType) ?? "credit"
        currency = try row.decode(String.self, forKey: .currency)
        paymentDueType = try row.decode(PaymentDueType.self, forKey: .paymentDueType)
        paymentDueValue = try row.decode(Int.self, forKey: .paymentDueValue)
        annualFee = try row.decodeIfPresent(Double.self, forKey: .annualFee)
        // D1 stores an image identifier, while the existing local column is card_art_url.
        let remote = try decoder.container(keyedBy: RemoteKeys.self)
        if remote.contains(.cardImageId) {
            cardArtUrl = try remote.decodeIfPresent(String.self, forKey: .cardImageId)
        } else {
            cardArtUrl = try row.decodeIfPresent(String.self, forKey: .cardArtUrl)
        }
    }

    private enum RemoteKeys: String, CodingKey {
        case cardImageId = "card_image_id"
    }

    enum CodingKeys: String, CodingKey {
        case id
        case bankId = "bank_id"
        case bankName = "bank_name"
        case cardName = "card_name"
        case cardType = "card_type"
        case currency
        case paymentDueType = "payment_due_type"
        case paymentDueValue = "payment_due_value"
        case annualFee = "annual_fee"
        case cardArtUrl = "card_art_url"
    }
}
