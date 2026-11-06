import AppKit
import CoreText
import Foundation

// Deterministic store artwork. Native screenshots are composited unchanged in
// content: only uniform scaling and a rounded clipping boundary are applied.
// Usage: swift compose.swift INPUT_DIR OUTPUT_DIR PROJECT_ROOT
let args = CommandLine.arguments
precondition(args.count == 4, "Usage: swift compose.swift INPUT_DIR OUTPUT_DIR PROJECT_ROOT")
let input = URL(fileURLWithPath: args[1])
let output = URL(fileURLWithPath: args[2])
let project = URL(fileURLWithPath: args[3])
try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
let W = 1080, H = 1920

func color(_ hex: UInt32) -> NSColor {
    NSColor(srgbRed: CGFloat((hex >> 16) & 255) / 255,
            green: CGFloat((hex >> 8) & 255) / 255,
            blue: CGFloat(hex & 255) / 255, alpha: 1)
}
func rect(_ x: CGFloat, _ top: CGFloat, _ width: CGFloat, _ height: CGFloat) -> NSRect {
    NSRect(x: x, y: CGFloat(H) - top - height, width: width, height: height)
}
func font(_ relative: String, size: CGFloat) -> NSFont {
    let url = project.appendingPathComponent(relative) as CFURL
    var error: Unmanaged<CFError>?
    CTFontManagerRegisterFontsForURL(url, .process, &error)
    guard let descriptors = CTFontManagerCreateFontDescriptorsFromURL(url) as? [CTFontDescriptor],
          let descriptor = descriptors.first,
          let name = CTFontDescriptorCopyAttribute(descriptor, kCTFontNameAttribute) as? String,
          let result = NSFont(name: name, size: size) else { fatalError("Missing font: \(relative)") }
    return result
}
let displayFont = font("node_modules/@expo-google-fonts/manrope/800ExtraBold/Manrope_800ExtraBold.ttf", size: 83)
let ink = color(0x17332D)
let cobalt = color(0x2645E4)
let cream = color(0xFFF7EC)
let peach = color(0xF8CFA6)

struct Card {
    let file: String
    let lines: [String]
    let accentLine: Int
    let background: [UInt32]
    let dark: Bool
}
let cards = [
    Card(file: "01-home.png", lines: ["Еда, вес", "и настроение.", "Всё рядом."], accentLine: 2, background: [0xF5CCA2, 0xFFF1DF], dark: false),
    Card(file: "02-food-entry.png", lines: ["Еда — текстом,", "голосом", "или фото."], accentLine: 2, background: [0x2443DC, 0x1836B8], dark: true),
    Card(file: "03-food-day.png", lines: ["Калории и БЖУ", "перед глазами."], accentLine: 0, background: [0xFFF4E5, 0xF6E3C8], dark: false),
    Card(file: "04-mood.png", lines: ["Настроение", "и мысли —", "рядом."], accentLine: 2, background: [0x2443DC, 0x1836B8], dark: true),
    Card(file: "05-weight.png", lines: ["История веса.", "В вашем темпе."], accentLine: 1, background: [0xF5CCA2, 0xFFF1DF], dark: false),
    Card(file: "06-sections.png", lines: ["Ваш дневник.", "Всё нужное", "под рукой."], accentLine: 0, background: [0xFFF4E5, 0xF6E3C8], dark: false),
]

var receipt: [[String: Any]] = []
for card in cards {
    guard let image = NSImage(contentsOf: input.appendingPathComponent(card.file)) else {
        fatalError("Missing native screenshot: \(card.file)")
    }
    precondition(abs(image.size.width / image.size.height - 9 / 16) < 0.0001, "Screenshot must be 9:16")
    let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: W, pixelsHigh: H,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
        colorSpaceName: .deviceRGB, bytesPerRow: W * 4, bitsPerPixel: 32)!
    bitmap.size = NSSize(width: W, height: H)
    NSGraphicsContext.saveGraphicsState()
    let context = NSGraphicsContext(bitmapImageRep: bitmap)!
    NSGraphicsContext.current = context
    context.imageInterpolation = .high
    NSGradient(starting: color(card.background[0]), ending: color(card.background[1]))!
        .draw(in: NSRect(x: 0, y: 0, width: W, height: H), angle: -90)

    // Three large benefit lines occupy less than the top 20% of the artwork.
    let paragraph = NSMutableParagraphStyle()
    paragraph.alignment = .left
    paragraph.lineBreakMode = .byClipping
    var lineRects: [[String: CGFloat]] = []
    for (i, line) in card.lines.enumerated() {
        let foreground = card.dark ? (i == card.accentLine ? peach : cream)
                                   : (i == card.accentLine ? cobalt : ink)
        let attributed = NSAttributedString(string: line, attributes: [
            .font: displayFont, .foregroundColor: foreground,
            .paragraphStyle: paragraph, .kern: -2.0,
        ])
        let measured = attributed.size()
        precondition(measured.width <= 920, "Headline overflow: \(line) / \(measured.width)")
        let top = CGFloat(48 + (3 - card.lines.count) * 47 + i * 94)
        let area = rect(80, top, 920, 114)
        attributed.draw(in: area)
        lineRects.append(["x":80, "top":top, "width":measured.width, "height":114])
    }

    // A neutral artboard frame, rather than a simulation of a phone model.
    let screen = rect(120, 380, 840, 1493.3333333333)
    let frame = screen.insetBy(dx: -12, dy: -12)
    let framePath = NSBezierPath(roundedRect: frame, xRadius: 49, yRadius: 49)
    NSGraphicsContext.saveGraphicsState()
    let shadow = NSShadow()
    shadow.shadowColor = NSColor(srgbRed: 0.1, green: 0.15, blue: 0.22, alpha: card.dark ? 0.3 : 0.19)
    shadow.shadowBlurRadius = 36
    shadow.shadowOffset = NSSize(width: 0, height: -18)
    shadow.set()
    color(0xFFFCF7).setFill()
    framePath.fill()
    NSGraphicsContext.restoreGraphicsState()
    NSGraphicsContext.saveGraphicsState()
    NSBezierPath(roundedRect: screen, xRadius: 38, yRadius: 38).addClip()
    image.draw(in: screen, from: .zero, operation: .copy, fraction: 1,
               respectFlipped: true, hints: [.interpolation: NSImageInterpolation.high])
    NSGraphicsContext.restoreGraphicsState()
    context.flushGraphics()
    NSGraphicsContext.restoreGraphicsState()
    let outputName = String(card.file.prefix(3)) + "promo-" + String(card.file.dropFirst(3))
    let destination = output.appendingPathComponent(outputName)
    try bitmap.representation(using: .png, properties: [:])!.write(to: destination)
    receipt.append([
        "file": outputName, "native_source": card.file, "headline_lines": card.lines, "font": displayFont.fontName,
        "font_size":83, "headline_rects":lineRects,
        "caption_region": ["x":80,"top":48,"width":920,"height":302],
        "caption_region_height_fraction": 302.0 / Double(H),
        "native_frame": ["x":120,"top":380,"width":840,"height":1493.3333333333],
        "native_transform":"uniform scale; rounded boundary clip; no internal UI edits",
        "canvas_width": W, "canvas_height": H,
    ])
    print("Rendered \(outputName)")
}
let json = try JSONSerialization.data(withJSONObject: receipt, options: [.prettyPrinted, .sortedKeys])
try json.write(to: output.appendingPathComponent("composition.json"))
