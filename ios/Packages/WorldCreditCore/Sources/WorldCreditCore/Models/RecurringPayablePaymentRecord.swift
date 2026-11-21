import Foundation
import GRDB

public struct RecurringPayablePaymentRecord: Codable, FetchableRecord, TableRecord, PersistableRecord, Sendable, Identifiable, Equatable {
    public static let databaseTableName = "recurring_payable_payments"

    public var id: String
    public var payableId: String
    public var period: String
    public var amount: Double
    public var paidAt: String
    public var note: String?
    public var createdAt: String

    public init(
        id: String,
        payableId: String,
        period: String,
        amount: Double,
        paidAt: String,
        note: String? = nil,
        createdAt: String = ISO8601DateFormatter().string(from: Date())
    ) {
        self.id = id
        self.payableId = payableId
        self.period = period
        self.amount = amount
        self.paidAt = paidAt
        self.note = note
        self.createdAt = createdAt
    }

    public init(from decoder: Decoder) throws {
        let row = try decoder.container(keyedBy: CodingKeys.self)
        id = try row.decode(String.self, forKey: .id)
        payableId = try row.decode(String.self, forKey: .payableId)
        period = try row.decode(String.self, forKey: .period)
        amount = try row.decode(Double.self, forKey: .amount)
        paidAt = try row.decode(String.self, forKey: .paidAt)
        note = try row.decodeIfPresent(String.self, forKey: .note)
        createdAt = try row.decodeIfPresent(String.self, forKey: .createdAt) ?? ""
    }

    enum CodingKeys: String, CodingKey {
        case id, period, amount, note
        case payableId = "payable_id"
        case paidAt = "paid_at"
        case createdAt = "created_at"
    }
}
