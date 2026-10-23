import Foundation
import GRDB
import Testing
@testable import WorldCreditCore

private enum ProtectionFailure: Error, Equatable { case denied }

private final class ProtectionFileManager: FileManager, @unchecked Sendable {
    enum FailurePoint { case directoryCreation, directory, database, wal, shm, verification, missingProtection, readback }
    let failurePoint: FailurePoint
    init(_ failurePoint: FailurePoint) { self.failurePoint = failurePoint; super.init() }

    override func createDirectory(at url: URL, withIntermediateDirectories: Bool,
                                  attributes: [FileAttributeKey: Any]? = nil) throws {
        if failurePoint == .directoryCreation { throw ProtectionFailure.denied }
        try super.createDirectory(at: url, withIntermediateDirectories: withIntermediateDirectories, attributes: attributes)
    }
    override func setAttributes(_ attributes: [FileAttributeKey: Any], ofItemAtPath path: String) throws {
        let fail = switch failurePoint {
        case .directory: path.hasSuffix("protected")
        case .database: path.hasSuffix(".sqlite")
        case .wal: path.hasSuffix("-wal")
        case .shm: path.hasSuffix("-shm")
        default: false
        }
        if fail { throw ProtectionFailure.denied }
        try super.setAttributes(attributes, ofItemAtPath: path)
    }
    override func attributesOfItem(atPath path: String) throws -> [FileAttributeKey: Any] {
        if failurePoint == .readback { throw ProtectionFailure.denied }
        var attributes = try super.attributesOfItem(atPath: path)
        // Model supported protection independently of the host filesystem.
        attributes[.protectionKey] = FileProtectionType.completeUntilFirstUserAuthentication
        if failurePoint == .verification { attributes[.protectionKey] = FileProtectionType.none }
        if failurePoint == .missingProtection { attributes.removeValue(forKey: .protectionKey) }
        return attributes
    }
}

@Suite("PR42 database protection")
struct DatabaseProtectionRegressionTests {
    @Test("Protection readback is mandatory outside the simulator")
    func platformPolicy() {
        #if targetEnvironment(simulator)
        #expect(!DatabaseManager.requiresProtectionReadback)
        #else
        #expect(DatabaseManager.requiresProtectionReadback)
        #endif
    }

    @Test("Directory creation and each protection failure propagate", arguments: [
        ProtectionFileManager.FailurePoint.directoryCreation, .directory, .database, .wal, .shm, .readback
    ], [true, false])
    fileprivate func failures(point: ProtectionFileManager.FailurePoint, requiresReadback: Bool) throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let url = root.appendingPathComponent("protected/store.sqlite")
        #expect(throws: ProtectionFailure.denied) {
            _ = try DatabaseManager.file(at: url, fileManager: ProtectionFileManager(point),
                                         requiresProtectionReadback: requiresReadback)
        }
    }

    @Test("Incorrect protection readback rejects the database even when missing attributes are allowed", arguments: [true, false])
    func verificationFailure(requiresReadback: Bool) throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        #expect(throws: (any Error).self) {
            _ = try DatabaseManager.file(at: root.appendingPathComponent("protected/store.sqlite"),
                                         fileManager: ProtectionFileManager(.verification),
                                         requiresProtectionReadback: requiresReadback)
        }
    }

    @Test("Device policy rejects missing protection readback")
    func missingReadbackOnDevice() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        #expect(throws: (any Error).self) {
            _ = try DatabaseManager.file(at: root.appendingPathComponent("protected/store.sqlite"),
                                         fileManager: ProtectionFileManager(.missingProtection),
                                         requiresProtectionReadback: true)
        }
    }

    @Test("Simulator policy permits absent protection readback and preserves disk data")
    func missingReadbackOnSimulator() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let url = root.appendingPathComponent("protected/store.sqlite")
        do {
            let manager = try DatabaseManager.file(at: url,
                fileManager: ProtectionFileManager(.missingProtection), requiresProtectionReadback: false)
            try manager.dbWriter.write { db in
                try db.execute(sql: "INSERT INTO sync_meta (key, value) VALUES ('fixture', '1')")
            }
        }
        let reopened = try DatabaseManager.file(at: url,
            fileManager: ProtectionFileManager(.missingProtection), requiresProtectionReadback: false)
        let value = try reopened.dbWriter.read { db in
            try String.fetchOne(db, sql: "SELECT value FROM sync_meta WHERE key = 'fixture'")
        }
        #expect(value == "1")
    }

    @Test("Directory, database and WAL sidecars exist after migration and reopening; available protection matches")
    func actualProtection() throws {
        let fm = FileManager.default
        let root = fm.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? fm.removeItem(at: root) }
        let directory = root.appendingPathComponent("protected")
        let url = directory.appendingPathComponent("store.sqlite")
        for _ in 0..<2 {
            let manager = try DatabaseManager.file(at: url)
            try manager.dbWriter.write { db in
                try db.execute(sql: "INSERT OR REPLACE INTO sync_meta (key, value) VALUES ('fixture', '1')")
            }
            for path in [directory.path, url.path, url.path + "-wal", url.path + "-shm"] {
                #expect(fm.fileExists(atPath: path))
                let attributes = try fm.attributesOfItem(atPath: path)
                #if targetEnvironment(simulator)
                // Simulator filesystems can omit this attribute even after a successful set.
                if attributes[.protectionKey] == nil { continue }
                #endif
                #expect(attributes[.protectionKey] as? FileProtectionType == .completeUntilFirstUserAuthentication)
            }
        }
    }
}
