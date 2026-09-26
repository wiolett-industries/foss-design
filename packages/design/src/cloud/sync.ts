import { CliError } from '../cli/log'
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
  message?: string
}

export interface SyncReport {
  ok: boolean
  command: 'push' | 'pull'
  host: string
  project: string
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
}

export function openSync(paths: DesignPaths, log: (line: string) => void): SyncContext {
  const link = requireLink(paths)
  const credential = requireCredential(link.host)
  return { paths, link, client: new CloudClient(link.host, credential.token), log }
}

export function newReport(command: SyncReport['command'], link: CloudLink): SyncReport {
  return { ok: true, command, host: link.host, project: link.project, units: [], hints: [] }
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
