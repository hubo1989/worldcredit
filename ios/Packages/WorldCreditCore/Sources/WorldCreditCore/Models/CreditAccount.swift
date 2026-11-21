import Foundation
import GRDB

public struct CreditAccount: Codable, FetchableRecord, TableRecord, PersistableRecord, Sendable, Identifiable, Equatable {
    public static let databaseTableName = "credit_accounts"

    public var id: String
    public var holderId: String
    public var bankId: String?
    public var bankName: String
    public var currency: String
    public var accountTail: String?
    public var statementMode: String
    public var quotaMode: String
    public var sharedCreditLimit: Double?
    public var billingDay: Int?
    public var dueType: String?
    public var dueValue: Int?
    public var primaryCardId: String?
    public var label: String?
    public var status: String
    public var createdAt: String
    public var updatedAt: String

    public var parsedDueType: PaymentDueType? {
        dueType.flatMap(PaymentDueType.init(rawValue:))
    }

    public init(
        id: String,
        holderId: String,
        bankId: String? = nil,
        bankName: String,
        currency: String = "CNY",
        accountTail: String? = nil,
        statementMode: String = "independent",
        quotaMode: String = "independent",
        sharedCreditLimit: Double? = nil,
        billingDay: Int? = nil,
        dueType: String? = "after_billing",
        dueValue: Int? = 20,
        primaryCardId: String? = nil,
        label: String? = nil,
        status: String = "active",
        createdAt: String = ISO8601DateFormatter().string(from: Date()),
        updatedAt: String = ISO8601DateFormatter().string(from: Date())
    ) {
        self.id = id
        self.holderId = holderId
        self.bankId = bankId
        self.bankName = bankName
        self.currency = currency
        self.accountTail = accountTail
        self.statementMode = statementMode
        self.quotaMode = quotaMode
        self.sharedCreditLimit = sharedCreditLimit
        self.billingDay = billingDay
        self.dueType = dueType
        self.dueValue = dueValue
        self.primaryCardId = primaryCardId
        self.label = label
        self.status = status
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    public init(from decoder: Decoder) throws {
        let row = try decoder.container(keyedBy: CodingKeys.self)
        id = try row.decode(String.self, forKey: .id)
        holderId = try row.decode(String.self, forKey: .holderId)
        bankId = try row.decodeIfPresent(String.self, forKey: .bankId)
        bankName = try row.decodeIfPresent(String.self, forKey: .bankName) ?? ""
        currency = try row.decodeIfPresent(String.self, forKey: .currency) ?? "CNY"
        accountTail = try row.decodeIfPresent(String.self, forKey: .accountTail)
        statementMode = try row.decodeIfPresent(String.self, forKey: .statementMode) ?? "independent"
        quotaMode = try row.decodeIfPresent(String.self, forKey: .quotaMode) ?? "independent"
        sharedCreditLimit = try row.decodeIfPresent(Double.self, forKey: .sharedCreditLimit)
        billingDay = try row.decodeIfPresent(Int.self, forKey: .billingDay)
        dueType = try row.decodeIfPresent(String.self, forKey: .dueType) ?? "after_billing"
        dueValue = try row.decodeIfPresent(Int.self, forKey: .dueValue)
        primaryCardId = try row.decodeIfPresent(String.self, forKey: .primaryCardId)
        label = try row.decodeIfPresent(String.self, forKey: .label)
        status = try row.decodeIfPresent(String.self, forKey: .status) ?? "active"
        createdAt = try row.decodeIfPresent(String.self, forKey: .createdAt) ?? ""
        updatedAt = try row.decodeIfPresent(String.self, forKey: .updatedAt) ?? ""
    }

    enum CodingKeys: String, CodingKey {
        case id, currency, label, status
        case holderId = "holder_id"
        case bankId = "bank_id"
        case bankName = "bank_name"
        case accountTail = "account_tail"
        case statementMode = "statement_mode"
        case quotaMode = "quota_mode"
        case sharedCreditLimit = "shared_credit_limit"
        case billingDay = "billing_day"
        case dueType = "due_type"
        case dueValue = "due_value"
        case primaryCardId = "primary_card_id"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}
