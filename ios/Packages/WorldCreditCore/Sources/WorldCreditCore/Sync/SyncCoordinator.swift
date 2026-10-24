import Foundation

/// Shares one complete sync cycle, including local refresh work, between foreground and push callers.
@MainActor
public final class SyncCoordinator {
    private var inFlight: Task<Void, Error>?

    public init() {}

    /// Joiners share the current cycle's result; their operation is intentionally not run.
    /// Cancelling a waiter does not cancel the unstructured task or interrupt Task.value:
    /// inFlight stays occupied until the complete cycle has actually returned or thrown.
    public func perform(_ operation: @escaping @MainActor () async throws -> Void) async throws {
        if let inFlight {
            try await inFlight.value
            return
        }
        let task = Task { try await operation() }
        inFlight = task
        defer { inFlight = nil }
        try await task.value
    }
}
