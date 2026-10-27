import Foundation
import SwiftUI
import Observation
import WorldCreditCore

@MainActor
@Observable
public final class AppState {
    public let dbManager: DatabaseManager
    public let apiClient: ApiClient
    public let syncEngine: SyncEngine
    public let paymentService: PaymentService
    public let billEditService: BillEditService
    public let cardEditService: CardEditService
    public let queryService: QueryService
    public let notificationScheduler: NotificationScheduler
    @ObservationIgnored private let syncCoordinator = SyncCoordinator()

    public var isLoggedIn: Bool = false
    public var currentUser: SessionUser?
    public var isSyncing: Bool = false
    public var lastSyncError: String?
    public var pendingSyncCount: Int = 0
    public var lastSyncedAt: String?

    public var selectedTab: Int = {
        if CommandLine.arguments.contains("--tab=bills") { return 1 }
        if CommandLine.arguments.contains("--tab=cards") { return 2 }
        if CommandLine.arguments.contains("--tab=settings") { return 3 }
        return 0
    }()
    public var dashboardBills: [BillDisplayItem] = []
    public var dashboardHolders: [CardHolder] = []
    public var dashboardCurrency = "CNY"
    public var dashboardPrivacy = true
    public var dashboardRates: FxRates?
    public var dashboardAvailableCount: Int?
    public var dashboardReminders: [DashboardReminder] = []
    public var dashboardRemoteErrors: [String] = []
    public var isDashboardLoading = false
    public var dashboardLoadError: String?
    @ObservationIgnored private var dashboardRemoteTask: Task<Void, Never>?
    @ObservationIgnored private var dashboardRequestID = UUID()
    @ObservationIgnored private lazy var dashboardRemote = DashboardRemoteService(apiClient: apiClient)
    @ObservationIgnored private lazy var payablesService = PayablesRemoteService(apiClient: apiClient)

    public var summary: DashboardSummary?
    public var bills: [BillDisplayItem] = []
    /// 全量账单（不受状态 tab 过滤）：账单页「缺账单提醒」的最新期基线必须用它，
    /// 否则「待还」tab 里被过滤掉的已还最新期会让提醒误报。
    public var allBills: [BillDisplayItem] = []
    public var cards: [CardDisplayItem] = []
    public var selectedBillFilter: BillFilter = .unpaid
    public var billsSortMode: BillsSortMode = .nearestDue
    // 固定支出(周期应付)为在线数据：失败只降级提示，不影响本地账单。
    public var payables: [PayableItem] = []
    public var payablesError: String?

    // MARK: - Biometric Security
    public var isBiometricsEnabled: Bool {
        get {
            if UITestConfiguration.isEnabled { return false }
            return UserDefaults.standard.bool(forKey: "worldcredit_biometrics_enabled")
        }
        set {
            UserDefaults.standard.set(newValue, forKey: "worldcredit_biometrics_enabled")
        }
    }
    public var isLocked: Bool = false

    public init(
        dbManager: DatabaseManager? = nil,
        baseURL: URL = URL(string: "https://app.all-bill.com")!
    ) {
        let db: DatabaseManager
        #if DEBUG
        if UITestConfiguration.isEnabled {
            do {
                db = try DatabaseManager.file(at: UITestConfiguration.databaseURL)
            } catch {
                preconditionFailure("UI test database could not open: \(error)")
            }
        } else if let dbManager {
            db = dbManager
        } else {
            do {
                db = try DatabaseManager.defaultDatabase()
            } catch {
                db = (try? DatabaseManager.inMemory())!
            }
        }
        #else
        if let dbManager {
            db = dbManager
        } else {
            do {
                db = try DatabaseManager.defaultDatabase()
            } catch {
                // Fallback to in-memory if disk db fails
                db = (try? DatabaseManager.inMemory())!
            }
        }
        #endif
        self.dbManager = db
        let client: ApiClient
        #if DEBUG
        if UITestConfiguration.isEnabled {
            client = ApiClient(baseURL: URL(string: "https://ui-tests.invalid")!,
                               session: OfflineUITestNetworkSession(), token: "ui-test-session", useKeychain: false)
        } else {
            client = ApiClient(baseURL: baseURL)
        }
        #else
        client = ApiClient(baseURL: baseURL)
        #endif
        self.apiClient = client
        self.syncEngine = SyncEngine(dbManager: db, apiClient: client)
        self.paymentService = PaymentService(dbManager: db)
        self.billEditService = BillEditService(dbManager: db)
        self.cardEditService = CardEditService(dbManager: db)
        self.queryService = QueryService(dbManager: db)
        self.notificationScheduler = NotificationScheduler(dbManager: db)

        self.isLoggedIn = client.token != nil
        if UITestConfiguration.isEnabled { dashboardPrivacy = false }
        if self.isLoggedIn && isBiometricsEnabled {
            self.isLocked = true
        }
    }

    public func lock() {
        if isBiometricsEnabled && isLoggedIn {
            isLocked = true
        }
    }

    public func unlockWithBiometrics() async {
        guard isLocked else { return }
        let success = await BiometricAuthManager.shared.authenticate(reason: "解锁 WorldCredit 查看财务数据")
        if success {
            isLocked = false
        }
    }

    @discardableResult
    public func reloadData() async -> Bool {
        do {
            // WCDBG 临时打点：定位弹窗提交偶发超时，交付前移除
            let t0 = CFAbsoluteTimeGetCurrent()
            let sum = try await queryService.fetchDashboardSummary()
            let t1 = CFAbsoluteTimeGetCurrent()
            let bList = try await queryService.fetchBills(
                filter: selectedBillFilter,
                sortMode: billsSortMode
            )
            let t2 = CFAbsoluteTimeGetCurrent()
            // 缺账单提醒的全量基线：多一次本地查询（SQLite、小数据），失败随外层 catch。
            let allBillsList = try await queryService.fetchBills(filter: .all, sortMode: billsSortMode)
            let cList = try await queryService.fetchCards()
            let t3 = CFAbsoluteTimeGetCurrent()
            let dashboardList = try await queryService.fetchDashboardBills()
            let t4 = CFAbsoluteTimeGetCurrent()
            let holders = try await queryService.fetchHolders()
            let t5 = CFAbsoluteTimeGetCurrent()
            let ms: (Double, Double) -> Int = { Int(($1 - $0) * 1000) }
            print("[WCDBG] reload summary=\(ms(t0, t1))ms bills=\(ms(t1, t2))ms cards=\(ms(t2, t3))ms dashBills=\(ms(t3, t4))ms holders=\(ms(t4, t5))ms")

            let meta = try? await dbManager.dbWriter.read { db in
                (
                    try? SyncMeta.fetchOne(db, key: "last_synced_at")?.value,
                    try? MutationOutbox.fetchCount(db)
                )
            }

            self.summary = sum
            self.bills = bList
            self.allBills = allBillsList
            self.cards = cList
            self.dashboardBills = dashboardList
            self.dashboardHolders = holders
            self.dashboardLoadError = nil
            self.lastSyncedAt = meta?.0
            self.pendingSyncCount = meta?.1 ?? 0

            // 生成并更新 Apple Watch 快照
            NSLog("[WCDBG] reload WATCH-BEGIN")
            if let snapshot = try? await WatchSnapshotManager.shared.buildSnapshot(dbManager: dbManager) {
                NSLog("[WCDBG] reload WATCH-SNAP-OK")
                try? WatchSnapshotManager.shared.save(snapshot)
                WatchSyncCoordinator.shared.sendSnapshotToWatch(snapshot)
            }
            NSLog("[WCDBG] reload WATCH-DONE")
            #if DEBUG
            // 证据采集不得阻塞业务链路：放后台，失败也不影响 UI 测试主流程。
            // 证据采集不得阻塞业务链路：放后台，失败也不影响 UI 测试主流程。
            Task { await UITestConfiguration.recordMetadata() }
            #endif
            NSLog("[WCDBG] reload RETURN")
            return true
        } catch {
            dashboardLoadError = "本地数据加载失败：\(error.localizedDescription)"
            print("Failed to reload local data: \(error)")
            return false
        }
    }

    public func refreshDashboard() async {
        isDashboardLoading = dashboardBills.isEmpty
        defer { isDashboardLoading = false }
        _ = await reloadData()
        await refreshDashboardRemote()
    }

    public func refreshDashboardRemote() async {
        guard isLoggedIn, !UITestConfiguration.isEnabled else { return }
        let requestID = UUID()
        dashboardRequestID = requestID
        let credential = apiClient.token
        do {
            let user: SessionUser
            if let currentUser { user = currentUser }
            else { user = try await apiClient.fetchSessionUser() }
            guard dashboardRequestID == requestID, isLoggedIn, apiClient.token == credential else { return }
            currentUser = user
            let snapshot = await dashboardRemote.fetch(userId: user.id)
            guard dashboardRequestID == requestID, isLoggedIn, apiClient.token == credential,
                  currentUser?.id == user.id else { return }
            if let currency = snapshot.displayCurrency { dashboardCurrency = currency }
            if let privacy = snapshot.privacyMode { dashboardPrivacy = privacy }
            dashboardAvailableCount = snapshot.availableCount
            dashboardReminders = Array((snapshot.reminders ?? []).prefix(3))
            if let rates = snapshot.exchangeRates {
                dashboardRates = FxRates(base: rates.base, rates: rates.rates,
                                         timestamp: rates.timestamp, fetchedAt: rates.fetchedAt.timeIntervalSince1970 * 1000)
            } else { dashboardRates = nil }
            dashboardRemoteErrors = snapshot.failures
                .sorted { $0.key.rawValue < $1.key.rawValue }
                .map { "\($0.key.rawValue) 暂不可用：\($0.value.message)" }
        } catch {
            guard dashboardRequestID == requestID, apiClient.token == credential else { return }
            dashboardRemoteErrors = ["首页在线信息暂不可用：\(error.localizedDescription)"]
            dashboardAvailableCount = nil
            dashboardReminders = []
        }
    }

    /// 拉取固定支出列表；失败降级为提示文案，不抛出。
    public func refreshPayables() async {
        guard isLoggedIn, !UITestConfiguration.isEnabled else { return }
        do {
            let user: SessionUser
            if let currentUser { user = currentUser }
            else { user = try await apiClient.fetchSessionUser() }
            payables = try await payablesService.fetchPayables(userId: user.id)
            payablesError = nil
        } catch {
            payables = []
            payablesError = "固定支出暂不可用：\(error.localizedDescription)"
        }
    }

    /// 登记固定支出当期还款，返回成功后刷新列表。
    public func payPayable(_ item: PayableItem, amount: Double) async throws {
        _ = try await payablesService.pay(payableId: item.id, amount: amount)
        await refreshPayables()
    }

    public func savePayable(_ draft: PayableDraft, existing: PayableItem?) async throws {
        if let existing {
            _ = try await payablesService.update(payableId: existing.id, draft: draft)
        } else {
            let user: SessionUser
            if let currentUser { user = currentUser }
            else { user = try await apiClient.fetchSessionUser() }
            _ = try await payablesService.create(userId: user.id, draft: draft)
        }
        await refreshPayables()
    }

    public func deletePayable(_ item: PayableItem) async throws {
        try await payablesService.delete(payableId: item.id)
        await refreshPayables()
    }

    public func setDashboardPrivacy(_ enabled: Bool) async {
        dashboardPrivacy = enabled
        guard let user = currentUser else { return }
        let credential = apiClient.token
        do {
            _ = try await dashboardRemote.updatePreferences(userId: user.id, privacyMode: enabled)
        } catch {
            guard currentUser?.id == user.id, apiClient.token == credential else { return }
            dashboardRemoteErrors = ["隐私设置已在本次生效，云端保存失败：\(error.localizedDescription)"]
        }
    }

    public func payDashboardBills(_ ids: [String]) async throws -> Int {
        let count = try await paymentService.recordFullPayments(billIds: ids)
        await reloadData()
        do { try await notificationScheduler.rescheduleAll() }
        catch { lastSyncError = "还款已保存，提醒更新失败：\(error.localizedDescription)" }
        Task { await self.sync() }
        return count
    }

    @discardableResult
    public func sync() async -> Bool {
        do {
            try await syncCoordinator.perform { [self] in
                isSyncing = true
                lastSyncError = nil
                defer { isSyncing = false }
                do {
                    try await syncEngine.sync()
                    try await notificationScheduler.rescheduleAll()
                    guard await reloadData() else {
                        throw NSError(domain: "WorldCredit.Sync", code: 1,
                                      userInfo: [NSLocalizedDescriptionKey: "同步后刷新本地数据失败"])
                    }
                } catch {
                    lastSyncError = error.localizedDescription
                    await reloadData()
                    throw error
                }
            }
            return true
        } catch {
            return false
        }
    }

    public func login(email: String, password: String) async throws {
        let user = try await apiClient.loginWithPassword(email: email, password: password)
        self.currentUser = user
        self.isLoggedIn = true
        await sync()
    }

    /// 用 Google Sign-In 取到的 ID token 完成登录，状态迁移与密码登录一致。
    /// GoogleSignIn SDK 的交互留在 LoginView，此处不引入该依赖。
    public func loginWithGoogle(idToken: String) async throws {
        let user = try await apiClient.loginWithGoogle(idToken: idToken)
        self.currentUser = user
        self.isLoggedIn = true
        await sync()
    }

    public func logout() {
        let oldUserID = currentUser?.id
        dashboardRequestID = UUID()
        dashboardRemoteTask?.cancel()
        dashboardPrivacy = true
        dashboardCurrency = "CNY"
        dashboardRates = nil
        dashboardAvailableCount = nil
        dashboardReminders = []
        dashboardRemoteErrors = []
        if let oldUserID { Task { await dashboardRemote.clearCache(userId: oldUserID) } }
        PushNotificationManager.shared.unregisterCurrentToken()
        apiClient.token = nil
        self.isLoggedIn = false
        self.currentUser = nil
        self.isLocked = false
    }

    public func recordPayment(
        billId: String,
        amount: Double,
        paidAt: String? = nil,
        channel: String? = "手动还款",
        note: String? = nil
    ) async throws {
        NSLog("[WCDBG] pay ENTRY")
        let t0 = CFAbsoluteTimeGetCurrent()
        try await paymentService.recordPayment(
            billId: billId,
            amount: amount,
            paidAt: paidAt,
            channel: channel,
            note: note
        )
        NSLog("[WCDBG] pay SVC-OK")
        let t1 = CFAbsoluteTimeGetCurrent()
        // Refresh local UI immediately
        await reloadData()
        NSLog("[WCDBG] pay RELOAD-OK")
        let t2 = CFAbsoluteTimeGetCurrent()
        print("[WCDBG] pre-resched svc=\(Int((t1 - t0) * 1000))ms reload=\(Int((t2 - t1) * 1000))ms")
        do {
            try await notificationScheduler.rescheduleAll()
        } catch {
            lastSyncError = "本地修改已保存，提醒更新失败：\(error.localizedDescription)"
            print("提醒更新失败：\(error)")
        }
        let t3 = CFAbsoluteTimeGetCurrent()
        let ms: (Double, Double) -> Int = { Int(($1 - $0) * 1000) }
        print("[WCDBG] pay svc=\(ms(t0, t1))ms reload=\(ms(t1, t2))ms resched=\(ms(t2, t3))ms")

        // Background trigger sync if online
        Task {
            await self.sync()
        }
    }

    public func setBillAmountOverride(billId: String, amount: Double?) async throws {
        try await billEditService.setBillAmountOverride(billId: billId, amount: amount)
        await reloadData()
        do {
            try await notificationScheduler.rescheduleAll()
        } catch {
            lastSyncError = "本地修改已保存，提醒更新失败：\(error.localizedDescription)"
            print("提醒更新失败：\(error)")
        }
        Task {
            await self.sync()
        }
    }

    public func updateCard(cardId: String, input: CardUpdateInput) async throws {
        try await cardEditService.updateCard(cardId: cardId, input: input)
        await reloadData()
        Task {
            await self.sync()
        }
    }

    public func loadDemoData(onlyIfNeeded: Bool = false) async {
        let now = ISO8601DateFormatter().string(from: Date())
        // 演示账单的还款日相对当天生成：固定历史日期会随真实日期漂移，
        // 让「逾期 / 待还」状态和依赖它的断言失去确定性。字符串在进 DB 写闭包前算好，
        /// 闭包是 Sendable 的，捕获局部函数/DateFormatter 会编译失败。
        let df = DateFormatter()
        df.dateFormat = "yyyy-MM-dd"
        df.timeZone = TimeZone(identifier: "Asia/Shanghai")
        let dueSoon = df.string(from: Date().addingTimeInterval(3 * 86400))
        let overdueDue = df.string(from: Date().addingTimeInterval(-31 * 86400))
        do {
            try await dbManager.dbWriter.write { db in
                if onlyIfNeeded, try SyncMeta.fetchOne(db, key: "ui_test_seeded") != nil {
                    return
                }
                let holder = CardHolder(
                    id: "holder-me",
                    createdBy: "user-1",
                    managedBy: "user-1",
                    name: "自用",
                    createdAt: now
                )
                try holder.save(db)
                // 仅有已结清账单的持卡人：锁「筛选选项不能只来自待还账单」的回归
                let holder2 = CardHolder(
                    id: "holder-wang",
                    createdBy: "user-1",
                    managedBy: "user-1",
                    name: "王五",
                    createdAt: now
                )
                try holder2.save(db)

                let bank1 = Bank(id: "bank-cmb", name: "招商银行", shortName: "招行")
                let bank2 = Bank(id: "bank-icbc", name: "工商银行", shortName: "工行")
                let bank3 = Bank(id: "bank-boc", name: "中国银行", shortName: "中行")
                let bank4 = Bank(id: "bank-ccb", name: "建设银行", shortName: "建行")
                try bank1.save(db)
                try bank2.save(db)
                try bank3.save(db)
                try bank4.save(db)

                let prod1 = CardProduct(
                    id: "prod-cmb-1",
                    bankId: "bank-cmb",
                    bankName: "招商银行",
                    cardName: "经典白金卡",
                    paymentDueType: .fixed,
                    paymentDueValue: 25
                )
                let prod2 = CardProduct(
                    id: "prod-icbc-1",
                    bankId: "bank-icbc",
                    bankName: "工商银行",
                    cardName: "工银大莱卡",
                    paymentDueType: .fixed,
                    paymentDueValue: 26
                )
                let prod3 = CardProduct(
                    id: "prod-boc-1",
                    bankId: "bank-boc",
                    bankName: "中国银行",
                    cardName: "长城世界卡",
                    paymentDueType: .fixed,
                    paymentDueValue: 28
                )
                try prod1.save(db)
                try prod2.save(db)
                try prod3.save(db)

                let prod4 = CardProduct(
                    id: "prod-ccb-1",
                    bankId: "bank-ccb",
                    bankName: "建设银行",
                    cardName: "龙卡全球支付卡",
                    paymentDueType: .fixed,
                    paymentDueValue: 20
                )
                try prod4.save(db)

                let card1 = CreditCard(
                    id: "card-cmb-1",
                    holderId: "holder-me",
                    cardProductId: "prod-cmb-1",
                    billingDay: 5,
                    cardNumberLast4: "8888",
                    creditLimit: 60000.0,
                    createdAt: now
                )
                let card2 = CreditCard(
                    id: "card-icbc-1",
                    holderId: "holder-me",
                    cardProductId: "prod-icbc-1",
                    billingDay: 1,
                    cardNumberLast4: "6666",
                    creditLimit: 50000.0,
                    createdAt: now
                )
                let card3 = CreditCard(
                    id: "card-boc-1",
                    holderId: "holder-me",
                    cardProductId: "prod-boc-1",
                    billingDay: 10,
                    cardNumberLast4: "1234",
                    creditLimit: 100000.0,
                    createdAt: now
                )
                try card1.save(db)
                try card2.save(db)
                try card3.save(db)

                let card4 = CreditCard(
                    id: "card-ccb-1",
                    holderId: "holder-wang",
                    cardProductId: "prod-ccb-1",
                    billingDay: 15,
                    cardNumberLast4: "2222",
                    creditLimit: 30000.0,
                    createdAt: now
                )
                try card4.save(db)

                // 账单 1：待还账单
                let bill1 = Bill(
                    id: "bill-cmb-202610",
                    cardId: "card-cmb-1",
                    billMonth: "2026-10",
                    statementDate: "2026-10-05",
                    billAmount: 12800.50,
                    minPayment: 1280.0,
                    dueDate: dueSoon,
                    status: "unpaid",
                    createdAt: now
                )
                // 账单 2：逾期账单
                let bill2 = Bill(
                    id: "bill-icbc-202609",
                    cardId: "card-icbc-1",
                    billMonth: "2026-09",
                    statementDate: "2026-09-01",
                    billAmount: 5430.00,
                    minPayment: 543.0,
                    dueDate: overdueDue,
                    status: "unpaid",
                    createdAt: now
                )
                // 账单 3：已结清账单
                let bill3 = Bill(
                    id: "bill-boc-202609",
                    cardId: "card-boc-1",
                    billMonth: "2026-09",
                    statementDate: "2026-09-10",
                    billAmount: 8900.00,
                    minPayment: 890.0,
                    dueDate: "2026-09-28",
                    status: "paid",
                    createdAt: now
                )
                try bill1.save(db)
                try bill2.save(db)
                try bill3.save(db)

                // 账单 4：王五名下唯一账单（已结清）——待还 tab 下该持卡人无任何账单
                let bill4 = Bill(
                    id: "bill-ccb-202609",
                    cardId: "card-ccb-1",
                    billMonth: "2026-09",
                    statementDate: "2026-09-15",
                    billAmount: 2600.00,
                    minPayment: 260.0,
                    dueDate: overdueDue,
                    status: "paid",
                    createdAt: now
                )
                try bill4.save(db)

                // 王五那期的结清 payment
                let pay4 = Payment(
                    id: "pay-ccb-full",
                    billId: "bill-ccb-202609",
                    amount: 2600.00,
                    paidAt: overdueDue,
                    channel: "手机银行",
                    note: "结清",
                    idempotencyKey: "init-key-4",
                    createdAt: now
                )
                try pay4.save(db)

                // 账单 5：中行卡的已结清历史期——锁「最大免息期不展示历史账单」的回归
                let bill5 = Bill(
                    id: "bill-boc-202608",
                    cardId: "card-boc-1",
                    billMonth: "2026-08",
                    statementDate: "2026-08-10",
                    billAmount: 7500.00,
                    minPayment: 750.0,
                    dueDate: overdueDue,
                    status: "paid",
                    createdAt: now
                )
                try bill5.save(db)
                let pay5 = Payment(
                    id: "pay-boc-202608",
                    billId: "bill-boc-202608",
                    amount: 7500.00,
                    paidAt: overdueDue,
                    channel: "手机银行",
                    note: "结清",
                    idempotencyKey: "init-key-5",
                    createdAt: now
                )
                try pay5.save(db)

                // 为账单 3 写入结清的 payment
                let pay3 = Payment(
                    id: "pay-boc-full",
                    billId: "bill-boc-202609",
                    amount: 8900.00,
                    paidAt: "2026-09-20",
                    channel: "手机银行",
                    note: "结清",
                    idempotencyKey: "init-key",
                    createdAt: now
                )
                try pay3.save(db)
                if onlyIfNeeded {
                    try SyncMeta(key: "ui_test_seeded", value: "1").save(db)
                }
            }
            self.isLoggedIn = true
            await reloadData()
        } catch {
            print("Failed to load demo data: \(error)")
        }
    }
}
