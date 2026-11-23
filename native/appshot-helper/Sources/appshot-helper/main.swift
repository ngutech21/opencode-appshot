// appshot-helper — tiny CLI the OpenCode plugin spawns from Electron's main process.
//
//   appshot-helper list [--exclude-pid <pid>]
//   appshot-helper permissions [--prompt]
//   appshot-helper capture --window-id <id> --pid <pid> [--title <t>] [--frame x,y,w,h] [--no-text] --out <png>
//
// Every command prints one JSON document on stdout. Errors go to stderr with exit code 1.
// macOS attributes Screen Recording / Accessibility to the app that spawned us (OpenCode),
// so the user grants those permissions to OpenCode, not to this binary.

import AppKit
import ApplicationServices
import CoreGraphics
import Foundation
import ImageIO

// MARK: - Output

func emit<T: Encodable>(_ value: T) -> Never {
    let enc = JSONEncoder()
    enc.outputFormatting = [.withoutEscapingSlashes]
    FileHandle.standardOutput.write(try! enc.encode(value))
    exit(0)
}

func fail(_ message: String) -> Never {
    FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
    exit(1)
}

func option(_ name: String) -> String? {
    let args = CommandLine.arguments
    guard let i = args.firstIndex(of: name), i + 1 < args.count else { return nil }
    return args[i + 1]
}

func flag(_ name: String) -> Bool { CommandLine.arguments.contains(name) }

// MARK: - Permissions

struct Permissions: Encodable {
    let screenRecording: Bool
    let accessibility: Bool
}

func permissions(prompt: Bool) -> Permissions {
    if prompt {
        if !CGPreflightScreenCaptureAccess() { _ = CGRequestScreenCaptureAccess() }
        let opts = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
        _ = AXIsProcessTrustedWithOptions(opts)
    }
    return Permissions(screenRecording: CGPreflightScreenCaptureAccess(), accessibility: AXIsProcessTrusted())
}

// MARK: - Window list

struct WindowEntry: Encodable {
    let id: Int
    let pid: Int
    let app: String
    let bundleId: String?
    let title: String
    let x: Double, y: Double, width: Double, height: Double
}

let ignoredOwners: Set<String> = ["Window Server", "Dock", "Control Center", "Notification Center", "Spotlight"]

func listWindows(excludePid: Int?) -> [WindowEntry] {
    guard let raw = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
        as? [[String: Any]] else { return [] }

    var out: [WindowEntry] = []
    for w in raw {  // already front-to-back
        guard (w[kCGWindowLayer as String] as? Int) == 0,
              let id = w[kCGWindowNumber as String] as? Int,
              let pid = w[kCGWindowOwnerPID as String] as? Int,
              pid != excludePid,
              pid != Int(ProcessInfo.processInfo.processIdentifier),
              let boundsDict = w[kCGWindowBounds as String] as? NSDictionary,
              let bounds = CGRect(dictionaryRepresentation: boundsDict as CFDictionary),
              bounds.width >= 120, bounds.height >= 80
        else { continue }

        let owner = w[kCGWindowOwnerName as String] as? String ?? "Unknown"
        if ignoredOwners.contains(owner) { continue }
        if let alpha = w[kCGWindowAlpha as String] as? Double, alpha < 0.05 { continue }

        let running = NSRunningApplication(processIdentifier: pid_t(pid))
        // Child processes of OpenCode (e.g. Electron helpers) share its bundle; skip those too.
        if let excludePid, let parent = NSRunningApplication(processIdentifier: pid_t(excludePid)),
           running?.bundleIdentifier != nil, running?.bundleIdentifier == parent.bundleIdentifier { continue }

        out.append(WindowEntry(
            id: id, pid: pid,
            app: running?.localizedName ?? owner,
            bundleId: running?.bundleIdentifier,
            title: w[kCGWindowName as String] as? String ?? "",  // needs Screen Recording
            x: bounds.origin.x, y: bounds.origin.y, width: bounds.width, height: bounds.height))
    }
    return out
}

// MARK: - Screenshot

func screenshot(windowId: Int, to path: String) {
    // `screencapture -l` is the simplest stable way to grab one window, including when it's
    // partly covered. -o drops the shadow, -x silences the shutter sound.
    // TODO(v2): switch to ScreenCaptureKit (SCScreenshotManager) for Retina control & no subprocess.
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
    p.arguments = ["-x", "-o", "-t", "png", "-l\(windowId)", path]
    do { try p.run() } catch { fail("could not run screencapture: \(error)") }
    p.waitUntilExit()
    guard p.terminationStatus == 0, FileManager.default.fileExists(atPath: path) else {
        fail("screencapture failed (status \(p.terminationStatus)). Is Screen Recording granted to OpenCode?")
    }
}

/// Longest side of an attached screenshot, in pixels. Vision models scale larger images down
/// to about this size anyway, so the extra Retina pixels only cost tokens and upload time.
let maxImageSide = 1568

/// Shrinks the PNG at `path` in place so its longest side is at most `maxSide` pixels.
/// Images that already fit are left untouched.
func downscale(_ path: String, maxSide: Int) {
    let url = URL(fileURLWithPath: path) as CFURL
    guard maxSide > 0,
          let src = CGImageSourceCreateWithURL(url, nil),
          let props = CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [CFString: Any],
          let w = props[kCGImagePropertyPixelWidth] as? Int,
          let h = props[kCGImagePropertyPixelHeight] as? Int,
          max(w, h) > maxSide else { return }
    let opts: [CFString: Any] = [
        kCGImageSourceCreateThumbnailFromImageAlways: true,
        kCGImageSourceThumbnailMaxPixelSize: maxSide,
        kCGImageSourceCreateThumbnailWithTransform: true,
    ]
    guard let small = CGImageSourceCreateThumbnailAtIndex(src, 0, opts as CFDictionary),
          let dst = CGImageDestinationCreateWithURL(url, "public.png" as CFString, 1, nil) else {
        fail("could not shrink the screenshot")
    }
    CGImageDestinationAddImage(dst, small, nil)
    guard CGImageDestinationFinalize(dst) else { fail("could not write the shrunk screenshot") }
}

// MARK: - Accessibility text

func attr(_ el: AXUIElement, _ name: String) -> CFTypeRef? {
    var v: CFTypeRef?
    return AXUIElementCopyAttributeValue(el, name as CFString, &v) == .success ? v : nil
}

func frame(of el: AXUIElement) -> CGRect? {
    guard let p = attr(el, kAXPositionAttribute), let s = attr(el, kAXSizeAttribute),
          CFGetTypeID(p) == AXValueGetTypeID(), CFGetTypeID(s) == AXValueGetTypeID() else { return nil }
    var pt = CGPoint.zero, sz = CGSize.zero
    AXValueGetValue(p as! AXValue, .cgPoint, &pt)
    AXValueGetValue(s as! AXValue, .cgSize, &sz)
    return CGRect(origin: pt, size: sz)
}

/// CGWindow ids aren't exposed via public AX API, so match the AX window by frame, then by title.
func axWindow(pid: pid_t, title: String, frame target: CGRect?) -> AXUIElement? {
    let app = AXUIElementCreateApplication(pid)
    AXUIElementSetMessagingTimeout(app, 1.5)
    // Chromium/Electron apps only build their AX tree when asked to.
    _ = AXUIElementSetAttributeValue(app, "AXManualAccessibility" as CFString, kCFBooleanTrue)

    guard let list = attr(app, kAXWindowsAttribute) as? [AXUIElement], !list.isEmpty else { return nil }
    if let target {
        if let hit = list.first(where: { w in
            guard let f = frame(of: w) else { return false }
            return abs(f.minX - target.minX) < 4 && abs(f.minY - target.minY) < 4
                && abs(f.width - target.width) < 4 && abs(f.height - target.height) < 4
        }) { return hit }
    }
    if !title.isEmpty, let hit = list.first(where: { (attr($0, kAXTitleAttribute) as? String) == title }) {
        return hit
    }
    return list.first
}

let contentRoles: Set<String> = [
    "AXStaticText", "AXTextArea", "AXTextField", "AXHeading", "AXLink", "AXCell",
    "AXMenuButton", "AXButton", "AXCheckBox", "AXRadioButton", "AXTab", "AXComboBox",
]
let skipRoles: Set<String> = ["AXScrollBar", "AXMenuBar", "AXToolbar"]

struct TextResult: Encodable {
    let text: String
    let truncated: Bool
    let matched: Bool
}

func windowText(pid: pid_t, title: String, frame target: CGRect?) -> TextResult {
    guard AXIsProcessTrusted(), let win = axWindow(pid: pid, title: title, frame: target) else {
        return TextResult(text: "", truncated: false, matched: false)
    }

    let maxNodes = 8000, maxChars = 200_000, maxDepth = 60
    var lines: [String] = []
    var chars = 0, nodes = 0, truncated = false
    var stack: [(AXUIElement, Int)] = [(win, 0)]

    while let item = stack.popLast() {
        let (el, depth) = item
        nodes += 1
        if nodes > maxNodes || chars > maxChars { truncated = true; break }
        let role = attr(el, kAXRoleAttribute) as? String ?? ""
        if skipRoles.contains(role) { continue }

        if contentRoles.contains(role) {
            var s = (attr(el, kAXValueAttribute) as? String) ?? ""
            if s.isEmpty { s = (attr(el, kAXTitleAttribute) as? String) ?? "" }
            if s.isEmpty, role != "AXStaticText" { s = (attr(el, kAXDescriptionAttribute) as? String) ?? "" }
            s = s.trimmingCharacters(in: .whitespacesAndNewlines)
            if !s.isEmpty, s != lines.last {
                if role == "AXHeading" { s = "## " + s }
                else if ["AXButton", "AXMenuButton", "AXTab", "AXCheckBox", "AXRadioButton"].contains(role) { s = "[\(s)]" }
                lines.append(s)
                chars += s.count
            }
            // Text fields/areas hold their text in AXValue; their children just repeat it.
            if role == "AXTextArea" || role == "AXTextField" || role == "AXStaticText" { continue }
        }

        guard depth < maxDepth else { continue }
        // Walk off-screen children too: long docs and chats are the point.
        if let kids = attr(el, kAXChildrenAttribute) as? [AXUIElement] {
            for k in kids.reversed() { stack.append((k, depth + 1)) }  // keep reading order
        }
    }
    return TextResult(text: lines.joined(separator: "\n"), truncated: truncated, matched: true)
}

// MARK: - Commands

let cmd = CommandLine.arguments.dropFirst().first ?? ""
switch cmd {
case "list":
    emit(listWindows(excludePid: option("--exclude-pid").flatMap { Int($0) }))

case "permissions":
    emit(permissions(prompt: flag("--prompt")))

case "capture":
    guard let id = option("--window-id").flatMap({ Int($0) }),
          let pid = option("--pid").flatMap({ Int32($0) }),
          let out = option("--out") else { fail("capture needs --window-id, --pid and --out") }
    var target: CGRect?
    if let f = option("--frame")?.split(separator: ",").compactMap({ Double($0) }), f.count == 4 {
        target = CGRect(x: f[0], y: f[1], width: f[2], height: f[3])
    }
    screenshot(windowId: id, to: out)
    downscale(out, maxSide: maxImageSide)
    if flag("--no-text") {
        // Image only: skip the Accessibility walk, keep the JSON shape.
        emit(TextResult(text: "", truncated: false, matched: false))
    } else {
        emit(windowText(pid: pid, title: option("--title") ?? "", frame: target))
    }

default:
    fail("usage: appshot-helper list|permissions|capture …")
}
