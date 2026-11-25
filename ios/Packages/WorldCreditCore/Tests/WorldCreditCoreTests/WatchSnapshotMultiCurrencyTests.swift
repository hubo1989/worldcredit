import Foundation
import GRDB
import Testing
import UserNotifications
@testable import WorldCreditCore

@Suite("WatchSnapshot Multi-Currency & NotificationScheduler Timezone/QuietHours")
struct WatchSnapshotMultiCurrencyTests {
    private func makeSeededDB() throws -> DatabaseManager {
        let manager = try DatabaseManager.inMemory()
        try manager.dbWriter.write { db in
            try Bank(id: "bank-cn", name: "招商银行", shortName: "招行").insert(db)
            try Bank(id: "bank-us", name: "Chase", shortName: "Chase").insert(db)
            try CardProduct(
                id: "prod-cny", bankId: "bank-cn", bankName: "招行", cardName: "经典白",
                currency: "CNY", paymentDueType: .fixed, paymentDueValue: 20
            ).insert(db)
            try CardProduct(
                id: "prod-usd", bankId: "bank-us", bankName: "Chase", cardName: "Sapphire",
                currency: "USD", paymentDueType: .fixed, paymentDueValue: 25
            ).insert(db)
            try CardHolder(id: "h-1", createdBy: "u-1", managedBy: "u-1", name: "Hubert").insert(db)
            try CreditAccount(
                id: "acc-cn", holderId: "h-1", bankId: "bank-cn", bankName: "招行",
                currency: "CNY", statementMode: "merged", quotaMode: "shared", sharedCreditLimit: 50000
            ).insert(db)
            try CreditCard(
                id: "card-cny-1", holderId: "h-1", cardProductId: "prod-cny",
                billingDay: 5, cardNumberLast4: "1111", creditLimit: 50000, accountId: "acc-cn"
            ).insert(db)
            try CreditCard(
                id: "card-cny-2", holderId: "h-1", cardProductId: "prod-cny",
                billingDay: 5, cardNumberLast4: "2222", creditLimit: 50000, accountId: "acc-cn"
            ).insert(db)
            try CreditCard(
                id: "card-usd-1", holderId: "h-1", cardProductId: "prod-usd",
                billingDay: 10, cardNumberLast4: "8888", creditLimit: 5000
            ).insert(db)

            try Bill(id: "b-cny", cardId: "card-cny-1", billMonth: "2026-10", billAmount: 500, dueDate: "2026-10-28").insert(db)
            try Bill(id: "b-usd", cardId: "card-usd-1", billMonth: "2026-10", billAmount: 100, dueDate: "2026-10-25").insert(db)
        }
        return manager
    }

    private func instant(_ iso: String) -> Date {
        let f = ISO8601DateFormatter()
        return f.date(from: iso)!
    }

    @Test("Multi-currency snapshot converts via FX rates and deduplicates shared credit account pool")
    func multiCurrencyConvertedWithSharedAccount() async throws {
        let manager = try makeSeededDB()
        let today = instant("2026-10-20T01:00:00Z")
        // 1 USD = 7 CNY => rates["USD"] = 1, rates["CNY"] = 7
        let fx = FxRates(base: "USD", rates: ["USD": 1.0, "CNY": 7.0], timestamp: 1_760_000_000, fetchedAt: 1_760_000_000_000)

        let snap = try await WatchSnapshotManager.shared.buildSnapshot(
            dbManager: manager,
            today: today,
            displayCurrency: "CNY",
            rates: fx
        )

        #expect(snap.displayCurrency == "CNY")
        #expect(snap.mixed == true)
        #expect(snap.ratesAvailable == true)
        #expect(snap.unconvertedCurrencies.isEmpty)
        #expect(snap.debtByCurrency["CNY"] == 500)
        #expect(snap.debtByCurrency["USD"] == 100)
        // 500 CNY + 100 USD * 7 = 1200 CNY
        #expect(abs(snap.totalDebt - 1200.0) < 0.001)
        // Shared acc-cn counted once (50000 CNY) + 5000 USD * 7 (35000) = 85000
        #expect(abs(snap.totalCreditLimit - 85000.0) < 0.001)
        #expect(snap.bills.first(where: { $0.id == "b-usd" })?.currency == "USD")
        #expect(snap.calendarEvents.first(where: { $0.id == "due-b-usd" })?.subtitle.contains("US$100") == true)
    }

    @Test("Missing FX rates degrades gracefully without mixing currencies 1:1")
    func missingRatesDegradesWithoutFalseMix() async throws {
        let manager = try makeSeededDB()
        let today = instant("2026-10-20T01:00:00Z")

        let snap = try await WatchSnapshotManager.shared.buildSnapshot(
            dbManager: manager,
            today: today,
            displayCurrency: "CNY",
            rates: nil
        )

        #expect(snap.ratesAvailable == false)
        #expect(snap.unconvertedCurrencies == ["USD"])
        #expect(snap.missingLimitCurrencies == ["USD"])
        #expect(abs(snap.totalDebt - 500.0) < 0.001)
        #expect(snap.formattedTotalDebt(compact: true) == "¥500 · US$100")
    }

    @Test("Legacy WatchSnapshot JSON without currency fields decodes safely")
    func legacyJSONBackwardCompatible() throws {
        let json = """
        {
          "generatedAt": "2026-10-20T00:00:00Z",
          "totalDebt": 300,
          "overdueCount": 0,
          "overdueAmount": 0,
          "totalCreditLimit": 10000,
          "bills": [{
            "id": "b1", "bankName": "招行", "cardTitle": "经典白", "last4": "1234",
            "holderName": "Hubert", "dueDate": "2026-10-25", "billAmount": 300, "remainingAmount": 300
          }],
          "cards": [],
          "calendarEvents": []
        }
        """
        let snap = try JSONDecoder().decode(WatchSnapshot.self, from: Data(json.utf8))
        #expect(snap.displayCurrency == "CNY")
        #expect(snap.bills.first?.currency == "CNY")
        #expect(snap.formattedTotalDebt(compact: true) == "¥300")
    }

    @Test("NotificationScheduler honors timezone, localTime, quiet-hours postponement, webPush disable, and bill currency")
    func schedulerTimezoneQuietHoursAndCurrency() async throws {
        let manager = try DatabaseManager.inMemory()
        try await manager.dbWriter.write { db in
            try Bank(id: "b-us", name: "Chase").insert(db)
            try CardProduct(id: "p-us", bankId: "b-us", bankName: "Chase", cardName: "CSP", currency: "USD", paymentDueType: .fixed, paymentDueValue: 28).insert(db)
            try CardHolder(id: "h1", createdBy: "u1", managedBy: "u1", name: "Hubert").insert(db)
            try CreditCard(id: "c1", holderId: "h1", cardProductId: "p-us", billingDay: 5, cardNumberLast4: "4242").insert(db)
            try Bill(id: "bill-usd", cardId: "c1", billMonth: "2026-10", billAmount: 120, dueDate: "2026-10-28").insert(db)
        }

        final class SpyCenter: NotificationCenterProtocol, @unchecked Sendable {
            var requests: [UNNotificationRequest] = []
            func add(_ request: UNNotificationRequest) async throws { requests.append(request) }
            func removePendingNotificationRequests(withIdentifiers identifiers: [String]) {}
            func removeAllPendingNotificationRequests() { requests.removeAll() }
            func pendingNotificationRequests() async -> [UNNotificationRequest] { requests }
        }

        let center = SpyCenter()
        let scheduler = NotificationScheduler(dbManager: manager, center: center)
        let today = instant("2026-10-26T00:00:00Z")

        // 1. Quiet-hours crossing midnight: 23:00 in 22:00-08:00 postpones to 08:00 next day in America/New_York
        var prefs = UserReminderPreferences(
            remindDaysBefore: [0],
            quietHoursStart: "22:00",
            quietHoursEnd: "08:00",
            enabledChannels: ["web_push"],
            items: NotificationItemSwitches(
                billDueToday: true,
                payableDueToday: false,
                billDueAdvance: false,
                payableDueAdvance: false,
                billOverdue: false,
                gracePeriodLongest: false
            ),
            opportunities: OpportunityReminderPreferences(timeZone: "America/New_York", localTime: "23:00")
        )
        try await scheduler.rescheduleAll(today: today, preferences: prefs)
        #expect(center.requests.count == 1)
        let req = try #require(center.requests.first)
        #expect(req.content.body.contains("US$120"))
        let trigger = try #require(req.trigger as? UNCalendarNotificationTrigger)
        #expect(trigger.dateComponents.hour == 8)
        #expect(trigger.dateComponents.minute == 0)
        #expect(trigger.dateComponents.day == 29) // Oct 28 23:00 -> Oct 29 08:00 NY time
        #expect(trigger.dateComponents.timeZone?.identifier == "America/New_York")

        // 2. Disabling webPush channel clears all requests
        prefs.enabledChannels = []
        try await scheduler.rescheduleAll(today: today, preferences: prefs)
        #expect(center.requests.isEmpty)
    }
}
