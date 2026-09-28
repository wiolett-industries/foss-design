import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { ensureThumb } from '../core/png'
import type { SnapshotInfo, SnapshotLookup } from '../core/sources'
import type { Theme } from '../shared/types'

interface Meta {
  height?: number
  light?: number
  dark?: number
  /** Hash of what each theme's snapshot was taken from: its `deps`' contents, else the screen file's. */
  sources?: Partial<Record<Theme, string>>
  /** The project's files the frame loaded (relative to the root), as a build told when it was taken. */
  deps?: string[]
}

/**
 * One hash over the contents of `rels` (relative to `root`): what a frame was built from. `cache`
 * keeps file hashes across calls within a run.
 */
export function depsHash(root: string, rels: readonly string[], cache = new Map<string, string>()): string {
  const hash = createHash('sha1')
  for (const rel of [...rels].sort()) {
    let one = cache.get(rel)
    if (one === undefined) {
      one = sourceHash(path.join(root, rel)) ?? 'missing'
      cache.set(rel, one)
    }
    hash.update(`${rel}\0${one}\n`)
  }
  return hash.digest('hex').slice(0, 16)
}

/** What a snapshot was taken from: the screen file's content, so touching it without a change is no change. */
export function sourceHash(file: string): string | null {
  try {
    return createHash('sha1').update(fs.readFileSync(file)).digest('hex').slice(0, 16)
  } catch {
    return null
  }
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

  /** Written aside and renamed: a run stopped mid-write leaves the old file, not half of one. */
  private writeMeta(canvas: string, data: Record<string, Meta>) {
    const temp = `${this.metaFile(canvas)}.${process.pid}.tmp`
    fs.writeFileSync(temp, JSON.stringify(data))
    fs.renameSync(temp, this.metaFile(canvas))
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

  /** The source hash recorded with the snapshot; undefined for snapshots taken before hashes were kept. */
  source(canvas: string, id: string, theme: Theme): string | undefined {
    if (!isSafeSegment(canvas) || !isSafeSegment(id)) return undefined
    return this.load(canvas)[id]?.sources?.[theme]
  }

  /** The files the snapshot's frame loaded, when a build told (see `Meta.deps`). */
  deps(canvas: string, id: string): string[] | undefined {
    if (!isSafeSegment(canvas) || !isSafeSegment(id)) return undefined
    return this.load(canvas)[id]?.deps
  }

  /** Record `hash` for a snapshot taken before hashes were kept: from now on it counts as that content's. */
  adopt(canvas: string, id: string, theme: Theme, hash: string) {
    if (!isSafeSegment(canvas) || !isSafeSegment(id)) return
    const data = this.load(canvas)
    const entry = data[id]
    if (!entry?.[theme]) return
    entry.sources = { ...entry.sources, [theme]: hash }
    this.writeMeta(canvas, data)
  }

  save(
    canvas: string,
    id: string,
    theme: Theme,
    png: Buffer,
    height?: number,
    source?: string | null,
    deps?: string[],
  ): { url: string } {
    if (!isSafeSegment(canvas) || !isSafeSegment(id)) throw new Error('bad snapshot key')
    const dir = path.join(this.dir, canvas)
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, `${id}.${theme}.png`)
    fs.writeFileSync(`${file}.${process.pid}.tmp`, png)
    fs.renameSync(`${file}.${process.pid}.tmp`, file)
    const data = this.load(canvas)
    const version = Date.now()
    const previous = data[id]
    const sources = { ...previous?.sources }
    if (source) sources[theme] = source
    else delete sources[theme]
    data[id] = { ...previous, [theme]: version, ...(height ? { height } : {}), sources, ...(deps ? { deps } : {}) }
    this.writeMeta(canvas, data)
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
