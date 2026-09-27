import { CliError, type Progress, silentProgress } from '../cli/log'
import type { DesignPaths } from '../core/paths'
import { CloudClient } from './client'
import { requireCredential } from './credentials'
import { type CloudLink, requireLink } from './state'
import { canvasUnit, isUnitKey, SYSTEM_UNIT } from './units'

export type UnitAction =
  // push
  | 'pushed'
  | 'created'
  | 'unchanged'
  | 'missing_locally'
  // pull
  | 'updated'
  | 'deleted'
  | 'kept'
  | 'up_to_date'
  | 'local_only'
  // both
  | 'archived'
  | 'banned'
  | 'remote_ahead'
  | 'conflict'

export interface UnitReport {
  unit: string
  action: UnitAction
  /** Revision the unit is at after the command (pushed or pulled head). */
  rev?: number
  /** Revision the unit was at here before the command. */
  baseRev?: number
  /** Head in the cloud, where it matters (remote_ahead, conflict). */
  headRev?: number
  /** Files written, changed and deleted here (pull). */
  files?: { added: number; changed: number; removed: number }
  /** Where the cloud version of a conflicting unit was written. */
  incoming?: string
  /** The unit in the web app, for units that are in the cloud after the command. */
  url?: string
  message?: string
}

export interface SyncReport {
  ok: boolean
  command: 'push' | 'pull'
  host: string
  project: string
  /** The project in the web app. */
  url: string
  units: UnitReport[]
  hints: string[]
  error?: { code: string; message: string; status?: number; limit?: string }
}

export interface SyncContext {
  paths: DesignPaths
  link: CloudLink
  client: CloudClient
  /** Progress lines; silent for --json. */
  log: (line: string) => void
  /** A line that updates in place for a long step (uploads, downloads); silent for --json. */
  progress: () => Progress
}

export function openSync(
  paths: DesignPaths,
  log: (line: string) => void,
  progress: () => Progress = () => silentProgress,
): SyncContext {
  const link = requireLink(paths)
  const credential = requireCredential(link.host)
  return { paths, link, client: new CloudClient(link.host, credential.token), log, progress }
}

/** Blob uploads and downloads in flight at once. */
export const TRANSFERS = 8

export const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`

/** " · 3.1 MB/s" once a second has passed, so the first figure is not noise. */
export function rate(bytes: number, started: number): string {
  const elapsed = (Date.now() - started) / 1000
  return elapsed < 1 ? '' : ` · ${(bytes / 1024 / 1024 / elapsed).toFixed(1)} MB/s`
}

export const seconds = (started: number) => `${((Date.now() - started) / 1000).toFixed(1)}s`

/** A project, or one of its units, in the web app: `/p/<project>`, `…/system`, `…/c/<canvas>`. */
export function webUrl(link: Pick<CloudLink, 'host' | 'project'>, unit?: string): string {
  const base = `${link.host.replace(/\/+$/, '')}/p/${encodeURIComponent(link.project)}`
  if (!unit) return base
  if (unit === SYSTEM_UNIT) return `${base}/system`
  return `${base}/c/${encodeURIComponent(unit.slice('canvas/'.length))}`
}

export function newReport(command: SyncReport['command'], link: CloudLink): SyncReport {
  return { ok: true, command, host: link.host, project: link.project, url: webUrl(link), units: [], hints: [] }
}

/** `system`, `@system`, `canvas/<id>` or a bare canvas id, as a unit key. */
export function unitArg(value: string): string {
  if (value === SYSTEM_UNIT || value === '@system') return SYSTEM_UNIT
  const key = value.startsWith('canvas/') ? value : canvasUnit(value)
  if (!isUnitKey(key)) throw new CliError(`"${value}" is not a unit: use system, a canvas id or canvas/<id>`)
  return key
}

export const unique = (keys: string[]) => [...new Set(keys)]

/** System first, then canvases by key. */
export const byUnit = (a: string, b: string) =>
  a === SYSTEM_UNIT ? -1 : b === SYSTEM_UNIT ? 1 : a < b ? -1 : a > b ? 1 : 0

export const plural = (count: number, word: string, many = `${word}s`) => `${count} ${count === 1 ? word : many}`
