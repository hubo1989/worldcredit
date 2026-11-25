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

    @Test("Decodes real PR #65 ROI board, card ROI detail, cycle spend estimate, and optional external fixture")
    func testPr65RpcContractDecoding() throws {
        let boardJson = #"""
        {
          "period_mode": "last_12m",
          "window_start": "2025-11-25",
          "window_end_exclusive": "2026-11-26",
          "display_currency": "CNY",
          "fx_available": true,
          "cards": [
            {
              "card_id": "qa-cny",
              "holder_id": "qa-h1",
              "holder_name": "QA Admin",
              "bank_name": "QA Bank",
              "card_name": "QA CNY",
              "card_number_last4": null,
              "card_currency": "CNY",
              "period_mode": "last_12m",
              "period_start": "2025-11-25",
              "period_end_exclusive": "2026-11-26",
              "window_mode_resolved": "last_12m_fallback",
              "annual_fee_cost": 3600,
              "cost_basis": "estimated_nominal",
              "redeemed_benefits_value": 1300,
              "promo_and_reward_value": 2800,
              "manual_reward_value": 0,
              "total_value": 4100,
              "net_value": 500,
              "coverage_pct": 113.9,
              "roi_pct": 13.9,
              "decision_tag": "keep_high_roi",
              "decision_label": "高 ROI · 建议续卡",
              "unvalued_benefit_count": 0,
              "unvalued_benefit_refs": [],
              "item_counts": { "benefit_usages": 2, "promo_usages": 1, "task_results": 0 }
            },
            {
              "card_id": "qa-zero",
              "holder_id": "qa-h2",
              "holder_name": "QA Member",
              "bank_name": "QA Bank",
              "card_name": "QA Unconfigured",
              "card_number_last4": null,
              "card_currency": "CNY",
              "period_mode": "last_12m",
              "period_start": "2025-11-25",
              "period_end_exclusive": "2026-11-26",
              "window_mode_resolved": "last_12m_fallback",
              "annual_fee_cost": 0,
              "cost_basis": "zero_fee",
              "redeemed_benefits_value": 0,
              "promo_and_reward_value": 0,
              "manual_reward_value": 200,
              "total_value": 200,
              "net_value": 200,
              "coverage_pct": null,
              "roi_pct": null,
              "decision_tag": "free_earning",
              "decision_label": "纯赚持有",
              "unvalued_benefit_count": 3,
              "unvalued_benefit_refs": [
                { "account_id": "qa-a2", "definition_id": "qa-unvalued", "quantity": 3 }
              ],
              "item_counts": { "benefit_usages": 1, "promo_usages": 0, "task_results": 0 }
            }
          ],
          "totals": {
            "annual_fee_cost": { "converted_currency": "CNY", "by_currency": { "CNY": 3600, "USD": 550 }, "total": 7560, "converted": true, "unconverted_currencies": [], "mixed": true },
            "redeemed_benefits_value": { "converted_currency": "CNY", "by_currency": { "CNY": 1300 }, "total": 1300, "converted": true, "unconverted_currencies": [], "mixed": false },
            "promo_and_reward_value": { "converted_currency": "CNY", "by_currency": { "CNY": 2800 }, "total": 2800, "converted": true, "unconverted_currencies": [], "mixed": false },
            "manual_reward_value": { "converted_currency": "CNY", "by_currency": { "USD": 300, "CNY": 200 }, "total": 2360, "converted": true, "unconverted_currencies": [], "mixed": true },
            "total_value": { "converted_currency": "CNY", "by_currency": { "CNY": 4300, "USD": 300 }, "total": 6460, "converted": true, "unconverted_currencies": [], "mixed": true },
            "net_value": { "converted_currency": "CNY", "by_currency": { "CNY": 700, "USD": -250 }, "total": -1100, "converted": true, "unconverted_currencies": [], "mixed": true }
          },
          "unconverted_currencies": [],
          "warnings": []
        }
        """#
        let cardJson = #"""
        {
          "card_id": "qa-cny",
          "holder_id": "qa-h1",
          "holder_name": "QA Admin",
          "bank_name": "QA Bank",
          "card_name": "QA CNY",
          "card_number_last4": null,
          "card_currency": "CNY",
          "period_mode": "current_cycle",
          "period_start": "2025-12-25",
          "period_end_exclusive": "2026-12-25",
          "window_mode_resolved": "exact_cycle",
          "annual_fee_cost": 3600,
          "cost_basis": "estimated_nominal",
          "redeemed_benefits_value": 1300,
          "promo_and_reward_value": 2800,
          "manual_reward_value": 0,
          "total_value": 4100,
          "net_value": 500,
          "coverage_pct": 113.9,
          "roi_pct": 13.9,
          "decision_tag": "keep_high_roi",
          "decision_label": "高 ROI · 建议续卡",
          "unvalued_benefit_count": 0,
          "unvalued_benefit_refs": [],
          "item_counts": { "benefit_usages": 2, "promo_usages": 1, "task_results": 0 }
        }
        """#
        let estimateJson = #"""
        {
          "card_id": "qa-cny",
          "period_start": "2025-12-25",
          "period_end_exclusive": "2026-12-25",
          "window_mode_resolved": "exact_cycle",
          "spend_amount": 800,
          "spend_count": 2,
          "currency": "CNY",
          "source": "bill_items"
        }
        """#

        let decoder = JSONDecoder()
        let board = try decoder.decode(FamilyAnnualFeeRoiBoard.self, from: Data(boardJson.utf8))
        #expect(board.totals.netValue.total == -1100)
        #expect(board.cards.count == 2)
        #expect(board.cards[1].unvaluedBenefitRefs.first?.quantity == 3)
        #expect(board.cards[1].annualFeeStatus == nil)

        let card = try decoder.decode(CardAnnualFeeRoiDetail.self, from: Data(cardJson.utf8))
        #expect(card.periodStart == "2025-12-25")
        #expect(card.periodEndExclusive == "2026-12-25")
        #expect(card.netValue == 500)
        #expect(card.itemCounts?.benefitUsages == 2)

        let estimate = try decoder.decode(CardCycleSpendEstimate.self, from: Data(estimateJson.utf8))
        #expect(estimate.spendAmount == 800)
        #expect(estimate.spendCount == 2)
        #expect(estimate.periodStart == "2025-12-25")

        if let fixturePath = ProcessInfo.processInfo.environment["HUB179_ROI_FIXTURE"] {
            struct Envelope<T: Decodable>: Decodable { let data: T }
            struct FixtureRoot: Decodable {
                let board: Envelope<FamilyAnnualFeeRoiBoard>
                let card: Envelope<CardAnnualFeeRoiDetail>
                let estimate: Envelope<CardCycleSpendEstimate>
                let recommendation: Envelope<RecommendationEngineOutput>
            }
            let fixtureData = try Data(contentsOf: URL(fileURLWithPath: fixturePath))
            let fixture = try decoder.decode(FixtureRoot.self, from: fixtureData)
            #expect(fixture.board.data.totals.netValue.total == -1100)
            #expect(fixture.card.data.netValue == 500)
            #expect(fixture.estimate.data.spendAmount == 800)
            #expect(fixture.estimate.data.spendCount == 2)
            #expect(fixture.recommendation.data.topRecommendations.first?.cardId == "qa-cny")
        }
    }
}
