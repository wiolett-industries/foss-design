import fs from 'node:fs'
import zlib from 'node:zlib'

/**
 * Small PNG previews of snapshots for the zoomed-out canvas, made with nothing
 * but zlib: a page of a hundred screens then decodes a hundred small images
 * instead of a hundred full-size ones. Handles 8-bit RGB and RGBA without
 * interlacing, which is what browsers encode; anything else is left alone.
 */

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** Width of a thumbnail, in pixels. */
export const THUMB_WIDTH = 320

interface Image {
  width: number
  height: number
  /** RGBA, row after row. */
  data: Uint8Array
}

function decode(png: Buffer): Image | null {
  if (!png.subarray(0, 8).equals(SIGNATURE)) return null
  let width = 0
  let height = 0
  let channels = 0
  const idat: Buffer[] = []
  for (let pos = 8; pos + 8 <= png.length; ) {
    const length = png.readUInt32BE(pos)
    const type = png.toString('ascii', pos + 4, pos + 8)
    const body = png.subarray(pos + 8, pos + 8 + length)
    pos += 12 + length
    if (type === 'IHDR') {
      width = body.readUInt32BE(0)
      height = body.readUInt32BE(4)
      const [depth, color, , , interlace] = [body[8], body[9], body[10], body[11], body[12]]
      if (depth !== 8 || interlace !== 0 || (color !== 2 && color !== 6)) return null
      channels = color === 6 ? 4 : 3
    } else if (type === 'IDAT') idat.push(body)
    else if (type === 'IEND') break
  }
  if (!width || !height || !channels) return null
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const data = new Uint8Array(width * height * 4)
  let prev = new Uint8Array(stride)
  let line = new Uint8Array(stride)
  for (let y = 0, at = 0; y < height; y++) {
    const filter = raw[at++]
    for (let x = 0; x < stride; x++, at++) {
      const left = x >= channels ? line[x - channels]! : 0
      const up = prev[x]!
      const corner = x >= channels ? prev[x - channels]! : 0
      let value = raw[at]!
      if (filter === 1) value += left
      else if (filter === 2) value += up
      else if (filter === 3) value += (left + up) >> 1
      else if (filter === 4) {
        const p = left + up - corner
        const pa = Math.abs(p - left)
        const pb = Math.abs(p - up)
        const pc = Math.abs(p - corner)
        value += pa <= pb && pa <= pc ? left : pb <= pc ? up : corner
      }
      line[x] = value & 255
    }
    for (let x = 0; x < width; x++) {
      const to = (y * width + x) * 4
      const from = x * channels
      data[to] = line[from]!
      data[to + 1] = line[from + 1]!
      data[to + 2] = line[from + 2]!
      data[to + 3] = channels === 4 ? line[from + 3]! : 255
    }
    ;[prev, line] = [line, prev]
  }
  return { width, height, data }
}

/** Average the source pixels under each target pixel. */
function shrink(image: Image, width: number): Image {
  const height = Math.max(1, Math.round((image.height * width) / image.width))
  const data = new Uint8Array(width * height * 4)
  const sx = image.width / width
  const sy = image.height / height
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y * sy)
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy))
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x * sx)
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx))
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const at = (yy * image.width + xx) * 4
          r += image.data[at]!
          g += image.data[at + 1]!
          b += image.data[at + 2]!
          a += image.data[at + 3]!
        }
      }
      const n = (y1 - y0) * (x1 - x0)
      const to = (y * width + x) * 4
      data[to] = Math.round(r / n)
      data[to + 1] = Math.round(g / n)
      data[to + 2] = Math.round(b / n)
      data[to + 3] = Math.round(a / n)
    }
  }
  return { width, height, data }
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 255]! ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(body.length, 0)
  head.write(type, 4, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0)
  return Buffer.concat([head, body, crc])
}

function encode(image: Image): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(image.width, 0)
  ihdr.writeUInt32BE(image.height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const stride = image.width * 4
  const raw = Buffer.alloc((stride + 1) * image.height)
  for (let y = 0; y < image.height; y++) {
    // Filter "sub": neighbouring pixels are alike, so the differences compress well.
    const row = y * (stride + 1)
    raw[row] = 1
    for (let x = 0; x < stride; x++) {
      const value = image.data[y * stride + x]!
      const left = x >= 4 ? image.data[y * stride + x - 4]! : 0
      raw[row + 1 + x] = (value - left) & 255
    }
  }
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** A PNG `width` pixels wide, or null when the image is already that small or cannot be read. */
export function thumbnail(png: Buffer, width = THUMB_WIDTH): Buffer | null {
  const image = decode(png)
  if (!image || image.width <= width) return null
  return encode(shrink(image, width))
}

/** Where the thumbnail of `file` lives. */
export const thumbPath = (file: string) => file.replace(/\.png$/, '.thumb.png')

/**
 * The thumbnail of a snapshot file, made on first use and kept next to it;
 * the snapshot itself when a thumbnail would not be smaller.
 */
export function ensureThumb(file: string): string {
  const thumb = thumbPath(file)
  try {
    const source = fs.statSync(file)
    const existing = fs.statSync(thumb, { throwIfNoEntry: false })
    if (existing && existing.mtimeMs >= source.mtimeMs) return thumb
    const small = thumbnail(fs.readFileSync(file))
    if (!small) return file
    fs.writeFileSync(thumb, small)
    return thumb
  } catch {
    return file
  }
}
