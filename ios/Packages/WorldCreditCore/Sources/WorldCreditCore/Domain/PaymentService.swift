import Foundation
import GRDB

public enum PaymentError: LocalizedError, Equatable {
    case billNotFound(String)
    case invalidAmount(Double)
    case overpayment(remaining: Double, requested: Double)
    case billAlreadyPaid

    public var errorDescription: String? {
        switch self {
        case .billNotFound(let id):
            return "账单未找到: \(id)"
        case .invalidAmount(let amt):
            return "还款金额必须大于 0: \(amt)"
        case .overpayment(let remaining, let requested):
            return "还款金额 (\(requested)) 超过剩余应还金额 (\(remaining))"
        case .billAlreadyPaid:
            return "账单已全额结清"
        }
    }
}

public struct PaymentSummary: Sendable {
    public let bill: Bill
    public let totalPaid: Double
    public let remainingDue: Double
    public let payments: [Payment]

    public init(bill: Bill, totalPaid: Double, remainingDue: Double, payments: [Payment]) {
        self.bill = bill
        self.totalPaid = totalPaid
        self.remainingDue = remainingDue
        self.payments = payments
    }
}

public final class PaymentService: Sendable {
    public let dbManager: DatabaseManager

    public init(dbManager: DatabaseManager) {
        self.dbManager = dbManager
    }

    /// 业务日期统一取上海时区的自然日（还款日、账单月都是中国时区语义）。
    private static func shanghaiToday() -> String {
        let df = DateFormatter()
        df.dateFormat = "yyyy-MM-dd"
        df.timeZone = TimeZone(identifier: "Asia/Shanghai") ?? .current
        return df.string(from: Date())
    }

    /// 获取账单还款详情（包括已还总额、剩余应还、历史明细）
    public func getPaymentSummary(billId: String) async throws -> PaymentSummary {
        try await dbManager.dbWriter.read { db in
            guard let bill = try Bill.fetchOne(db, id: billId) else {
                throw PaymentError.billNotFound(billId)
            }
            let payments = try Payment.filter(Column("bill_id") == billId)
                .order(Column("paid_at").desc, Column("created_at").desc)
                .fetchAll(db)
            let totalPaid = payments.reduce(0.0) { $0 + $1.amount }
            let remainingDue = max(0.0, bill.effectiveAmount - totalPaid)
            return PaymentSummary(bill: bill, totalPaid: totalPaid, remainingDue: remainingDue, payments: payments)
        }
    }

    /// 离线登记还款：本地事务写入 payment、更新 bill.status、入队 mutation_outbox
    @discardableResult
    public func recordPayment(
        billId: String,
        amount: Double,
        paidAt: String? = nil,
        channel: String? = "手动还款",
        note: String? = nil,
        paymentId: String = "pay-\(UUID().uuidString.prefix(12).lowercased())",
        idempotencyKey: String = UUID().uuidString
    ) async throws -> Payment {
        guard amount > 0 else {
            throw PaymentError.invalidAmount(amount)
        }

        let effectivePaidAt = paidAt ?? Self.shanghaiToday()

        return try await dbManager.dbWriter.write { db in
            guard var bill = try Bill.fetchOne(db, id: billId) else {
                throw PaymentError.billNotFound(billId)
            }

            let existingPayments = try Payment.filter(Column("bill_id") == billId).fetchAll(db)
            let totalPaidBefore = existingPayments.reduce(0.0) { $0 + $1.amount }
            let remainingDue = max(0.0, bill.effectiveAmount - totalPaidBefore)

            if remainingDue <= 0.01 {
                throw PaymentError.billAlreadyPaid
            }

            if amount > remainingDue + 0.01 {
                throw PaymentError.overpayment(remaining: remainingDue, requested: amount)
            }

            // 1. 插入本地还款记录
            let payment = Payment(
                id: paymentId,
                billId: billId,
                amount: amount,
                paidAt: effectivePaidAt,
                channel: channel,
                note: note,
                idempotencyKey: idempotencyKey
            )
            try payment.insert(db)

            // 2. 重新计算账单状态
            let newTotalPaid = totalPaidBefore + amount
            if newTotalPaid >= bill.effectiveAmount - 0.01 {
                bill.status = "paid"
            } else if newTotalPaid > 0 {
                bill.status = "partial"
            } else {
                bill.status = "unpaid"
            }
            try bill.update(db)

            // 3. 写入离线发送队列
            var mutationArg: [String: Any] = [
                "id": paymentId,
                "bill_id": billId,
                "amount": amount,
                "paid_at": effectivePaidAt,
                "idempotency_key": idempotencyKey
            ]
            if let channel { mutationArg["channel"] = channel }
            if let note { mutationArg["note"] = note }

            let argsData = try JSONSerialization.data(withJSONObject: [mutationArg])
            let argsJson = String(data: argsData, encoding: .utf8) ?? "[]"

            let outboxItem = MutationOutbox(
                id: UUID().uuidString,
                name: "bills.recordPayment",
                argsJson: argsJson
            )
            try outboxItem.insert(db)

            return payment
        }
    }

    /// 批量全额结清（首页一键还款）：单条本地事务内逐笔**重读**余额、校验、
    /// 写 payment、更新账单状态并入 mutation_outbox。整批成功或整批回滚，
    /// 不存在部分成功后静默丢失一半的形态。
    ///
    /// - 金额一律取每笔账单**原币种**的事务内重读剩余（与 Web
    ///   `markAllOverdueBillsAsPaid` 同口径），绝不使用调用方快照，也不做任何汇率折算。
    /// - 已结清（status = paid）或剩余 ≤ 0.01 浮点容差的账单跳过且不计数，
    ///   并发重复提交因此天然幂等（第二次全量跳过、返回 0），不会重复入账。
    /// - 任一账单不存在则抛 `PaymentError.billNotFound`，整批回滚。
    /// - 输入里的重复 id 去重，避免同一账单付两次。
    ///
    /// - Returns: 本次实际结清的账单笔数（跳过的不计）。
    @discardableResult
    public func recordFullPayments(
        billIds: [String],
        paidAt: String? = nil,
        channel: String? = "快捷全额结清",
        note: String? = "一键全部还款结清"
    ) async throws -> Int {
        var seen = Set<String>()
        let uniqueIds = billIds.filter { seen.insert($0).inserted }
        let effectivePaidAt = paidAt ?? Self.shanghaiToday()

        return try await dbManager.dbWriter.write { db in
            var paidCount = 0
            for billId in uniqueIds {
                guard var bill = try Bill.fetchOne(db, id: billId) else {
                    throw PaymentError.billNotFound(billId)
                }

                let totalPaidBefore = try Payment.filter(Column("bill_id") == billId)
                    .fetchAll(db)
                    .reduce(0.0) { $0 + $1.amount }
                let remainingDue = max(0.0, bill.effectiveAmount - totalPaidBefore)

                // 已结清或只剩浮点残差：跳过（幂等），payments 表 CHECK(amount > 0) 也不允许写 0。
                if bill.status == "paid" || remainingDue <= 0.01 { continue }

                let paymentId = "pay-\(UUID().uuidString.prefix(12).lowercased())"
                let idempotencyKey = UUID().uuidString
                let payment = Payment(
                    id: paymentId,
                    billId: billId,
                    amount: remainingDue,
                    paidAt: effectivePaidAt,
                    channel: channel,
                    note: note,
                    idempotencyKey: idempotencyKey
                )
                try payment.insert(db)

                // 全额结清：金额就是重读出的全部剩余。
                bill.status = "paid"
                try bill.update(db)

                var mutationArg: [String: Any] = [
                    "id": paymentId,
                    "bill_id": billId,
                    "amount": remainingDue,
                    "paid_at": effectivePaidAt,
                    "idempotency_key": idempotencyKey
                ]
                if let channel { mutationArg["channel"] = channel }
                if let note { mutationArg["note"] = note }

                // 与 recordPayment 相同的 outbox 形状：每行一条单对象数组参数，
                // 服务端 bills.recordPayment 只接受单个对象，回滚逻辑也按单条解析。
                let argsData = try JSONSerialization.data(withJSONObject: [mutationArg])
                let argsJson = String(data: argsData, encoding: .utf8) ?? "[]"
                let outboxItem = MutationOutbox(
                    id: UUID().uuidString,
                    name: "bills.recordPayment",
                    argsJson: argsJson
                )
                try outboxItem.insert(db)

                paidCount += 1
            }
            return paidCount
        }
    }
}
