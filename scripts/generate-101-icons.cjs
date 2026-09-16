/**
 * generate-101-icons.cjs — v2
 * Clean "101" brand icons with proper digit shapes.
 */

const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')

const OUT = path.resolve(__dirname, '..', 'public', 'assets', 'icons')

const GREEN = [64, 83, 59]     // #40533b
const CREAM = [247, 245, 239]  // #f7f5ef

// ── Minimal PNG encoder ──────────────────────────────────────
function crc32(buf) {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
    table[i] = c
  }
  let crc = 0xFFFFFFFF
  for (const b of buf) crc = table[(crc ^ b) & 0xFF] ^ (crc >>> 8)
  return (crc ^ 0xFFFFFFFF) >>> 0
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type)
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const crcBuf = Buffer.concat([typeBytes, data])
  const crcVal = Buffer.alloc(4); crcVal.writeUInt32BE(crc32(crcBuf))
  return Buffer.concat([len, typeBytes, data, crcVal])
}

function encodePNG(pixels, w, h) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8; ihdr[9] = 2 // 8-bit RGB truecolor
  const scanlines = []
  for (let y = 0; y < h; y++) {
    scanlines.push(0) // filter=None
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      scanlines.push(pixels[i], pixels[i+1], pixels[i+2])
    }
  }
  const compressed = zlib.deflateSync(Buffer.from(scanlines), { level: 9 })
  return Buffer.concat([
    Buffer.from([137,80,78,71,13,10,26,10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0))
  ])
}

// ── Icon renderer ────────────────────────────────────────────
function rasterize101(size) {
  const pixels = new Uint8Array(size * size * 4)

  // Fill with green
  for (let i = 0; i < size * size; i++) {
    pixels[i*4]   = GREEN[0]
    pixels[i*4+1] = GREEN[1]
    pixels[i*4+2] = GREEN[2]
    pixels[i*4+3] = 255
  }

  const setPixel = (px, py) => {
    if (px >= 0 && px < size && py >= 0 && py < size) {
      const i = (py * size + px) * 4
      pixels[i]   = CREAM[0]
      pixels[i+1] = CREAM[1]
      pixels[i+2] = CREAM[2]
      pixels[i+3] = 255
    }
  }

  const fillRect = (x1, y1, x2, y2) => {
    for (let py = y1; py <= y2; py++)
      for (let px = x1; px <= x2; px++)
        setPixel(px, py)
  }

  // Layout parameters
  const pad = Math.round(size * 0.13)
  const areaW = size - pad * 2
  const areaH = size - pad * 2

  // Character dimensions
  const charH = Math.round(areaH * 0.68)
  const sw = Math.max(2, Math.round(charH * 0.18))   // stroke width
  const zeroW = Math.round(charH * 0.65)              // '0' width
  const oneW  = Math.max(sw, Math.round(sw * 1.5))   // '1' is just a thick bar
  const gap   = Math.round(charH * 0.15)

  // Total width: 1 + gap + 0 + gap + 1
  const totalW = oneW + gap + zeroW + gap + oneW
  let x = pad + Math.round((areaW - totalW) / 2)
  const y0 = pad + Math.round((areaH - charH) / 2)
  const y1 = y0 + charH - 1

  // ── Draw '1' ──────────────────────────────
  // Simple vertical thick bar, no serif
  fillRect(x, y0, x + oneW - 1, y1)
  x += oneW + gap

  // ── Draw '0' ──────────────────────────────
  // Outer rect - inner rect = hollow rectangle (rounded feel via thick walls)
  // Top stroke
  fillRect(x + sw, y0, x + zeroW - sw - 1, y0 + sw - 1)
  // Bottom stroke
  fillRect(x + sw, y1 - sw + 1, x + zeroW - sw - 1, y1)
  // Left stroke
  fillRect(x, y0 + sw, x + sw - 1, y1 - sw)
  // Right stroke
  fillRect(x + zeroW - sw, y0 + sw, x + zeroW - 1, y1 - sw)
  // Corner fills to avoid gaps
  fillRect(x, y0, x + sw - 1, y0 + sw - 1)
  fillRect(x + zeroW - sw, y0, x + zeroW - 1, y0 + sw - 1)
  fillRect(x, y1 - sw + 1, x + sw - 1, y1)
  fillRect(x + zeroW - sw, y1 - sw + 1, x + zeroW - 1, y1)
  x += zeroW + gap

  // ── Draw '1' ──────────────────────────────
  fillRect(x, y0, x + oneW - 1, y1)

  return pixels
}

function makeIcon(size, filename) {
  const pixels = rasterize101(size)
  const png = encodePNG(pixels, size, size)
  fs.writeFileSync(path.join(OUT, filename), png)
  console.log(`  ✓ ${filename} (${size}×${size})`)
}

// ── Generate favicon.ico (multi-size) ───────────────────────
function makeFaviconIco() {
  const sizes = [16, 32]
  const pngs = sizes.map(s => encodePNG(rasterize101(s), s, s))
  const count = sizes.length
  const headerSize = 6
  const dirSize = 16 * count
  let offset = headerSize + dirSize
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2) // type=icon
  header.writeUInt16LE(count, 4)
  const dirs = pngs.map((png, i) => {
    const sz = sizes[i]
    const dir = Buffer.alloc(16)
    dir[0] = sz <= 255 ? sz : 0
    dir[1] = sz <= 255 ? sz : 0
    dir[2] = 0; dir[3] = 0
    dir.writeUInt16LE(1, 4)
    dir.writeUInt16LE(32, 6)
    dir.writeUInt32LE(png.length, 8)
    dir.writeUInt32LE(offset, 12)
    offset += png.length
    return dir
  })
  const ico = Buffer.concat([header, ...dirs, ...pngs])
  fs.writeFileSync(path.join(OUT, 'favicon.ico'), ico)
  console.log(`  ✓ favicon.ico (${sizes.join('+')}px)`)
}

// ── Main ─────────────────────────────────────────────────────
console.log('Generating 101 brand icons v2...')

const oldIcons = [
  'favicon.ico', 'favicon-16x16.png', 'favicon-32x32.png',
  'apple-touch-icon.png', 'icon-192x192.png', 'icon-512x512.png',
  'icon-maskable-192x192.png', 'icon-maskable-512x512.png'
]
oldIcons.forEach(f => {
  const p = path.join(OUT, f)
  if (fs.existsSync(p)) fs.unlinkSync(p)
})

makeIcon(16,  'favicon-16x16.png')
makeIcon(32,  'favicon-32x32.png')
makeIcon(180, 'apple-touch-icon.png')
makeIcon(192, 'icon-192x192.png')
makeIcon(512, 'icon-512x512.png')
makeIcon(192, 'icon-maskable-192x192.png')
makeIcon(512, 'icon-maskable-512x512.png')
makeFaviconIco()

console.log('Done.')
