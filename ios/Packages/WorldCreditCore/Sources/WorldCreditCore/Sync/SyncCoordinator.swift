import Foundation

/// Shares one complete sync cycle, including local refresh work, between foreground and push callers.
@MainActor
public final class SyncCoordinator {
    private var inFlight: Task<Void, Error>?
    private var inFlightID: UUID?

    public init() {}

    /// Joiners share the current cycle's result; their operation is intentionally not run.
    /// Cancelling a waiter does not cancel the unstructured task or interrupt Task.value:
    /// inFlight stays occupied until the complete cycle has actually returned or thrown.
    public func perform(_ operation: @escaping @MainActor () async throws -> Void) async throws {
        if let inFlight {
            try await inFlight.value
            return
        }
        let id = UUID()
        let task = Task { try await operation() }
        inFlight = task
        inFlightID = id
        defer {
            // 登出 detach 后新任务可启动；旧任务结束不能清掉新任务的句柄。
            if inFlightID == id {
                inFlight = nil
                inFlightID = nil
            }
        }
        try await task.value
    }

    /// 取消并移交旧任务的所有权。登出必须保存并等待返回值，不能只 detach。
    public func cancelInFlight() -> Task<Void, Error>? {
        let task = inFlight
        task?.cancel()
        inFlight = nil
        inFlightID = nil
        return task
    }
}
