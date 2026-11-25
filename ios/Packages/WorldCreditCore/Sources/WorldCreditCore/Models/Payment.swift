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
    public var settledCurrency: String?
    public var settledAmount: Double?
    public var lockedFxRate: Double?
    public var idempotencyKey: String
    public var createdAt: String

    public init(
        id: String,
        billId: String,
        amount: Double,
        paidAt: String,
        channel: String? = "手动还款",
        note: String? = nil,
        settledCurrency: String? = nil,
        settledAmount: Double? = nil,
        lockedFxRate: Double? = nil,
        idempotencyKey: String,
        createdAt: String = ISO8601DateFormatter().string(from: Date())
    ) {
        self.id = id
        self.billId = billId
        self.amount = amount
        self.paidAt = paidAt
        self.channel = channel
        self.note = note
        self.settledCurrency = settledCurrency
        self.settledAmount = settledAmount
        self.lockedFxRate = lockedFxRate
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
        case settledCurrency = "settled_currency"
        case settledAmount = "settled_amount"
        case lockedFxRate = "locked_fx_rate"
        case idempotencyKey = "idempotency_key"
        case createdAt = "created_at"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        billId = try c.decode(String.self, forKey: .billId)
        amount = try c.decode(Double.self, forKey: .amount)
        paidAt = try c.decode(String.self, forKey: .paidAt)
        channel = try c.decodeIfPresent(String.self, forKey: .channel)
        note = try c.decodeIfPresent(String.self, forKey: .note)
        idempotencyKey = try c.decodeIfPresent(String.self, forKey: .idempotencyKey) ?? id
        createdAt = try c.decodeIfPresent(String.self, forKey: .createdAt) ?? ""
    }
}
