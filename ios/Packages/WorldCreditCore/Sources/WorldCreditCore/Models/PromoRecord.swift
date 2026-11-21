import Foundation
import GRDB

public struct PromoRecord: Codable, FetchableRecord, TableRecord, PersistableRecord, Sendable, Identifiable, Equatable {
    public static let databaseTableName = "promos"

    public var id: String
    public var cardProductId: String?
    public var bankId: String?
    public var bankName: String
    public var title: String
    public var description: String?
    public var discountType: String?
    public var startDate: String?
    public var endDate: String?
    public var conditions: String?
    public var maxUses: Int?
    public var isActive: Bool
    public var createdAt: String

    public init(
        id: String,
        cardProductId: String? = nil,
        bankId: String? = nil,
        bankName: String,
        title: String,
        description: String? = nil,
        discountType: String? = nil,
        startDate: String? = nil,
        endDate: String? = nil,
        conditions: String? = nil,
        maxUses: Int? = nil,
        isActive: Bool = true,
        createdAt: String = ISO8601DateFormatter().string(from: Date())
    ) {
        self.id = id
        self.cardProductId = cardProductId
        self.bankId = bankId
        self.bankName = bankName
        self.title = title
        self.description = description
        self.discountType = discountType
        self.startDate = startDate
        self.endDate = endDate
        self.conditions = conditions
        self.maxUses = maxUses
        self.isActive = isActive
        self.createdAt = createdAt
    }

    public init(from decoder: Decoder) throws {
        let row = try decoder.container(keyedBy: CodingKeys.self)
        id = try row.decode(String.self, forKey: .id)
        cardProductId = try row.decodeIfPresent(String.self, forKey: .cardProductId)
        bankId = try row.decodeIfPresent(String.self, forKey: .bankId)
        bankName = try row.decodeIfPresent(String.self, forKey: .bankName) ?? ""
        title = try row.decode(String.self, forKey: .title)
        description = try row.decodeIfPresent(String.self, forKey: .description)
        discountType = try row.decodeIfPresent(String.self, forKey: .discountType)
        startDate = try row.decodeIfPresent(String.self, forKey: .startDate)
        endDate = try row.decodeIfPresent(String.self, forKey: .endDate)
        conditions = try row.decodeIfPresent(String.self, forKey: .conditions)
        maxUses = try row.decodeIfPresent(Int.self, forKey: .maxUses)
        isActive = try row.decodeFlexibleBoolIfPresent(forKey: .isActive) ?? true
        createdAt = try row.decodeIfPresent(String.self, forKey: .createdAt) ?? ""
    }

    enum CodingKeys: String, CodingKey {
        case id, title, description, conditions
        case cardProductId = "card_product_id"
        case bankId = "bank_id"
        case bankName = "bank_name"
        case discountType = "discount_type"
        case startDate = "start_date"
        case endDate = "end_date"
        case maxUses = "max_uses"
        case isActive = "is_active"
        case createdAt = "created_at"
    }
}
