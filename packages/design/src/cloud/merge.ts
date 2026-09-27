import fs from 'node:fs'
import path from 'node:path'
import { merge as diff3 } from 'node-diff3'
import type { DesignPaths } from '../core/paths'
import { type CloudLink, cloudCache } from './state'
import { type Manifest, SYSTEM_UNIT, unitRoot } from './units'
import { pruneEmpty, writeInside } from './write'

/**
 * Three-way merge of one unit (D6): this `.design` ("here"), the cloud head ("cloud") and the base
 * both started from (the revision cloud.json last recorded). A file changed on one side takes that
 * side; a text file changed on both merges line by line; what cannot merge is a conflict, written
 * with markers (text) or left as yours (anything else), with every side kept under
 * `.design/.cache/cloud/merge/<unit>/` until `design merge` resolves it.
 */

export type ConflictKind = 'text' | 'binary' | 'deleted_here' | 'deleted_in_cloud'

export interface Conflict {
  /** Relative to `.design`. */
  path: string
  kind: ConflictKind
}

export interface MergeState {
  unit: string
  /** The cloud head the merge took in; the unit's base is already there. */
  headRev: number
  conflicts: Conflict[]
}

export interface MergeResult {
  files: { added: number; changed: number; removed: number; merged: number }
  conflicts: Conflict[]
}

const TEXT = /\.(?:[cm]?[jt]sx?|json|css|scss|html?|mdx?|svg|txt|ya?ml|csv|xml|toml)$/i

/** Text files merge line by line; the rest (images, fonts) cannot. */
const isText = (rel: string, ...data: (Buffer | undefined)[]) =>
  TEXT.test(rel) && data.every((buffer) => !buffer || !buffer.subarray(0, 8192).includes(0))

export const mergeDir = (paths: DesignPaths, key: string) => path.join(cloudCache(paths), 'merge', ...key.split('/'))
const stateFile = (paths: DesignPaths, key: string) => path.join(mergeDir(paths, key), 'state.json')
/** The kept `side` (`here`, `cloud`, `base`) of a conflicted file. */
export const sideFile = (paths: DesignPaths, key: string, rel: string, side: 'here' | 'cloud' | 'base') =>
  path.join(mergeDir(paths, key), side, rel)

export function readMergeState(paths: DesignPaths, key: string): MergeState | null {
  try {
    return JSON.parse(fs.readFileSync(stateFile(paths, key), 'utf8')) as MergeState
  } catch {
    return null
  }
}

function saveState(paths: DesignPaths, state: MergeState) {
  fs.mkdirSync(mergeDir(paths, state.unit), { recursive: true })
  fs.writeFileSync(stateFile(paths, state.unit), `${JSON.stringify(state, null, 2)}\n`)
}

/** Units with a merge waiting on `design merge`. */
export function mergingUnits(paths: DesignPaths): MergeState[] {
  const root = path.join(cloudCache(paths), 'merge')
  const found: MergeState[] = []
  const visit = (dir: string, prefix: string) => {
    if (fs.existsSync(path.join(dir, 'state.json'))) {
      const state = readMergeState(paths, prefix)
      if (state) found.push(state)
      return
    }
    let entries: fs.Dirent[] = []
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {}
    for (const entry of entries)
      if (entry.isDirectory()) visit(path.join(dir, entry.name), prefix ? `${prefix}/${entry.name}` : entry.name)
  }
  visit(root, '')
  return found
}

const MARKER = /^(<{7}|={7}|>{7})( |$)/m

/** Conflicts still open: text files keep their markers until edited or resolved; the rest until resolved. */
export function openConflicts(paths: DesignPaths, state: MergeState): Conflict[] {
  return state.conflicts.filter((conflict) => {
    if (conflict.kind !== 'text') return true
    try {
      return MARKER.test(fs.readFileSync(path.join(paths.design, conflict.path), 'utf8'))
    } catch {
      return false
    }
  })
}

function keep(paths: DesignPaths, key: string, rel: string, side: 'here' | 'cloud' | 'base', data: Buffer | undefined) {
  if (!data) return
  const file = sideFile(paths, key, rel, side)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, data)
}

export function mergeUnit(
  paths: DesignPaths,
  key: string,
  headRev: number,
  base: Record<string, string>,
  here: Manifest,
  cloud: Manifest,
  blob: (hash: string) => Buffer | undefined,
): MergeResult {
  const files = { added: 0, changed: 0, removed: 0, merged: 0 }
  const conflicts: Conflict[] = []
  const stop = key === SYSTEM_UNIT ? paths.design : path.dirname(unitRoot(paths, key))
  fs.rmSync(mergeDir(paths, key), { recursive: true, force: true })
  const read = (rel: string) => fs.readFileSync(path.join(paths.design, rel))
  const remove = (rel: string) => {
    const file = path.join(paths.design, rel)
    fs.rmSync(file, { force: true })
    pruneEmpty(path.dirname(file), stop)
  }

  for (const rel of [...new Set([...Object.keys(base), ...Object.keys(here), ...Object.keys(cloud)])].sort()) {
    const b = base[rel]
    const h = here[rel]?.hash
    const c = cloud[rel]?.hash
    if (h === c || c === b) continue
    if (h === b) {
      // Changed in the cloud only: take it.
      if (c) {
        writeInside(paths.design, rel, blob(c)!)
        if (h) files.changed++
        else files.added++
      } else {
        remove(rel)
        files.removed++
      }
      continue
    }
    // Changed on both sides.
    const cloudData = c ? blob(c) : undefined
    const hereData = h ? read(rel) : undefined
    if (!h || !c) {
      const kind: ConflictKind = h ? 'deleted_in_cloud' : 'deleted_here'
      keep(paths, key, rel, 'here', hereData)
      keep(paths, key, rel, 'cloud', cloudData)
      // Nothing is lost on disk: the side that still has the file keeps it there.
      if (!h && cloudData) writeInside(paths.design, rel, cloudData)
      conflicts.push({ path: rel, kind })
      continue
    }
    const baseData = b ? blob(b) : undefined
    if (isText(rel, hereData, cloudData, baseData)) {
      const lines = (data: Buffer | undefined) => (data ? data.toString('utf8').split('\n') : [])
      const result = diff3(lines(hereData), lines(baseData), lines(cloudData), {
        label: { a: 'here', b: 'cloud' },
      })
      writeInside(paths.design, rel, Buffer.from(result.result.join('\n')))
      if (!result.conflict) {
        files.merged++
        continue
      }
      keep(paths, key, rel, 'base', baseData)
      keep(paths, key, rel, 'here', hereData)
      keep(paths, key, rel, 'cloud', cloudData)
      conflicts.push({ path: rel, kind: 'text' })
      continue
    }
    keep(paths, key, rel, 'here', hereData)
    keep(paths, key, rel, 'cloud', cloudData)
    conflicts.push({ path: rel, kind: 'binary' })
  }
  if (conflicts.length) saveState(paths, { unit: key, headRev, conflicts })
  return { files, conflicts }
}

/** Settle one conflict with one side, as `design merge --here|--cloud` does. */
export function resolveConflict(paths: DesignPaths, state: MergeState, rel: string, side: 'here' | 'cloud') {
  const conflict = state.conflicts.find((item) => item.path === rel)
  if (!conflict) return
  const kept = sideFile(paths, state.unit, rel, side)
  const stop = state.unit === SYSTEM_UNIT ? paths.design : path.dirname(unitRoot(paths, state.unit))
  if (fs.existsSync(kept)) writeInside(paths.design, rel, fs.readFileSync(kept))
  else {
    // That side has no such file: the conflict was a deletion, and this side keeps it deleted.
    fs.rmSync(path.join(paths.design, rel), { force: true })
    pruneEmpty(path.dirname(path.join(paths.design, rel)), stop)
  }
  state.conflicts = state.conflicts.filter((item) => item.path !== rel)
  saveState(paths, state)
}

/**
 * Close the unit's merge when nothing is left open: the working files are the result, and the next
 * push takes them. Returns the conflicts still open (the merge stays then).
 */
export function finishMerge(paths: DesignPaths, link: CloudLink, key: string, accept = false): Conflict[] {
  const state = readMergeState(paths, key)
  if (state) {
    const open = openConflicts(paths, state).filter((conflict) => !(accept && conflict.kind !== 'text'))
    if (open.length) return open
    fs.rmSync(mergeDir(paths, key), { recursive: true, force: true })
  }
  delete link.conflicts[key]
  return []
}
