import Foundation
import GRDB

public enum BillEditError: LocalizedError, Equatable {
    case billNotFound(String)
    case invalidAmount(Double)

    public var errorDescription: String? {
        switch self {
        case .billNotFound(let id):
            return "账单未找到: \(id)"
        case .invalidAmount(let amt):
            return "账单金额必须是不小于 0 的数字: \(amt)"
        }
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
}
