// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "WorldCreditCore",
    platforms: [
        .iOS("18.0"),
        .watchOS("11.0"),
        .macOS("14.0")
    ],
    products: [
        .library(
            name: "WorldCreditCore",
            targets: ["WorldCreditCore"]
        ),
    ],
    dependencies: [
        .package(url: "https://github.com/groue/GRDB.swift.git", revision: "0d8cf958b4b66a0473ec6e6986eb9da462171da9")
    ],
    targets: [
        .target(
            name: "WorldCreditCore",
            dependencies: [
                .product(name: "GRDB", package: "GRDB.swift")
            ],
            path: "Sources/WorldCreditCore"
        ),
        .testTarget(
            name: "WorldCreditCoreTests",
            dependencies: ["WorldCreditCore"],
            path: "Tests/WorldCreditCoreTests"
        ),
    ]
)
