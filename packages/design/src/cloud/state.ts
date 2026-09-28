import fs from 'node:fs'
import path from 'node:path'
import { CliError } from '../cli/log'
import type { DesignPaths } from '../core/paths'
import type { RemoteUnit } from './client'
import { hashBuffer, isUnitKey, type Manifest } from './units'

/** What the last push or pull left a unit at: its revision and the sha256 of every source file. */
export interface UnitBase {
  rev: number
  files: Record<string, string>
  /**
   * Files outside the unit its last push built in (another canvas's screen, a shared module, the
   * app's source through an alias), relative to `.design`, with their sha256 then: one that
   * changes since makes the unit changed too, though none of its own files did (0.9.16+).
   */
  deps?: Record<string, string>
}

/** `.design/cloud.json`. */
export interface CloudLink {
  host: string
  project: string
  units: Record<string, UnitBase>
  /** Units pulled with changes on both sides, and the head that was written to `incoming/`. */
  conflicts: Record<string, number>
  /** The cloud project's name at the last sync: the project's name here. */
  name?: string
  /** sha256 of the project icon at the last sync (null: none), the base both sides are compared to. */
  icon?: string | null
}

export type UnitState = 'in_sync' | 'local_changes' | 'remote_ahead' | 'conflict' | 'archived'

export interface UnitStatus {
  key: string
  state: UnitState
  /** Revision of the last push or pull here; 0 when never synced. */
  baseRev: number
  /** Head in the cloud; null when the unit is not there (or the cloud was not asked). */
  headRev: number | null
  /** The unit has files here. */
  local: boolean
  /** Files changed here since the base (relative to `.design`), not counting ones that already match the head. */
  changed: string[]
  /** Files outside the unit that its last push built in and that changed since (relative to `.design`). */
  usesChanged: string[]
  /** The cloud has a newer revision, or deleted a unit that was synced here. */
  ahead: boolean
  /**
   * Files the newer cloud revision changed against the base. Empty while `ahead` means a build-only
   * revision (a system push rebuilds every canvas): pull moves the base and keeps local changes.
   */
  remoteChanged: string[]
  /** Synced here before and deleted in the cloud since. */
  deletedRemotely: boolean
  /** Head recorded by a pull that found changes on both sides. */
  conflictRev?: number
}

export const linkFile = (paths: DesignPaths) => path.join(paths.design, 'cloud.json')
export const cloudCache = (paths: DesignPaths) => path.join(paths.cache, 'cloud')
export const incomingDir = (paths: DesignPaths, key: string) =>
  path.join(cloudCache(paths), 'incoming', ...key.split('/'))

export function readLink(paths: DesignPaths): CloudLink | null {
  const file = linkFile(paths)
  if (!fs.existsSync(file)) return null
  let data: Partial<CloudLink>
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    throw new CliError(`${file} is not valid JSON (${(error as Error).message}); run \`design link <project>\` again`)
  }
  if (typeof data?.host !== 'string' || typeof data.project !== 'string')
    throw new CliError(`${file} has no host or project; run \`design link <project>\` again`)
  const units: Record<string, UnitBase> = {}
  for (const [key, base] of Object.entries(data.units ?? {})) {
    if (!isUnitKey(key) || typeof base?.rev !== 'number') continue
    units[key] = { rev: base.rev, files: base.files && typeof base.files === 'object' ? base.files : {} }
    if (base.deps && typeof base.deps === 'object') units[key]!.deps = base.deps
  }
  const conflicts: Record<string, number> = {}
  for (const [key, rev] of Object.entries(data.conflicts ?? {})) if (typeof rev === 'number') conflicts[key] = rev
  return {
    host: data.host,
    project: data.project,
    units,
    conflicts,
    ...(typeof data.name === 'string' ? { name: data.name } : {}),
    ...(typeof data.icon === 'string' || data.icon === null ? { icon: data.icon } : {}),
  }
}

export function requireLink(paths: DesignPaths): CloudLink {
  const link = readLink(paths)
  if (!link) throw new CliError('This .design is not linked to a cloud project. Run `design link` to pick one.')
  return link
}

export function writeLink(paths: DesignPaths, link: CloudLink) {
  const sorted = <T>(record: Record<string, T>) =>
    Object.fromEntries(Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
  const file = linkFile(paths)
  const temp = `${file}.${process.pid}.tmp`
  const data: CloudLink = {
    host: link.host,
    project: link.project,
    ...(link.name !== undefined ? { name: link.name } : {}),
    ...(link.icon !== undefined ? { icon: link.icon } : {}),
    units: sorted(link.units),
    conflicts: sorted(link.conflicts),
  }
  fs.writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`)
  fs.renameSync(temp, file)
}

export const hashes = (manifest: Manifest): Record<string, string> =>
  Object.fromEntries(Object.entries(manifest).map(([file, entry]) => [file, entry.hash]))

/** Paths whose hash differs between two `{path: hash}` maps. */
export function diffFiles(a: Record<string, string>, b: Record<string, string>): string[] {
  const out: string[] = []
  for (const file of new Set([...Object.keys(a), ...Object.keys(b)])) if (a[file] !== b[file]) out.push(file)
  return out.sort()
}

/**
 * Where one unit stands between this `.design`, its base in cloud.json and the
 * cloud head. Without `remote` (not signed in, offline) only local changes
 * are known.
 */
export function unitStatus(
  key: string,
  link: CloudLink,
  local: Manifest | undefined,
  remote: Map<string, RemoteUnit> | null,
  /** `.design`, to look at the files outside the unit its last push built in; left out, they are not. */
  design?: string,
): UnitStatus {
  const base = link.units[key]
  const baseRev = base?.rev ?? 0
  const localFiles = hashes(local ?? {})
  const remoteUnit = remote?.get(key)
  const remoteFiles = remoteUnit ? hashes(remoteUnit.manifest) : {}
  const deletedRemotely = !!remote && !remoteUnit && baseRev > 0
  const ahead = remote ? (remoteUnit ? remoteUnit.headRev > baseRev : baseRev > 0) : false
  let changed = diffFiles(localFiles, base?.files ?? {})
  // An edit that already matches the head is not a change of ours.
  if (ahead) changed = changed.filter((file) => localFiles[file] !== remoteFiles[file])
  const remoteChanged = ahead ? diffFiles(remoteFiles, base?.files ?? {}) : []
  const usesChanged = design ? changedDeps(design, base?.deps) : []
  const conflictRev = link.conflicts[key]
  let state: UnitState
  if (remoteUnit?.archived) state = 'archived'
  else if (conflictRev !== undefined || (changed.length && remoteChanged.length && !deletedRemotely)) state = 'conflict'
  else if (ahead) state = 'remote_ahead'
  else if (changed.length || usesChanged.length) state = 'local_changes'
  else state = 'in_sync'
  return {
    key,
    state,
    baseRev,
    headRev: remoteUnit ? remoteUnit.headRev : null,
    local: Object.keys(localFiles).length > 0,
    changed,
    usesChanged,
    ahead,
    remoteChanged,
    deletedRemotely,
    conflictRev,
  }
}

/** Which of `deps` (relative to `design`) differ from the sha256 recorded for them, or are gone. */
export function changedDeps(design: string, deps: Record<string, string> | undefined): string[] {
  const out: string[] = []
  for (const [rel, hash] of Object.entries(deps ?? {})) {
    let now: string | null = null
    try {
      now = hashBuffer(fs.readFileSync(path.join(design, rel)))
    } catch {}
    if (now !== hash) out.push(rel)
  }
  return out.sort()
}

/** Every unit known here, in the link or in the cloud: system first, then canvases by id. */
export function allUnitKeys(
  link: CloudLink,
  local: Map<string, unknown>,
  remote: Map<string, RemoteUnit> | null,
): string[] {
  const keys = new Set([...local.keys(), ...Object.keys(link.units), ...Object.keys(link.conflicts)])
  for (const key of remote?.keys() ?? []) keys.add(key)
  return [...keys].sort((a, b) => (a === 'system' ? -1 : b === 'system' ? 1 : a < b ? -1 : a > b ? 1 : 0))
}
