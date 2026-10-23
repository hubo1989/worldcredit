import Foundation
import Testing
@testable import WorldCreditCore

@MainActor
private final class CancellationGate {
    private var opened = false
    private var waiters: [CheckedContinuation<Void, Never>] = []
    func wait() async {
        if opened { return }
        await withCheckedContinuation { waiters.append($0) }
    }
    func open() {
        opened = true
        let pending = waiters
        waiters = []
        pending.forEach { $0.resume() }
    }
}

@Suite("PR42 cancellation semantics")
@MainActor
struct SyncCancellationRegressionTests {
    private enum Failure: Error, Equatable { case operation }

    @Test("Cancelling owner and joiner neither cancels shared task nor releases single flight", arguments: [false, true])
    func cancelledWaiters(throwsError: Bool) async throws {
        let coordinator = SyncCoordinator()
        let started = CancellationGate()
        let release = CancellationGate()
        let joined = CancellationGate()
        var completed = 0
        var duplicates = 0
        var operationWasCancelled = false
        let first = Task {
            defer { completed += 1 }
            try await coordinator.perform {
                started.open()
                await release.wait()
                operationWasCancelled = Task.isCancelled
                if throwsError { throw Failure.operation }
            }
        }
        await started.wait()
        first.cancel()
        let second = Task {
            defer { completed += 1 }
            joined.open()
            try await coordinator.perform { duplicates += 1 }
        }
        await joined.wait()
        second.cancel()
        // Give both cancelled waiters an opportunity to return prematurely.
        for _ in 0..<20 { await Task.yield() }
        #expect(completed == 0)
        let thirdEntered = CancellationGate()
        let third = Task {
            thirdEntered.open()
            try await coordinator.perform { duplicates += 1 }
        }
        await thirdEntered.wait()
        #expect(duplicates == 0)
        release.open()
        if throwsError {
            await #expect(throws: Failure.operation) { try await first.value }
            await #expect(throws: Failure.operation) { try await second.value }
            await #expect(throws: Failure.operation) { try await third.value }
        } else {
            try await first.value
            try await second.value
            try await third.value
        }
        #expect(!operationWasCancelled)
        #expect(duplicates == 0)
        #expect(completed == 2)
        try await coordinator.perform { duplicates += 1 }
        #expect(duplicates == 1)
    }
}
