import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { buildSite, type SiteResult } from '../build/static'
import type { DesignPaths } from '../core/paths'
import { ID_PATTERN } from '../core/schema'
import { toPosix } from '../core/text'

/**
 * Sync units (D1): `system` is `.design/design.json` and `.design/system/**`,
 * `canvas/<id>` is `.design/canvas/<id>/**`. Each unit is revised, conflicted
 * and built on its own.
 */
export const SYSTEM_UNIT = 'system'
const CANVAS_PREFIX = 'canvas/'

export interface FileEntry {
  /** sha256, lowercase hex. */
  hash: string
  size: number
}

/** `{ [relPath]: { hash, size } }`; source paths are relative to `.design`, build paths to the unit build root. */
export type Manifest = Record<string, FileEntry>

export interface LocalUnit {
  key: string
  kind: 'system' | 'canvas'
  /** Source files, relative to `.design`. */
  manifest: Manifest
}

export interface LocalScan {
  units: Map<string, LocalUnit>
  /** Entries in `.design` that no unit syncs, relative to `.design`; folders end with `/`. */
  notSynced: string[]
}

/** Top-level names in `.design` that are not "not synced" even though no unit carries them. */
const LOCAL_ONLY = new Set(['cloud.json', 'node_modules'])

export const canvasUnit = (id: string) => `${CANVAS_PREFIX}${id}`

export function unitCanvasId(key: string): string | null {
  return key.startsWith(CANVAS_PREFIX) ? key.slice(CANVAS_PREFIX.length) : null
}

export function isUnitKey(key: string): boolean {
  if (key === SYSTEM_UNIT) return true
  const id = unitCanvasId(key)
  return id !== null && ID_PATTERN.test(id)
}

/** Where a unit's files live, and what its paths inside `incoming/` and archives are relative to. */
export function unitRoot(paths: DesignPaths, key: string): string {
  const id = unitCanvasId(key)
  return id === null ? paths.design : path.join(paths.canvases, id)
}

/** A unit's path relative to its root: `canvas/home/canvas.json` → `canvas.json`; system paths stay as they are. */
export function unitRelative(key: string, rel: string): string {
  const id = unitCanvasId(key)
  return id === null ? rel : rel.slice(`${CANVAS_PREFIX}${id}/`.length)
}

/**
 * A path (relative to `.design`) a unit may contain. Anything else in a
 * remote manifest is refused, so a pull never writes outside the unit.
 */
export function isUnitPath(key: string, rel: string): boolean {
  if (!rel || rel.includes('\\') || rel.includes('\0') || rel.startsWith('/')) return false
  const segments = rel.split('/')
  if (segments.some((part) => !part || part === '..' || part.startsWith('.') || part === 'node_modules')) return false
  if (key === SYSTEM_UNIT) return rel === 'design.json' || (segments[0] === 'system' && segments.length > 1)
  const id = unitCanvasId(key)
  return id !== null && segments[0] === 'canvas' && segments[1] === id && segments.length > 2
}

export function hashBuffer(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

export function hashFile(file: string): FileEntry {
  const data = fs.readFileSync(file)
  return { hash: hashBuffer(data), size: data.length }
}

/** Files under `dir`, relative to `base`, without dot-files and `node_modules`. */
function walk(dir: string, base: string, out: Manifest) {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
    const full = path.join(dir, entry.name)
    let isFile = entry.isFile()
    let isDir = entry.isDirectory()
    if (entry.isSymbolicLink()) {
      // A linked file syncs as its content; linked folders are not followed.
      try {
        isFile = fs.statSync(full).isFile()
      } catch {}
      isDir = false
    }
    if (isDir) walk(full, base, out)
    else if (isFile) out[toPosix(path.relative(base, full))] = hashFile(full)
  }
}

/** The files of one unit as they are now; empty when the unit is not here. */
export function unitManifest(paths: DesignPaths, key: string): Manifest {
  const manifest: Manifest = {}
  if (key === SYSTEM_UNIT) {
    if (fs.existsSync(paths.config) && fs.statSync(paths.config).isFile())
      manifest['design.json'] = hashFile(paths.config)
    walk(paths.system, paths.design, manifest)
  } else walk(unitRoot(paths, key), paths.design, manifest)
  return sortManifest(manifest)
}

/** Every build output under `dir`, relative to it. */
export function buildManifest(dir: string): Manifest {
  const manifest: Manifest = {}
  const visit = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) visit(full)
      else if (entry.isFile()) manifest[toPosix(path.relative(dir, full))] = hashFile(full)
    }
  }
  if (fs.existsSync(dir)) visit(dir)
  return sortManifest(manifest)
}

function sortManifest(manifest: Manifest): Manifest {
  return Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
}

/** The units in `.design` with their source manifests, and what is left out of sync. */
export function scanLocal(paths: DesignPaths): LocalScan {
  const units = new Map<string, LocalUnit>()
  const notSynced: string[] = []
  if (!fs.existsSync(paths.design)) return { units, notSynced }

  const system = unitManifest(paths, SYSTEM_UNIT)
  if (Object.keys(system).length) units.set(SYSTEM_UNIT, { key: SYSTEM_UNIT, kind: 'system', manifest: system })

  for (const entry of fs.readdirSync(paths.design, { withFileTypes: true })) {
    const { name } = entry
    if (name.startsWith('.') || LOCAL_ONLY.has(name)) continue
    if (name === 'design.json' && entry.isFile()) continue
    if ((name === 'system' || name === 'canvas') && entry.isDirectory()) continue
    notSynced.push(entry.isDirectory() ? `${name}/` : name)
  }

  if (fs.existsSync(paths.canvases) && fs.statSync(paths.canvases).isDirectory()) {
    for (const entry of fs.readdirSync(paths.canvases, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue
      if (!entry.isDirectory() || !ID_PATTERN.test(entry.name)) {
        notSynced.push(`canvas/${entry.name}${entry.isDirectory() ? '/' : ''}`)
        continue
      }
      const key = canvasUnit(entry.name)
      const manifest = unitManifest(paths, key)
      // A folder with nothing to sync is no canvas.
      if (Object.keys(manifest).length) units.set(key, { key, kind: 'canvas', manifest })
    }
  }
  return { units, notSynced: notSynced.sort() }
}

/** `.design/.cache/cloud/build/<unit>/`. */
export function unitBuildDir(paths: DesignPaths, key: string): string {
  return path.join(paths.cache, 'cloud', 'build', ...key.split('/'))
}

/**
 * Build one unit without the viewer: the system alone (`api/system.json`,
 * `api/sources.json`, specimen frames), or one canvas without the system's
 * pages (`api/canvas/<id>.json`, its frames, files and snapshots). Both carry
 * `api/project.json`.
 */
export async function buildUnit(paths: DesignPaths, key: string, out = unitBuildDir(paths, key)): Promise<SiteResult> {
  const id = unitCanvasId(key)
  fs.rmSync(out, { recursive: true, force: true })
  return buildSite(paths, out, {
    canvases: id === null ? [] : [id],
    includeSystem: id === null,
    includeViewer: false,
  })
}
