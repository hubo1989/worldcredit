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
