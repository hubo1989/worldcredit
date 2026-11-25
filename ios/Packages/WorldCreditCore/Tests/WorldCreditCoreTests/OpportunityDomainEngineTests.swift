import Foundation
import CryptoKit
import Testing
@testable import WorldCreditCore

@Suite("Opportunity Domain Engine, SHA-256 Event Keys, Tasks & Availability")
struct OpportunityDomainEngineTests {
    private func sampleRules(
        weekdays: [Int]? = nil,
        allocation: String = "recurring",
        requiresConfirm: Bool = false,
        countLimit: Int? = 5,
        amountLimitMinor: Int? = nil,
        currency: String? = nil,
        claimWindow: ClaimWindowSpec? = nil
    ) -> RuleSnapshotV1 {
        RuleSnapshotV1(
            title: "机场贵宾厅",
            category: "travel",
            timeZone: "Asia/Shanghai",
            bankId: "b-1",
            cardProductIds: ["p-1"],
            validFrom: "2026-01-01",
            validUntilBefore: "2027-01-01",
            openEnded: false,
            weekdays: weekdays,
            cycle: RuleCycleSpec(kind: "monthly"),
            allocation: allocation,
            countLimit: countLimit,
            amountLimitMinor: amountLimitMinor,
            currency: currency,
            requiresPersonalConfirmation: requiresConfirm,
            claimWindow: claimWindow
        )
    }

    private func sampleCycle(
        activationState: String = "active",
        usableStart: String = "2026-10-01",
        usableEndBefore: String? = "2026-11-01",
        countLimit: Int? = 5,
        usedCount: Int = 1,
        reservedCount: Int = 0
    ) -> OpportunityCycleRecord {
        OpportunityCycleRecord(
            id: "cyc-1",
            accountId: "acc-1",
            versionId: "ver-1",
            versionAsOfOn: "2026-10-01",
            cycleKey: "2026-10",
            allocationKind: "regular",
            activationState: activationState,
            periodStartOn: "2026-10-01",
            periodEndBefore: "2026-11-01",
            usableStartOn: usableStart,
            usableEndBefore: usableEndBefore,
            countLimit: countLimit,
            usedCount: usedCount,
            reservedCount: reservedCount,
            balanceVerified: true
        )
    }

    @Test("Availability evaluates all 7 states matching availability.ts rules")
    func availabilityAllSevenStates() {
        // 1. availableToday (> 7d remaining)
        let r1 = OpportunityDomainEngine.computeAvailability(
            todayOn: "2026-10-10", weekday: 6, rules: sampleRules(),
            definitionStatus: "active", terminatedAt: nil, accountStatus: "active",
            eligibility: "confirmed", eligibleFromOn: nil, hasActiveLinkedCard: true,
            cycle: sampleCycle(), balanceVerified: true
        )
        #expect(r1.status == .availableToday)
        #expect(r1.action == .recordUsage)
        #expect(r1.remainingCount == 4)

        // 2. expiringSoon (<= 7d remaining)
        let r2 = OpportunityDomainEngine.computeAvailability(
            todayOn: "2026-10-28", weekday: 3, rules: sampleRules(),
            definitionStatus: "active", terminatedAt: nil, accountStatus: "active",
            eligibility: "confirmed", eligibleFromOn: nil, hasActiveLinkedCard: true,
            cycle: sampleCycle(), balanceVerified: true
        )
        #expect(r2.status == .expiringSoon)
        #expect(r2.daysLeft == 4)

        // 3. claimable
        let r3 = OpportunityDomainEngine.computeAvailability(
            todayOn: "2026-10-10", weekday: 6,
            rules: sampleRules(allocation: "claim_gated", claimWindow: ClaimWindowSpec(startsAt: "2026-10-01", endsAt: "2026-10-31")),
            definitionStatus: "active", terminatedAt: nil, accountStatus: "active",
            eligibility: "confirmed", eligibleFromOn: nil, hasActiveLinkedCard: true,
            cycle: sampleCycle(activationState: "pending_claim"), balanceVerified: true
        )
        #expect(r3.status == .claimable)
        #expect(r3.action == .recordClaim)

        // 4. exhausted (via reserved)
        let r4 = OpportunityDomainEngine.computeAvailability(
            todayOn: "2026-10-10", weekday: 6, rules: sampleRules(),
            definitionStatus: "active", terminatedAt: nil, accountStatus: "active",
            eligibility: "confirmed", eligibleFromOn: nil, hasActiveLinkedCard: true,
            cycle: sampleCycle(usedCount: 2, reservedCount: 3), balanceVerified: true
        )
        #expect(r4.status == .exhausted)
        #expect(r4.reason == "本期额度已被预约占用")

        // 5. needsConfirmation
        let r5 = OpportunityDomainEngine.computeAvailability(
            todayOn: "2026-10-10", weekday: 6, rules: sampleRules(requiresConfirm: true),
            definitionStatus: "active", terminatedAt: nil, accountStatus: "active",
            eligibility: "unknown", eligibleFromOn: nil, hasActiveLinkedCard: true,
            cycle: sampleCycle(), balanceVerified: false
        )
        #expect(r5.status == .needsConfirmation)
        #expect(r5.needsReview == true)

        // 6. notStarted
        let r6 = OpportunityDomainEngine.computeAvailability(
            todayOn: "2025-12-20", weekday: 6, rules: sampleRules(),
            definitionStatus: "active", terminatedAt: nil, accountStatus: "active",
            eligibility: "confirmed", eligibleFromOn: nil, hasActiveLinkedCard: true,
            cycle: nil, balanceVerified: true
        )
        #expect(r6.status == .notStarted)

        // 7. expired
        let r7 = OpportunityDomainEngine.computeAvailability(
            todayOn: "2027-01-05", weekday: 2, rules: sampleRules(),
            definitionStatus: "active", terminatedAt: nil, accountStatus: "active",
            eligibility: "confirmed", eligibleFromOn: nil, hasActiveLinkedCard: true,
            cycle: nil, balanceVerified: true
        )
        #expect(r7.status == .expired)
    }

    @Test("reminderEventKey matches canonical JSON SHA-256 12-hex prefix in reminders.ts")
    func reminderEventKeyParity() {
        let key = OpportunityDates.reminderEventKey(
            type: "expiry",
            objectId: "acc-1",
            cycleOrGrantKey: "cyc-1",
            deadlineBefore: "2026-11-01",
            version: "ver-1"
        )
        let canonical = "{\"deadline_before\":\"2026-11-01\",\"version\":\"ver-1\"}"
        let expectedHex = SHA256.hash(data: Data(canonical.utf8)).map { String(format: "%02x", $0) }.joined().prefix(12)
        #expect(key == "op:expiry:acc-1:cyc-1:\(expectedHex)")
    }

    @Test("evaluateTask computes OR across groups and AND within group with non-negative gaps")
    func taskEvaluationAndOr() {
        let rules = TaskConditionsV1(
            currency: "USD",
            groups: [
                TaskConditionGroup(id: "g1", metrics: [
                    TaskConditionMetric(id: "amt", kind: "amount", targetMinor: 50000),
                    TaskConditionMetric(id: "cnt", kind: "count", targetCount: 3),
                ]),
                TaskConditionGroup(id: "g2", metrics: [
                    TaskConditionMetric(id: "chk", kind: "check", label: "开卡刷一笔")
                ]),
            ]
        )
        let incomplete = ManualProgress(
            asOfOn: "2026-10-15",
            metricValues: ["amt": .number(30000), "cnt": .number(4), "chk": .bool(false)]
        )
        let eval1 = OpportunityDomainEngine.evaluateTask(rules: rules, progress: incomplete)
        #expect(eval1.satisfied == false)
        #expect(eval1.groups[0].metrics[0].gap == 20000)
        #expect(eval1.groups[0].metrics[1].gap == 0)

        let completeByOr = ManualProgress(
            asOfOn: "2026-10-16",
            metricValues: ["amt": .number(30000), "chk": .bool(true)]
        )
        let eval2 = OpportunityDomainEngine.evaluateTask(rules: rules, progress: completeByOr)
        #expect(eval2.satisfied == true)
    }

    @Test("Payment decoding tolerates extra unknown Direction-3 FX lock columns")
    func paymentDecodingToleratesExtraColumns() throws {
        let json = """
        {
          "id": "pay-1",
          "bill_id": "bill-1",
          "amount": 100.5,
          "paid_at": "2026-10-20",
          "idempotency_key": "idem-1",
          "fx_locked_amount": 723.6,
          "fx_currency": "CNY"
        }
        """
        let payment = try JSONDecoder().decode(Payment.self, from: Data(json.utf8))
        #expect(payment.id == "pay-1")
        #expect(payment.amount == 100.5)
    }
}
