import Foundation
import GRDB

public struct Bill: Codable, FetchableRecord, TableRecord, PersistableRecord, Sendable, Identifiable, Equatable {
    public static let databaseTableName = "bills"

    public var id: String
    public var accountId: String?
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
    public var minPaymentOverride: Double?
    public var dueDateOverride: String?
    public var statementDateOverride: String?
    public var statementStartOverride: String?
    public var statementEndOverride: String?
    public var createdAt: String

    public var effectiveAmount: Double {
        billAmountOverride ?? billAmount
    }

    public var effectiveMinPayment: Double? {
        minPaymentOverride ?? minPayment
    }

    public var effectiveDueDate: String {
        dueDateOverride ?? dueDate
    }

    public var effectiveStatementDate: String? {
        statementDateOverride ?? statementDate
    }

    public var effectiveStatementStart: String? {
        statementStartOverride ?? statementStart
    }

    public var effectiveStatementEnd: String? {
        statementEndOverride ?? statementEnd
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
        createdAt: String = ISO8601DateFormatter().string(from: Date()),
        accountId: String? = nil,
        minPaymentOverride: Double? = nil,
        dueDateOverride: String? = nil,
        statementDateOverride: String? = nil,
        statementStartOverride: String? = nil,
        statementEndOverride: String? = nil
    ) {
        self.id = id
        self.accountId = accountId
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
        self.minPaymentOverride = minPaymentOverride
        self.dueDateOverride = dueDateOverride
        self.statementDateOverride = statementDateOverride
        self.statementStartOverride = statementStartOverride
        self.statementEndOverride = statementEndOverride
        self.createdAt = createdAt
    }

    public init(from decoder: Decoder) throws {
        let row = try decoder.container(keyedBy: CodingKeys.self)
        id = try row.decode(String.self, forKey: .id)
        accountId = try row.decodeIfPresent(String.self, forKey: .accountId)
        cardId = try row.decode(String.self, forKey: .cardId)
        billMonth = try row.decode(String.self, forKey: .billMonth)
        statementStart = try row.decodeIfPresent(String.self, forKey: .statementStart)
        statementEnd = try row.decodeIfPresent(String.self, forKey: .statementEnd)
        statementDate = try row.decodeIfPresent(String.self, forKey: .statementDate)
        billAmount = try row.decodeIfPresent(Double.self, forKey: .billAmount) ?? 0
        minPayment = try row.decodeIfPresent(Double.self, forKey: .minPayment)
        dueDate = try row.decode(String.self, forKey: .dueDate)
        status = try row.decodeIfPresent(String.self, forKey: .status) ?? "unpaid"
        billAmountOverride = try row.decodeIfPresent(Double.self, forKey: .billAmountOverride)
        minPaymentOverride = try row.decodeIfPresent(Double.self, forKey: .minPaymentOverride)
        dueDateOverride = try row.decodeIfPresent(String.self, forKey: .dueDateOverride)
        statementDateOverride = try row.decodeIfPresent(String.self, forKey: .statementDateOverride)
        statementStartOverride = try row.decodeIfPresent(String.self, forKey: .statementStartOverride)
        statementEndOverride = try row.decodeIfPresent(String.self, forKey: .statementEndOverride)
        createdAt = try row.decodeIfPresent(String.self, forKey: .createdAt) ?? ""
    }

    enum CodingKeys: String, CodingKey {
        case id
        case accountId = "account_id"
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
        case minPaymentOverride = "min_payment_override"
        case dueDateOverride = "due_date_override"
        case statementDateOverride = "statement_date_override"
        case statementStartOverride = "statement_start_override"
        case statementEndOverride = "statement_end_override"
        case createdAt = "created_at"
    }
}
