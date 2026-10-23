import Foundation
import Testing

@Suite("PR42 reproducible package dependency")
struct PackageDependencyRegressionTests {
    @Test("GRDB is pinned to the verified upstream revision without an ignored local path")
    func remoteDependency() throws {
        let packageDirectory = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let manifest = try String(contentsOf: packageDirectory.appendingPathComponent("Package.swift"), encoding: .utf8)
        #expect(manifest.contains("https://github.com/groue/GRDB.swift.git"))
        #expect(manifest.contains("revision: \"0d8cf958b4b66a0473ec6e6986eb9da462171da9\""))
        #expect(!manifest.contains(".package(path:"))
        #expect(manifest.contains("package: \"GRDB.swift\""))
    }
}
