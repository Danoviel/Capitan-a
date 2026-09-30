// Genera el AppIcon.icns de PuertosView sin depender de un diseñador ni de
// herramientas externas: dibuja el enchufe sobre el mismo fondo oscuro del
// dashboard usando AppKit, y deja los PNG en un .iconset listo para iconutil.
//
//   swift scripts/make-icon.swift <carpeta-destino>

import AppKit
import Foundation

let outputDir = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "./PuertosView.iconset"
try? FileManager.default.createDirectory(
  atPath: outputDir, withIntermediateDirectories: true)

/// Fondo `slate-900` del panel, para que el ícono y la app se vean de la misma familia.
let background = NSColor(srgbRed: 0.058, green: 0.090, blue: 0.165, alpha: 1)
let border = NSColor(srgbRed: 0.20, green: 0.26, blue: 0.37, alpha: 1)

func render(size: Int) -> Data? {
  let side = CGFloat(size)

  // Se dibuja sobre un NSBitmapImageRep en vez de NSImage.lockFocus: con
  // lockFocus el contexto sigue tomado al pedir la representación y el
  // encoder falla en los tamaños chicos.
  guard
    let bitmap = NSBitmapImageRep(
      bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size,
      bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
      colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)
  else { return nil }
  bitmap.size = NSSize(width: side, height: side)

  NSGraphicsContext.saveGraphicsState()
  defer { NSGraphicsContext.restoreGraphicsState() }
  guard let context = NSGraphicsContext(bitmapImageRep: bitmap) else { return nil }
  NSGraphicsContext.current = context
  context.imageInterpolation = .high

  // macOS espera un "squircle" con márgenes: el arte ocupa ~80% del lienzo.
  let inset = side * 0.10
  let rect = NSRect(x: inset, y: inset, width: side - inset * 2, height: side - inset * 2)
  let squircle = NSBezierPath(roundedRect: rect, xRadius: side * 0.22, yRadius: side * 0.22)

  background.setFill()
  squircle.fill()

  // Halo esmeralda (el verde de "encendido" del panel): sin él, el enchufe
  // queda oscuro sobre fondo oscuro y el ícono se lee como una mancha.
  NSGraphicsContext.saveGraphicsState()
  squircle.addClip()
  let glow = NSGradient(colors: [
    NSColor(srgbRed: 0.20, green: 0.83, blue: 0.60, alpha: 0.38),
    NSColor(srgbRed: 0.20, green: 0.83, blue: 0.60, alpha: 0.0),
  ])
  glow?.draw(
    fromCenter: NSPoint(x: side * 0.5, y: side * 0.46), radius: 0,
    toCenter: NSPoint(x: side * 0.5, y: side * 0.46), radius: side * 0.42,
    options: [])
  NSGraphicsContext.restoreGraphicsState()

  border.setStroke()
  squircle.lineWidth = max(1, side * 0.008)
  squircle.stroke()

  let glyph = "🔌" as NSString
  let fontSize = side * 0.48
  let attributes: [NSAttributedString.Key: Any] = [
    .font: NSFont.systemFont(ofSize: fontSize)
  ]
  let glyphSize = glyph.size(withAttributes: attributes)
  glyph.draw(
    at: NSPoint(x: (side - glyphSize.width) / 2, y: (side - glyphSize.height) / 2),
    withAttributes: attributes)

  context.flushGraphics()
  return bitmap.representation(using: .png, properties: [:])
}

// Nombres exactos que iconutil espera dentro de un .iconset.
let variants: [(name: String, size: Int)] = [
  ("icon_16x16", 16), ("icon_16x16@2x", 32),
  ("icon_32x32", 32), ("icon_32x32@2x", 64),
  ("icon_128x128", 128), ("icon_128x128@2x", 256),
  ("icon_256x256", 256), ("icon_256x256@2x", 512),
  ("icon_512x512", 512), ("icon_512x512@2x", 1024),
]

for variant in variants {
  guard let data = render(size: variant.size) else {
    FileHandle.standardError.write("no se pudo render \(variant.name)\n".data(using: .utf8)!)
    exit(1)
  }
  let path = "\(outputDir)/\(variant.name).png"
  try data.write(to: URL(fileURLWithPath: path))
}

print("iconset generado en \(outputDir) (\(variants.count) tamaños)")
