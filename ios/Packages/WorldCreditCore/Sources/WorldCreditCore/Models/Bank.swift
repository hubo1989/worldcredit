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

    public init(from decoder: Decoder) throws {
        let row = try decoder.container(keyedBy: CodingKeys.self)
        id = try row.decode(String.self, forKey: .id)
        name = try row.decode(String.self, forKey: .name)
        shortName = try row.decodeIfPresent(String.self, forKey: .shortName)
        logoUrl = try row.decodeIfPresent(String.self, forKey: .logoUrl)
        quotaMode = try row.decodeIfPresent(String.self, forKey: .quotaMode)
        statementMode = try row.decodeIfPresent(String.self, forKey: .statementMode)
        // Pull returns D1 names; encoding and GRDB retain the existing local column.
        let remote = try decoder.container(keyedBy: RemoteKeys.self)
        if remote.contains(.customerServicePhone) {
            tel = try remote.decodeIfPresent(String.self, forKey: .customerServicePhone)
        } else {
            tel = try row.decodeIfPresent(String.self, forKey: .tel)
        }
    }

    private enum RemoteKeys: String, CodingKey {
        case customerServicePhone = "customer_service_phone"
    }

    enum CodingKeys: String, CodingKey {
        case id, name, tel
        case shortName = "short_name"
        case logoUrl = "logo_url"
        case quotaMode = "quota_mode"
        case statementMode = "statement_mode"
    }
}
