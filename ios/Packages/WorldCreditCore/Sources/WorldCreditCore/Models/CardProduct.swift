import Foundation
import GRDB

public enum PaymentDueType: String, Codable, Sendable, DatabaseValueConvertible {
    case fixed
    case afterBilling = "after_billing"
    case fixedBeforeBilling = "fixed_before_billing"
}

public struct CardProduct: Codable, FetchableRecord, TableRecord, PersistableRecord, Sendable, Identifiable, Equatable {
    public static let databaseTableName = "card_products"

    public var id: String
    public var country: String
    public var bankId: String?
    public var bankName: String
    public var cardName: String
    public var cardType: String
    public var cardImageId: String?
    public var descriptionMd: String?
    public var applyUrl: String?
    public var rewardsSummary: String?
    public var currency: String
    public var paymentDueType: PaymentDueType
    public var paymentDueValue: Int
    public var annualFee: Double?
    public var annualFeeWaiver: String?
    public var cardArtUrl: String?
    public var isActive: Bool
    public var createdAt: String?

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
        cardArtUrl: String? = nil,
        country: String = "CN",
        cardImageId: String? = nil,
        descriptionMd: String? = nil,
        applyUrl: String? = nil,
        rewardsSummary: String? = nil,
        annualFeeWaiver: String? = nil,
        isActive: Bool = true,
        createdAt: String? = nil
    ) {
        let resolvedImage = cardImageId ?? cardArtUrl
        self.id = id
        self.country = country
        self.bankId = bankId
        self.bankName = bankName
        self.cardName = cardName
        self.cardType = cardType
        self.cardImageId = resolvedImage
        self.descriptionMd = descriptionMd
        self.applyUrl = applyUrl
        self.rewardsSummary = rewardsSummary
        self.currency = currency
        self.paymentDueType = paymentDueType
        self.paymentDueValue = paymentDueValue
        self.annualFee = annualFee
        self.annualFeeWaiver = annualFeeWaiver
        self.cardArtUrl = resolvedImage
        self.isActive = isActive
        self.createdAt = createdAt
    }

    public init(from decoder: Decoder) throws {
        let row = try decoder.container(keyedBy: CodingKeys.self)
        id = try row.decode(String.self, forKey: .id)
        country = try row.decodeIfPresent(String.self, forKey: .country) ?? "CN"
        bankId = try row.decodeIfPresent(String.self, forKey: .bankId)
        bankName = try row.decodeIfPresent(String.self, forKey: .bankName) ?? ""
        cardName = try row.decode(String.self, forKey: .cardName)
        // D1 products describe credit card templates; card_type exists only on the owned card.
        cardType = try row.decodeIfPresent(String.self, forKey: .cardType) ?? "credit"
        descriptionMd = try row.decodeIfPresent(String.self, forKey: .descriptionMd)
        applyUrl = try row.decodeIfPresent(String.self, forKey: .applyUrl)
        rewardsSummary = try row.decodeIfPresent(String.self, forKey: .rewardsSummary)
        currency = try row.decodeIfPresent(String.self, forKey: .currency) ?? "CNY"
        paymentDueType = try row.decode(PaymentDueType.self, forKey: .paymentDueType)
        paymentDueValue = try row.decode(Int.self, forKey: .paymentDueValue)
        annualFee = try row.decodeIfPresent(Double.self, forKey: .annualFee)
        annualFeeWaiver = try row.decodeIfPresent(String.self, forKey: .annualFeeWaiver)
        isActive = try row.decodeFlexibleBoolIfPresent(forKey: .isActive) ?? true
        createdAt = try row.decodeIfPresent(String.self, forKey: .createdAt)

        // D1 stores card_image_id while existing local records/tests may provide card_art_url.
        let remoteImage = try row.decodeIfPresent(String.self, forKey: .cardImageId)
        let localImage = try row.decodeIfPresent(String.self, forKey: .cardArtUrl)
        let resolvedImage = remoteImage ?? localImage
        cardImageId = resolvedImage
        cardArtUrl = resolvedImage
    }

    enum CodingKeys: String, CodingKey {
        case id, country, currency
        case bankId = "bank_id"
        case bankName = "bank_name"
        case cardName = "card_name"
        case cardType = "card_type"
        case cardImageId = "card_image_id"
        case descriptionMd = "description_md"
        case applyUrl = "apply_url"
        case rewardsSummary = "rewards_summary"
        case paymentDueType = "payment_due_type"
        case paymentDueValue = "payment_due_value"
        case annualFee = "annual_fee"
        case annualFeeWaiver = "annual_fee_waiver"
        case cardArtUrl = "card_art_url"
        case isActive = "is_active"
        case createdAt = "created_at"
    }
}
