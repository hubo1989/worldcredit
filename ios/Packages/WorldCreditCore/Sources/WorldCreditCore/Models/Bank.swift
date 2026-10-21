import Foundation
import GRDB

public struct Bank: Codable, FetchableRecord, TableRecord, PersistableRecord, Sendable, Identifiable {
    public static let databaseTableName = "banks"

    public var id: String
    public var name: String
    public var shortName: String?
    public var logoUrl: String?
    public var tel: String?
    public var quotaMode: String?
    public var statementMode: String?

    public init(
        id: String,
        name: String,
        shortName: String? = nil,
        logoUrl: String? = nil,
        tel: String? = nil,
        quotaMode: String? = nil,
        statementMode: String? = nil
    ) {
        self.id = id
        self.name = name
        self.shortName = shortName
        self.logoUrl = logoUrl
        self.tel = tel
        self.quotaMode = quotaMode
        self.statementMode = statementMode
    }

    enum CodingKeys: String, CodingKey {
        case id, name, tel
        case shortName = "short_name"
        case logoUrl = "logo_url"
        case quotaMode = "quota_mode"
        case statementMode = "statement_mode"
    }
}
