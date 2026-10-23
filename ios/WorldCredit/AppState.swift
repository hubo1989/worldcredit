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

    public var summary: DashboardSummary?
    public var bills: [BillDisplayItem] = []
    public var cards: [CardDisplayItem] = []
    public var selectedBillFilter: BillFilter = .unpaid

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
            let sum = try await queryService.fetchDashboardSummary()
            let bList = try await queryService.fetchBills(filter: selectedBillFilter)
            let cList = try await queryService.fetchCards()

            let meta = try? await dbManager.dbWriter.read { db in
                (
                    try? SyncMeta.fetchOne(db, key: "last_synced_at")?.value,
                    try? MutationOutbox.fetchCount(db)
                )
            }

            self.summary = sum
            self.bills = bList
            self.cards = cList
            self.lastSyncedAt = meta?.0
            self.pendingSyncCount = meta?.1 ?? 0

            // 生成并更新 Apple Watch 快照
            if let snapshot = try? await WatchSnapshotManager.shared.buildSnapshot(dbManager: dbManager) {
                try? WatchSnapshotManager.shared.save(snapshot)
                WatchSyncCoordinator.shared.sendSnapshotToWatch(snapshot)
            }
            #if DEBUG
            await UITestConfiguration.recordMetadata()
            #endif
            return true
        } catch {
            print("Failed to reload local data: \(error)")
            return false
        }
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
        try await paymentService.recordPayment(
            billId: billId,
            amount: amount,
            paidAt: paidAt,
            channel: channel,
            note: note
        )
        // Refresh local UI immediately
        await reloadData()
        do {
            try await notificationScheduler.rescheduleAll()
        } catch {
            lastSyncError = "本地修改已保存，提醒更新失败：\(error.localizedDescription)"
            print("提醒更新失败：\(error)")
        }

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

                let bank1 = Bank(id: "bank-cmb", name: "招商银行", shortName: "招行")
                let bank2 = Bank(id: "bank-icbc", name: "工商银行", shortName: "工行")
                let bank3 = Bank(id: "bank-boc", name: "中国银行", shortName: "中行")
                try bank1.save(db)
                try bank2.save(db)
                try bank3.save(db)

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

                // 账单 1：待还账单
                let bill1 = Bill(
                    id: "bill-cmb-202610",
                    cardId: "card-cmb-1",
                    billMonth: "2026-10",
                    statementDate: "2026-10-05",
                    billAmount: 12800.50,
                    minPayment: 1280.0,
                    dueDate: "2026-10-25",
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
                    dueDate: "2026-09-26",
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
