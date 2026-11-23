// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "appshot-helper",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(name: "appshot-helper", path: "Sources/appshot-helper")
    ]
)
