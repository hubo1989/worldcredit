import Foundation
import GRDB

public struct Payment: Codable, FetchableRecord, TableRecord, PersistableRecord, Sendable, Identifiable {
    public static let databaseTableName = "payments"

    public var id: String
    public var billId: String
    public var amount: Double
    public var paidAt: String
    public var channel: String?
    public var note: String?
    public var idempotencyKey: String
    public var createdAt: String

    public init(
        id: String,
        billId: String,
        amount: Double,
        paidAt: String,
        channel: String? = "手动还款",
        note: String? = nil,
        idempotencyKey: String,
        createdAt: String = ISO8601DateFormatter().string(from: Date())
    ) {
        self.id = id
        self.billId = billId
        self.amount = amount
        self.paidAt = paidAt
        self.channel = channel
        self.note = note
        self.idempotencyKey = idempotencyKey
        self.createdAt = createdAt
    }

    public init(from decoder: Decoder) throws {
        let row = try decoder.container(keyedBy: CodingKeys.self)
        id = try row.decode(String.self, forKey: .id)
        billId = try row.decode(String.self, forKey: .billId)
        amount = try row.decode(Double.self, forKey: .amount)
        paidAt = try row.decode(String.self, forKey: .paidAt)
        channel = try row.decodeIfPresent(String.self, forKey: .channel)
        note = try row.decodeIfPresent(String.self, forKey: .note)
        idempotencyKey = try row.decodeIfPresent(String.self, forKey: .idempotencyKey) ?? id
        createdAt = try row.decodeIfPresent(String.self, forKey: .createdAt) ?? ""
    }

    enum CodingKeys: String, CodingKey {
        case id
        case billId = "bill_id"
        case amount
        case paidAt = "paid_at"
        case channel
        case note
        case idempotencyKey = "idempotency_key"
        case createdAt = "created_at"
    }
}
