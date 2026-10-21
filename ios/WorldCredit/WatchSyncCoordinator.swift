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
        Task { @MainActor in
            await self.handleWatchAction(userInfo)
        }
    }

    nonisolated public func session(_ session: WCSession, didReceiveMessage message: [String: Any], replyHandler: @escaping ([String: Any]) -> Void) {
        Task { @MainActor in
            await self.handleWatchAction(message)
            replyHandler(["status": "ok"])
        }
    }

    private func handleWatchAction(_ dict: [String: Any]) async {
        guard let action = dict["action"] as? String, action == "mark_as_paid",
              let billId = dict["bill_id"] as? String,
              let amount = dict["amount"] as? Double,
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
