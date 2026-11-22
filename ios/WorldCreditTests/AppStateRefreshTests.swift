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
        XCTAssertNil(state.pendingWebDestination)

        state.handleNotificationRoute("/benefits/calendar")
        XCTAssertEqual(state.selectedTab, 3)
        XCTAssertEqual(state.pendingWebDestination, .benefitCalendar)

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

    private actor SyncTestNetwork: NetworkSession {
        var activeUserId = "old-user"
        var validAccessToken = "token-1"
        var refreshMode: String = "ok" // ok | fail503 | timeout | fail401
        var pushCalls = 0
        var pushedMutationNames: [String] = []
        var failLogin = false

        func setValidAccessToken(_ token: String) { validAccessToken = token }
        func setRefreshMode(_ mode: String) { refreshMode = mode }
        func setFailLogin(_ flag: Bool) { failLogin = flag }
        func setActiveUser(_ userId: String, token: String) {
            activeUserId = userId
            validAccessToken = token
        }

        func data(for request: URLRequest) async throws -> (Data, URLResponse) {
            let url = try XCTUnwrap(request.url)
            let path = url.path
            func resp(_ status: Int, _ json: String) -> (Data, URLResponse) {
                (Data(json.utf8), HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: nil)!)
            }

            if path == "/api/auth/token" {
                if failLogin {
                    return resp(401, #"{"error":"邮箱或密码错误"}"#)
                }
                return resp(200, #"{"token":"\#(validAccessToken)","token_type":"Bearer","expires_in":604800,"user":{"id":"\#(activeUserId)","email":"\#(activeUserId)@example.test","name":"User","role":"member","created_at":"2026-01-01T00:00:00Z"},"refresh_token":"refresh-1"}"#)
            }

            if path == "/api/auth/refresh" {
                switch refreshMode {
                case "fail503":
                    return resp(503, #"{"error":"服务暂时不可用"}"#)
                case "timeout":
                    throw URLError(.timedOut)
                case "fail401":
                    return resp(401, #"{"error":"refresh token 无效或已过期"}"#)
                default:
                    validAccessToken = "token-2"
                    return resp(200, #"{"token":"token-2","token_type":"Bearer","expires_in":604800,"user":{"id":"\#(activeUserId)","email":"\#(activeUserId)@example.test","name":"User","role":"member","created_at":"2026-01-01T00:00:00Z"},"refresh_token":"refresh-2"}"#)
                }
            }

            guard request.value(forHTTPHeaderField: "Authorization") == "Bearer \(validAccessToken)" else {
                return resp(401, #"{"error":"未登录"}"#)
            }

            if path == "/api/sync/push" {
                pushCalls += 1
                let body = (try? JSONSerialization.jsonObject(with: request.httpBody ?? Data()) as? [String: Any]) ?? [:]
                let mutations = (body["mutations"] as? [[String: Any]]) ?? []
                for m in mutations {
                    if let name = m["name"] as? String { pushedMutationNames.append(name) }
                }
                let results = mutations.map { ["id": $0["id"] ?? "", "ok": true] }
                let data = try JSONSerialization.data(withJSONObject: ["results": results])
                return (data, HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil)!)
            }

            if path == "/api/sync/pull" {
                return resp(200, #"{"cursor":10,"has_more":false,"changes":[],"server_time":"2026-11-21T00:00:00Z"}"#)
            }

            return resp(404, #"{"error":"not found"}"#)
        }
    }

    func testSync401SilentRefreshRetriesInPlaceWithoutDeadlock() async throws {
        let db = try DatabaseManager.inMemory()
        let network = SyncTestNetwork()
        let client = ApiClient(
            baseURL: URL(string: "https://unit-tests.invalid")!,
            session: network,
            useKeychain: false,
            retryBaseDelayNanoseconds: 0
        )
        let state = AppState(
            dbManager: db,
            apiClient: client,
            sendWatchSnapshot: { _ in },
            clearUserData: { try await db.clearUserData() }
        )
        _ = try await state.login(email: "old-user@example.test", password: "pw")
        XCTAssertEqual(state.apiClient.token, "token-1")

        // 服务端使旧 token-1 失效，要求静默续期换取 token-2
        await network.setValidAccessToken("server-rotated-secret")
        let synced = await state.sync()
        XCTAssertTrue(synced)
        XCTAssertTrue(state.isLoggedIn)
        XCTAssertFalse(state.isSyncing)
        XCTAssertNil(state.lastSyncError)
        XCTAssertEqual(state.apiClient.token, "token-2")
        XCTAssertEqual(state.apiClient.refreshToken, "refresh-2")
    }

    func testSync401TransientRefreshFailurePreservesSession() async throws {
        let db = try DatabaseManager.inMemory()
        let network = SyncTestNetwork()
        let client = ApiClient(
            baseURL: URL(string: "https://unit-tests.invalid")!,
            session: network,
            useKeychain: false,
            retryBaseDelayNanoseconds: 0
        )
        let state = AppState(
            dbManager: db,
            apiClient: client,
            sendWatchSnapshot: { _ in },
            clearUserData: { try await db.clearUserData() }
        )
        _ = try await state.login(email: "old-user@example.test", password: "pw")

        // 访问受保护端点返回 401，但 /api/auth/refresh 遇到 503 瞬态故障
        await network.setValidAccessToken("server-needs-refresh")
        await network.setRefreshMode("fail503")
        let firstAttempt = await state.sync()
        XCTAssertFalse(firstAttempt)
        XCTAssertTrue(state.isLoggedIn, "瞬态刷新失败不得把用户踢回登录页")
        XCTAssertFalse(state.isSyncing)
        XCTAssertNotNil(state.lastSyncError)
        XCTAssertEqual(state.apiClient.token, "token-1")
        XCTAssertEqual(state.apiClient.refreshToken, "refresh-1")

        // 弱网超时同样不得清空会话
        await network.setRefreshMode("timeout")
        let timeoutAttempt = await state.sync()
        XCTAssertFalse(timeoutAttempt)
        XCTAssertTrue(state.isLoggedIn)
        XCTAssertEqual(state.apiClient.refreshToken, "refresh-1")

        // 恢复网络后再次 sync 成功续期并清错
        await network.setRefreshMode("ok")
        let recovered = await state.sync()
        XCTAssertTrue(recovered)
        XCTAssertTrue(state.isLoggedIn)
        XCTAssertNil(state.lastSyncError)
        XCTAssertEqual(state.apiClient.token, "token-2")
    }

    func testReLoginSameUserPreservesOfflineOutboxWhileDifferentUserClearsDatabase() async throws {
        let db = try DatabaseManager.inMemory()
        let network = SyncTestNetwork()
        let client = ApiClient(
            baseURL: URL(string: "https://unit-tests.invalid")!,
            session: network,
            token: "expired-no-refresh",
            useKeychain: false,
            retryBaseDelayNanoseconds: 0
        )
        try await db.dbWriter.write { db in
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
                INSERT INTO sync_meta (key, value) VALUES ('sync_owner_user_id', 'old-user');
                """)
        }
        let state = AppState(
            dbManager: db,
            apiClient: client,
            sendWatchSnapshot: { _ in },
            clearUserData: { try await db.clearUserData() }
        )
        state.isLoggedIn = true
        state.currentUser = SessionUser(id: "old-user", email: "old-user@example.test")

        // 离线登记一笔还款，然后触发 401 会话过期（无 refresh_token -> 回登录页）
        try await state.paymentService.recordPayment(billId: "bill", amount: 50)
        await state.refreshPayables()
        XCTAssertFalse(state.isLoggedIn)

        // 密码错误时不得清空本地离线队列
        await network.setFailLogin(true)
        do {
            _ = try await state.login(email: "old-user@example.test", password: "wrong")
            XCTFail("Expected login error")
        } catch {}
        let pendingAfterFailedLogin = try await db.dbWriter.read { try MutationOutbox.fetchCount($0) }
        XCTAssertEqual(pendingAfterFailedLogin, 1)

        // 同账号重新登录：保留离线 outbox 并自动推送到服务端
        await network.setFailLogin(false)
        let sessionA = try await state.login(email: "old-user@example.test", password: "pw")
        XCTAssertTrue(sessionA.syncSuccess)
        XCTAssertNil(state.lastSyncError)
        let pendingAfterSameUserLogin = try await db.dbWriter.read { try MutationOutbox.fetchCount($0) }
        XCTAssertEqual(pendingAfterSameUserLogin, 0)
        let pushedNames = await network.pushedMutationNames
        XCTAssertEqual(pushedNames, ["bills.recordPayment"])

        // 切换不同账号登录：必须先清空前账号本地库，防止跨账号数据泄漏
        try await state.paymentService.recordPayment(billId: "bill", amount: 20)
        await network.setActiveUser("other-user", token: "other-token")
        let sessionB = try await state.login(email: "other-user@example.test", password: "pw")
        XCTAssertTrue(sessionB.syncSuccess)
        XCTAssertNil(state.lastSyncError)
        let remainingBills = try await db.dbWriter.read { try Bill.fetchCount($0) }
        let remainingOutbox = try await db.dbWriter.read { try MutationOutbox.fetchCount($0) }
        let ownerMeta = try await db.dbWriter.read { try SyncMeta.fetchOne($0, key: "sync_owner_user_id")?.value }
        XCTAssertEqual(remainingBills, 0)
        XCTAssertEqual(remainingOutbox, 0)
        XCTAssertEqual(ownerMeta, "other-user")
    }
}
