import Foundation
import SwiftUI
import Observation
import WorldCreditCore

@MainActor
@Observable
public final class AppState {
    public let dbManager: DatabaseManager
    /// 仅测试构造器注入 mock 会替换实例；生产路径构造后不变。
    @ObservationIgnored public private(set) var apiClient: ApiClient
    /// 登出时的附加清理钩子。GoogleSignIn 依赖不能进 AppState（见 loginWithGoogle 注释），
    /// 由 App 入口注入 `GIDSignIn.sharedInstance.signOut()`，防止 Google 身份跨 app 会话存活。
    @ObservationIgnored public var sessionIdentityCleanup: (@Sendable () -> Void)?
    public private(set) var syncEngine: SyncEngine
    public let paymentService: PaymentService
    public let billEditService: BillEditService
    public let cardEditService: CardEditService
    public let queryService: QueryService
    public let notificationScheduler: NotificationScheduler
    @ObservationIgnored private let syncCoordinator = SyncCoordinator()
    @ObservationIgnored private var accountCleanupTask: Task<Void, Error>?
    @ObservationIgnored private var accountTransitionTask: Task<Void, Error>?
    @ObservationIgnored private var watchSnapshots: WatchSnapshotManager = .shared
    @ObservationIgnored private var saveWatchSnapshot: @MainActor (WatchSnapshot) throws -> Void = {
        try WatchSnapshotManager.shared.save($0)
    }
    @ObservationIgnored private var sendWatchSnapshot: @MainActor (WatchSnapshot) throws -> Void = {
        WatchSyncCoordinator.shared.sendSnapshotToWatch($0)
    }
    #if DEBUG
    /// 用于在读库开始前暂停任务，验证换号与取消的竞态。
    @ObservationIgnored var beforeLocalReload: (@MainActor () async -> Void)?
    #endif
    /// 测试注入点：替换清库行为验证登出链路；生产路径为 nil 时走 dbManager.clearUserData()。
    @ObservationIgnored private var clearUserDataHandler: (@Sendable () async throws -> Void)?

    public var isLoggedIn: Bool = false
    public var currentUser: SessionUser?
    public var isSyncing: Bool = false
    /// Gmail 分轮拉取在迹标记：防「查看邮箱」连点重入
    public var isGmailSyncing: Bool = false
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
    public var dashboardRates: FxRates? {
        didSet { invalidateBillsPresentation() }
    }
    public var dashboardAvailableCount: Int?
    public var dashboardReminders: [DashboardReminder] = []
    public var dashboardRemoteErrors: [String] = []
    public var isDashboardLoading = false
    public var dashboardLoadError: String?
    @ObservationIgnored private var dashboardRemoteTask: Task<Void, Never>?
    @ObservationIgnored private var dashboardRequestID = UUID()
    @ObservationIgnored private let refreshState = SessionDataRefreshState()
    @ObservationIgnored private var sessionEpoch: UUID {
        get { refreshState.sessionEpoch }
        set { _ = refreshState.advanceSession() }
    }
    @ObservationIgnored private lazy var dashboardRemote = DashboardRemoteService(apiClient: apiClient)
    @ObservationIgnored private lazy var payablesService = PayablesRemoteService(apiClient: apiClient)

    public var summary: DashboardSummary?
    public var bills: [BillDisplayItem] = []
    /// 全量账单（不受状态 tab 过滤）：账单页「缺账单提醒」的最新期基线必须用它，
    /// 否则「待还」tab 里被过滤掉的已还最新期会让提醒误报。
    public var allBills: [BillDisplayItem] = [] {
        didSet { invalidateBillsPresentation() }
    }
    public var cards: [CardDisplayItem] = [] {
        didSet { invalidateBillsPresentation() }
    }
    public var selectedBillFilter: BillFilter = .unpaid
    public var billsSortMode: BillsSortMode = .nearestDue
    // 固定支出(周期应付)为在线数据：失败只降级提示，不影响本地账单。
    public var payables: [PayableItem] = [] {
        didSet { invalidateBillsPresentation() }
    }
    @ObservationIgnored private var billsPresentationCache = BillsPresentationCache()
    private var billsDataRevision = UUID()

    private func invalidateBillsPresentation() {
        billsPresentationCache.invalidate()
        billsDataRevision = UUID()
    }

    public func billsPresentation(holderId: String?, bankName: String?) -> BillsPresentation {
        // 观察 revision，缓存本身不发布状态，避免在 body 求值时反向触发更新。
        _ = billsDataRevision
        let filter = BillsPresentationFilter(status: selectedBillFilter, holderId: holderId, bankName: bankName)
        let today = Date()
        let bills = allBills
        let cards = cards
        let payables = payables
        let rates = dashboardRates
        return billsPresentationCache.value(for: filter, today: today) {
            BillsPresentation(bills: bills, cards: cards, payables: payables,
                              rates: rates, filter: filter, today: today)
        }
    }
    public var payablesError: String?
    /// 盘库打不开、退到内存库时的可恢复提示（数据不持久化），由 UI 展示。
    public var dbInitWarning: String?

    // MARK: - Theme Mode
    public var themeMode: AppThemeMode = {
        let saved = UserDefaults.standard.string(forKey: "worldcredit_theme_mode") ?? AppThemeMode.system.rawValue
        return AppThemeMode(rawValue: saved) ?? .system
    }() {
        didSet {
            UserDefaults.standard.set(themeMode.rawValue, forKey: "worldcredit_theme_mode")
        }
    }

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
        baseURL: URL = URL(string: "https://app.all-bill.com")!,
        apiClient injectedClient: ApiClient? = nil
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
                db = Self.fallbackInMemoryDatabase(originalError: error)
                dbInitWarning = "本地数据库打开失败，已启用临时内存库：本次数据不会持久化"
            }
        }
        #else
        if let dbManager {
            db = dbManager
        } else {
            do {
                db = try DatabaseManager.defaultDatabase()
            } catch {
                // 盘库失败退到内存库（可恢复：数据不持久化但功能可用）
                db = Self.fallbackInMemoryDatabase(originalError: error)
                dbInitWarning = "本地数据库打开失败，已启用临时内存库：本次数据不会持久化"
            }
        }
        #endif
        self.dbManager = db
        let client: ApiClient
        if let injectedClient {
            client = injectedClient
        } else {
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
        }
        self.apiClient = client
        self.syncEngine = SyncEngine(dbManager: db, apiClient: client)
        self.paymentService = PaymentService(dbManager: db)
        self.billEditService = BillEditService(dbManager: db)
        self.cardEditService = CardEditService(dbManager: db)
        self.queryService = QueryService(dbManager: db)
        self.notificationScheduler = NotificationScheduler(dbManager: db)
        self.clearUserDataHandler = { [db] in try await db.clearUserData() }

        self.isLoggedIn = client.token != nil
        if UITestConfiguration.isEnabled { dashboardPrivacy = false }
        if self.isLoggedIn && isBiometricsEnabled {
            self.isLocked = true
        }

        // 清除旧版本全局未隔离的遗留缓存 key；已登录冷启动保留当前账号文件快照供离线兜底。
        Self.clearLegacyPayablesCaches(preserveCurrentOwnerSnapshot: self.isLoggedIn)

        if UITestConfiguration.isEnabled {
            self.payables = Self.generateDemoPayables()
        } else {
            self.payables = []
        }
    }

    /// 测试辅助构造器：支持注入 MockNetworkSession 和文件路径数据库。
    /// 用于端到端验证 logout/login 会话切换安全。
    #if DEBUG
    public convenience init(
        dbManager: DatabaseManager,
        apiClient: ApiClient,
        watchSnapshots: WatchSnapshotManager = .shared,
        sendWatchSnapshot: @escaping @MainActor (WatchSnapshot) throws -> Void = { _ in },
        clearUserData: (@Sendable () async throws -> Void)? = nil
    ) {
        self.init(dbManager: dbManager, apiClient: apiClient)
        self.watchSnapshots = watchSnapshots
        self.saveWatchSnapshot = { _ in }
        self.sendWatchSnapshot = sendWatchSnapshot
        if let clearUserData { self.clearUserDataHandler = clearUserData }
    }

    public convenience init(
        dbURL: URL,
        networkSession: some NetworkSession,
        baseURL: URL = URL(string: "https://app.all-bill.com")!
    ) throws {
        let db = try DatabaseManager.file(at: dbURL)
        let client = ApiClient(baseURL: baseURL, session: networkSession, token: nil, useKeychain: false)
        self.init(dbManager: db, baseURL: baseURL, apiClient: client)
    }
    #endif

    /// 盘库不可用时的内存库兜底。进程内 SQLite 也创建失败属环境级故障，
    /// 所有服务都依赖 DB，无可恢复 UI 可退——带原因终止，而不是裸 `!` 崩在隐晦位置。
    private static func fallbackInMemoryDatabase(originalError: Error) -> DatabaseManager {
        do {
            return try DatabaseManager.inMemory()
        } catch {
            fatalError("本地数据库与内存兜底库均创建失败（不可恢复）：disk=\(originalError), memory=\(error)")
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

    /// 一次会话只做一次首屏加载；切页和回到前台都复用内存快照。
    public func loadInitialDataIfNeeded() async {
        await refreshState.loadInitialIfNeeded(
            isLoggedIn: { self.isLoggedIn },
            initialLoad: { epoch in
                guard await self.reloadData() else { return false }
                guard self.refreshState.isCurrent(epoch, isLoggedIn: self.isLoggedIn) else { return false }
                self.restorePayablesSnapshotIfNeeded()
                guard !UITestConfiguration.isEnabled,
                      !CommandLine.arguments.contains("--demo-mode") else { return true }
                await self.sync()
                guard self.refreshState.isCurrent(epoch, isLoggedIn: self.isLoggedIn) else { return false }
                await self.refreshPayables()
                guard self.refreshState.isCurrent(epoch, isLoggedIn: self.isLoggedIn) else { return false }
                await self.refreshDashboardRemote()
                return true
            },
            dayRefresh: { epoch, now in
                await self.performBusinessDayRefresh(epoch: epoch, now: now)
            }
        )
    }

    /// 跨上海自然日时只刷新本地日期派生值和应付倒计时，不发起服务器同步。
    public func refreshForBusinessDayIfNeeded(now: Date = Date()) async {
        await refreshState.refreshBusinessDayIfNeeded(
            isLoggedIn: { self.isLoggedIn },
            now: now
        ) { epoch, day in
            await self.performBusinessDayRefresh(epoch: epoch, now: day)
        }
    }

    private func performBusinessDayRefresh(epoch: UUID, now: Date) async {
        guard await reloadData(today: now),
              refreshState.isCurrent(epoch, isLoggedIn: isLoggedIn) else { return }
        if !payables.isEmpty {
            payables = payables.map { Self.recalculatePayableStatus($0, today: now) }
        }
    }

    /// 按上海午夜唤醒；设备本地午夜通知无法覆盖海外时区。
    public func observeBusinessDayChanges() async {
        guard isLoggedIn else { return }
        let epoch = sessionEpoch
        await loadInitialDataIfNeeded()
        while refreshState.isCurrent(epoch, isLoggedIn: isLoggedIn) {
            await refreshForBusinessDayIfNeeded()
            guard refreshState.isCurrent(epoch, isLoggedIn: isLoggedIn) else { return }
            do {
                try await Task.sleep(for: .seconds(BillingDateCalculator.secondsUntilNextBusinessMidnight()))
            } catch { return }
        }
    }

    private func restorePayablesSnapshotIfNeeded() {
        guard payables.isEmpty,
              !UITestConfiguration.isEnabled,
              !CommandLine.arguments.contains("--demo-mode"),
              let userId = currentUser?.id ?? UserDefaults.standard.string(forKey: Self.payablesOwnerKey),
              let cached = Self.loadPayablesSnapshot(userId: userId) else { return }
        payables = cached.map { Self.recalculatePayableStatus($0) }
    }

    @discardableResult
    public func reloadData(today: Date = Date()) async -> Bool {
        guard isLoggedIn, !Task.isCancelled else { return false }
        let epoch = sessionEpoch
        #if DEBUG
        await beforeLocalReload?()
        #endif
        guard isLoggedIn, sessionEpoch == epoch, !Task.isCancelled else { return false }
        do {
            let sum = try await queryService.fetchDashboardSummary(today: today)
            // 只读一次全量账单，筛选与模式切换在内存完成。
            let allBillsList = try await queryService.fetchBills(filter: .all, today: today)
            let bList = allBillsList.filter { item in
                switch selectedBillFilter {
                case .unpaid: return item.bill.status != "paid" && item.remainingAmount > 0.01
                case .paid: return item.bill.status == "paid" && item.remainingAmount <= 0.01
                case .all: return true
                }
            }
            let cList = try await queryService.fetchCards(today: today)
            let dashboardList = try await queryService.fetchDashboardBills(today: today)
            let holders = try await queryService.fetchHolders()

            // 读失败只保留旧值，不把同步状态静默重置为「0 待同步/从未同步」。
            let meta: (String?, Int)? = try? await dbManager.dbWriter.read { db in
                (
                    try SyncMeta.fetchOne(db, key: "last_synced_at")?.value,
                    try MutationOutbox.fetchCount(db)
                )
            }
            guard isLoggedIn, sessionEpoch == epoch, !Task.isCancelled else { return false }

            self.summary = sum
            self.bills = bList
            self.allBills = allBillsList
            self.cards = cList
            self.dashboardBills = dashboardList
            self.dashboardHolders = holders
            self.dashboardLoadError = nil
            self.refreshState.markLoaded(today: today)
            if let meta {
                self.lastSyncedAt = meta.0
                self.pendingSyncCount = meta.1
            }

            // 生成并更新 Apple Watch 快照（复用本次已查数据，避免重复查询）
            if let snapshot = try? await watchSnapshots.buildSnapshot(
                summary: sum, bills: bList, cards: cList, today: today) {
                // buildSnapshot 是 await 边界；换号后不可把前账号快照写盘或发给手表。
                guard isLoggedIn, sessionEpoch == epoch, !Task.isCancelled else { return false }
                try? saveWatchSnapshot(snapshot)
                try? sendWatchSnapshot(snapshot)
            }
            #if DEBUG
            // 证据采集不得阻塞业务链路：放后台，失败也不影响 UI 测试主流程。
            Task { await UITestConfiguration.recordMetadata() }
            #endif
            return true
        } catch {
            guard isLoggedIn, sessionEpoch == epoch, !Task.isCancelled else { return false }
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
        // 把在途请求登记到 dashboardRemoteTask：logout() 的 cancel() 才能真正取消，
        // 而不是只靠 requestID/token 守卫丢弃结果。
        let task = Task {
            await self.performDashboardRemoteFetch(requestID: requestID, credential: credential)
        }
        dashboardRemoteTask = task
        await task.value
    }

    private func performDashboardRemoteFetch(requestID: UUID, credential: String?) async {
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

    /// 拉取固定支出列表；失败降级为缓存或兜底数据，不抛出异常阻塞界面。
    // MARK: - Payables Cache & Recalculation Helpers
    /// 敏感财务快照不用 UserDefaults（未加密 plist 随备份导出）：
    /// 改存 Application Support 下带 NSFileProtectionComplete 的专属文件。
    /// 快照归属记录：401 会话过期后直接换号登录不经过 logout（currentUser 已为 nil），
    /// per-user 文件只能靠 owner 记录定位清理。
    private static let payablesOwnerKey = "worldcredit_cached_payables_owner"

    private static var payablesCacheDirectory: URL? {
        let fm = FileManager.default
        guard let base = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else { return nil }
        let dir = base.appendingPathComponent("PayablesCache", isDirectory: true)
        do {
            try fm.createDirectory(at: dir, withIntermediateDirectories: true)
            return dir
        } catch { return nil }
    }

    private static func payablesCacheURL(userId: String) -> URL? {
        payablesCacheDirectory?.appendingPathComponent("\(userId).json")
    }

    /// 快照写入（原子落盘 + .completeFileProtection）。
    private static func savePayablesSnapshot(_ items: [PayableItem], userId: String) {
        guard let url = payablesCacheURL(userId: userId),
              let data = try? JSONEncoder().encode(items) else { return }
        try? data.write(to: url, options: [.atomic, .completeFileProtection])
        UserDefaults.standard.set(userId, forKey: payablesOwnerKey)
    }

    private static func loadPayablesSnapshot(userId: String) -> [PayableItem]? {
        guard let url = payablesCacheURL(userId: userId),
              let data = try? Data(contentsOf: url),
              let items = try? JSONDecoder().decode([PayableItem].self, from: data),
              !items.isEmpty else { return nil }
        return items
    }

    public static func payablesCacheKey(userId: String) -> String {
        "worldcredit_cached_payables_\(userId)"
    }

    /// 清理旧版本全局未隔离的遗留缓存 key（混淆 key 与明文 key 都清）。
    /// login/loginWithGoogle/init/logout 共用，保证换号/冷启动路径不残留前任用户快照。
    public static func clearLegacyPayablesCaches(preserveCurrentOwnerSnapshot: Bool = false) {
        let defaults = UserDefaults.standard
        // 旧版全局明文/混淆 key
        defaults.removeObject(forKey: "worldcredit_cached_payables")
        defaults.removeObject(forKey: "worldcredit_cached_payables")
        if let owner = defaults.string(forKey: payablesOwnerKey) {
            defaults.removeObject(forKey: payablesCacheKey(userId: owner))
            if !preserveCurrentOwnerSnapshot {
                if let url = payablesCacheURL(userId: owner) {
                    try? FileManager.default.removeItem(at: url)
                }
                defaults.removeObject(forKey: payablesOwnerKey)
            }
        }
        // 前缀扫清：不依赖 owner 完整性
        defaults.dictionaryRepresentation().keys
            .filter { $0.hasPrefix("worldcredit_cached_payables_") }
            .forEach { defaults.removeObject(forKey: $0) }
    }

    public static func recalculatePayableStatus(_ item: PayableItem, today: Date = Date()) -> PayableItem {
        let cal = BillingDateCalculator.businessCalendar
        let parts = item.dueDate.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return item }
        let comp = DateComponents(year: parts[0], month: parts[1], day: parts[2])
        guard let targetDate = cal.date(from: comp) else { return item }
        let diff = BillingDateCalculator.diffInCalendarDays(target: targetDate, today: today)
        let status: PayableStatus
        if item.isSettled {
            status = .paid
        } else if diff < 0 {
            status = .overdue
        } else {
            status = .unpaid
        }
        return PayableItem(
            id: item.id,
            createdBy: item.createdBy,
            name: item.name,
            category: item.category,
            amount: item.amount,
            currency: item.currency,
            dueDay: item.dueDay,
            holderId: item.holderId,
            note: item.note,
            bankAccount: item.bankAccount,
            period: item.period,
            dueDate: item.dueDate,
            daysUntilDue: diff,
            paidAmount: item.paidAmount,
            status: status
        )
    }

    /// 服务端判定会话失效（401）时落地到未登录态：本地 DB 保留，
    /// 用户重新登录后 sync 自动恢复数据。
    /// 注意不要清 Keychain——token 本身已失效，删除操作无意义且可能与在途请求竞态。
    private func handleSessionExpired() {
        guard isLoggedIn else { return }
        let expiredUserID = currentUser?.id
        sessionEpoch = UUID()
        dashboardRequestID = UUID()
        dashboardRemoteTask?.cancel()
        isLoggedIn = false
        currentUser = nil
        isSyncing = false
        summary = nil
        bills = []
        allBills = []
        cards = []
        dashboardBills = []
        dashboardHolders = []
        dashboardRates = nil
        dashboardAvailableCount = nil
        dashboardReminders = []
        dashboardRemoteErrors = []
        payables = []
        payablesError = nil
        lastSyncError = nil
        // 401 会话过期不走完整 logout：per-user 快照靠 owner 记录在这里补清，
        // 否则下一个账号直接 login 时前任财务快照残留磁盘
        if let expiredUserID {
            if let url = Self.payablesCacheURL(userId: expiredUserID) {
                try? FileManager.default.removeItem(at: url)
            }
            UserDefaults.standard.removeObject(forKey: Self.payablesCacheKey(userId: expiredUserID))
        }
        Self.clearLegacyPayablesCaches()
        // 引擎失效防止在途请求以旧会话写回；本地 SQLite 不清（重登后 pull 恢复）。
        syncEngine.invalidateSession()
        syncEngine = SyncEngine(dbManager: dbManager, apiClient: apiClient)
    }

    /// access token 过期（401）时的处理：先尝试静默续期（refresh token 一次性轮换），
    /// 成功则重放原操作；refresh token 也失效才落地到登录页。
    /// 返回 true = 已续期可重试，false = 已切回登录态。
    private func trySilentRefresh() async -> Bool {
        guard apiClient.refreshToken != nil else {
            handleSessionExpired()
            return false
        }
        do {
            let user = try await apiClient.refreshSession()
            currentUser = user
            isLoggedIn = true
            return true
        } catch {
            handleSessionExpired()
            return false
        }
    }

    public func refreshPayables() async {
        // 演示模式（--demo-mode）与 UI 测试都不拉在线固定支出：
        // 演示下 fetchSessionUser 必然失败，会污染特意清空的干净演示状态
        guard isLoggedIn, !UITestConfiguration.isEnabled,
              !CommandLine.arguments.contains("--demo-mode") else { return }
        let epoch = sessionEpoch
        let token = apiClient.token
        // 会话级 401（Keychain 恢复中/token 过期）不是网络降级：不进入 payablesError
        // 降级横幅误导用户；静默跳过，待 sync()/重新登录后自然恢复
        guard token != nil else { return }
        // catch 分支的缓存兑底 key 依赖 userId；冷启动 currentUser 尚为 nil 且离线时
        // fetchSessionUser 必败，用持久化的 lastUserId 兑底（否则离线永远看不到本地快照）
        var fallbackUserId = currentUser?.id
            ?? UserDefaults.standard.string(forKey: Self.payablesOwnerKey)
        do {
            let user: SessionUser
            if let currentUser { user = currentUser }
            else { user = try await apiClient.fetchSessionUser() }
            guard sessionEpoch == epoch, apiClient.token == token else { return }
            currentUser = user
            fallbackUserId = user.id

            let items = try await payablesService.fetchPayables(userId: user.id)
            guard sessionEpoch == epoch, apiClient.token == token else { return }

            payables = items
            payablesError = nil

            // 空结果 = 用户删空了固定支出：移除快照（否则「删空后重启+离线」会复活已删条目）；
            // 服务端瞬时异常返回空列表的窗口极窄且下次在线刷新即自愈，不值得为它保留陈旧快照。
            // 变化才写盘：高频路径避免重复序列化与磁盘写入。
            if items.isEmpty {
                if let url = Self.payablesCacheURL(userId: user.id) {
                    try? FileManager.default.removeItem(at: url)
                }
                UserDefaults.standard.removeObject(forKey: Self.payablesCacheKey(userId: user.id))
            } else if let existing = Self.loadPayablesSnapshot(userId: user.id), existing == items {
                // 内容未变，只刷新 owner 归属
                UserDefaults.standard.set(user.id, forKey: Self.payablesOwnerKey)
            } else {
                Self.savePayablesSnapshot(items, userId: user.id)
            }
        } catch is CancellationError {
            return
        } catch let urlError as URLError where urlError.code == .cancelled {
            // 下拉刷新松手/离页时系统取消任务：不是故障，不写降级横幅
            return
        } catch {
            guard sessionEpoch == epoch, apiClient.token == token else { return }
            // 401 = access token 过期：先静默续期，成功则重拉；续期失败回登录页
            if let nsError = error as NSError?, nsError.code == 401 {
                if await trySilentRefresh() {
                    await refreshPayables()
                }
                return
            }
            self.payablesError = error.localizedDescription

            // 网络失败时优先保留内存中已有的数据；若内存为空则尝试读取本用户的有效本地快照并重算倒计时
            if payables.isEmpty, let userId = fallbackUserId,
               let cached = Self.loadPayablesSnapshot(userId: userId) {
                payables = cached.map { Self.recalculatePayableStatus($0) }
            }
        }
    }

    /// 仅供演示模式和 UI 测试使用的虚拟示例数据（杜绝真实生产数据和内部真实持卡人信息泄露）
    public static func generateDemoPayables(today: Date = Date()) -> [PayableItem] {
        let cal = BillingDateCalculator.businessCalendar
        let currentYear = cal.component(.year, from: today)
        let currentMonth = cal.component(.month, from: today)
        let currentDay = cal.component(.day, from: today)

        func makeItem(
            id: String,
            name: String,
            category: PayableCategory,
            amount: Double,
            dueDay: Int,
            holderId: String? = nil,
            note: String? = nil,
            bankAccount: String? = nil
        ) -> PayableItem {
            var targetYear = currentYear
            var targetMonth = currentMonth
            if currentDay > dueDay {
                targetMonth += 1
                if targetMonth > 12 {
                    targetMonth = 1
                    targetYear += 1
                }
            }

            let period = String(format: "%04d-%02d", targetYear, targetMonth)
            let comp = DateComponents(year: targetYear, month: targetMonth, day: dueDay)
            let targetDate = cal.date(from: comp) ?? today
            let targetDueDateStr = String(format: "%04d-%02d-%02d", targetYear, targetMonth, dueDay)
            let diff = BillingDateCalculator.diffInCalendarDays(target: targetDate, today: today)

            return PayableItem(
                id: id,
                createdBy: "demo-user-id",
                name: name,
                category: category,
                amount: amount,
                currency: "CNY",
                dueDay: dueDay,
                holderId: holderId,
                note: note,
                bankAccount: bankAccount,
                period: period,
                dueDate: targetDueDateStr,
                daysUntilDue: diff,
                paidAmount: 0.0,
                status: diff < 0 ? .overdue : .unpaid
            )
        }

        let mortgage = makeItem(
            id: "demo-payable-mortgage",
            name: "房贷",
            category: .loan,
            amount: 3500.0,
            dueDay: 2,
            holderId: "demo-holder-c544",
            note: "房贷按月还款"
        )

        let lightning = makeItem(
            id: "demo-payable-lightning",
            name: "闪电贷",
            category: .loan,
            amount: 800.0,
            dueDay: 3,
            holderId: "demo-holder-3fb2",
            note: "按期应还借款"
        )

        let creditLoan = makeItem(
            id: "demo-payable-credit-loan",
            name: "个人信用贷",
            category: .loan,
            amount: 900.0,
            dueDay: 21,
            note: "按期应还借款"
        )

        return [mortgage, lightning, creditLoan]
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

    /// Gmail 账单分轮拉取（与 GmailSyncSection.syncNow 同款流程）：每轮 6 封、按 remaining 续拉。
    /// 「查看邮箱」入口专用：拉完 Gmail 后刷新本地账单，让缺账单卡片真正检查到邮箱。
    /// 带 sessionEpoch 守卫：登出/换号期间慢请求返回不会写入新会话。
    public func syncGmailBills(maxRounds: Int = 6) async {
        // 对齐 refreshPayables 守卫：演示模式/UI 测试不发起真实 Gmail 同步
        //（演示态无 token，401 会触发会话落地、清空特意准备的干净演示状态；
        // 设备 Keychain 残留真实 token 时甚至会以真实凭证向生产环境发有副作用请求）
        guard isLoggedIn, !UITestConfiguration.isEnabled,
              !CommandLine.arguments.contains("--demo-mode") else { return }
        guard maxRounds > 0 else { return }
        guard apiClient.token != nil else { return }
        // 防重入：按钮无 loading 态时用户易连点，每次都会再起最多 6 轮请求
        guard !isGmailSyncing else { return }
        isGmailSyncing = true
        defer { isGmailSyncing = false }
        let epoch = sessionEpoch
        for round in 1...maxRounds {
            do {
                let result = try await apiClient.gmailSync(maxMessages: 6)
                guard sessionEpoch == epoch, isLoggedIn else { return }
                // 成功后清空历史错误：否则一次失败的「Gmail 同步异常」会永久滞留设置页
                lastSyncError = nil
                guard let remaining = result.remaining, remaining > 0, round < maxRounds else { break }
            } catch is CancellationError {
                return // 取消不是故障：不落盘错误也不触发重载
            } catch let urlError as URLError where urlError.code == .cancelled {
                return
            } catch {
                guard sessionEpoch == epoch, isLoggedIn else { return }
                // 401 = access token 过期：静默续期；失败回登录页
                if let nsError = error as NSError?, nsError.code == 401 {
                    _ = await trySilentRefresh()
                    break
                }
                lastSyncError = "Gmail 账单同步失败：\(error.localizedDescription)"
                break
            }
        }
        await reloadData()
    }

    @discardableResult
    public func sync() async -> Bool {
        guard isLoggedIn else { return false }
        let epoch = sessionEpoch
        do {
            try await syncCoordinator.perform { [self] in
                guard isLoggedIn, sessionEpoch == epoch else { return }
                isSyncing = true
                lastSyncError = nil
                defer {
                    if sessionEpoch == epoch { isSyncing = false }
                }
                do {
                    try await syncEngine.sync()
                    guard isLoggedIn, sessionEpoch == epoch else { return }
                    try await notificationScheduler.rescheduleAll()
                    guard await reloadData() else {
                        throw NSError(domain: "WorldCredit.Sync", code: 1,
                                      userInfo: [NSLocalizedDescriptionKey: "同步后刷新本地数据失败"])
                    }
                } catch {
                    guard sessionEpoch == epoch else { return }
                    // 401 = access token 过期：静默续期后重跑本次 sync；失败回登录页
                    if let nsError = error as NSError?, nsError.code == 401 {
                        if await trySilentRefresh() {
                            _ = await sync()
                        }
                        throw error
                    }
                    lastSyncError = error.localizedDescription
                    await reloadData()
                    throw error
                }
            }
            return sessionEpoch == epoch
        } catch {
            return false
        }
    }

    /// 用 Google Sign-In 取到的 ID token 完成登录，状态迁移与密码登录一致。
    /// GoogleSignIn SDK 的交互留在 LoginView，此处不引入该依赖。
    public func loginWithGoogle(idToken: String) async throws {
        sessionEpoch = UUID()
        Self.clearLegacyPayablesCaches()
        accountTransitionTask = Task {
            do { try await dbManager.clearUserData() } catch {
                throw LoginError.cleanupFailed(reason: error.localizedDescription)
            }
        }
        try await accountTransitionTask?.value
        accountTransitionTask = nil

        let user = try await apiClient.loginWithGoogle(idToken: idToken)
        self.currentUser = user
        self.isLoggedIn = true
        await sync()
    }

    public func logout() async throws {
        let oldUserID = currentUser?.id
        // 先取凭据再清状态：登出请求吊销本设备 refresh token（单设备语义，
        // 不影响其他设备）；token 失效时服务端也能凭 refresh_token 吊销
        let deviceRefreshToken = apiClient.refreshToken
        sessionEpoch = UUID()
        dashboardRequestID = UUID()
        dashboardRemoteTask?.cancel()

        // 等待现有 account transition 完成，避免并发登录；失败不阻塞登出清理。
        try? await accountTransitionTask?.value

        // cancelInFlight 返回的旧 task 必须被 await；不允许异步“丢弃”它。
        if let syncedTask = syncCoordinator.cancelInFlight() {
            do { try await syncedTask.value } catch {
                print("Cancelled sync failed: \(error)")
            }
        }
        // 引擎失效不可逆：防止被取消前的在途请求以旧会话写回。
        syncEngine.invalidateSession()

        PushNotificationManager.shared.unregisterCurrentToken()
        sessionIdentityCleanup?()
        apiClient.token = nil
        isLoggedIn = false
        currentUser = nil
        isLocked = false
        isSyncing = false
        lastSyncError = nil
        pendingSyncCount = 0
        lastSyncedAt = nil
        summary = nil
        bills = []
        allBills = []
        cards = []
        dashboardBills = []
        dashboardHolders = []
        dashboardPrivacy = true
        dashboardCurrency = "CNY"
        dashboardRates = nil
        dashboardAvailableCount = nil
        dashboardReminders = []
        dashboardRemoteErrors = []
        dashboardLoadError = nil
        payables = []
        payablesError = nil
        notificationScheduler.center.removeAllPendingNotificationRequests()
        watchSnapshots.clear()
        let emptySnapshot = WatchSnapshot(
            totalDebt: 0,
            overdueCount: 0,
            overdueAmount: 0,
            totalCreditLimit: 0,
            bills: [],
            cards: [],
            calendarEvents: []
        )
        try? sendWatchSnapshot(emptySnapshot)

        // 先清理 UserDefaults 等非 DB 持久化缓存，再执行可能抛错的 DB 清理：
        // 若 clearUserData 抛错，前一账号的财务快照也不能残留在磁盘。
        // 冷启动恢复会话时 currentUser 可能为 nil，需从缓存侧兼清旧全局 key。
        if let oldUserID {
            UserDefaults.standard.removeObject(forKey: Self.payablesCacheKey(userId: oldUserID))
            await dashboardRemote.clearCache(userId: oldUserID)
        }
        Self.clearLegacyPayablesCaches()

        // 阻塞式清理数据库，失败时抛出异常让 UI 无法继续下一步；这是登出防跨账号泄漏的最后防线。
        do {
            if let clearUserDataHandler {
                try await clearUserDataHandler()
            } else {
                try await dbManager.clearUserData()
            }
        } catch {
            throw LoginError.cleanupFailed(reason: error.localizedDescription)
        }
        // 吊销本设备 refresh 凭据（fire-and-forget：本地已清理，服务端吊销失败
        // 只影响该凭据自身的 180 天有效期，不影响登出语义）
        if let deviceRefreshToken {
            Task.detached { [apiClient] in
                try? await apiClient.requestLogoutRevoke(refreshToken: deviceRefreshToken)
            }
        }
        // 登出后重建引擎：invalidateSession 不可逆，新账号必须用全新引擎同步。
        syncEngine = SyncEngine(dbManager: dbManager, apiClient: apiClient)
    }

    public enum LoginError: LocalizedError {
        case cleanupFailed(reason: String)
        public var errorDescription: String? {
            switch self {
            case .cleanupFailed(let r): return "登录前清除数据失败：\(r)"
            }
        }
    }

    @discardableResult
    public func login(email: String, password: String) async throws -> UserSession {
        sessionEpoch = UUID()
        Self.clearLegacyPayablesCaches()
        accountTransitionTask = Task {
            do { try await dbManager.clearUserData() } catch {
                throw LoginError.cleanupFailed(reason: error.localizedDescription)
            }
        }
        try await accountTransitionTask?.value
        accountTransitionTask = nil

        let user = try await apiClient.loginWithPassword(email: email, password: password)
        self.currentUser = user
        self.isLoggedIn = true
        let syncResult = try await sync()
        return UserSession(user: user, syncSuccess: syncResult)
    }

    public struct UserSession: Sendable {
        public let user: SessionUser
        public let syncSuccess: Bool
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
            self.payables = Self.generateDemoPayables()
            self.payablesError = nil
            await reloadData()
        } catch {
            print("Failed to load demo data: \(error)")
        }
    }
}
