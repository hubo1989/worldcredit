import Foundation
import GRDB

public struct Bank: Codable, FetchableRecord, TableRecord, PersistableRecord, Sendable, Identifiable, Equatable {
    public static let databaseTableName = "banks"

    public var id: String
    public var name: String
    public var shortName: String?
    public var fullName: String?
    public var logoUrl: String?
    public var country: String
    public var tel: String?
    /// 派生别名：始终与 `tel` 保持单一事实来源一致；自定义 `encode(to:)` 会同步写入 `customer_service_phone`。
    public var customerServicePhone: String? {
        get { tel }
        set { tel = newValue }
    }
    public var websiteUrl: String?
    public var quotaMode: String?
    public var statementMode: String?
    public var isActive: Bool
    public var createdAt: String?

    public init(
        id: String,
        name: String,
        shortName: String? = nil,
        logoUrl: String? = nil,
        tel: String? = nil,
        quotaMode: String? = nil,
        statementMode: String? = nil,
        fullName: String? = nil,
        country: String = "CN",
        customerServicePhone: String? = nil,
        websiteUrl: String? = nil,
        isActive: Bool = true,
        createdAt: String? = nil
    ) {
        let resolvedPhone = customerServicePhone ?? tel
        self.id = id
        self.name = name
        self.shortName = shortName
        self.fullName = fullName
        self.logoUrl = logoUrl
        self.country = country
        self.tel = resolvedPhone
        self.websiteUrl = websiteUrl
        self.quotaMode = quotaMode
        self.statementMode = statementMode
        self.isActive = isActive
        self.createdAt = createdAt
    }

    public init(from decoder: Decoder) throws {
        let row = try decoder.container(keyedBy: CodingKeys.self)
        id = try row.decode(String.self, forKey: .id)
        name = try row.decode(String.self, forKey: .name)
        shortName = try row.decodeIfPresent(String.self, forKey: .shortName)
        fullName = try row.decodeIfPresent(String.self, forKey: .fullName)
        logoUrl = try row.decodeIfPresent(String.self, forKey: .logoUrl)
        country = try row.decodeIfPresent(String.self, forKey: .country) ?? "CN"
        websiteUrl = try row.decodeIfPresent(String.self, forKey: .websiteUrl)
        quotaMode = try row.decodeIfPresent(String.self, forKey: .quotaMode)
        statementMode = try row.decodeIfPresent(String.self, forKey: .statementMode)
        isActive = try row.decodeFlexibleBoolIfPresent(forKey: .isActive) ?? true
        createdAt = try row.decodeIfPresent(String.self, forKey: .createdAt)

        // D1 sends customer_service_phone; older local/JSON payloads may use tel.
        let remotePhone = try row.decodeIfPresent(String.self, forKey: .customerServicePhone)
        let localPhone = try row.decodeIfPresent(String.self, forKey: .tel)
        tel = remotePhone ?? localPhone
    }

    public func encode(to encoder: Encoder) throws {
        var row = encoder.container(keyedBy: CodingKeys.self)
        try row.encode(id, forKey: .id)
        try row.encode(name, forKey: .name)
        try row.encodeIfPresent(shortName, forKey: .shortName)
        try row.encodeIfPresent(fullName, forKey: .fullName)
        try row.encodeIfPresent(logoUrl, forKey: .logoUrl)
        try row.encode(country, forKey: .country)
        try row.encodeIfPresent(tel, forKey: .tel)
        try row.encodeIfPresent(tel, forKey: .customerServicePhone)
        try row.encodeIfPresent(websiteUrl, forKey: .websiteUrl)
        try row.encodeIfPresent(quotaMode, forKey: .quotaMode)
        try row.encodeIfPresent(statementMode, forKey: .statementMode)
        try row.encode(isActive, forKey: .isActive)
        try row.encodeIfPresent(createdAt, forKey: .createdAt)
    }

    enum CodingKeys: String, CodingKey {
        case id, name, tel, country
        case shortName = "short_name"
        case fullName = "full_name"
        case logoUrl = "logo_url"
        case customerServicePhone = "customer_service_phone"
        case websiteUrl = "website_url"
        case quotaMode = "quota_mode"
        case statementMode = "statement_mode"
        case isActive = "is_active"
        case createdAt = "created_at"
    }
}
