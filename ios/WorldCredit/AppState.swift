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
    public let queryService: QueryService
    public let notificationScheduler: NotificationScheduler

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

    public init(
        dbManager: DatabaseManager? = nil,
        baseURL: URL = URL(string: "https://app.all-bill.com")!
    ) {
        let db: DatabaseManager
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
        self.dbManager = db
        let client = ApiClient(baseURL: baseURL)
        self.apiClient = client
        self.syncEngine = SyncEngine(dbManager: db, apiClient: client)
        self.paymentService = PaymentService(dbManager: db)
        self.queryService = QueryService(dbManager: db)
        self.notificationScheduler = NotificationScheduler(dbManager: db)

        self.isLoggedIn = client.token != nil
    }

    public func reloadData() async {
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
        } catch {
            print("Failed to reload local data: \(error)")
        }
    }

    public func sync() async {
        guard !isSyncing else { return }
        isSyncing = true
        lastSyncError = nil
        defer { isSyncing = false }

        do {
            try await syncEngine.sync()
            try? await notificationScheduler.rescheduleAll()
            await reloadData()
        } catch {
            lastSyncError = error.localizedDescription
            await reloadData()
        }
    }

    public func login(email: String, password: String) async throws {
        let user = try await apiClient.loginWithPassword(email: email, password: password)
        self.currentUser = user
        self.isLoggedIn = true
        await sync()
    }

    public func logout() {
        apiClient.token = nil
        self.isLoggedIn = false
        self.currentUser = nil
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
        try? await notificationScheduler.rescheduleAll()

        // Background trigger sync if online
        Task {
            await self.sync()
        }
    }
}
