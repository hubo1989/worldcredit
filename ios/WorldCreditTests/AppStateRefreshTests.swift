import XCTest
import GRDB
import WorldCreditCore
@testable import WorldCredit

@MainActor
final class AppStateRefreshTests: XCTestCase {
    @MainActor
    private final class Gate {
        let entered = XCTestExpectation(description: "本地加载已暂停")
        private var continuation: CheckedContinuation<Void, Never>?
        private var isReleased = false

        func wait() async {
            entered.fulfill()
            if isReleased { return }
            await withCheckedContinuation { continuation = $0 }
        }

        func release() {
            isReleased = true
            continuation?.resume()
            continuation = nil
        }
    }

    private actor Network: NetworkSession {
        private(set) var requests = 0

        func data(for request: URLRequest) async throws -> (Data, URLResponse) {
            requests += 1
            let url = try XCTUnwrap(request.url)
            return (Data(#"{"error":"expired"}"#.utf8),
                    HTTPURLResponse(url: url, statusCode: 401, httpVersion: nil, headerFields: nil)!)
        }
    }

    private struct Fixture {
        let state: AppState
        let network: Network
    }

    private func fixture(loggedIn: Bool, snapshots: @escaping @MainActor (WatchSnapshot) -> Void = { _ in }) throws -> Fixture {
        let db = try DatabaseManager.inMemory()
        try db.dbWriter.write { db in
            try db.execute(sql: """
                INSERT INTO banks (id, name) VALUES ('bank', '测试银行');
                INSERT INTO card_products (id, bank_id, bank_name, card_name, currency, payment_due_type, payment_due_value)
                VALUES ('product', 'bank', '测试银行', '测试卡', 'CNY', 'fixed', 25);
                INSERT INTO card_holders (id, created_by, managed_by, name, created_at)
                VALUES ('holder', 'old-user', 'old-user', '测试持卡人', '2026-01-01');
                INSERT INTO credit_cards (id, holder_id, card_product_id, billing_day, credit_limit)
                VALUES ('card', 'holder', 'product', 10, 10000);
                INSERT INTO bills (id, card_id, bill_month, bill_amount, due_date, status)
                VALUES ('bill', 'card', '2026-10', 100, '2026-10-30', 'unpaid');
                """)
        }
        let network = Network()
        let client = ApiClient(baseURL: URL(string: "https://unit-tests.invalid")!, session: network,
                               token: loggedIn ? "old-token" : nil, useKeychain: false)
        let state = AppState(
            dbManager: db,
            apiClient: client,
            sendWatchSnapshot: snapshots,
            clearUserData: { try await db.clearUserData() }
        )
        state.isLoggedIn = loggedIn
        state.currentUser = loggedIn ? SessionUser(id: "old-user", email: "old@example.test") : nil
        return Fixture(state: state, network: network)
    }

    func testLoggedOutRefreshCannotRestoreRetainedDatabaseOrPublishSnapshot() async throws {
        var snapshots = 0
        let fixture = try fixture(loggedIn: false) { _ in snapshots += 1 }
        let state = fixture.state
        var loads = 0
        state.beforeLocalReload = { loads += 1 }
        await state.loadInitialDataIfNeeded()
        await state.refreshForBusinessDayIfNeeded()
        let reloaded = await state.reloadData()
        XCTAssertFalse(reloaded)
        XCTAssertEqual(loads, 0)
        XCTAssertTrue(state.allBills.isEmpty)
        XCTAssertTrue(state.cards.isEmpty)
        XCTAssertNil(state.summary)
        XCTAssertEqual(snapshots, 0)
        let requests = await fixture.network.requests
        XCTAssertEqual(requests, 0)
    }

    func testExpiredSessionCancelsPendingRefreshAndNextSessionCanRefreshAgain() async throws {
        var snapshots = 0
        let fixture = try fixture(loggedIn: true) { _ in snapshots += 1 }
        let state = fixture.state
        let gate = Gate()
        state.beforeLocalReload = { await gate.wait() }
        let pending = Task { await state.refreshForBusinessDayIfNeeded() }
        await fulfillment(of: [gate.entered], timeout: 2)
        await state.refreshPayables()
        XCTAssertFalse(state.isLoggedIn, "真实 401 路径必须使旧会话失效")
        gate.release()
        await pending.value
        XCTAssertTrue(state.allBills.isEmpty)
        XCTAssertEqual(snapshots, 0)

        // 同一进程恢复会话；不能被上一会话已经结束的 businessDayTask 永久短路。
        state.apiClient.token = "next-token"
        state.isLoggedIn = true
        state.currentUser = SessionUser(id: "old-user", email: "old@example.test")
        state.beforeLocalReload = nil
        await state.refreshForBusinessDayIfNeeded()
        XCTAssertEqual(state.allBills.map(\.id), ["bill"])
        XCTAssertEqual(snapshots, 1)
    }

    func testLogoutCancelsPendingRefreshAndClearsLoadedDay() async throws {
        var sentSnapshots: [WatchSnapshot] = []
        let fixture = try fixture(loggedIn: true) { snapshot in sentSnapshots.append(snapshot) }
        let state = fixture.state
        let gate = Gate()
        state.beforeLocalReload = { await gate.wait() }
        let pending = Task { await state.refreshForBusinessDayIfNeeded() }
        await fulfillment(of: [gate.entered], timeout: 2)
        try await state.logout()
        gate.release()
        await pending.value
        XCTAssertFalse(state.isLoggedIn)
        XCTAssertTrue(state.allBills.isEmpty)
        XCTAssertEqual(sentSnapshots.count, 1, "登出时仅允许发送一条清空手表的空快照")
        XCTAssertTrue(sentSnapshots.allSatisfy { $0.bills.isEmpty && $0.totalDebt == 0 },
                      "被取消的旧刷新不得向手表发送残留账单快照")
        state.apiClient.token = "next-token"
        state.isLoggedIn = true
        state.beforeLocalReload = nil
        await state.refreshForBusinessDayIfNeeded()
        XCTAssertNotNil(state.summary)
        XCTAssertEqual(state.summary?.totalDebt, 0)
        XCTAssertEqual(sentSnapshots.count, 2)
        XCTAssertEqual(sentSnapshots.last?.bills.count, 0)
    }

    func testForegroundAndDayEventJoinInitialLoad() async throws {
        let fixture = try fixture(loggedIn: true)
        let state = fixture.state
        let gate = Gate()
        var loads = 0
        state.beforeLocalReload = {
            loads += 1
            await gate.wait()
        }
        let initial = Task { await state.loadInitialDataIfNeeded() }
        await fulfillment(of: [gate.entered], timeout: 2)
        let foreground = Task { await state.loadInitialDataIfNeeded() }
        let dayChanged = Task { await state.refreshForBusinessDayIfNeeded() }
        await Task.yield()
        XCTAssertEqual(loads, 1)
        gate.release()
        await initial.value
        await foreground.value
        await dayChanged.value
        XCTAssertEqual(loads, 1, "初次加载未结束时不得启动第二次本地加载")
    }

    func testBusinessDayRefreshRecomputesDatesOnceWithoutNetwork() async throws {
        let fixture = try fixture(loggedIn: true)
        let state = fixture.state
        let calendar = BillingDateCalculator.businessCalendar
        let first = try XCTUnwrap(calendar.date(from: DateComponents(year: 2026, month: 10, day: 30, hour: 23)))
        let second = try XCTUnwrap(calendar.date(from: DateComponents(year: 2026, month: 10, day: 31, hour: 1)))
        var loads = 0
        state.beforeLocalReload = { loads += 1 }
        await state.refreshForBusinessDayIfNeeded(now: first)
        XCTAssertEqual(state.allBills.first?.daysUntilDue, 0)
        await state.refreshForBusinessDayIfNeeded(now: first.addingTimeInterval(60))
        XCTAssertEqual(loads, 1)
        await state.refreshForBusinessDayIfNeeded(now: second)
        XCTAssertEqual(loads, 2)
        XCTAssertEqual(state.allBills.first?.daysUntilDue, -1)
        XCTAssertEqual(state.allBills.first?.isOverdue, true)
        let requests = await fixture.network.requests
        XCTAssertEqual(requests, 0)
    }

    func testFiveTabLaunchArgumentsAndNotificationRoutes() throws {
        XCTAssertEqual(AppState.initialTab(for: ["WorldCredit"]), 0)
        XCTAssertEqual(AppState.initialTab(for: ["WorldCredit", "--tab=bills"]), 1)
        XCTAssertEqual(AppState.initialTab(for: ["WorldCredit", "--tab=accounts"]), 2)
        XCTAssertEqual(AppState.initialTab(for: ["WorldCredit", "--tab=cards"]), 2)
        XCTAssertEqual(AppState.initialTab(for: ["WorldCredit", "--tab=benefits"]), 3)
        XCTAssertEqual(AppState.initialTab(for: ["WorldCredit", "--tab=mine"]), 4)
        XCTAssertEqual(AppState.initialTab(for: ["WorldCredit", "--tab=settings"]), 4)

        let fixture = try fixture(loggedIn: true)
        let state = fixture.state

        state.handleNotificationRoute("/accounts")
        XCTAssertEqual(state.selectedTab, 2)
        XCTAssertNil(state.pendingWebDestination)
        XCTAssertFalse(state.pendingOpenNotifications)

        state.handleNotificationRoute("/accounts/acc-1?source=push")
        XCTAssertEqual(state.selectedTab, 2)

        state.handleNotificationRoute("/cards")
        XCTAssertEqual(state.selectedTab, 2)

        state.handleNotificationRoute("/promos")
        XCTAssertEqual(state.selectedTab, 3)
        XCTAssertNil(state.pendingWebDestination)

        state.handleNotificationRoute("/benefits")
        XCTAssertEqual(state.selectedTab, 3)
        XCTAssertEqual(state.pendingBenefitsRoute, .ledger(accountId: nil))
        XCTAssertNil(state.pendingWebDestination)

        state.handleNotificationRoute("/benefits/acc-9")
        XCTAssertEqual(state.selectedTab, 3)
        XCTAssertEqual(state.pendingBenefitsRoute, .ledger(accountId: "acc-9"))
        XCTAssertNil(state.pendingWebDestination)

        state.handleNotificationRoute("/benefits/calendar")
        XCTAssertEqual(state.selectedTab, 3)
        XCTAssertEqual(state.pendingBenefitsRoute, .calendar())
        XCTAssertNil(state.pendingWebDestination)

        state.handleNotificationRoute("/benefits/tasks")
        XCTAssertEqual(state.selectedTab, 3)
        XCTAssertEqual(state.pendingBenefitsRoute, .tasks())
        XCTAssertNil(state.pendingWebDestination)

        state.handleNotificationRoute("/gmail-ledger")
        XCTAssertEqual(state.selectedTab, 1)
        XCTAssertTrue(state.pendingOpenDraftsInbox)
        XCTAssertNil(state.pendingWebDestination)

        state.handleNotificationRoute("/settings")
        XCTAssertEqual(state.selectedTab, 4)
        XCTAssertNil(state.pendingWebDestination)

        state.handleNotificationRoute("/bills")
        XCTAssertEqual(state.selectedTab, 1)

        state.handleNotificationRoute("/dashboard")
        XCTAssertEqual(state.selectedTab, 0)

        // 非站内相对路径不得跳转
        state.selectedTab = 2
        state.handleNotificationRoute("https://evil.example/settings")
        XCTAssertEqual(state.selectedTab, 2)
        state.handleNotificationRoute("//evil.example/settings")
        XCTAssertEqual(state.selectedTab, 2)
    }

    func testOmnibusDraftRoutesAndIncomingURL() async throws {
        let fixture = try fixture(loggedIn: true)
        let state = fixture.state

        state.handleNotificationRoute("/gmail-ledger")
        XCTAssertEqual(state.selectedTab, 1)
        XCTAssertTrue(state.pendingOpenDraftsInbox)
        XCTAssertNil(state.pendingDraftIdToConfirm)
        XCTAssertNil(state.pendingWebDestination)

        state.pendingOpenDraftsInbox = false
        state.handleNotificationRoute("/bills?draftId=draft-123")
        XCTAssertEqual(state.selectedTab, 1)
        XCTAssertEqual(state.pendingDraftIdToConfirm, "draft-123")
        XCTAssertFalse(state.pendingOpenDraftsInbox)

        state.pendingDraftIdToConfirm = nil
        state.handleNotificationRoute("/bills?drafts=1")
        XCTAssertEqual(state.selectedTab, 1)
        XCTAssertTrue(state.pendingOpenDraftsInbox)

        state.pendingOpenDraftsInbox = false
        state.handleIncomingURL(URL(string: "worldcredit://drafts/draft-from-share")!)
        XCTAssertEqual(state.selectedTab, 1)
        XCTAssertEqual(state.pendingDraftIdToConfirm, "draft-from-share")

        state.pendingDraftIdToConfirm = nil
        state.handleIncomingURL(URL(string: "worldcredit://drafts")!)
        XCTAssertEqual(state.selectedTab, 1)
        XCTAssertTrue(state.pendingOpenDraftsInbox)
    }

    func testReloadDataReadsV2TablesAndLogoutClearsAllState() async throws {
        let fixture = try fixture(loggedIn: true)
        let state = fixture.state

        try await state.dbManager.dbWriter.write { db in
            let account = CreditAccount(
                id: "acc-1",
                holderId: "holder",
                bankId: "bank",
                bankName: "测试银行",
                currency: "CNY",
                statementMode: "merged",
                quotaMode: "shared",
                sharedCreditLimit: 50000,
                billingDay: 10,
                primaryCardId: "card",
                label: "测试共享账户"
            )
            try account.save(db)
            try db.execute(
                sql: "UPDATE credit_cards SET account_id = 'acc-1' WHERE id = 'card'"
            )

            let promo = PromoRecord(
                id: "promo-1",
                cardProductId: "product",
                bankId: "bank",
                bankName: "测试银行",
                title: "周三五折餐饮券",
                description: "测试活动描述",
                discountType: "折扣",
                isActive: true
            )
            try promo.save(db)

            let pref = try UserPreferenceRecord(
                userId: "old-user",
                displayConfig: UserDisplayConfig(
                    privacyMode: false,
                    showMinPayment: false,
                    showStatementDate: false,
                    showAnnualFee: false,
                    showCardLast4: false,
                    defaultCurrency: "USD"
                )
            )
            try pref.save(db)
        }

        let reloaded = await state.reloadData()
        XCTAssertTrue(reloaded)
        XCTAssertEqual(state.creditAccountGroups.count, 1)
        XCTAssertEqual(state.creditAccountGroups.first?.account.id, "acc-1")
        XCTAssertEqual(state.creditAccountGroups.first?.creditLimit, 50000)
        XCTAssertEqual(state.promos.map(\.id), ["promo-1"])
        XCTAssertEqual(state.displayConfig, UserDisplayConfig(
            privacyMode: false,
            showMinPayment: false,
            showStatementDate: false,
            showAnnualFee: false,
            showCardLast4: false,
            defaultCurrency: "USD"
        ))
        XCTAssertFalse(state.dashboardPrivacy)
        XCTAssertEqual(state.dashboardCurrency, "USD")

        try await state.logout()
        XCTAssertFalse(state.isLoggedIn)
        XCTAssertNil(state.currentUser)
        XCTAssertTrue(state.creditAccountGroups.isEmpty)
        XCTAssertTrue(state.promos.isEmpty)
        XCTAssertEqual(state.displayConfig, UserDisplayConfig())
        XCTAssertTrue(state.dashboardPrivacy)
        XCTAssertEqual(state.dashboardCurrency, "CNY")
        XCTAssertTrue(state.allBills.isEmpty)
        XCTAssertTrue(state.cards.isEmpty)
        XCTAssertNil(state.summary)

        let counts: (Int, Int, Int, Int, Int) = try await state.dbManager.dbWriter.read { db in
            (
                try CreditAccount.fetchCount(db),
                try PromoRecord.fetchCount(db),
                try UserPreferenceRecord.fetchCount(db),
                try Bill.fetchCount(db),
                try CreditCard.fetchCount(db)
            )
        }
        XCTAssertEqual(counts.0, 0)
        XCTAssertEqual(counts.1, 0)
        XCTAssertEqual(counts.2, 0)
        XCTAssertEqual(counts.3, 0)
        XCTAssertEqual(counts.4, 0)
    }

    func testPhase2WorkerDeepLinkRetainsAccountAndClaimAction() throws {
        let state = try fixture(loggedIn: true).state

        state.handleNotificationRoute("/benefits?account_id=acc_1")
        XCTAssertEqual(state.selectedTab, 3)
        XCTAssertNil(state.pendingWebDestination)
        XCTAssertEqual(state.pendingBenefitsRoute, .ledger(accountId: "acc_1"))
        XCTAssertNil(state.pendingBenefitsAction)

        state.handleNotificationRoute("/benefits?account_id=acc_1&action=claim")
        XCTAssertEqual(state.selectedTab, 3)
        XCTAssertNil(state.pendingWebDestination)
        XCTAssertEqual(state.pendingBenefitsRoute, .ledger(accountId: "acc_1"))
        XCTAssertEqual(state.pendingBenefitsAction, "claim")
    }

    func testPhase2WorkerCalendarAndTaskRoutesRetainDistinctTargets() throws {
        let state = try fixture(loggedIn: true).state

        for (first, second) in [
            ("/benefits/calendar?event_key=ev_1", "/benefits/calendar?event_key=ev_2"),
            ("/benefits/tasks?task_cycle_id=tc_1", "/benefits/tasks?task_cycle_id=tc_2"),
        ] {
            state.handleNotificationRoute(first)
            let original = state.pendingBenefitsRoute
            state.handleNotificationRoute(second)
            XCTAssertEqual(state.selectedTab, 3)
            XCTAssertNil(state.pendingWebDestination)
            XCTAssertNotEqual(state.pendingBenefitsRoute, original, second)
        }
        state.handleNotificationRoute("/promos")
        XCTAssertEqual(state.pendingBenefitsRoute, .promos)
        XCTAssertNil(state.pendingWebDestination)
    }
}
