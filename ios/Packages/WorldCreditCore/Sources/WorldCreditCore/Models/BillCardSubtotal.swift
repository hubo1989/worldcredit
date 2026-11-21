import Foundation
import GRDB

public struct BillCardSubtotal: Codable, FetchableRecord, TableRecord, PersistableRecord, Sendable, Identifiable, Equatable {
    public static let databaseTableName = "bill_card_subtotals"

    public var id: String
    public var billId: String
    public var cardId: String?
    public var cardTail: String
    public var subtotalAmount: Double
    public var currency: String?
    public var source: String
    public var createdAt: String

    public init(
        id: String,
        billId: String,
        cardId: String? = nil,
        cardTail: String,
        subtotalAmount: Double,
        currency: String? = "CNY",
        source: String = "email",
        createdAt: String = ISO8601DateFormatter().string(from: Date())
    ) {
        self.id = id
        self.billId = billId
        self.cardId = cardId
        self.cardTail = cardTail
        self.subtotalAmount = subtotalAmount
        self.currency = currency
        self.source = source
        self.createdAt = createdAt
    }

    public init(from decoder: Decoder) throws {
        let row = try decoder.container(keyedBy: CodingKeys.self)
        id = try row.decode(String.self, forKey: .id)
        billId = try row.decode(String.self, forKey: .billId)
        cardId = try row.decodeIfPresent(String.self, forKey: .cardId)
        cardTail = try row.decode(String.self, forKey: .cardTail)
        subtotalAmount = try row.decode(Double.self, forKey: .subtotalAmount)
        currency = try row.decodeIfPresent(String.self, forKey: .currency) ?? "CNY"
        source = try row.decodeIfPresent(String.self, forKey: .source) ?? "email"
        createdAt = try row.decodeIfPresent(String.self, forKey: .createdAt) ?? ""
    }

    enum CodingKeys: String, CodingKey {
        case id, currency, source
        case billId = "bill_id"
        case cardId = "card_id"
        case cardTail = "card_tail"
        case subtotalAmount = "subtotal_amount"
        case createdAt = "created_at"
    }
}
