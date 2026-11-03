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

/// 周期应付的封闭币种集（与 Web `lib/api/payables.shared.ts` 及 `shared/fixtures/payable-currencies.json` 三方对齐）。
/// 存量记录里的 `PayableItem.currency` 仍保持 `String`，以便原样透传历史未知币种（如 EUR），绝不静默当成 CNY。
public enum PayableCurrency: String, Codable, Sendable, CaseIterable, Identifiable {
    case cny = "CNY"
    case usd = "USD"
    case hkd = "HKD"

    public var id: String { rawValue }

    public var label: String {
        switch self {
        case .cny: return "人民币 CNY"
        case .usd: return "美元 USD"
        case .hkd: return "港币 HKD"
        }
    }

    public var symbol: String {
        switch self {
        case .cny: return "¥"
        case .usd: return "US$"
        case .hkd: return "HK$"
        }
    }

    /// 显式归一化：trim + uppercase，仅接受封闭三字码或明确中文别名（人民币/美元/港币）；未知币种返回 nil。
    public static func normalize(_ raw: String) -> PayableCurrency? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        switch trimmed {
        case "人民币": return .cny
        case "美元": return .usd
        case "港币": return .hkd
        default:
            return PayableCurrency(rawValue: trimmed.uppercased())
        }
    }
}

/// 表单币种选择状态：合法封闭币种 vs 历史未知币种（原样展示，不静默改成 CNY）。
public enum PayableCurrencySelection: Hashable, Sendable {
    case supported(PayableCurrency)
    case legacy(String)

    public init(persistedCurrency: String) {
        if let normalized = PayableCurrency.normalize(persistedCurrency) {
            self = .supported(normalized)
        } else {
            self = .legacy(persistedCurrency)
        }
    }

    public var legacyCode: String? {
        if case .legacy(let code) = self { return code }
        return nil
    }

    /// 供 PayableDraft 提交的币种值：
    /// - 合法封闭币种：返回规范三字码（CNY/USD/HKD）；
    /// - 历史未知币种（如 EUR）：保留原始值；服务更新时核对原值并省略 currency 字段。
    public var draftCurrency: String {
        switch self {
        case .supported(let currency):
            return currency.rawValue
        case .legacy(let code):
            return code
        }
    }
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
