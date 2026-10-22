import Foundation
#if canImport(WatchConnectivity)
import WatchConnectivity
#endif
import WorldCreditCore

@MainActor
public final class WatchSyncCoordinator: NSObject, Sendable {
    public static let shared = WatchSyncCoordinator()
    private weak var appState: AppState?

    private override init() {
        super.init()
    }

    public func configure(appState: AppState) {
        self.appState = appState
        #if canImport(WatchConnectivity)
        if WCSession.isSupported() {
            let session = WCSession.default
            session.delegate = self
            session.activate()
        }
        #endif
    }

    public func sendSnapshotToWatch(_ snapshot: WatchSnapshot) {
        #if canImport(WatchConnectivity)
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        guard session.activationState == .activated else { return }

        do {
            let data = try JSONEncoder().encode(snapshot)
            try session.updateApplicationContext(["snapshot_data": data])
        } catch {
            print("Failed to send snapshot to watch: \(error)")
        }
        #endif
    }
}

#if canImport(WatchConnectivity)
extension WatchSyncCoordinator: WCSessionDelegate {
    nonisolated public func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: (any Error)?
    ) {
        if let error {
            print("WCSession activation error: \(error)")
        }
    }

    nonisolated public func sessionDidBecomeInactive(_ session: WCSession) {}
    nonisolated public func sessionDidDeactivate(_ session: WCSession) {
        session.activate()
    }

    nonisolated public func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
        let action = userInfo["action"] as? String
        let billId = userInfo["bill_id"] as? String
        let amount = userInfo["amount"] as? Double

        Task { @MainActor in
            await self.handleParsedWatchAction(action: action, billId: billId, amount: amount)
        }
    }

    nonisolated public func session(
        _ session: WCSession,
        didReceiveMessage message: [String: Any],
        replyHandler: @escaping ([String: Any]) -> Void
    ) {
        let action = message["action"] as? String
        let billId = message["bill_id"] as? String
        let amount = message["amount"] as? Double

        struct SendableReply: @unchecked Sendable {
            let handler: ([String: Any]) -> Void
        }
        let safeReply = SendableReply(handler: replyHandler)

        Task { @MainActor in
            await self.handleParsedWatchAction(action: action, billId: billId, amount: amount)
            safeReply.handler(["status": "ok"])
        }
    }

    private func handleParsedWatchAction(action: String?, billId: String?, amount: Double?) async {
        guard let action, action == "mark_as_paid",
              let billId,
              let amount,
              let appState = self.appState else {
            return
        }

        do {
            try await appState.recordPayment(
                billId: billId,
                amount: amount,
                channel: "Apple Watch",
                note: "手表快捷还款"
            )
        } catch {
            print("Watch mark-paid action failed: \(error)")
        }
    }
}
#endif
