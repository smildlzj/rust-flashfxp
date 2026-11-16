// Rebuild the installer artwork with: swift scripts/dmg/render-background.swift
import AppKit

let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
let destination = root.appendingPathComponent("src-tauri/dmg")
let preview = CommandLine.arguments.contains("--preview")
try FileManager.default.createDirectory(at: destination, withIntermediateDirectories: true)
let width = 720.0, height = 440.0

func color(_ hex: UInt32) -> NSColor {
    NSColor(srgbRed: CGFloat((hex >> 16) & 255) / 255, green: CGFloat((hex >> 8) & 255) / 255,
            blue: CGFloat(hex & 255) / 255, alpha: 1)
}

func text(_ value: String, x: Double, y: Double, size: Double, weight: NSFont.Weight, ink: UInt32, centered: Bool = false) {
    let attributes: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: size, weight: weight), .foregroundColor: color(ink)]
    let string = value as NSString
    let dimensions = string.size(withAttributes: attributes)
    string.draw(at: NSPoint(x: centered ? x - dimensions.width / 2 : x, y: height - y - dimensions.height), withAttributes: attributes)
}

for scale in [1, 2] {
    let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(width) * scale, pixelsHigh: Int(height) * scale,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    bitmap.size = NSSize(width: width, height: height)
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)

    color(0xF8FAFC).setFill()
    NSBezierPath(rect: NSRect(x: 0, y: 0, width: width, height: height)).fill()
    color(0x2563EB).setFill()
    NSBezierPath(rect: NSRect(x: 0, y: height - 4, width: width, height: 4)).fill()
    text("RUST FLASH FTP", x: 44, y: 30, size: 11, weight: .semibold, ink: 0x2563EB)
    text("让文件传输，更从容。", x: 44, y: 57, size: 28, weight: .semibold, ink: 0x172033)
    text("将左侧应用拖入右侧 Applications，即可完成安装。", x: 44, y: 103, size: 14, weight: .regular, ink: 0x64748B)

    for x in [102.0, 442.0] {
        let card = NSBezierPath(roundedRect: NSRect(x: x, y: height - 334, width: 176, height: 178), xRadius: 22, yRadius: 22)
        color(0xFFFFFF).setFill(); card.fill()
        color(0xE2E8F0).setStroke(); card.lineWidth = 1; card.stroke()
    }
    let arrow = NSBezierPath()
    arrow.move(to: NSPoint(x: 326, y: height - 232))
    arrow.line(to: NSPoint(x: 394, y: height - 232))
    arrow.move(to: NSPoint(x: 380, y: height - 218))
    arrow.line(to: NSPoint(x: 394, y: height - 232))
    arrow.line(to: NSPoint(x: 380, y: height - 246))
    color(0x2563EB).setStroke(); arrow.lineWidth = 3; arrow.lineCapStyle = .round; arrow.lineJoinStyle = .round; arrow.stroke()
    text("拖入安装", x: 360, y: 265, size: 12, weight: .medium, ink: 0x64748B, centered: true)

    if preview {
        let appIcon = NSImage(contentsOf: root.appendingPathComponent("src-tauri/icons/icon.icns"))!
        let folderIcon = NSImage(contentsOfFile: "/System/Library/CoreServices/CoreTypes.bundle/Contents/Resources/ApplicationsFolderIcon.icns")!
        appIcon.draw(in: NSRect(x: 142, y: height - 280, width: 96, height: 96))
        folderIcon.draw(in: NSRect(x: 482, y: height - 280, width: 96, height: 96))
        text("Rust Flash Ftp", x: 190, y: 290, size: 12, weight: .regular, ink: 0x172033, centered: true)
        text("Applications", x: 530, y: 290, size: 12, weight: .regular, ink: 0x172033, centered: true)
    }

    color(0xE2E8F0).setFill()
    NSBezierPath(rect: NSRect(x: 44, y: height - 373, width: 632, height: 1)).fill()
    text("FTP  /  FTPS  /  SFTP", x: 44, y: 392, size: 11, weight: .medium, ink: 0x64748B)
    text("安装后，请从「应用程序」打开", x: 500, y: 390, size: 11, weight: .regular, ink: 0x64748B)
    NSGraphicsContext.restoreGraphicsState()
    let data = bitmap.representation(using: .png, properties: [:])!
    let name = preview ? "preview" : "background"
    try data.write(to: destination.appendingPathComponent(scale == 1 ? "\(name).png" : "\(name)@2x.png"))
}

if preview { exit(0) }

let task = Process()
task.executableURL = URL(fileURLWithPath: "/usr/bin/tiffutil")
task.arguments = ["-cathidpicheck", destination.appendingPathComponent("background.png").path,
                  destination.appendingPathComponent("background@2x.png").path, "-out", destination.appendingPathComponent("background.tiff").path]
try task.run(); task.waitUntilExit()
if task.terminationStatus != 0 { exit(task.terminationStatus) }
