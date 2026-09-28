import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { type DesignPaths, PKG, packageVersion } from '../../core/paths'
import { DesignProject } from '../../core/project'
import { DEV_URLS } from '../../core/sources'
import { startDevServer } from '../../server'
import {
  clearState,
  listPreviews,
  liveServer,
  logFile,
  pidAlive,
  readState,
  type ServerState,
  stopPreview,
} from '../../server/state'
import { installStamp } from '../../server/vite'
import { bold, CliError, dim, print } from '../log'

export function openBrowser(url: string) {
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '""', url]]
        : ['xdg-open', [url]]
  const child = spawn(command, args as string[], { stdio: 'ignore', detached: true, windowsHide: true })
  child.on('error', () => {})
  child.unref()
}

function printUrls(paths: DesignPaths, url: string) {
  const project = new DesignProject(paths, DEV_URLS)
  print(`${bold('Preview')} ${url}`)
  for (const id of project.canvasIds()) print(`  ${dim('canvas')} ${url}/c/${id}`)
  if (project.system()) print(`  ${dim('system')} ${url}/system`)
}

async function waitForServer(paths: DesignPaths, timeoutMs: number): Promise<ServerState | null> {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    const live = await liveServer(paths)
    if (live) return live
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  return null
}

export async function stopServer(paths: DesignPaths): Promise<boolean> {
  const state = readState(paths)
  if (!state) return false
  try {
    process.kill(state.pid, 'SIGTERM')
  } catch {
    clearState(paths)
    return false
  }
  const until = Date.now() + 5000
  while (Date.now() < until) {
    try {
      process.kill(state.pid, 0)
    } catch {
      break
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  clearState(paths)
  return true
}

/** Start the server in the background (or reuse the running one) and print where it is. */
export async function ensureServer(
  paths: DesignPaths,
  options: { port?: number; restart?: boolean },
): Promise<ServerState> {
  const live = await liveServer(paths)
  // A server left running by another foss-design version would serve its old viewer and runtime.
  const stale = live && live.version !== packageVersion()
  // One started before the app's packages were installed again serves the old pre-bundled copies.
  const installed =
    live?.deps !== undefined && live.deps !== installStamp(paths, new DesignProject(paths, DEV_URLS).appDir())
  if (live && !options.restart && !stale && !installed) return live
  if (stale)
    print(dim(`Restarting the preview server: it runs foss-design ${live.version}, this is ${packageVersion()}.`))
  else if (installed) print(dim("Restarting the preview server: the app's packages changed since it started."))
  if (live) await stopServer(paths)
  // Any other server still running for this project goes too: one busy past the health check
  // (a big canvas loading) would otherwise keep running untracked once server.json names the new one.
  const recorded = readState(paths)
  if (recorded && pidAlive(recorded.pid)) await stopPreview(recorded)
  for (const other of listPreviews()) if (other.root === paths.root) await stopPreview(other)
  fs.mkdirSync(paths.cache, { recursive: true })
  const log = fs.openSync(logFile(paths), 'w')
  const args = [PKG.cli, 'preview', '--foreground', '--root', paths.root]
  if (options.port) args.push('--port', String(options.port))
  // windowsHide: on Windows a detached process gets a console window of its own otherwise.
  const child = spawn(process.execPath, args, {
    detached: true,
    windowsHide: true,
    stdio: ['ignore', log, log],
    cwd: paths.root,
  })
  child.unref()
  const state = await waitForServer(paths, 40000)
  if (!state) {
    const tail = fs.existsSync(logFile(paths)) ? fs.readFileSync(logFile(paths), 'utf8').split('\n').slice(-25) : []
    throw new CliError(`The preview server did not start.\n${tail.join('\n')}`)
  }
  return state
}

export async function runPreview(
  paths: DesignPaths,
  options: { open?: string | boolean; port?: number; foreground: boolean; restart: boolean },
) {
  const openPath = typeof options.open === 'string' ? options.open : ''
  if (options.foreground) {
    const server = await startDevServer({ root: paths.root, port: options.port })
    printUrls(paths, server.url)
    if (options.open) openBrowser(`${server.url}${openPath}`)
    const shutdown = () => {
      void server.close().finally(() => process.exit(0))
    }
    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)
    return
  }
  const state = await ensureServer(paths, options)
  printUrls(paths, state.url)
  if (options.open) openBrowser(`${state.url}${openPath}`)
}

export async function runStop(paths: DesignPaths) {
  print((await stopServer(paths)) ? 'Stopped the preview server.' : 'No preview server is running for this project.')
}

const since = (iso: string) => {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

/** `design previews [--json]`: every preview server on this machine, orphans marked. */
export function runPreviews(options: { json: boolean }) {
  const previews = listPreviews()
  if (options.json) return print(JSON.stringify({ previews }, null, 2))
  if (!previews.length) return print('No preview servers are running.')
  for (const preview of previews) {
    const orphan = preview.tracked ? '' : ` ${bold('orphan')} ${dim('(its project names another server)')}`
    print(`${preview.url}  ${preview.root}${orphan}`)
    print(dim(`  foss-design ${preview.version} · pid ${preview.pid} · up ${since(preview.startedAt)}`))
  }
}

/** `design stop --all`: every preview server on this machine. */
export async function runStopAll() {
  const previews = listPreviews()
  for (const preview of previews) await stopPreview(preview)
  print(
    previews.length
      ? `Stopped ${previews.length} preview server${previews.length === 1 ? '' : 's'}.`
      : 'No preview servers are running.',
  )
}
