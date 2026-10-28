import Foundation
import GRDB

public struct Bill: Codable, FetchableRecord, TableRecord, PersistableRecord, Sendable, Identifiable {
    public static let databaseTableName = "bills"

    public var id: String
    public var cardId: String
    public var billMonth: String
    public var statementStart: String?
    public var statementEnd: String?
    public var statementDate: String?
    public var billAmount: Double
    public var minPayment: Double?
    public var dueDate: String
    public var status: String
    public var billAmountOverride: Double?
    public var createdAt: String

    public var effectiveAmount: Double {
        billAmountOverride ?? billAmount
    }

    public init(
        id: String,
        cardId: String,
        billMonth: String,
        statementStart: String? = nil,
        statementEnd: String? = nil,
        statementDate: String? = nil,
        billAmount: Double = 0,
        minPayment: Double? = 0,
        dueDate: String,
        status: String = "unpaid",
        billAmountOverride: Double? = nil,
        createdAt: String = ISO8601DateFormatter().string(from: Date())
    ) {
        self.id = id
        self.cardId = cardId
        self.billMonth = billMonth
        self.statementStart = statementStart
        self.statementEnd = statementEnd
        self.statementDate = statementDate
        self.billAmount = billAmount
        self.minPayment = minPayment
        self.dueDate = dueDate
        self.status = status
        self.billAmountOverride = billAmountOverride
        self.createdAt = createdAt
    }

    enum CodingKeys: String, CodingKey {
        case id
        case cardId = "card_id"
        case billMonth = "bill_month"
        case statementStart = "statement_start"
        case statementEnd = "statement_end"
        case statementDate = "statement_date"
        case billAmount = "bill_amount"
        case minPayment = "min_payment"
        case dueDate = "due_date"
        case status
        case billAmountOverride = "bill_amount_override"
        case createdAt = "created_at"
    }
}
