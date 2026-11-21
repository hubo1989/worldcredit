import Foundation
import GRDB

public enum BillEditError: LocalizedError, Equatable {
    case billNotFound(String)
    case invalidAmount(Double)
    case invalidDate(field: String, value: String)
    case invalidStatementPeriod
    case emptyUpdate
    case invalidOverrideFields

    public var errorDescription: String? {
        switch self {
        case .billNotFound(let id):
            return "账单未找到: \(id)"
        case .invalidAmount(let amt):
            return "账单金额必须是不小于 0 的数字: \(amt)"
        case .invalidDate(let field, let value):
            return "\(field)必须是 YYYY-MM-DD 格式的真实日历日: \(value)"
        case .invalidStatementPeriod:
            return "账期开始日不能晚于账期结束日"
        case .emptyUpdate:
            return "没有需要更新的字段"
        case .invalidOverrideFields:
            return "没有需要撤销的字段"
        }
    }
}

public enum BillOverrideField: String, CaseIterable, Codable, Sendable {
    case amount
    case minPayment = "min_payment"
    case dueDate = "due_date"
    case statementDate = "statement_date"
}

public struct BillFieldsUpdateInput: Sendable, Equatable {
    public var billAmount: Double?
    public var minPayment: Double?
    public var dueDate: String?
    public var statementDate: String?
    public var statementStart: String?
    public var statementEnd: String?
    public var clearMinPayment: Bool
    public var clearStatementDate: Bool
    public var clearStatementStart: Bool
    public var clearStatementEnd: Bool

    public init(
        billAmount: Double? = nil,
        minPayment: Double? = nil,
        dueDate: String? = nil,
        statementDate: String? = nil,
        statementStart: String? = nil,
        statementEnd: String? = nil,
        clearMinPayment: Bool = false,
        clearStatementDate: Bool = false,
        clearStatementStart: Bool = false,
        clearStatementEnd: Bool = false
    ) {
        self.billAmount = billAmount
        self.minPayment = minPayment
        self.dueDate = dueDate
        self.statementDate = statementDate
        self.statementStart = statementStart
        self.statementEnd = statementEnd
        self.clearMinPayment = clearMinPayment
        self.clearStatementDate = clearStatementDate
        self.clearStatementStart = clearStatementStart
        self.clearStatementEnd = clearStatementEnd
    }
}

public final class BillEditService: Sendable {
    public let dbManager: DatabaseManager

    public init(dbManager: DatabaseManager) {
        self.dbManager = dbManager
    }

    /// 设置账单人工调整金额（nil 表示清除人工调整，恢复原始出账金额）
    @discardableResult
    public func setBillAmountOverride(billId: String, amount: Double?) async throws -> Bill {
        if let amount {
            guard amount.isFinite, amount >= 0 else {
                throw BillEditError.invalidAmount(amount)
            }
        }

        return try await dbManager.dbWriter.write { db in
            guard var bill = try Bill.fetchOne(db, id: billId) else {
                throw BillEditError.billNotFound(billId)
            }

            // 1. 本地更新账单金额
            bill.billAmountOverride = amount

            // 2. 根据已有还款重新计算状态
            let payments = try Payment.filter(Column("bill_id") == billId).fetchAll(db)
            let totalPaid = payments.reduce(0.0) { $0 + $1.amount }
            if totalPaid >= bill.effectiveAmount - 0.01 {
                bill.status = "paid"
            } else if totalPaid > 0 {
                bill.status = "partial"
            } else {
                bill.status = "unpaid"
            }
            try bill.update(db)

            // 3. 写入离线发送队列
            let args: [Any] = [billId, amount as Any]
            let argsData = try JSONSerialization.data(withJSONObject: args)
            let argsJson = String(data: argsData, encoding: .utf8) ?? "[]"

            let outboxItem = MutationOutbox(
                id: UUID().uuidString,
                name: "bills.setBillAmountOverride",
                argsJson: argsJson
            )
            try outboxItem.insert(db)

            return bill
        }
    }

    /// 结构化离线编辑账单字段：金额/最低还款/到期日/账单日写入 *_override 列，
    /// 账期起止直接写 statement_start / statement_end，并入队 `bills.updateBillFields`。
    @discardableResult
    public func updateBillFields(
        billId: String,
        input: BillFieldsUpdateInput,
        today: Date = Date()
    ) async throws -> Bill {
        if let billAmount = input.billAmount {
            guard billAmount.isFinite, billAmount >= 0 else {
                throw BillEditError.invalidAmount(billAmount)
            }
        }
        if let minPayment = input.minPayment, !input.clearMinPayment {
            guard minPayment.isFinite, minPayment >= 0 else {
                throw BillEditError.invalidAmount(minPayment)
            }
        }
        if let dueDate = input.dueDate, !Self.isValidCalendarDate(dueDate) {
            throw BillEditError.invalidDate(field: "到期日", value: dueDate)
        }
        if let statementDate = input.statementDate, !input.clearStatementDate,
           !Self.isValidCalendarDate(statementDate) {
            throw BillEditError.invalidDate(field: "账单日", value: statementDate)
        }
        if let statementStart = input.statementStart, !input.clearStatementStart,
           !Self.isValidCalendarDate(statementStart) {
            throw BillEditError.invalidDate(field: "账期开始日", value: statementStart)
        }
        if let statementEnd = input.statementEnd, !input.clearStatementEnd,
           !Self.isValidCalendarDate(statementEnd) {
            throw BillEditError.invalidDate(field: "账期结束日", value: statementEnd)
        }

        let todayString = Self.shanghaiDateString(from: today)

        return try await dbManager.dbWriter.write { db in
            guard var bill = try Bill.fetchOne(db, id: billId) else {
                throw BillEditError.billNotFound(billId)
            }

            var patch: [String: Any] = [:]

            if let billAmount = input.billAmount {
                bill.billAmountOverride = billAmount
                patch["amount"] = billAmount
            }
            if input.clearMinPayment {
                bill.minPaymentOverride = nil
                patch["min_payment"] = NSNull()
            } else if let minPayment = input.minPayment {
                bill.minPaymentOverride = minPayment
                patch["min_payment"] = minPayment
            }
            if let dueDate = input.dueDate {
                bill.dueDateOverride = dueDate
                patch["due_date"] = dueDate
            }
            if input.clearStatementDate {
                bill.statementDateOverride = nil
                patch["statement_date"] = NSNull()
            } else if let statementDate = input.statementDate {
                bill.statementDateOverride = statementDate
                patch["statement_date"] = statementDate
            }

            let nextStart: String? = if input.clearStatementStart {
                nil
            } else if let statementStart = input.statementStart {
                statementStart
            } else {
                bill.effectiveStatementStart
            }
            let nextEnd: String? = if input.clearStatementEnd {
                nil
            } else if let statementEnd = input.statementEnd {
                statementEnd
            } else {
                bill.effectiveStatementEnd
            }
            if let s = nextStart, let e = nextEnd, s > e {
                throw BillEditError.invalidStatementPeriod
            }

            if input.clearStatementStart {
                bill.statementStart = nil
                bill.statementStartOverride = nil
                patch["statement_start"] = NSNull()
            } else if let statementStart = input.statementStart {
                bill.statementStart = statementStart
                bill.statementStartOverride = nil
                patch["statement_start"] = statementStart
            }
            if input.clearStatementEnd {
                bill.statementEnd = nil
                bill.statementEndOverride = nil
                patch["statement_end"] = NSNull()
            } else if let statementEnd = input.statementEnd {
                bill.statementEnd = statementEnd
                bill.statementEndOverride = nil
                patch["statement_end"] = statementEnd
            }

            guard !patch.isEmpty else {
                throw BillEditError.emptyUpdate
            }

            if input.billAmount != nil || input.dueDate != nil {
                try Self.recalculateStatus(for: &bill, todayString: todayString, in: db)
            }
            try bill.update(db)

            let args: [Any] = [billId, patch]
            let argsData = try JSONSerialization.data(withJSONObject: args)
            let argsJson = String(data: argsData, encoding: .utf8) ?? "[]"
            try MutationOutbox(
                id: UUID().uuidString,
                name: "bills.updateBillFields",
                argsJson: argsJson
            ).insert(db)

            return bill
        }
    }

    /// 清除单个账单覆盖字段，回落到导入值，并入队 `bills.clearOverride`。
    @discardableResult
    public func clearOverride(
        billId: String,
        field: BillOverrideField,
        today: Date = Date()
    ) async throws -> Bill {
        try await clearOverride(billId: billId, fields: [field], today: today)
    }

    /// 批量清除账单覆盖字段，回落到导入值，并入队 `bills.clearOverride`。
    @discardableResult
    public func clearOverride(
        billId: String,
        fields: [BillOverrideField],
        today: Date = Date()
    ) async throws -> Bill {
        guard !fields.isEmpty else {
            throw BillEditError.invalidOverrideFields
        }
        let todayString = Self.shanghaiDateString(from: today)

        return try await dbManager.dbWriter.write { db in
            guard var bill = try Bill.fetchOne(db, id: billId) else {
                throw BillEditError.billNotFound(billId)
            }

            var orderedUnique: [BillOverrideField] = []
            var seen = Set<BillOverrideField>()
            for field in fields where seen.insert(field).inserted {
                orderedUnique.append(field)
                switch field {
                case .amount:
                    bill.billAmountOverride = nil
                case .minPayment:
                    bill.minPaymentOverride = nil
                case .dueDate:
                    bill.dueDateOverride = nil
                case .statementDate:
                    bill.statementDateOverride = nil
                }
            }

            if seen.contains(.amount) || seen.contains(.dueDate) {
                try Self.recalculateStatus(for: &bill, todayString: todayString, in: db)
            }
            try bill.update(db)

            let args: [Any] = [billId, orderedUnique.map(\.rawValue)]
            let argsData = try JSONSerialization.data(withJSONObject: args)
            let argsJson = String(data: argsData, encoding: .utf8) ?? "[]"
            try MutationOutbox(
                id: UUID().uuidString,
                name: "bills.clearOverride",
                argsJson: argsJson
            ).insert(db)

            return bill
        }
    }

    private static func recalculateStatus(
        for bill: inout Bill,
        todayString: String,
        in db: Database
    ) throws {
        let payments = try Payment.filter(Column("bill_id") == bill.id).fetchAll(db)
        let totalPaid = payments.reduce(0.0) { $0 + $1.amount }
        if totalPaid >= bill.effectiveAmount - 0.01 {
            bill.status = "paid"
        } else if totalPaid > 0 {
            bill.status = "partial"
        } else if bill.effectiveDueDate < todayString {
            bill.status = "overdue"
        } else {
            bill.status = "unpaid"
        }
    }

    private static func shanghaiDateString(from date: Date) -> String {
        let df = DateFormatter()
        df.locale = Locale(identifier: "en_US_POSIX")
        df.dateFormat = "yyyy-MM-dd"
        df.timeZone = TimeZone(identifier: "Asia/Shanghai") ?? .current
        return df.string(from: date)
    }

    static func isValidCalendarDate(_ raw: String) -> Bool {
        let parts = raw.split(separator: "-", omittingEmptySubsequences: false)
        guard parts.count == 3,
              parts[0].count == 4, parts[1].count == 2, parts[2].count == 2,
              let year = Int(parts[0]), let month = Int(parts[1]), let day = Int(parts[2]),
              (1970...2100).contains(year), (1...12).contains(month), (1...31).contains(day) else {
            return false
        }
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "Asia/Shanghai")!
        var comp = DateComponents()
        comp.year = year
        comp.month = month
        comp.day = day
        guard let date = cal.date(from: comp) else { return false }
        let back = cal.dateComponents([.year, .month, .day], from: date)
        return back.year == year && back.month == month && back.day == day
    }
}
