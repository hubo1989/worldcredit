import Foundation
import Security
import Testing
@testable import WorldCreditCore

private final class KeychainProbe: TokenKeychain, @unchecked Sendable {
    private let lock = NSLock()
    private var stored: Data? = Data("fixture-session".utf8)
    private var savedAccessibility: String?
    var addStatus: OSStatus = errSecSuccess
    var deleteStatus: OSStatus = errSecSuccess
    var readStatus: OSStatus = errSecSuccess
    var deleteEntered: DispatchSemaphore?
    var releaseDelete: DispatchSemaphore?
    var readEntered: DispatchSemaphore?

    var accessibility: String? { lock.withLock { savedAccessibility } }
    func add(_ attributes: [String: Any]) -> OSStatus {
        lock.withLock {
            savedAccessibility = attributes[kSecAttrAccessible as String] as? String
            if addStatus == errSecSuccess { stored = attributes[kSecValueData as String] as? Data }
            return addStatus
        }
    }
    func delete(_ query: [String: Any]) -> OSStatus {
        // 只对 access-token 条目挂起探针：logout 现在会额外删 refresh-token 条目，
        // 不能让两次删除共享同一个信号量（第二次会等不到 release 超时）
        if query[kSecAttrAccount as String] as? String == "com.chunfenshijie.worldcredit.sessionToken" {
            deleteEntered?.signal()
            if let releaseDelete { _ = releaseDelete.wait(timeout: .now() + 3) }
        }
        return lock.withLock {
            if deleteStatus == errSecSuccess { stored = nil }
            return deleteStatus
        }
    }
    func read(_ query: [String: Any]) -> (OSStatus, Data?) {
        readEntered?.signal()
        return lock.withLock { (readStatus, stored) }
    }
}

@Suite("PR42 token storage")
struct TokenStorageRegressionTests {
    private func client(_ keychain: KeychainProbe) -> ApiClient {
        ApiClient(baseURL: URL(string: "https://example.invalid")!, keychain: keychain)
    }

    @Test("Logout holds the state lock through Keychain deletion")
    func logoutReadRace() {
        let keychain = KeychainProbe()
        let deleting = DispatchSemaphore(value: 0)
        let release = DispatchSemaphore(value: 0)
        let reading = DispatchSemaphore(value: 0)
        keychain.deleteEntered = deleting
        keychain.releaseDelete = release
        keychain.readEntered = reading
        let api = client(keychain)
        let logoutDone = DispatchSemaphore(value: 0)
        DispatchQueue.global().async { api.token = nil; logoutDone.signal() }
        #expect(deleting.wait(timeout: .now() + 2) == .success)
        let readerStarted = DispatchSemaphore(value: 0)
        let readDone = DispatchSemaphore(value: 0)
        DispatchQueue.global().async {
            readerStarted.signal()
            #expect(api.token == nil)
            readDone.signal()
        }
        #expect(readerStarted.wait(timeout: .now() + 2) == .success)
        #expect(reading.wait(timeout: .now() + 0.15) == .timedOut)
        #expect(readDone.wait(timeout: .now() + 0.05) == .timedOut)
        release.signal()
        #expect(logoutDone.wait(timeout: .now() + 2) == .success)
        #expect(readDone.wait(timeout: .now() + 2) == .success)
        #expect(api.token == nil)
    }

    @Test("Failed deletion is observable and cannot resurrect credentials")
    func failedLogout() {
        let keychain = KeychainProbe()
        keychain.deleteStatus = errSecInteractionNotAllowed
        let api = client(keychain)
        api.token = nil
        #expect(api.token == nil)
        #expect(api.lastKeychainFailure == KeychainFailure(operation: .delete, status: errSecInteractionNotAllowed))
    }

    @Test("Persisted sessions are device only and failed additions remain observable")
    func failedAdd() {
        let keychain = KeychainProbe()
        keychain.addStatus = errSecNotAvailable
        let api = client(keychain)
        api.token = "new-fixture"
        #expect(keychain.accessibility == (kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly as String))
        #expect(api.lastKeychainFailure == KeychainFailure(operation: .add, status: errSecNotAvailable))
        #expect(api.token == "new-fixture")
    }

    @Test("Read failure is distinguishable from an absent credential")
    func readFailure() {
        let keychain = KeychainProbe()
        keychain.readStatus = errSecInteractionNotAllowed
        let api = client(keychain)
        #expect(api.token == nil)
        #expect(api.lastKeychainFailure == KeychainFailure(operation: .read, status: errSecInteractionNotAllowed))
    }

    @Test("Failed replacement deletion prevents add and remains observable")
    func failedReplacement() {
        let keychain = KeychainProbe()
        keychain.deleteStatus = errSecInteractionNotAllowed
        let api = client(keychain)
        api.token = "replacement-fixture"
        #expect(api.lastKeychainFailure == KeychainFailure(operation: .delete, status: errSecInteractionNotAllowed))
        #expect(keychain.accessibility == nil)
        #expect(api.token == "replacement-fixture")
    }

    @Test("Successful persistence clears a prior failure")
    func recovery() {
        let keychain = KeychainProbe()
        keychain.addStatus = errSecNotAvailable
        let api = client(keychain)
        api.token = "first-fixture"
        #expect(api.lastKeychainFailure != nil)
        keychain.addStatus = errSecSuccess
        api.token = "recovered-fixture"
        #expect(api.lastKeychainFailure == nil)
        #expect(client(keychain).token == "recovered-fixture")
        api.token = nil
        #expect(client(keychain).token == nil)
    }

    @Test("Missing items are normal during read and delete")
    func missingItem() {
        let keychain = KeychainProbe()
        keychain.readStatus = errSecItemNotFound
        keychain.deleteStatus = errSecItemNotFound
        let api = client(keychain)
        #expect(api.token == nil)
        api.token = nil
        #expect(api.lastKeychainFailure == nil)
    }

    @Test("Memory-only clients never touch Keychain")
    func memoryOnly() {
        let keychain = KeychainProbe()
        keychain.addStatus = errSecNotAvailable
        keychain.deleteStatus = errSecNotAvailable
        keychain.readStatus = errSecNotAvailable
        let api = ApiClient(baseURL: URL(string: "https://example.invalid")!, useKeychain: false, keychain: keychain)
        api.token = "memory-fixture"
        #expect(api.token == "memory-fixture")
        api.token = nil
        #expect(api.token == nil)
        #expect(api.lastKeychainFailure == nil)
    }
}
