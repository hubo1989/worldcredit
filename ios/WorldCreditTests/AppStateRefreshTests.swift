import XCTest
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
        var snapshots = 0
        let fixture = try fixture(loggedIn: true) { _ in snapshots += 1 }
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
        XCTAssertEqual(snapshots, 0)
        state.apiClient.token = "next-token"
        state.isLoggedIn = true
        state.beforeLocalReload = nil
        await state.refreshForBusinessDayIfNeeded()
        XCTAssertNotNil(state.summary)
        XCTAssertEqual(snapshots, 1)
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
}
