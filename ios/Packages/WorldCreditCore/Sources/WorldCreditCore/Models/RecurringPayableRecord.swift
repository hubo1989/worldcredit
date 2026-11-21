import Foundation
import GRDB

public struct RecurringPayableRecord: Codable, FetchableRecord, TableRecord, PersistableRecord, Sendable, Identifiable, Equatable {
    public static let databaseTableName = "recurring_payables"

    public var id: String
    public var createdBy: String
    public var name: String
    public var category: String
    public var customCategory: String?
    public var amount: Double
    public var currency: String
    public var dueDay: Int
    public var cycleType: String
    public var cycleMonths: Int
    public var dueMonth: Int?
    public var anchorPeriod: String?
    public var holderId: String?
    public var bankName: String?
    public var bankAccount: String?
    public var note: String?
    public var isActive: Bool
    public var createdAt: String

    public init(
        id: String,
        createdBy: String,
        name: String,
        category: String = "other",
        customCategory: String? = nil,
        amount: Double = 0,
        currency: String = "CNY",
        dueDay: Int,
        cycleType: String = "monthly",
        cycleMonths: Int = 1,
        dueMonth: Int? = nil,
        anchorPeriod: String? = nil,
        holderId: String? = nil,
        bankName: String? = nil,
        bankAccount: String? = nil,
        note: String? = nil,
        isActive: Bool = true,
        createdAt: String = ISO8601DateFormatter().string(from: Date())
    ) {
        self.id = id
        self.createdBy = createdBy
        self.name = name
        self.category = category
        self.customCategory = customCategory
        self.amount = amount
        self.currency = currency
        self.dueDay = dueDay
        self.cycleType = cycleType
        self.cycleMonths = cycleMonths
        self.dueMonth = dueMonth
        self.anchorPeriod = anchorPeriod
        self.holderId = holderId
        self.bankName = bankName
        self.bankAccount = bankAccount
        self.note = note
        self.isActive = isActive
        self.createdAt = createdAt
    }

    public init(from decoder: Decoder) throws {
        let row = try decoder.container(keyedBy: CodingKeys.self)
        id = try row.decode(String.self, forKey: .id)
        createdBy = try row.decode(String.self, forKey: .createdBy)
        name = try row.decode(String.self, forKey: .name)
        category = try row.decodeIfPresent(String.self, forKey: .category) ?? "other"
        customCategory = try row.decodeIfPresent(String.self, forKey: .customCategory)
        amount = try row.decodeIfPresent(Double.self, forKey: .amount) ?? 0
        currency = try row.decodeIfPresent(String.self, forKey: .currency) ?? "CNY"
        dueDay = try row.decode(Int.self, forKey: .dueDay)
        cycleType = try row.decodeIfPresent(String.self, forKey: .cycleType) ?? "monthly"
        cycleMonths = try row.decodeIfPresent(Int.self, forKey: .cycleMonths) ?? 1
        dueMonth = try row.decodeIfPresent(Int.self, forKey: .dueMonth)
        anchorPeriod = try row.decodeIfPresent(String.self, forKey: .anchorPeriod)
        holderId = try row.decodeIfPresent(String.self, forKey: .holderId)
        bankName = try row.decodeIfPresent(String.self, forKey: .bankName)
        let remoteBankAccount = try row.decodeIfPresent(String.self, forKey: .bankAccount)
        let legacyAlias = try decoder.container(keyedBy: LegacyKeys.self)
            .decodeIfPresent(String.self, forKey: .accountLast4)
        bankAccount = remoteBankAccount ?? legacyAlias
        note = try row.decodeIfPresent(String.self, forKey: .note)
        isActive = try row.decodeFlexibleBoolIfPresent(forKey: .isActive) ?? true
        createdAt = try row.decodeIfPresent(String.self, forKey: .createdAt) ?? ""
    }

    private enum LegacyKeys: String, CodingKey {
        case accountLast4 = "account_last4"
    }

    enum CodingKeys: String, CodingKey {
        case id, name, category, amount, currency, note
        case createdBy = "created_by"
        case customCategory = "custom_category"
        case dueDay = "due_day"
        case cycleType = "cycle_type"
        case cycleMonths = "cycle_months"
        case dueMonth = "due_month"
        case anchorPeriod = "anchor_period"
        case holderId = "holder_id"
        case bankName = "bank_name"
        case bankAccount = "bank_account"
        case isActive = "is_active"
        case createdAt = "created_at"
    }
}
