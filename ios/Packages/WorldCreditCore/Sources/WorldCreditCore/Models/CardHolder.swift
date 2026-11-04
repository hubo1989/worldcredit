import Foundation
import GRDB

public struct CardHolder: Codable, FetchableRecord, TableRecord, PersistableRecord, Sendable, Identifiable {
    public static let databaseTableName = "card_holders"

    public var id: String
    public var createdBy: String
    public var managedBy: String
    public var name: String
    public var phone: String?
    public var email: String?
    public var aliases: String?
    public var avatarColor: String?
    public var authUserId: String?
    public var createdAt: String

    public init(
        id: String,
        createdBy: String,
        managedBy: String,
        name: String,
        phone: String? = nil,
        email: String? = nil,
        aliases: String? = nil,
        avatarColor: String? = "#1976d2",
        authUserId: String? = nil,
        createdAt: String = ISO8601DateFormatter().string(from: Date())
    ) {
        self.id = id
        self.createdBy = createdBy
        self.managedBy = managedBy
        self.name = name
        self.phone = phone
        self.email = email
        self.aliases = aliases
        self.avatarColor = avatarColor
        self.authUserId = authUserId
        self.createdAt = createdAt
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        let cb = try container.decodeIfPresent(String.self, forKey: .createdBy) ?? ""
        createdBy = cb
        managedBy = try container.decodeIfPresent(String.self, forKey: .managedBy) ?? cb
        name = try container.decode(String.self, forKey: .name)
        phone = try container.decodeIfPresent(String.self, forKey: .phone)
        email = try container.decodeIfPresent(String.self, forKey: .email)
        aliases = try container.decodeIfPresent(String.self, forKey: .aliases)
        avatarColor = try container.decodeIfPresent(String.self, forKey: .avatarColor) ?? "#1976d2"
        authUserId = try container.decodeIfPresent(String.self, forKey: .authUserId)
        createdAt = try container.decodeIfPresent(String.self, forKey: .createdAt) ?? ""
    }

    enum CodingKeys: String, CodingKey {
        case id, name, phone, email, aliases
        case createdBy = "created_by"
        case managedBy = "managed_by"
        case avatarColor = "avatar_color"
        case authUserId = "auth_user_id"
        case createdAt = "created_at"
    }
}
