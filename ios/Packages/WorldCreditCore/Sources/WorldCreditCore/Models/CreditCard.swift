import Foundation
import GRDB

public struct CreditCard: Codable, FetchableRecord, TableRecord, PersistableRecord, Sendable, Identifiable, Equatable {
    public static let databaseTableName = "credit_cards"

    public var id: String
    public var holderId: String
    public var accountId: String?
    public var cardProductId: String
    public var cardNumberLast4: String?
    public var creditLimit: Double
    public var creditLimitOverride: Double?
    public var billingDay: Int
    public var status: String
    public var cardType: String
    public var loanDueDay: Int?
    public var overrideBillingDay: Int?
    public var overrideDueType: PaymentDueType?
    public var overrideDueValue: Int?
    public var nameOverride: String?
    public var annualFeeOverride: Double?
    public var accountModeOverride: String?
    public var issuedOn: String?
    public var activatedOn: String?
    public var annualFeeCycleType: String?
    public var nextAnnualFeeDate: String?
    public var annualFeeStatus: String?
    public var waiverProgressJson: String?
    public var actualFeePaid: Double?
    public var manualRewardValue: Double?
    public var createdAt: String

    public var effectiveCreditLimit: Double {
        creditLimitOverride ?? creditLimit
    }

    public init(
        id: String,
        holderId: String,
        cardProductId: String,
        billingDay: Int,
        overrideBillingDay: Int? = nil,
        overrideDueType: PaymentDueType? = nil,
        overrideDueValue: Int? = nil,
        cardNumberLast4: String? = nil,
        creditLimit: Double = 0,
        status: String = "active",
        cardType: String = "credit",
        loanDueDay: Int? = nil,
        nameOverride: String? = nil,
        annualFeeOverride: Double? = nil,
        accountModeOverride: String? = nil,
        createdAt: String = ISO8601DateFormatter().string(from: Date()),
        accountId: String? = nil,
        creditLimitOverride: Double? = nil,
        issuedOn: String? = nil,
        activatedOn: String? = nil,
        annualFeeCycleType: String? = nil,
        nextAnnualFeeDate: String? = nil,
        annualFeeStatus: String? = nil,
        waiverProgressJson: String? = nil,
        actualFeePaid: Double? = nil,
        manualRewardValue: Double? = nil
    ) {
        self.id = id
        self.holderId = holderId
        self.accountId = accountId
        self.cardProductId = cardProductId
        self.billingDay = billingDay
        self.overrideBillingDay = overrideBillingDay
        self.overrideDueType = overrideDueType
        self.overrideDueValue = overrideDueValue
        self.cardNumberLast4 = cardNumberLast4
        self.creditLimit = creditLimit
        self.creditLimitOverride = creditLimitOverride
        self.status = status
        self.cardType = cardType
        self.loanDueDay = loanDueDay
        self.nameOverride = nameOverride
        self.annualFeeOverride = annualFeeOverride
        self.accountModeOverride = accountModeOverride
        self.issuedOn = issuedOn
        self.activatedOn = activatedOn
        self.annualFeeCycleType = annualFeeCycleType
        self.nextAnnualFeeDate = nextAnnualFeeDate
        self.annualFeeStatus = annualFeeStatus
        self.waiverProgressJson = waiverProgressJson
        self.actualFeePaid = actualFeePaid
        self.manualRewardValue = manualRewardValue
        self.createdAt = createdAt
    }

    public init(from decoder: Decoder) throws {
        let row = try decoder.container(keyedBy: CodingKeys.self)
        id = try row.decode(String.self, forKey: .id)
        holderId = try row.decode(String.self, forKey: .holderId)
        accountId = try row.decodeIfPresent(String.self, forKey: .accountId)
        cardProductId = try row.decode(String.self, forKey: .cardProductId)
        cardNumberLast4 = try row.decodeIfPresent(String.self, forKey: .cardNumberLast4)
        creditLimit = try row.decodeIfPresent(Double.self, forKey: .creditLimit) ?? 0
        creditLimitOverride = try row.decodeIfPresent(Double.self, forKey: .creditLimitOverride)
        billingDay = try row.decode(Int.self, forKey: .billingDay)
        status = try row.decodeIfPresent(String.self, forKey: .status) ?? "active"
        cardType = try row.decodeIfPresent(String.self, forKey: .cardType) ?? "credit"
        loanDueDay = try row.decodeIfPresent(Int.self, forKey: .loanDueDay)
        overrideBillingDay = try row.decodeIfPresent(Int.self, forKey: .overrideBillingDay)
        overrideDueType = try row.decodeIfPresent(PaymentDueType.self, forKey: .overrideDueType)
        overrideDueValue = try row.decodeIfPresent(Int.self, forKey: .overrideDueValue)
        nameOverride = try row.decodeIfPresent(String.self, forKey: .nameOverride)
        annualFeeOverride = try row.decodeIfPresent(Double.self, forKey: .annualFeeOverride)
        accountModeOverride = try row.decodeIfPresent(String.self, forKey: .accountModeOverride)
        issuedOn = try row.decodeIfPresent(String.self, forKey: .issuedOn)
        activatedOn = try row.decodeIfPresent(String.self, forKey: .activatedOn)
        annualFeeCycleType = try row.decodeIfPresent(String.self, forKey: .annualFeeCycleType)
        nextAnnualFeeDate = try row.decodeIfPresent(String.self, forKey: .nextAnnualFeeDate)
        annualFeeStatus = try row.decodeIfPresent(String.self, forKey: .annualFeeStatus)
        waiverProgressJson = try row.decodeIfPresent(String.self, forKey: .waiverProgressJson)
        actualFeePaid = try row.decodeIfPresent(Double.self, forKey: .actualFeePaid)
        manualRewardValue = try row.decodeIfPresent(Double.self, forKey: .manualRewardValue)
        createdAt = try row.decodeIfPresent(String.self, forKey: .createdAt) ?? ""
    }

    enum CodingKeys: String, CodingKey {
        case id
        case holderId = "holder_id"
        case accountId = "account_id"
        case cardProductId = "card_product_id"
        case cardNumberLast4 = "card_number_last4"
        case creditLimit = "credit_limit"
        case creditLimitOverride = "credit_limit_override"
        case billingDay = "billing_day"
        case status
        case cardType = "card_type"
        case loanDueDay = "loan_due_day"
        case overrideBillingDay = "override_billing_day"
        case overrideDueType = "override_due_type"
        case overrideDueValue = "override_due_value"
        case nameOverride = "name_override"
        case annualFeeOverride = "annual_fee_override"
        case accountModeOverride = "account_mode_override"
        case issuedOn = "issued_on"
        case activatedOn = "activated_on"
        case annualFeeCycleType = "annual_fee_cycle_type"
        case nextAnnualFeeDate = "next_annual_fee_date"
        case annualFeeStatus = "annual_fee_status"
        case waiverProgressJson = "waiver_progress_json"
        case actualFeePaid = "actual_fee_paid"
        case manualRewardValue = "manual_reward_value"
        case createdAt = "created_at"
    }
}
