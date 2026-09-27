import fs from 'node:fs'
import path from 'node:path'
import { ensureThumb } from '../core/png'
import type { SnapshotInfo, SnapshotLookup } from '../core/sources'
import type { Theme } from '../shared/types'

interface Meta {
  height?: number
  light?: number
  dark?: number
}

const SAFE = /^@?[a-z0-9][a-z0-9_-]*$/i

export function isSafeSegment(value: string): boolean {
  return SAFE.test(value)
}

/** PNG previews the frames take of themselves, shown on the zoomed-out canvas and on canvas cards. */
export class SnapshotStore {
  private meta = new Map<string, Record<string, Meta>>()

  constructor(
    readonly dir: string,
    private readonly urlBase = '/api/snapshots',
  ) {}

  private metaFile(canvas: string) {
    return path.join(this.dir, canvas, 'meta.json')
  }

  private load(canvas: string): Record<string, Meta> {
    const cached = this.meta.get(canvas)
    if (cached) return cached
    let data: Record<string, Meta> = {}
    try {
      data = JSON.parse(fs.readFileSync(this.metaFile(canvas), 'utf8'))
    } catch {}
    this.meta.set(canvas, data)
    return data
  }

  url(canvas: string, id: string, theme: Theme, version: number, thumb = false) {
    const name = `${encodeURIComponent(id)}.${theme}${thumb ? '.thumb' : ''}.png`
    return `${this.urlBase}/${encodeURIComponent(canvas)}/${name}?v=${version}`
  }

  lookup: SnapshotLookup = (canvas, id): SnapshotInfo | null => {
    if (!isSafeSegment(canvas) || !isSafeSegment(id)) return null
    const entry = this.load(canvas)[id]
    if (!entry) return null
    const urls: SnapshotInfo['urls'] = {}
    const thumbs: SnapshotInfo['urls'] = {}
    for (const theme of ['light', 'dark'] as const) {
      const version = entry[theme]
      if (!version) continue
      urls[theme] = this.url(canvas, id, theme, version)
      thumbs[theme] = this.url(canvas, id, theme, version, true)
    }
    return { urls, thumbs, height: entry.height }
  }

  /** When the snapshot was taken (ms), or null without one. */
  version(canvas: string, id: string, theme: Theme): number | null {
    if (!isSafeSegment(canvas) || !isSafeSegment(id)) return null
    return this.load(canvas)[id]?.[theme] ?? null
  }

  save(canvas: string, id: string, theme: Theme, png: Buffer, height?: number): { url: string } {
    if (!isSafeSegment(canvas) || !isSafeSegment(id)) throw new Error('bad snapshot key')
    const dir = path.join(this.dir, canvas)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, `${id}.${theme}.png`), png)
    const data = this.load(canvas)
    const version = Date.now()
    data[id] = { ...data[id], [theme]: version, ...(height ? { height } : {}) }
    fs.writeFileSync(this.metaFile(canvas), JSON.stringify(data))
    return { url: this.url(canvas, id, theme, version) }
  }

  /** Absolute path of `<id>.<theme>.png`, or of its thumbnail for `<id>.<theme>.thumb.png` (made on first use); null when missing. */
  file(canvas: string, name: string): string | null {
    const match = /^(@?[a-z0-9][a-z0-9_-]*)\.(light|dark)(\.thumb)?\.png$/i.exec(name)
    if (!isSafeSegment(canvas) || !match) return null
    const file = path.join(this.dir, canvas, `${match[1]}.${match[2]}.png`)
    if (!fs.existsSync(file)) return null
    return match[3] ? ensureThumb(file) : file
  }
}
