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

        let effectivePaidAt = paidAt ?? {
            let df = DateFormatter()
            df.dateFormat = "yyyy-MM-dd"
            df.timeZone = TimeZone(identifier: "Asia/Shanghai") ?? .current
            return df.string(from: Date())
        }()

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
}
