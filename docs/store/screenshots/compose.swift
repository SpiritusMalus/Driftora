import AppKit
import Foundation

let base = CommandLine.arguments[1]
let items: [(String, String)] = [
  ("01_main", "Еда, вес, шаги и настроение —\nна одном экране"),
  ("05_parse", "Напишите или скажите, что съели, —\nDriftora посчитает сама"),
  ("04_food_day", "Бюджет дня растёт\nот движения"),
  ("02_mood", "Тело и настроение — рядом,\nчтобы видеть связи"),
  ("06_weight", "Вес — трендом,\nа не паникой"),
  ("03_sections", "Без ленты, рекламы\nи соревнований"),
]
let W: CGFloat = 1080, H: CGFloat = 1920
for (idx, item) in items.enumerated() {
  guard let src = NSImage(contentsOfFile: "\(base)/\(item.0).png") else { print("missing \(item.0)"); continue }
  let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(W), pixelsHigh: Int(H), bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
  rep.size = NSSize(width: W, height: H)
  NSGraphicsContext.saveGraphicsState()
  let ctx = NSGraphicsContext(bitmapImageRep: rep)!
  NSGraphicsContext.current = ctx
  // background gradient (warm peach -> cream)
  let top = NSColor(red: 0.957, green: 0.812, blue: 0.643, alpha: 1)   // #F4CFA4
  let bottom = NSColor(red: 0.996, green: 0.965, blue: 0.929, alpha: 1) // #FEF6ED
  NSGradient(starting: top, ending: bottom)!.draw(in: NSRect(x: 0, y: 0, width: W, height: H), angle: -90)
  // caption
  let para = NSMutableParagraphStyle(); para.alignment = .center; para.lineSpacing = 6
  let attrs: [NSAttributedString.Key: Any] = [
    .font: NSFont.systemFont(ofSize: 58, weight: .bold),
    .foregroundColor: NSColor(red: 0.17, green: 0.12, blue: 0.09, alpha: 1),
    .paragraphStyle: para,
  ]
  let text = NSAttributedString(string: item.1, attributes: attrs)
  let textRect = NSRect(x: 60, y: H - 290, width: W - 120, height: 230)
  text.draw(with: textRect, options: [.usesLineFragmentOrigin])
  // screenshot, scaled to width 760, top at y = H-300 (from top), cut at bottom
  let sw: CGFloat = 760
  let sh = sw * (src.size.height / src.size.width)
  let x = (W - sw) / 2
  let yTop = H - 310
  let frame = NSRect(x: x, y: yTop - sh, width: sw, height: sh)
  NSGraphicsContext.saveGraphicsState()
  let shadow = NSShadow(); shadow.shadowColor = NSColor(white: 0, alpha: 0.28); shadow.shadowBlurRadius = 40; shadow.shadowOffset = NSSize(width: 0, height: -12)
  shadow.set()
  NSColor.white.setFill()
  NSBezierPath(roundedRect: frame, xRadius: 44, yRadius: 44).fill()
  NSGraphicsContext.restoreGraphicsState()
  NSGraphicsContext.saveGraphicsState()
  NSBezierPath(roundedRect: frame, xRadius: 44, yRadius: 44).addClip()
  src.draw(in: frame, from: .zero, operation: .sourceOver, fraction: 1)
  NSGraphicsContext.restoreGraphicsState()
  ctx.flushGraphics()
  NSGraphicsContext.restoreGraphicsState()
  let png = rep.representation(using: .png, properties: [:])!
  let out = "\(base)/out/\(idx + 1)_\(item.0).png"
  try! png.write(to: URL(fileURLWithPath: out))
  print("wrote \(out)")
}
