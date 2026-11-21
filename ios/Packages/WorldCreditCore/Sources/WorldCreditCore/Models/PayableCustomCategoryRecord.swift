import Foundation
import GRDB

public struct PayableCustomCategoryRecord: Codable, FetchableRecord, TableRecord, PersistableRecord, Sendable, Identifiable, Equatable {
    public static let databaseTableName = "payable_custom_categories"

    public var id: String
    public var userId: String
    public var name: String
    public var normalizedName: String
    public var createdAt: String

    public init(
        id: String,
        userId: String,
        name: String,
        normalizedName: String? = nil,
        createdAt: String = ISO8601DateFormatter().string(from: Date())
    ) {
        self.id = id
        self.userId = userId
        self.name = name
        self.normalizedName = normalizedName ?? name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        self.createdAt = createdAt
    }

    public init(from decoder: Decoder) throws {
        let row = try decoder.container(keyedBy: CodingKeys.self)
        id = try row.decode(String.self, forKey: .id)
        userId = try row.decode(String.self, forKey: .userId)
        name = try row.decode(String.self, forKey: .name)
        normalizedName = try row.decodeIfPresent(String.self, forKey: .normalizedName)
            ?? name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        createdAt = try row.decodeIfPresent(String.self, forKey: .createdAt) ?? ""
    }

    enum CodingKeys: String, CodingKey {
        case id, name
        case userId = "user_id"
        case normalizedName = "normalized_name"
        case createdAt = "created_at"
    }
}
