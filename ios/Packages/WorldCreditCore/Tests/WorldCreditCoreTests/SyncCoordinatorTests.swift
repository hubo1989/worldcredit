import Foundation
import Testing
@testable import WorldCreditCore

@MainActor
private final class OperationGate {
    private var isOpen = false
    private var waiters: [CheckedContinuation<Void, Never>] = []

    func wait() async {
        if isOpen { return }
        await withCheckedContinuation { waiters.append($0) }
    }

    func open() {
        isOpen = true
        let pending = waiters
        waiters = []
        pending.forEach { $0.resume() }
    }
}

@Suite("Foreground and silent push sync coordination")
@MainActor
struct SyncCoordinatorTests {
    private enum Failure: Error, Equatable { case reminders }

    @Test("Concurrent callers await the same complete sync, reminder and refresh cycle")
    func sharedCycle() async throws {
        let coordinator = SyncCoordinator()
        let started = OperationGate()
        let release = OperationGate()
        let secondEntered = OperationGate()
        var events: [String] = []
        let first = Task {
            try await coordinator.perform {
                events.append("network")
                started.open()
                await release.wait()
                events.append("reminders")
                events.append("refresh")
            }
        }
        await started.wait()
        let second = Task {
            secondEntered.open()
            try await coordinator.perform { events.append("duplicate") }
        }
        await secondEntered.wait()
        #expect(events == ["network"])
        release.open()
        try await first.value
        try await second.value
        #expect(events == ["network", "reminders", "refresh"])
    }

    @Test("All waiters receive refresh failures and a later cycle can retry")
    func sharedFailureAndRetry() async throws {
        let coordinator = SyncCoordinator()
        let started = OperationGate()
        let release = OperationGate()
        let secondEntered = OperationGate()
        let first = Task {
            try await coordinator.perform {
                started.open()
                await release.wait()
                throw Failure.reminders
            }
        }
        await started.wait()
        let second = Task {
            secondEntered.open()
            try await coordinator.perform { Issue.record("Unexpected duplicate cycle") }
        }
        await secondEntered.wait()
        release.open()
        await #expect(throws: Failure.reminders) { try await first.value }
        await #expect(throws: Failure.reminders) { try await second.value }
        var retried = false
        try await coordinator.perform { retried = true }
        #expect(retried)
    }
}
