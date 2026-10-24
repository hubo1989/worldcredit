import Foundation
import SwiftUI
import Observation
#if canImport(WatchConnectivity)
import WatchConnectivity
#endif
#if canImport(WidgetKit)
import WidgetKit
#endif
import WorldCreditCore

@MainActor
@Observable
public final class WatchStore: NSObject, Sendable {
    public var snapshot: WatchSnapshot?
    public var isReachable: Bool = false

    public override init() {
        super.init()
        loadLocalSnapshot()
        setupWatchConnectivity()
    }

    public func loadLocalSnapshot() {
        if let snap = WatchSnapshotManager.shared.load() {
            self.snapshot = snap
        }
    }

    public var lastUpdatedText: String {
        guard let iso = snapshot?.generatedAt else { return "尚未同步" }
        let isoFormatter = ISO8601DateFormatter()
        guard let date = isoFormatter.date(from: iso) else { return iso }
        let df = DateFormatter()
        df.dateFormat = "MM-dd HH:mm"
        df.timeZone = TimeZone(identifier: "Asia/Shanghai") ?? .current
        return "数据更新于 \(df.string(from: date))"
    }

    public func markAsPaid(bill: WatchBillItem) {
        // 1. 本地乐观更新快照
        guard let current = snapshot else { return }
        let updatedBills = current.bills.filter { $0.id != bill.id }
        let newTotalDebt = max(0.0, current.totalDebt - bill.remainingAmount)
        let isOverdue = bill.isOverdue()
        let newOverdueCount = isOverdue ? max(0, current.overdueCount - 1) : current.overdueCount
        let newOverdueAmount = isOverdue ? max(0.0, current.overdueAmount - bill.remainingAmount) : current.overdueAmount

        let updatedSnapshot = WatchSnapshot(
            generatedAt: ISO8601DateFormatter().string(from: Date()),
            totalDebt: newTotalDebt,
            overdueCount: newOverdueCount,
            overdueAmount: newOverdueAmount,
            totalCreditLimit: current.totalCreditLimit,
            bills: updatedBills,
            cards: current.cards,
            calendarEvents: current.calendarEvents.filter { $0.id != "due-\(bill.id)" }
        )

        self.snapshot = updatedSnapshot
        try? WatchSnapshotManager.shared.save(updatedSnapshot)

        #if canImport(WidgetKit)
        WidgetCenter.shared.reloadAllTimelines()
        #endif

        // 2. 发送还款指令至 iPhone
        #if canImport(WatchConnectivity)
        let payload: [String: Any] = [
            "action": "mark_as_paid",
            "bill_id": bill.id,
            "amount": bill.remainingAmount
        ]

        if WCSession.isSupported() {
            let session = WCSession.default
            if session.activationState == .activated {
                if session.isReachable {
                    session.sendMessage(payload, replyHandler: nil) { err in
                        print("Send message error, queuing userInfo: \(err)")
                        session.transferUserInfo(payload)
                    }
                } else {
                    session.transferUserInfo(payload)
                }
            }
        }
        #endif
    }

    private func setupWatchConnectivity() {
        #if canImport(WatchConnectivity)
        if WCSession.isSupported() {
            let session = WCSession.default
            session.delegate = self
            session.activate()
        }
        #endif
    }
}

#if canImport(WatchConnectivity)
extension WatchStore: WCSessionDelegate {
    nonisolated public func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: (any Error)?
    ) {
        let reachable = session.isReachable
        Task { @MainActor in
            self.isReachable = reachable
        }
    }

    nonisolated public func sessionReachabilityDidChange(_ session: WCSession) {
        let reachable = session.isReachable
        Task { @MainActor in
            self.isReachable = reachable
        }
    }

    nonisolated public func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        guard let data = applicationContext["snapshot_data"] as? Data,
              let newSnapshot = try? JSONDecoder().decode(WatchSnapshot.self, from: data) else {
            return
        }

        Task { @MainActor in
            self.snapshot = newSnapshot
            try? WatchSnapshotManager.shared.save(newSnapshot)
            #if canImport(WidgetKit)
            WidgetCenter.shared.reloadAllTimelines()
            #endif
        }
    }
}
#endif
