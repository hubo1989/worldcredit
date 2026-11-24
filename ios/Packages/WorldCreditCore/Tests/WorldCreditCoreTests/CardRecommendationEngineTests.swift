import Foundation
import Testing
@testable import WorldCreditCore

@Suite("Direction 4 Card Rules, Annual Fee Cycle & Offline Recommendation Engine")
struct CardRecommendationEngineTests {

    @Test("v5_direction4_card_rules_and_roi migration adds columns and CardEditService persists updates")
    func testV5MigrationAndCardEditService() async throws {
        let dbManager = try DatabaseManager.inMemory()
        let service = CardEditService(dbManager: dbManager)

        try await dbManager.dbWriter.write { db in
            try db.execute(sql: """
                INSERT INTO card_holders (id, created_by, managed_by, name)
                VALUES ('h1', 'u1', 'u1', '张三');
                INSERT INTO card_products (
                    id, bank_name, card_name, currency, payment_due_type, payment_due_value,
                    annual_fee, ftf_rate, fx_free_currencies_json, reward_rules_json,
                    annual_fee_cycle_type, annual_fee_waiver_rules_json
                ) VALUES (
                    'p1', '招商银行', '经典白金卡', 'CNY', 'after_billing', 20,
                    3600, 1.5, '["USD"]',
                    '{"schema_version":1,"reward_kind":"cashback","base_rate_pct":1.0,"category_rules":[{"category":"dining","rate_pct":4.0}]}',
                    'anniversary_issued',
                    '{"schema_version":1,"waiver_type":"spend_amount","target_amount":50000,"target_currency":"CNY"}'
                );
                INSERT INTO credit_cards (
                    id, holder_id, card_product_id, billing_day, credit_limit, issued_on
                ) VALUES (
                    'c1', 'h1', 'p1', 5, 50000, '2024-02-29'
                );
                """)
        }

        let updated = try await service.updateCard(
            cardId: "c1",
            input: CardUpdateInput(
                annualFeeCycleType: "anniversary_issued",
                nextAnnualFeeDate: "2026-12-25",
                annualFeeStatus: "waived",
                actualFeePaid: 0,
                manualRewardValue: 1200
            )
        )

        #expect(updated.annualFeeStatus == "waived")
        #expect(updated.nextAnnualFeeDate == "2026-12-25")
        #expect(updated.actualFeePaid == 0)
        #expect(updated.manualRewardValue == 1200)

        let outboxCount = try await dbManager.dbWriter.read { db in
            try MutationOutbox.fetchCount(db)
        }
        #expect(outboxCount == 1)
    }

    @Test("resolveAnnualFeeCycleState clamps Feb 29 leap year and never fabricates unknown dates")
    func testAnnualFeeCycleLeapYearAndUnknownGuard() {
        let product = CardProduct(
            id: "p1",
            bankName: "招商银行",
            cardName: "经典白金卡",
            currency: "CNY",
            paymentDueType: .afterBilling,
            paymentDueValue: 20,
            annualFee: 3600,
            annualFeeCycleType: "anniversary_issued"
        )

        let unknownCard = CreditCard(
            id: "c-unknown",
            holderId: "h1",
            cardProductId: "p1",
            billingDay: 5,
            createdAt: "2025-05-01T00:00:00Z"
        )
        let unknownState = CardRecommendationEngine.resolveAnnualFeeCycleState(
            card: unknownCard,
            product: product,
            todayStr: "2026-11-25"
        )
        #expect(unknownState.nextDueDate == nil)

        let leapCard = CreditCard(
            id: "c-leap",
            holderId: "h1",
            cardProductId: "p1",
            billingDay: 5,
            issuedOn: "2024-02-29",
            annualFeeCycleType: "anniversary_issued"
        )
        let state2025 = CardRecommendationEngine.resolveAnnualFeeCycleState(
            card: leapCard,
            product: product,
            todayStr: "2025-01-10"
        )
        #expect(state2025.nextDueDate == "2025-02-28")

        let state2028 = CardRecommendationEngine.resolveAnnualFeeCycleState(
            card: leapCard,
            product: product,
            todayStr: "2028-01-10"
        )
        #expect(state2028.nextDueDate == "2028-02-29")
    }

    @Test("rankCardsForPurchase enforces FTF deduction, shared pool exclusion, and missing FX safety")
    func testOfflineRecommendationScoringAndSafety() {
        let cnyProduct = CardProduct(
            id: "p-cny",
            bankName: "中国银行",
            cardName: "外币高返卡",
            currency: "CNY",
            paymentDueType: .afterBilling,
            paymentDueValue: 20,
            ftfRate: 1.5,
            rewardRulesJson: #"{"schema_version":1,"reward_kind":"cashback","base_rate_pct":2.0,"category_rules":[]}"#
        )
        let usdProduct = CardProduct(
            id: "p-usd",
            bankName: "Chase",
            cardName: "Sapphire",
            currency: "USD",
            paymentDueType: .afterBilling,
            paymentDueValue: 20,
            ftfRate: 0.0,
            rewardRulesJson: #"{"schema_version":1,"reward_kind":"cashback","base_rate_pct":1.5,"category_rules":[]}"#
        )
        let sharedAccount = CreditAccount(
            id: "acc-shared",
            holderId: "h1",
            bankName: "广发银行",
            currency: "USD",
            statementMode: "merged",
            quotaMode: "shared",
            sharedCreditLimit: 1000
        )

        let cnyCard = CreditCard(id: "c-cny", holderId: "h1", cardProductId: "p-cny", billingDay: 5, creditLimit: 50000)
        let usdCard = CreditCard(id: "c-usd", holderId: "h1", cardProductId: "p-usd", billingDay: 5, creditLimit: 5000)
        let poolExhaustedCard = CreditCard(id: "c-pool", holderId: "h1", cardProductId: "p-usd", billingDay: 5, creditLimit: 5000, accountId: "acc-shared")
        let frozenCard = CreditCard(id: "c-frozen", holderId: "h1", cardProductId: "p-usd", billingDay: 5, creditLimit: 5000, status: "frozen")

        let rates = FxRates(base: "USD", rates: ["USD": 1.0, "CNY": 7.2], timestamp: 0, fetchedAt: 0)
        let output = CardRecommendationEngine.rankCardsForPurchase(
            snapshots: [
                OfflineCardSnapshot(card: cnyCard, product: cnyProduct, holderName: "张三"),
                OfflineCardSnapshot(card: usdCard, product: usdProduct, holderName: "张三"),
                OfflineCardSnapshot(card: poolExhaustedCard, product: usdProduct, holderName: "张三", account: sharedAccount, cardUnpaidTotal: 900, poolUnpaidTotal: 900),
                OfflineCardSnapshot(card: frozenCard, product: usdProduct, holderName: "张三"),
            ],
            input: PurchaseRecommendationInput(amount: 200, currency: "USD", purchaseDate: "2026-11-25"),
            rates: rates
        )

        // USD 卡净返现 1.50% > CNY 卡 (2.00% - 1.50% FTF = 0.50%)，且共享池超额与冻结卡被排除
        #expect(output.topRecommendations.first?.cardId == "c-usd")
        #expect(output.topRecommendations.count == 2)
        #expect(output.excludedCards.count == 2)
        #expect(output.excludedCards.contains(where: { $0.cardId == "c-pool" && $0.excludeCode == "shared_pool_insufficient_credit" }))
        #expect(output.excludedCards.contains(where: { $0.cardId == "c-frozen" && $0.excludeCode == "card_frozen" }))

        // 缺汇率时绝不按 1:1 误算额度
        let noFxOutput = CardRecommendationEngine.rankCardsForPurchase(
            snapshots: [OfflineCardSnapshot(card: usdCard, product: usdProduct, holderName: "张三")],
            input: PurchaseRecommendationInput(amount: 100, currency: "CNY", purchaseDate: "2026-11-25"),
            rates: nil
        )
        #expect(noFxOutput.fxAvailable == false)
        #expect(noFxOutput.topRecommendations.first?.creditCheck == "unknown_fx")
    }
}
