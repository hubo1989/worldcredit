import Foundation

/// 周期应付(房租/贷款/水电等)的类型与值对象，字段对齐 Web `lib/api/payables.server.ts`。
public enum PayableCategory: String, Codable, Sendable, CaseIterable, Identifiable {
    case rent, loan, utility, insurance, other

    public var id: String { rawValue }

    public var label: String {
        switch self {
        case .rent: return "房租"
        case .loan: return "贷款"
        case .utility: return "水电物业"
        case .insurance: return "保险"
        case .other: return "其他"
        }
    }
}

public enum PayableStatus: String, Codable, Sendable {
    case unpaid, paid, overdue
}

/// 服务端 `PayableWithStatus`：应付事项 + 当期状态，账单页直接渲染。
public struct PayableItem: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let createdBy: String
    public let name: String
    public let category: PayableCategory
    public let amount: Double
    public let currency: String
    public let dueDay: Int
    public let holderId: String?
    public let note: String?
    public let bankAccount: String?
    /// 当前账期 'YYYY-MM'
    public let period: String
    /// 当期到期日 'YYYY-MM-DD'
    public let dueDate: String
    /// 距到期天数(负数 = 已逾期)
    public let daysUntilDue: Int
    /// 当期已登记金额
    public let paidAmount: Double
    public let status: PayableStatus

    public init(
        id: String,
        createdBy: String,
        name: String,
        category: PayableCategory,
        amount: Double,
        currency: String,
        dueDay: Int,
        holderId: String? = nil,
        note: String? = nil,
        bankAccount: String? = nil,
        period: String,
        dueDate: String,
        daysUntilDue: Int,
        paidAmount: Double,
        status: PayableStatus
    ) {
        self.id = id
        self.createdBy = createdBy
        self.name = name
        self.category = category
        self.amount = amount
        self.currency = currency
        self.dueDay = dueDay
        self.holderId = holderId
        self.note = note
        self.bankAccount = bankAccount
        self.period = period
        self.dueDate = dueDate
        self.daysUntilDue = daysUntilDue
        self.paidAmount = paidAmount
        self.status = status
    }

    enum CodingKeys: String, CodingKey {
        case id
        case createdBy = "created_by"
        case name, category, amount, currency
        case dueDay = "due_day"
        case holderId = "holder_id"
        case note
        case bankAccount = "bank_account"
        case period
        case dueDate = "due_date"
        case daysUntilDue = "days_until_due"
        case paidAmount = "paid_amount"
        case status
    }

    public var remainingAmount: Double {
        max(0, amount - paidAmount)
    }

    public var isSettled: Bool {
        amount > 0 && paidAmount >= amount - 0.01
    }

    public var displayStatus: String {
        switch status {
        case .paid: return "已付"
        case .overdue: return "已逾期"
        case .unpaid: return "待付"
        }
    }

    public var distanceLabel: String {
        if status == .paid { return "本期已付" }
        if daysUntilDue == 0 { return "今天应付" }
        if daysUntilDue < 0 { return "逾期 \(-daysUntilDue) 日" }
        return "距离应付日 \(daysUntilDue) 日"
    }
}

/// 创建/编辑入参，对齐 Web `RecurringPayableInput`；id 由服务端生成。
public struct PayableDraft: Codable, Equatable, Sendable {
    public var name: String
    public var category: PayableCategory
    public var amount: Double
    public var currency: String
    public var dueDay: Int
    public var holderId: String?
    public var note: String?
    public var bankAccount: String?

    enum CodingKeys: String, CodingKey {
        case name, category, amount, currency
        case dueDay = "due_day"
        case holderId = "holder_id"
        case note
        case bankAccount = "bank_account"
    }

    public init(
        name: String,
        category: PayableCategory,
        amount: Double,
        currency: String,
        dueDay: Int,
        holderId: String? = nil,
        note: String? = nil,
        bankAccount: String? = nil
    ) {
        self.name = name
        self.category = category
        self.amount = amount
        self.currency = currency
        self.dueDay = dueDay
        self.holderId = holderId
        self.note = note
        self.bankAccount = bankAccount
    }
}
