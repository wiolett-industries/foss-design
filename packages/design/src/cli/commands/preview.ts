import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { type DesignPaths, PKG } from '../../core/paths'
import { DesignProject } from '../../core/project'
import { DEV_URLS } from '../../core/sources'
import { startDevServer } from '../../server'
import { clearState, liveServer, logFile, readState, type ServerState } from '../../server/state'
import { bold, CliError, dim, print } from '../log'

export function openBrowser(url: string) {
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '""', url]]
        : ['xdg-open', [url]]
  const child = spawn(command, args as string[], { stdio: 'ignore', detached: true })
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
  if (live && !options.restart) return live
  if (live) await stopServer(paths)
  fs.mkdirSync(paths.cache, { recursive: true })
  const log = fs.openSync(logFile(paths), 'w')
  const args = [PKG.cli, 'preview', '--foreground', '--root', paths.root]
  if (options.port) args.push('--port', String(options.port))
  const child = spawn(process.execPath, args, { detached: true, stdio: ['ignore', log, log], cwd: paths.root })
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
