import Foundation
import GRDB
import Testing
@testable import WorldCreditCore

@Suite("HUB-171 iOS Payment FX Lock & v4 Migration")
struct PaymentFxLockTests {
    @Test("v4_payment_fx_lock migration adds nullable FX lock columns and decodes legacy Payment payloads")
    func v4MigrationAndBackwardCompatibility() async throws {
        let manager = try DatabaseManager.inMemory()

        // Verify v4 migration ran alongside v1 and v2 without colliding with v3
        let applied: [String] = try await manager.dbWriter.read { db in
            try String.fetchAll(db, sql: "SELECT identifier FROM grdb_migrations ORDER BY rowid")
        }
        #expect(applied.contains("v4_payment_fx_lock"))

        // Legacy payload without settled_* / locked_fx_rate still decodes cleanly
        let legacyJson = """
        {
            "id": "pay-legacy",
            "bill_id": "bill-1",
            "amount": 100.0,
            "paid_at": "2026-11-20",
            "channel": "手动还款",
            "note": null,
            "idempotency_key": "idem-legacy",
            "created_at": "2026-11-20T00:00:00Z"
        }
        """
        let decodedLegacy = try JSONDecoder().decode(Payment.self, from: Data(legacyJson.utf8))
        #expect(decodedLegacy.settledCurrency == nil)
        #expect(decodedLegacy.settledAmount == nil)
        #expect(decodedLegacy.lockedFxRate == nil)
    }

    @Test("PaymentService.recordPayment persists FX lock fields and enqueues them in mutation_outbox")
    func recordPaymentWithFxLock() async throws {
        let manager = try DatabaseManager.inMemory()
        try await manager.dbWriter.write { db in
            try Bank(id: "b1", name: "Chase", shortName: "Chase").insert(db)
            try CardProduct(
                id: "cp1",
                bankId: "b1",
                bankName: "Chase",
                cardName: "Sapphire",
                currency: "USD",
                paymentDueType: .fixed,
                paymentDueValue: 15
            ).insert(db)
            try CardHolder(
                id: "h1",
                createdBy: "u1",
                managedBy: "u1",
                name: "Hubert"
            ).insert(db)
            try CreditCard(
                id: "c1",
                holderId: "h1",
                cardProductId: "cp1",
                billingDay: 1,
                creditLimit: 10000
            ).insert(db)
            try Bill(
                id: "bill-usd",
                cardId: "c1",
                billMonth: "2026-11",
                billAmount: 500,
                minPayment: 50,
                dueDate: "2026-12-15",
                status: "unpaid"
            ).insert(db)
        }

        let service = PaymentService(dbManager: manager)
        let saved = try await service.recordPayment(
            billId: "bill-usd",
            amount: 500,
            paidAt: "2026-11-24",
            channel: "手机银行",
            note: "购汇还款",
            settledCurrency: "CNY",
            settledAmount: 3625.0,
            lockedFxRate: 7.25
        )

        #expect(saved.settledCurrency == "CNY")
        #expect(saved.settledAmount == 3625.0)
        #expect(saved.lockedFxRate == 7.25)

        let outboxArgs: String = try await manager.dbWriter.read { db in
            let row = try MutationOutbox.fetchOne(db)
            return row?.argsJson ?? ""
        }
        #expect(outboxArgs.contains("settled_currency"))
        #expect(outboxArgs.contains("CNY"))
        #expect(outboxArgs.contains("3625"))
        #expect(outboxArgs.contains("7.25"))
    }
}
