import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { DesignPaths } from '../core/paths'

/** What a running preview server leaves in `.design/.cache/server.json`. */
export interface ServerState {
  pid: number
  port: number
  url: string
  root: string
  version: string
  startedAt: string
  /** `installStamp` when it started: the app's packages it pre-bundled (0.9.16+). */
  deps?: string
}

const stateFile = (paths: DesignPaths) => path.join(paths.cache, 'server.json')
export const logFile = (paths: DesignPaths) => path.join(paths.cache, 'server.log')

export function readState(paths: DesignPaths): ServerState | null {
  try {
    return JSON.parse(fs.readFileSync(stateFile(paths), 'utf8'))
  } catch {
    return null
  }
}

/**
 * Every preview server on this machine, one file per process: `$XDG_CACHE_HOME/foss-design/previews`
 * (`~/.cache/…` without it), `%LOCALAPPDATA%\foss-design\previews` on Windows. A process that died
 * without cleaning up (killed, crashed, or stopped on Windows, which ends processes at once) leaves
 * its file, and the next read drops it.
 */
export function registryDir(): string {
  const base =
    process.platform === 'win32'
      ? process.env.LOCALAPPDATA || process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Local')
      : process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache')
  return path.join(base, 'foss-design', 'previews')
}

const entryFile = (pid: number) => path.join(registryDir(), `${pid}.json`)

export function writeState(paths: DesignPaths, state: ServerState) {
  fs.mkdirSync(paths.cache, { recursive: true })
  fs.writeFileSync(stateFile(paths), `${JSON.stringify(state, null, 2)}\n`)
  try {
    fs.mkdirSync(registryDir(), { recursive: true })
    fs.writeFileSync(entryFile(state.pid), `${JSON.stringify(state, null, 2)}\n`)
  } catch {}
}

export function clearState(paths: DesignPaths, pid?: number) {
  const state = readState(paths)
  fs.rmSync(entryFile(pid ?? state?.pid ?? -1), { force: true })
  if (pid !== undefined && state && state.pid !== pid) return
  fs.rmSync(stateFile(paths), { force: true })
}

export interface PreviewEntry extends ServerState {
  /** The project's own server.json names this process; an untracked one is an orphan. */
  tracked: boolean
}

/** The preview servers running on this machine, oldest first. */
export function listPreviews(): PreviewEntry[] {
  let files: string[] = []
  try {
    files = fs.readdirSync(registryDir()).filter((name) => name.endsWith('.json'))
  } catch {
    return []
  }
  const found: PreviewEntry[] = []
  for (const name of files) {
    const file = path.join(registryDir(), name)
    let state: ServerState | null = null
    try {
      state = JSON.parse(fs.readFileSync(file, 'utf8')) as ServerState
    } catch {}
    if (!state?.pid || !pidAlive(state.pid)) {
      fs.rmSync(file, { force: true })
      continue
    }
    let recorded: ServerState | null = null
    try {
      recorded = JSON.parse(fs.readFileSync(path.join(state.root, '.design', '.cache', 'server.json'), 'utf8'))
    } catch {}
    found.push({ ...state, tracked: recorded?.pid === state.pid })
  }
  return found.sort((a, b) => a.startedAt.localeCompare(b.startedAt))
}

/** Stop one preview process and forget it; the project's server.json goes too when it names it. */
export async function stopPreview(entry: Pick<ServerState, 'pid' | 'root'>): Promise<void> {
  try {
    process.kill(entry.pid, 'SIGTERM')
  } catch {}
  const until = Date.now() + 5000
  while (Date.now() < until && pidAlive(entry.pid)) await new Promise((resolve) => setTimeout(resolve, 100))
  fs.rmSync(entryFile(entry.pid), { force: true })
  const stateAt = path.join(entry.root, '.design', '.cache', 'server.json')
  try {
    if ((JSON.parse(fs.readFileSync(stateAt, 'utf8')) as ServerState).pid === entry.pid)
      fs.rmSync(stateAt, { force: true })
  } catch {}
}

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** The recorded server, if it is still up and serves this project. */
export async function liveServer(paths: DesignPaths): Promise<ServerState | null> {
  const state = readState(paths)
  if (!state || !pidAlive(state.pid)) return null
  try {
    const response = await fetch(`http://127.0.0.1:${state.port}/api/health`, { signal: AbortSignal.timeout(1500) })
    if (!response.ok) return null
    const health = (await response.json()) as { root?: string }
    return health.root === paths.root ? state : null
  } catch {
    return null
  }
}
