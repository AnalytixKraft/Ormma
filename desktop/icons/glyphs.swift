// A word, as SVG path data, from a font on this Mac: the icon's lettering is
// outlines, so it looks the same wherever the icon is drawn, with or without
// the font. Used by make-icons.mjs, which this file sits beside.
//
//   swift glyphs.swift <PostScript font name> <text>
//
// Prints one line: the path (y down, baseline at 0, in font units at size
// 1000), then the advance width and the cap height, separated by tabs.
import CoreText
import Foundation

let args = CommandLine.arguments
guard args.count == 3 else { print("usage: glyphs.swift <font> <text>"); exit(2) }
let font = CTFontCreateWithName(args[1] as CFString, 1000, nil)
let actual = CTFontCopyPostScriptName(font) as String
guard actual == args[1] else { FileHandle.standardError.write("no font \(args[1]) (got \(actual))\n".data(using: .utf8)!); exit(1) }
let line = CTLineCreateWithAttributedString(NSAttributedString(string: args[2], attributes: [kCTFontAttributeName as NSAttributedString.Key: font, kCTKernAttributeName as NSAttributedString.Key: 0]))
var d = ""
func n(_ v: CGFloat) -> String { String(format: "%.1f", v) }
for run in CTLineGetGlyphRuns(line) as! [CTRun] {
  let count = CTRunGetGlyphCount(run)
  var glyphs = [CGGlyph](repeating: 0, count: count)
  var positions = [CGPoint](repeating: .zero, count: count)
  CTRunGetGlyphs(run, CFRange(location: 0, length: count), &glyphs)
  CTRunGetPositions(run, CFRange(location: 0, length: count), &positions)
  for i in 0..<count {
    var t = CGAffineTransform(a: 1, b: 0, c: 0, d: -1, tx: positions[i].x, ty: 0)
    guard let path = CTFontCreatePathForGlyph(font, glyphs[i], &t) else { continue }
    path.applyWithBlock { el in
      let p = el.pointee.points
      switch el.pointee.type {
      case .moveToPoint: d += "M\(n(p[0].x)) \(n(p[0].y))"
      case .addLineToPoint: d += "L\(n(p[0].x)) \(n(p[0].y))"
      case .addQuadCurveToPoint: d += "Q\(n(p[0].x)) \(n(p[0].y)) \(n(p[1].x)) \(n(p[1].y))"
      case .addCurveToPoint: d += "C\(n(p[0].x)) \(n(p[0].y)) \(n(p[1].x)) \(n(p[1].y)) \(n(p[2].x)) \(n(p[2].y))"
      case .closeSubpath: d += "Z"
      @unknown default: break
      }
    }
  }
}
let width = CTLineGetTypographicBounds(line, nil, nil, nil)
print("\(d)\t\(n(CGFloat(width)))\t\(n(CTFontGetCapHeight(font)))")
