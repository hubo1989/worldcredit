import Foundation
import GRDB
import Testing
@testable import WorldCreditCore

@Suite("Phase 1 Domain Services, Account Grouping & API Wrappers")
struct Phase1DomainAndApiTests {
    private let baseURL = URL(string: "https://test.local")!

    private func makeDbWithBaseEntities() throws -> DatabaseManager {
        let manager = try DatabaseManager.inMemory()
        try manager.dbWriter.write { db in
            try db.execute(sql: """
                INSERT INTO banks (id, name, short_name, quota_mode, statement_mode)
                VALUES ('b-cmb', '招商银行', '招行', 'shared', 'merged');
                INSERT INTO card_products (id, bank_id, bank_name, card_name, currency, payment_due_type, payment_due_value)
                VALUES ('cp-cmb', 'b-cmb', '招商银行', '经典白金卡', 'CNY', 'after_billing', 18);
                INSERT INTO card_holders (id, created_by, managed_by, name)
                VALUES ('h-1', 'u-1', 'u-1', '张三');
                INSERT INTO credit_accounts (id, holder_id, bank_id, bank_name, currency, statement_mode, quota_mode, shared_credit_limit, billing_day, due_type, due_value, primary_card_id, label, status)
                VALUES ('acc-cmb', 'h-1', 'b-cmb', '招商银行', 'CNY', 'merged', 'shared', 50000.0, 5, 'after_billing', 18, 'c-1', '招行共享账户', 'active');
                INSERT INTO credit_cards (id, holder_id, account_id, card_product_id, card_number_last4, credit_limit, credit_limit_override, billing_day, status)
                VALUES
                  ('c-1', 'h-1', 'acc-cmb', 'cp-cmb', '1001', 50000.0, 50000.0, 5, 'active'),
                  ('c-2', 'h-1', 'acc-cmb', 'cp-cmb', '1002', 50000.0, NULL, 5, 'active');
                INSERT INTO bills (id, account_id, card_id, bill_month, statement_start, statement_end, statement_date, bill_amount, min_payment, due_date, status)
                VALUES ('bill-1', 'acc-cmb', 'c-1', '2026-10', '2026-09-06', '2026-10-05', '2026-10-05', 12000.0, 1200.0, '2026-10-23', 'partial');
                INSERT INTO payments (id, bill_id, amount, paid_at, idempotency_key)
                VALUES ('pay-1', 'bill-1', 2000.0, '2026-10-10', 'idem-1');
            """)
        }
        return manager
    }

    private func instant(_ iso: String) -> Date {
        ISO8601DateFormatter().date(from: iso)!
    }

    // MARK: - BillEditService

    @Test("BillEditService updateBillFields writes overrides, recalculates status and enqueues bills.updateBillFields")
    func billUpdateFieldsAndClearOverride() async throws {
        let manager = try makeDbWithBaseEntities()
        let service = BillEditService(dbManager: manager)
        let today = instant("2026-10-20T00:00:00Z")

        let updated = try await service.updateBillFields(
            billId: "bill-1",
            input: BillFieldsUpdateInput(
                billAmount: 2000.0,
                minPayment: 200.0,
                dueDate: "2026-10-28",
                statementDate: "2026-10-06",
                statementStart: "2026-09-07",
                statementEnd: "2026-10-06"
            ),
            today: today
        )

        #expect(updated.billAmountOverride == 2000.0)
        #expect(updated.effectiveAmount == 2000.0)
        #expect(updated.billAmount == 12000.0)
        #expect(updated.effectiveMinPayment == 200.0)
        #expect(updated.effectiveDueDate == "2026-10-28")
        #expect(updated.dueDate == "2026-10-23")
        #expect(updated.effectiveStatementDate == "2026-10-06")
        #expect(updated.statementStart == "2026-09-07")
        #expect(updated.statementEnd == "2026-10-06")
        #expect(updated.status == "paid")

        // Verify outbox payload uses server-expected keys ("amount", "min_payment", ...)
        try await manager.dbWriter.read { db in
            let outbox = try MutationOutbox.filter(Column("name") == "bills.updateBillFields").fetchAll(db)
            #expect(outbox.count == 1)
            let args = try #require(try JSONSerialization.jsonObject(with: Data(outbox[0].argsJson.utf8)) as? [Any])
            #expect(args.first as? String == "bill-1")
            let patch = try #require(args[1] as? [String: Any])
            #expect(patch["amount"] as? Double == 2000.0)
            #expect(patch["min_payment"] as? Double == 200.0)
            #expect(patch["due_date"] as? String == "2026-10-28")
            #expect(patch["statement_date"] as? String == "2026-10-06")
            #expect(patch["statement_start"] as? String == "2026-09-07")
            #expect(patch["statement_end"] as? String == "2026-10-06")
        }

        // Clear amount override -> falls back to 12000, status returns to partial
        let afterAmountClear = try await service.clearOverride(billId: "bill-1", field: .amount, today: today)
        #expect(afterAmountClear.billAmountOverride == nil)
        #expect(afterAmountClear.effectiveAmount == 12000.0)
        #expect(afterAmountClear.status == "partial")

        // Clear remaining overrides
        let afterDueClear = try await service.clearOverride(
            billId: "bill-1",
            fields: [.minPayment, .dueDate, .statementDate],
            today: today
        )
        #expect(afterDueClear.effectiveMinPayment == 1200.0)
        #expect(afterDueClear.effectiveDueDate == "2026-10-23")
        #expect(afterDueClear.effectiveStatementDate == "2026-10-05")

        try await manager.dbWriter.read { db in
            let clears = try MutationOutbox.filter(Column("name") == "bills.clearOverride").fetchAll(db)
            #expect(clears.count == 2)
            let firstArgs = try #require(try JSONSerialization.jsonObject(with: Data(clears[0].argsJson.utf8)) as? [Any])
            #expect(firstArgs[0] as? String == "bill-1")
            #expect(firstArgs[1] as? [String] == ["amount"])
        }
    }

    @Test("BillEditService rejects invalid calendar dates, negative amounts, inverted statement range and empty update")
    func billUpdateValidationErrors() async throws {
        let manager = try makeDbWithBaseEntities()
        let service = BillEditService(dbManager: manager)

        await #expect(throws: BillEditError.emptyUpdate) {
            try await service.updateBillFields(billId: "bill-1", input: BillFieldsUpdateInput())
        }
        await #expect(throws: BillEditError.invalidDate(field: "到期日", value: "2026-02-30")) {
            try await service.updateBillFields(billId: "bill-1", input: BillFieldsUpdateInput(dueDate: "2026-02-30"))
        }
        await #expect(throws: BillEditError.invalidAmount(-10)) {
            try await service.updateBillFields(billId: "bill-1", input: BillFieldsUpdateInput(minPayment: -10))
        }
        await #expect(throws: BillEditError.invalidStatementPeriod) {
            try await service.updateBillFields(
                billId: "bill-1",
                input: BillFieldsUpdateInput(statementStart: "2026-10-10", statementEnd: "2026-10-01")
            )
        }
        let outboxCount = try await manager.dbWriter.read { db in
            try MutationOutbox.fetchCount(db)
        }
        #expect(outboxCount == 0)
    }

    // MARK: - CardEditService

    @Test("CardEditService extends CardUpdateInput with Phase 1 fields and enqueues cards.updateCard")
    func cardEditPhase1Fields() async throws {
        let manager = try makeDbWithBaseEntities()
        let service = CardEditService(dbManager: manager)

        let input = CardUpdateInput(
            creditLimitOverride: 95000.0,
            annualFeeOverride: 800.0,
            status: "frozen",
            cardType: "credit",
            issuedOn: "2024-06-01",
            activatedOn: "2024-06-15",
            accountModeOverride: "single"
        )
        let updated = try await service.updateCard(cardId: "c-1", input: input)
        #expect(updated.creditLimitOverride == 95000.0)
        #expect(updated.effectiveCreditLimit == 95000.0)
        #expect(updated.annualFeeOverride == 800.0)
        #expect(updated.status == "frozen")
        #expect(updated.cardType == "credit")
        #expect(updated.issuedOn == "2024-06-01")
        #expect(updated.activatedOn == "2024-06-15")
        #expect(updated.accountModeOverride == "single")

        try await manager.dbWriter.read { db in
            let outbox = try #require(try MutationOutbox.filter(Column("name") == "cards.updateCard").fetchOne(db))
            let args = try #require(try JSONSerialization.jsonObject(with: Data(outbox.argsJson.utf8)) as? [Any])
            #expect(args[0] as? String == "c-1")
            let patch = try #require(args[1] as? [String: Any])
            #expect(patch["credit_limit_override"] as? Double == 95000.0)
            #expect(patch["annual_fee_override"] as? Double == 800.0)
            #expect(patch["status"] as? String == "frozen")
            #expect(patch["card_type"] as? String == "credit")
            #expect(patch["issued_on"] as? String == "2024-06-01")
            #expect(patch["activated_on"] as? String == "2024-06-15")
            #expect(patch["account_mode_override"] as? String == "single")
        }

        await #expect(throws: CardEditError.invalidStatus("archived")) {
            try await service.updateCard(cardId: "c-1", input: CardUpdateInput(status: "archived"))
        }
        await #expect(throws: CardEditError.invalidAccountMode("invalid")) {
            try await service.updateCard(cardId: "c-1", input: CardUpdateInput(accountModeOverride: "invalid"))
        }
        await #expect(throws: CardEditError.invalidDate(field: "发卡日", value: "2024-02-31")) {
            try await service.updateCard(cardId: "c-1", input: CardUpdateInput(issuedOn: "2024-02-31"))
        }
    }

    // MARK: - QueryService

    @Test("QueryService fetchCreditAccountGroups deduplicates merged bills and shared limits without doubling")
    func queryAccountGroupsNoDoubling() async throws {
        let manager = try makeDbWithBaseEntities()
        let query = QueryService(dbManager: manager)
        let today = instant("2026-10-15T00:00:00Z")

        let groups = try await query.fetchCreditAccountGroups(today: today)
        #expect(groups.count == 1)
        let group = try #require(groups.first)
        #expect(group.account.id == "acc-cmb")
        #expect(group.isMergedStatement == true)
        #expect(group.isSharedQuota == true)
        #expect(group.cards.count == 2)
        // Shared quota pool is 50000 (not 100000 across 2 cards)
        #expect(group.creditLimit == 50000.0)
        // Merged bill (12000 - 2000 paid = 10000) is counted once (not 20000)
        #expect(group.unpaidAmount == 10000.0)
        #expect(group.availableLimit == 40000.0)
        #expect(group.bank?.id == "b-cmb")
        #expect(group.holder?.id == "h-1")

        // Dashboard summary must also avoid doubling shared pool credit limits
        let summary = try await query.fetchDashboardSummary(today: today)
        #expect(summary.totalCreditLimit == 50000.0)
        #expect(summary.totalDebt == 10000.0)
    }

    @Test("QueryService fetches bill_card_subtotals, promos, display_config, recurring_payables and holders from DB")
    func queryPhase1Tables() async throws {
        let manager = try makeDbWithBaseEntities()
        try await manager.dbWriter.write { db in
            try BillCardSubtotal(id: "sub-1", billId: "bill-1", cardId: "c-1", cardTail: "1001", subtotalAmount: 7000).insert(db)
            try BillCardSubtotal(id: "sub-2", billId: "bill-1", cardId: "c-2", cardTail: "1002", subtotalAmount: 5000).insert(db)
            try PromoRecord(id: "pr-active", bankId: "b-cmb", bankName: "招商银行", title: "周五半价", startDate: "2026-10-01", endDate: "2026-10-31", isActive: true).insert(db)
            try PromoRecord(id: "pr-upcoming", bankId: "b-cmb", bankName: "招商银行", title: "双十一预热", startDate: "2026-11-01", endDate: "2026-11-11", isActive: true).insert(db)
            try PromoRecord(id: "pr-expired", bankId: "b-cmb", bankName: "招商银行", title: "国庆已结束", startDate: "2026-10-01", endDate: "2026-10-07", isActive: true).insert(db)
            try PromoRecord(id: "pr-inactive", bankId: "b-cmb", bankName: "招商银行", title: "已下线", isActive: false).insert(db)
            try UserPreferenceRecord(
                userId: "u-1",
                displayConfig: UserDisplayConfig(privacyMode: true, showMinPayment: false, defaultCurrency: "HKD")
            ).insert(db)
            try RecurringPayableRecord(
                id: "rp-1", createdBy: "u-1", name: "季度车位费", category: "other", customCategory: "车位",
                amount: 900, currency: "CNY", dueDay: 10, cycleType: "every_n_months", cycleMonths: 3, anchorPeriod: "2026-10"
            ).insert(db)
            try RecurringPayableRecord(
                id: "rp-inactive", createdBy: "u-1", name: "停用项目", category: "other",
                amount: 100, currency: "CNY", dueDay: 1, isActive: false
            ).insert(db)
        }

        let query = QueryService(dbManager: manager)

        let subtotals = try await query.fetchBillCardSubtotals(billId: "bill-1")
        #expect(subtotals.map(\.cardTail) == ["1001", "1002"])
        #expect(subtotals.map(\.subtotalAmount) == [7000, 5000])

        let today = instant("2026-10-15T00:00:00Z")
        let activePromos = try await query.fetchPromos()
        #expect(activePromos.map(\.id) == ["pr-expired", "pr-active", "pr-upcoming"])
        let onlyStartedToday = try await query.fetchPromos(activeOnly: true, asOf: today)
        #expect(onlyStartedToday.map(\.id) == ["pr-active"])
        let currentAndUpcoming = try await query.fetchPromos(activeOnly: true, asOf: today, includeUpcoming: true)
        #expect(currentAndUpcoming.map(\.id) == ["pr-active", "pr-upcoming"])
        let allPromos = try await query.fetchPromos(activeOnly: false)
        #expect(allPromos.count == 4)

        let display = try await query.fetchDisplayConfig(userId: "u-1")
        #expect(display.privacyMode == true)
        #expect(display.showMinPayment == false)
        #expect(display.defaultCurrency == "HKD")
        let fallbackDisplay = try await query.fetchDisplayConfig(userId: "missing-user")
        #expect(fallbackDisplay == UserDisplayConfig())

        let payables = try await query.fetchRecurringPayablesFromDB()
        #expect(payables.map(\.id) == ["rp-1"])
        #expect(payables.first?.cycleType == "every_n_months")
        #expect(payables.first?.cycleMonths == 3)
        #expect(payables.first?.customCategory == "车位")

        let holders = try await query.fetchHoldersFromDB()
        #expect(holders.map(\.id) == ["h-1"])
    }

    // MARK: - ApiClient.register & Online RPCs

    @Test("ApiClient.register issues Bearer and refresh tokens when server returns token response")
    func registerWithToken() async throws {
        let session = MockNetworkSession { request in
            #expect(request.url?.path == "/api/auth/register")
            #expect(request.httpMethod == "POST")
            let body = try #require(JSONSerialization.jsonObject(with: request.httpBody!) as? [String: Any])
            #expect(body["email"] as? String == "new@example.test")
            #expect(body["password"] as? String == "secret123")
            #expect(body["name"] as? String == "Alice")
            #expect(body["issue_token"] as? Bool == true)

            let json = #"{"token":"reg-access-token","token_type":"Bearer","expires_in":604800,"refresh_token":"reg-refresh-token","user":{"id":"u-new","email":"new@example.test","name":"Alice","role":"member","created_at":"2026-10-01T00:00:00Z"}}"#
            return (Data(json.utf8), HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
        }

        let client = ApiClient(baseURL: baseURL, session: session, useKeychain: false)
        let response = try await client.register(email: "new@example.test", password: "secret123", name: "Alice")
        #expect(response.token == "reg-access-token")
        #expect(response.refreshToken == "reg-refresh-token")
        #expect(response.user.id == "u-new")
        #expect(client.token == "reg-access-token")
        #expect(client.refreshToken == "reg-refresh-token")
    }

    @Test("ApiClient.register falls back to password login when register returns only user without token")
    func registerFallsBackToPasswordLogin() async throws {
        let session = MockNetworkSession { request in
            switch request.url?.path {
            case "/api/auth/register":
                let json = #"{"user":{"id":"u-old","email":"old@example.test","name":null,"role":"member","created_at":"2026-10-01T00:00:00Z"}}"#
                return (Data(json.utf8), HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
            case "/api/auth/token":
                let body = try #require(JSONSerialization.jsonObject(with: request.httpBody!) as? [String: String])
                #expect(body["grant_type"] == "password")
                #expect(body["email"] == "old@example.test")
                let json = #"{"token":"fallback-token","token_type":"Bearer","expires_in":604800,"refresh_token":"fallback-refresh","user":{"id":"u-old","email":"old@example.test","name":null,"role":"member","created_at":"2026-10-01T00:00:00Z"}}"#
                return (Data(json.utf8), HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
            default:
                Issue.record("Unexpected path: \(request.url?.path ?? "")")
                throw URLError(.badURL)
            }
        }

        let client = ApiClient(baseURL: baseURL, session: session, useKeychain: false)
        let response = try await client.register(email: "old@example.test", password: "pw")
        #expect(response.token == "fallback-token")
        #expect(client.token == "fallback-token")
        #expect(client.refreshToken == "fallback-refresh")
    }

    @Test("ApiClient Phase 1 online RPC wrappers send exact routes and argument order")
    func phase1OnlineRpcs() async throws {
        let session = MockNetworkSession { request in
            let body = try #require(JSONSerialization.jsonObject(with: request.httpBody!) as? [String: Any])
            let args = try #require(body["args"] as? [Any])
            let json: String
            switch request.url?.path {
            case "/api/rpc/bills/createBill":
                let input = try #require(args.first as? [String: Any])
                #expect(input["card_id"] as? String == "c-1")
                #expect(input["bill_month"] as? String == "2026-11")
                #expect(input["bill_amount"] as? Double == 500.0)
                json = #"{"data":{"id":"bill-created","card_id":"c-1","bill_month":"2026-11","bill_amount":500,"due_date":"2026-11-23","status":"unpaid","created_at":"2026-11-05T00:00:00Z"},"error":null}"#
            case "/api/rpc/bills/deleteBill":
                #expect(args as? [String] == ["bill-created"])
                // Real server Response.json({ data: undefined, error: null }) omits the "data" key
                json = #"{"error":null}"#
            case "/api/rpc/payments/updatePayment":
                #expect(args.first as? String == "pay-1")
                let patch = try #require(args[1] as? [String: Any])
                #expect(patch["amount"] as? Double == 300.0)
                #expect(patch["note"] as? String == "更正")
                json = #"{"data":{"id":"pay-1","bill_id":"bill-1","amount":300,"paid_at":"2026-10-10","channel":"手动还款","note":"更正","idempotency_key":"idem-1","created_at":"2026-10-10T00:00:00Z"},"error":null}"#
            case "/api/rpc/payments/deletePayment":
                #expect(args as? [String] == ["pay-1"])
                json = #"{"data":{"ok":true},"error":null}"#
            case "/api/rpc/accounts/mergeCardsIntoAccount":
                #expect(args[0] as? String == "acc-1")
                #expect(args[1] as? [String] == ["c-2", "c-3"])
                json = #"{"data":{"mergedCount":2},"error":null}"#
            case "/api/rpc/accounts/splitCardFromAccount":
                #expect(args as? [String] == ["c-2"])
                json = #"{"data":{"id":"acc_i_c-2","holder_id":"h-1","bank_name":"招商银行","currency":"CNY","statement_mode":"independent","quota_mode":"independent","primary_card_id":"c-2","status":"active","created_at":"2026-11-01T00:00:00Z","updated_at":"2026-11-01T00:00:00Z"},"error":null}"#
            case "/api/rpc/accounts/updateCreditAccount":
                #expect(args[0] as? String == "acc-1")
                let patch = try #require(args[1] as? [String: Any])
                #expect(patch["label"] as? String == "主账户")
                #expect(patch["shared_credit_limit"] as? Double == 100000.0)
                json = #"{"data":{"id":"acc-1","holder_id":"h-1","bank_name":"招商银行","currency":"CNY","statement_mode":"merged","quota_mode":"shared","shared_credit_limit":100000,"label":"主账户","status":"active","created_at":"2026-10-01T00:00:00Z","updated_at":"2026-11-01T00:00:00Z"},"error":null}"#
            case "/api/rpc/preferences/updateUserPreferences":
                #expect(args[0] as? String == "")
                let updates = try #require(args[1] as? [String: Any])
                let display = try #require(updates["display_config"] as? [String: Any])
                #expect(display["privacy_mode"] as? Bool == true)
                #expect(display["default_currency"] as? String == "USD")
                json = #"{"data":{"user_id":"u-1","display_config":{"privacy_mode":true,"show_min_payment":true,"show_statement_date":true,"show_annual_fee":false,"show_card_last4":true,"default_currency":"USD"}},"error":null}"#
            default:
                Issue.record("Unexpected RPC path: \(request.url?.path ?? "")")
                throw URLError(.badURL)
            }
            return (Data(json.utf8), HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
        }

        let client = ApiClient(baseURL: baseURL, session: session, token: "tok", useKeychain: false)

        let createdBill = try await client.createBill(cardId: "c-1", billMonth: "2026-11", dueDate: "2026-11-23", billAmount: 500)
        #expect(createdBill.id == "bill-created")
        try await client.deleteBill(billId: "bill-created")

        let updatedPayment = try await client.updatePayment(paymentId: "pay-1", amount: 300, note: "更正")
        #expect(updatedPayment.amount == 300)
        try await client.deletePayment(paymentId: "pay-1")

        let merged = try await client.mergeCardsIntoAccount(targetAccountId: "acc-1", cardIds: ["c-2", "c-3"])
        #expect(merged.mergedCount == 2)
        let split = try await client.splitCardFromAccount(cardId: "c-2")
        #expect(split.id == "acc_i_c-2")
        let updatedAcc = try await client.updateCreditAccount(accountId: "acc-1", label: "主账户", sharedCreditLimit: 100000)
        #expect(updatedAcc.sharedCreditLimit == 100000)

        let updatedDisplay = try await client.updateDisplayPreferences(
            UserDisplayConfig(privacyMode: true, showAnnualFee: false, defaultCurrency: "USD")
        )
        #expect(updatedDisplay.privacyMode == true)
        #expect(updatedDisplay.showAnnualFee == false)
        #expect(updatedDisplay.defaultCurrency == "USD")
    }

    @Test("ApiClient updateCreditAccount encodes null for billing_day when clearBillingDay is true")
    func updateCreditAccountClearsBillingDay() async throws {
        let session = MockNetworkSession { request in
            #expect(request.url?.path == "/api/rpc/accounts/updateCreditAccount")
            let body = try #require(JSONSerialization.jsonObject(with: request.httpBody!) as? [String: Any])
            let args = try #require(body["args"] as? [Any])
            #expect(args.first as? String == "acc-1")
            let patch = try #require(args[1] as? [String: Any])
            #expect(patch["billing_day"] is NSNull)
            #expect(patch["label"] is NSNull)
            let json = #"{"data":{"id":"acc-1","holder_id":"h-1","bank_name":"招商银行","currency":"CNY","statement_mode":"merged","quota_mode":"shared","billing_day":null,"label":null,"status":"active","created_at":"2026-10-01T00:00:00Z","updated_at":"2026-11-01T00:00:00Z"},"error":null}"#
            return (Data(json.utf8), HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
        }

        let client = ApiClient(baseURL: baseURL, session: session, token: "tok", useKeychain: false)
        let input = ApiClient.UpdateCreditAccountInput(clearLabel: true, clearBillingDay: true, statementMode: "merged", quotaMode: "shared")
        let updated = try await client.updateCreditAccount(accountId: "acc-1", input: input)
        #expect(updated.billingDay == nil)
        #expect(updated.label == nil)
    }

    // MARK: - Payables 0030 Cycles & Custom Categories

    @Test("PayablesModels and PayablesRemoteService support 0030 cycle fields and custom categories")
    func payables0030CycleParity() async throws {
        let envelope = #"{"data":[{"id":"p-cycle","created_by":"alice","name":"季度物业","category":"other","custom_category":"物业费","amount":1200,"currency":"CNY","due_day":15,"cycle_type":"every_n_months","cycle_months":3,"due_month":null,"anchor_period":"2026-10","holder_id":null,"bank_name":"招商银行","bank_account":null,"period":"2026-10","due_date":"2026-10-15","days_until_due":5,"paid_amount":0,"status":"unpaid"}],"error":null}"#
        let session = MockNetworkSession { request in
            switch request.url?.path {
            case "/api/rpc/payables/getRecurringPayables":
                return (Data(envelope.utf8), HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
            case "/api/rpc/payables/createRecurringPayable":
                let body = try #require(JSONSerialization.jsonObject(with: request.httpBody!) as? [String: Any])
                let arg = try #require((body["args"] as? [[String: Any]])?.first)
                #expect(arg["cycle_type"] as? String == "yearly")
                #expect(arg["cycle_months"] as? Int == 12)
                #expect(arg["due_month"] as? Int == 6)
                #expect(arg["anchor_period"] as? String == "2026-06")
                #expect(arg["custom_category"] as? String == "车险")
                let created = #"{"data":{"id":"p-new","created_by":"alice","name":"车险","category":"other","custom_category":"车险","amount":4000,"currency":"CNY","due_day":1,"cycle_type":"yearly","cycle_months":12,"due_month":6,"anchor_period":"2026-06","holder_id":null,"bank_name":null,"bank_account":null,"period":"2026-06","due_date":"2026-06-01","days_until_due":20,"paid_amount":0,"status":"unpaid"},"error":null}"#
                return (Data(created.utf8), HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
            case "/api/rpc/payables/getPayableCustomCategories":
                let cats = #"{"data":["物业费","车险"],"error":null}"#
                return (Data(cats.utf8), HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
            default:
                throw URLError(.badURL)
            }
        }

        let client = ApiClient(baseURL: baseURL, session: session, token: "tok", useKeychain: false)
        let service = PayablesRemoteService(apiClient: client)

        let items = try await service.fetchPayables(userId: "alice")
        #expect(items.count == 1)
        let item = try #require(items.first)
        #expect(item.cycleType == .everyNMonths)
        #expect(item.cycleMonths == 3)
        #expect(item.anchorPeriod == "2026-10")
        #expect(item.customCategory == "物业费")
        #expect(item.categoryDisplayLabel == "物业费")
        #expect(item.cycleDisplayLabel == "每 3 个月 · 15 日")

        let draft = PayableDraft(
            name: "车险",
            category: .other,
            amount: 4000,
            currency: "CNY",
            dueDay: 1,
            customCategory: "车险",
            cycleType: .yearly,
            cycleMonths: 12,
            dueMonth: 6,
            anchorPeriod: "2026-06"
        )
        let created = try await service.create(userId: "alice", draft: draft)
        #expect(created.cycleType == .yearly)
        #expect(created.dueMonth == 6)
        #expect(created.cycleDisplayLabel == "每年 6 月 1 日")

        let categories = try await service.fetchCustomCategories()
        #expect(categories == ["物业费", "车险"])
    }

    // MARK: - Legacy JSON Compatibility & UserDisplayConfig Round-Trip

    @Test("Legacy JSON payloads missing Phase 1 columns decode safely and UserDisplayConfig round-trips")
    func legacyCompatibilityAndDisplayConfigRoundTrip() throws {
        let legacyCardJSON = #"{"id":"c-legacy","holder_id":"h-1","card_product_id":"p-1","billing_day":12}"#
        let card = try JSONDecoder().decode(CreditCard.self, from: Data(legacyCardJSON.utf8))
        #expect(card.effectiveCreditLimit == 0)
        #expect(card.accountId == nil)
        #expect(card.issuedOn == nil)

        let legacyBillJSON = #"{"id":"b-legacy","card_id":"c-legacy","bill_month":"2026-10","due_date":"2026-10-28"}"#
        let bill = try JSONDecoder().decode(Bill.self, from: Data(legacyBillJSON.utf8))
        #expect(bill.effectiveDueDate == "2026-10-28")
        #expect(bill.effectiveMinPayment == nil)
        #expect(bill.effectiveStatementDate == nil)

        let config = UserDisplayConfig(
            privacyMode: true,
            showMinPayment: false,
            showStatementDate: true,
            showAnnualFee: false,
            showCardLast4: true,
            defaultCurrency: "USD"
        )
        let record = try UserPreferenceRecord(userId: "u-rt", displayConfig: config)
        let decoded = record.decodedDisplayConfig()
        #expect(decoded == config)
    }
}
