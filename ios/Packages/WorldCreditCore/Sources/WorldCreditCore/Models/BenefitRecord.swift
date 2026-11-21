import Foundation
import GRDB

public struct BenefitRecord: Codable, FetchableRecord, TableRecord, PersistableRecord, Sendable, Identifiable, Equatable {
    public static let databaseTableName = "benefits"

    public var id: String
    public var cardProductId: String
    public var name: String
    public var description: String?
    public var quota: Int
    public var period: String
    public var resetMonth: Int?
    public var expiryDate: String?
    public var createdAt: String

    public init(
        id: String,
        cardProductId: String,
        name: String,
        description: String? = nil,
        quota: Int = 1,
        period: String = "yearly",
        resetMonth: Int? = nil,
        expiryDate: String? = nil,
        createdAt: String = ISO8601DateFormatter().string(from: Date())
    ) {
        self.id = id
        self.cardProductId = cardProductId
        self.name = name
        self.description = description
        self.quota = quota
        self.period = period
        self.resetMonth = resetMonth
        self.expiryDate = expiryDate
        self.createdAt = createdAt
    }

    public init(from decoder: Decoder) throws {
        let row = try decoder.container(keyedBy: CodingKeys.self)
        id = try row.decode(String.self, forKey: .id)
        cardProductId = try row.decode(String.self, forKey: .cardProductId)
        name = try row.decode(String.self, forKey: .name)
        description = try row.decodeIfPresent(String.self, forKey: .description)
        quota = try row.decodeIfPresent(Int.self, forKey: .quota) ?? 1
        period = try row.decodeIfPresent(String.self, forKey: .period) ?? "yearly"
        resetMonth = try row.decodeIfPresent(Int.self, forKey: .resetMonth)
        expiryDate = try row.decodeIfPresent(String.self, forKey: .expiryDate)
        createdAt = try row.decodeIfPresent(String.self, forKey: .createdAt) ?? ""
    }

    enum CodingKeys: String, CodingKey {
        case id, name, description, quota, period
        case cardProductId = "card_product_id"
        case resetMonth = "reset_month"
        case expiryDate = "expiry_date"
        case createdAt = "created_at"
    }
}
