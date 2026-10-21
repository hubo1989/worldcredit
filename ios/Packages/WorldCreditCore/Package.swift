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
        .package(path: "../GRDB")
    ],
    targets: [
        .target(
            name: "WorldCreditCore",
            dependencies: [
                .product(name: "GRDB", package: "GRDB")
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
