import Foundation
import GRDB

public struct SyncMeta: Codable, FetchableRecord, TableRecord, PersistableRecord, Sendable {
    public static let databaseTableName = "sync_meta"

    public var key: String
    public var value: String

    public init(key: String, value: String) {
        self.key = key
        self.value = value
    }
}

public struct MutationOutbox: Codable, FetchableRecord, TableRecord, PersistableRecord, Sendable, Identifiable {
    public static let databaseTableName = "mutation_outbox"

    public var id: String
    public var name: String
    public var argsJson: String
    public var createdAt: String
    public var retryCount: Int
    public var lastError: String?

    public init(
        id: String = UUID().uuidString,
        name: String,
        argsJson: String,
        createdAt: String = ISO8601DateFormatter().string(from: Date()),
        retryCount: Int = 0,
        lastError: String? = nil
    ) {
        self.id = id
        self.name = name
        self.argsJson = argsJson
        self.createdAt = createdAt
        self.retryCount = retryCount
        self.lastError = lastError
    }

    enum CodingKeys: String, CodingKey {
        case id, name
        case argsJson = "args_json"
        case createdAt = "created_at"
        case retryCount = "retry_count"
        case lastError = "last_error"
    }
}
