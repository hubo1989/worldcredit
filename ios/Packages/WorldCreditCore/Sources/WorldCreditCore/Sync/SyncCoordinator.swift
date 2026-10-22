import Foundation

/// Shares one complete sync cycle, including local refresh work, between foreground and push callers.
@MainActor
public final class SyncCoordinator {
    private var inFlight: Task<Void, Error>?

    public init() {}

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
