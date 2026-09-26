import fs from 'node:fs'
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

export function writeState(paths: DesignPaths, state: ServerState) {
  fs.mkdirSync(paths.cache, { recursive: true })
  fs.writeFileSync(stateFile(paths), `${JSON.stringify(state, null, 2)}\n`)
}

export function clearState(paths: DesignPaths, pid?: number) {
  const state = readState(paths)
  if (pid !== undefined && state && state.pid !== pid) return
  fs.rmSync(stateFile(paths), { force: true })
}

function pidAlive(pid: number): boolean {
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
