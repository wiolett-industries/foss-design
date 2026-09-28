import fs from 'node:fs'
import http, { type IncomingMessage, type ServerResponse } from 'node:http'
import path from 'node:path'
import sirv from 'sirv'
import { createServer, searchForWorkspaceRoot, type ViteDevServer } from 'vite'
import { designPaths, isInside, PKG, packageVersion, relToDesign } from '../core/paths'
import { DesignProject } from '../core/project'
import { DEV_URLS, type ScreenSource } from '../core/sources'
import { SYSTEM_CANVAS } from '../core/system'
import { escapeHtml, toPosix } from '../core/text'
import type { Theme } from '../shared/types'
import { handleApi, sendJson } from './api'
import { DrawingHub } from './drawings'
import { Entries, HTML_BOOT } from './entries'
import { EventHub } from './events'
import { FRAME_HOST, isAllowedHost, isFrameApi, parseHost, VIEWER_HOST } from './hosts'
import { type FrameHead, injectIntoHtml, moduleShell, optsOutOfSystem } from './html'
import { linkShippedPackages } from './links'
import { SnapshotStore } from './snapshots'
import { clearState, writeState } from './state'
import { appPlugins, baseConfig, dropStaleDepCache, installStamp } from './vite'

/** 0: any free port, so previews of several projects run side by side. */
export const DEFAULT_PORT = 0

export interface DevServerOptions {
  root: string
  port?: number
  host?: string
  /** Write `.design/.cache/server.json` so the CLI can find this server. */
  record?: boolean
}

export interface DevServer {
  url: string
  port: number
  project: DesignProject
  close(): Promise<void>
}

async function listen(server: http.Server, port: number, host: string): Promise<number> {
  const attempt = (candidate: number) =>
    new Promise<number>((resolve, reject) => {
      const onError = (error: Error) => {
        server.off('listening', onListening)
        reject(error)
      }
      const onListening = () => {
        server.off('error', onError)
        resolve((server.address() as { port: number }).port)
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(candidate, host)
    })
  if (port === 0) return attempt(0)
  // An asked-for port that is taken falls through to the next ones.
  for (let candidate = port; candidate < port + 40; candidate++) {
    try {
      return await attempt(candidate)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error
    }
  }
  throw new Error(`No free port between ${port} and ${port + 40}`)
}

function notFoundPage(res: ServerResponse, title: string, text: string) {
  res.writeHead(404, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
  res.end(
    `<!doctype html><meta charset="utf-8"><body style="margin:0;display:grid;place-items:center;min-height:100vh;` +
      `font:14px/1.5 ui-monospace,Menlo,monospace;background:#f5f6f8;color:#3a414a"><div style="max-width:520px;padding:24px">` +
      `<div style="font-weight:600;margin-bottom:6px">${escapeHtml(title)}</div>${escapeHtml(text)}</div></body>`,
  )
}

export async function startDevServer(options: DevServerOptions): Promise<DevServer> {
  const paths = designPaths(options.root)
  if (!fs.existsSync(paths.design)) throw new Error(`No .design folder in ${options.root}; run \`design init\``)
  fs.mkdirSync(paths.cache, { recursive: true })

  const snapshots = new SnapshotStore(paths.snapshots)
  const project = new DesignProject(paths, DEV_URLS, snapshots.lookup)
  const entries = new Entries(project)
  entries.sync()
  const links = linkShippedPackages(paths, project.appDir())
  const events = new EventHub()
  const drawings = new DrawingHub(paths, (id) => project.canvasIds().includes(id))
  const httpServer = http.createServer()
  const listening = () => (httpServer.address() as { port: number } | null)?.port ?? 0

  dropStaleDepCache(paths, project.appDir())
  const deps = installStamp(paths, project.appDir())
  const fromApp = await appPlugins(project, 'serve')
  for (const problem of fromApp.problems) console.warn(`warning: ${problem}`)
  const base = baseConfig(project, fromApp.plugins)
  const vite: ViteDevServer = await createServer({
    ...base,
    base: '/_fs/',
    appType: 'custom',
    server: {
      middlewareMode: { server: httpServer },
      // Without this Vite 8 opens HMR on its own port (24678), which a second preview then collides with.
      hmr: { server: httpServer },
      fs: {
        strict: true,
        allow: [searchForWorkspaceRoot(paths.root), paths.root, paths.design, PKG.root, ...links.allow],
      },
      watch: {
        // `.cache` is ours (server.log, snapshots, builds): a change there must not reload frames. The
        // generated entries are modules the frames load, so those stay watched.
        ignored: (file: string) => {
          const rel = toPosix(path.relative(paths.cache, file))
          const inCache = rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
          return inCache && rel !== 'entries' && !rel.startsWith('entries/')
        },
      },
      // Vite forwards frames' console warnings to the server when an agent runs it; the runtime
      // already reports errors, and the log they would fill sits in `.cache`.
      forwardConsole: false,
    },
    optimizeDeps: {
      entries: entries.files().map((file) => toPosix(path.relative(paths.design, file))),
    },
  })

  const publicDir = project.publicDir()
  const servePublic = publicDir ? sirv(publicDir, { dev: true }) : null
  const publicRel = (encoded: string) => {
    try {
      return decodeURIComponent(encoded)
    } catch {
      return null
    }
  }
  const viewer = fs.existsSync(PKG.viewer) ? sirv(PKG.viewer, { dev: true, etag: true }) : null
  const viewerIndex = path.join(PKG.viewer, 'index.html')
  // The viewer is built with relative asset URLs; a base keeps them right on nested routes like /c/x/p/y.
  const serveViewerIndex = (req: IncomingMessage, res: ServerResponse, url: URL) => {
    // The frames' host serves no viewer: a viewer there would put its frames on the viewer's own host.
    if (parseHost(req.headers.host)?.name === FRAME_HOST) {
      res.writeHead(302, { location: `http://${VIEWER_HOST}:${listening()}${url.pathname}${url.search}` })
      res.end()
      return
    }
    const html = fs.readFileSync(viewerIndex, 'utf8').replace(/<head>/i, '<head>\n<base href="/">')
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    res.end(html)
  }
  const ctx = { project, events, snapshots, drawings }
  // Frame HTML goes through transformIndexHtml, which puts the /_fs/ base in front of these.
  const systemCssUrl = `/${relToDesign(paths, entries.systemCssFile())}`
  const bootUrl = `/${relToDesign(paths, path.join(entries.dir, HTML_BOOT))}`

  const frameHead = (source: ScreenSource, extra: Partial<FrameHead> = {}): FrameHead => {
    const canvasTheme: Theme | undefined =
      source.canvas === SYSTEM_CANVAS ? undefined : project.canvas(source.canvas)?.doc.theme
    return {
      source,
      theme: canvasTheme ?? 'light',
      fonts: project.system()?.doc.fonts ?? [],
      snapshots: source.canvas !== SYSTEM_CANVAS,
      autoHeight: source.autoHeight ?? false,
      // Vite serves the public folder under the frames' base.
      public: { base: '/_fs/', files: project.publicFiles() },
      ...extra,
    }
  }

  const serveModuleShell = async (req: IncomingMessage, res: ServerResponse, url: URL) => {
    const [canvas = '', id = ''] = url.pathname.slice('/_s/'.length).split('/').map(decodeURIComponent)
    const source = project.source(canvas, id)
    if (source?.format !== 'module') {
      notFoundPage(res, 'Screen not found', `No screen "${id}" in "${canvas}". Check canvas.json.`)
      return
    }
    if (!fs.existsSync(entries.entryFile(source))) entries.sync()
    const entryUrl = `/${relToDesign(paths, entries.entryFile(source))}`
    const html = await vite.transformIndexHtml(url.pathname + url.search, moduleShell(frameHead(source), entryUrl))
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    res.end(html)
    void req
  }

  const serveHtmlScreen = async (res: ServerResponse, url: URL) => {
    const rel = decodeURIComponent(url.pathname.slice('/_fs/'.length))
    const file = path.resolve(paths.design, rel)
    if (!isInside(paths.design, file) || !fs.existsSync(file)) {
      notFoundPage(res, 'Screen not found', `No file .design/${rel}`)
      return
    }
    const [canvas = '', id = ''] = (url.searchParams.get('__design') ?? '').split('/')
    const found = project.source(canvas, id)
    const source: ScreenSource = found ?? {
      key: `${canvas}/${id}`,
      canvas,
      id,
      title: path.basename(file),
      file,
      format: 'html',
      props: {},
      system: true,
    }
    const raw = fs.readFileSync(file, 'utf8')
    const withSystem = source.system && !optsOutOfSystem(raw)
    const html = injectIntoHtml(
      raw,
      frameHead(source, { systemCss: withSystem ? systemCssUrl : undefined, boot: bootUrl }),
    )
    const transformed = await vite.transformIndexHtml(`/${rel}`, html, url.pathname + url.search)
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    res.end(transformed)
  }

  httpServer.on('request', (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const fail = (error: unknown) => {
      if (res.headersSent) return res.end()
      sendJson(res, 500, { error: (error as Error)?.stack ?? String(error) })
    }
    if (!isAllowedHost(req.headers.host, listening(), options.host)) {
      sendJson(res, 403, { error: `This preview server answers on localhost:${listening()} only.` })
      return
    }
    try {
      if (url.pathname.startsWith('/api/')) {
        if (parseHost(req.headers.host)?.name === FRAME_HOST && !isFrameApi(url.pathname, req.method ?? 'GET')) {
          sendJson(res, 403, { error: `Frames' host: open the viewer on http://${VIEWER_HOST}:${listening()}.` })
          return
        }
        handleApi(ctx, req, res, url)
          .then((handled) => {
            if (!handled) sendJson(res, 404, { error: 'unknown endpoint' })
          })
          .catch(fail)
        return
      }
      if (url.pathname.startsWith('/_s/')) {
        serveModuleShell(req, res, url).catch(fail)
        return
      }
      if (url.pathname.startsWith('/_fs/') && url.searchParams.has('__design') && /\.html?$/i.test(url.pathname)) {
        serveHtmlScreen(res, url).catch(fail)
        return
      }
      if (url.pathname.startsWith('/_fs/')) {
        // Vite serves the whole public folder under the base; dot-files and links out of it stay private.
        const rel = publicRel(url.pathname.slice('/_fs/'.length))
        if (publicDir && rel !== null && !project.isPublicFile(rel) && fs.existsSync(path.join(publicDir, rel))) {
          notFoundPage(res, 'Not found', url.pathname)
          return
        }
        vite.middlewares(req, res, () => notFoundPage(res, 'Not found', url.pathname))
        return
      }
      if (viewer) {
        const notViewer = () => {
          // A root path the runtime has not pointed at the frames' base yet, e.g. from markup set with innerHTML.
          const rel = publicRel(url.pathname.slice(1))
          if (servePublic && rel !== null && project.isPublicFile(rel))
            servePublic(req, res, () => notFoundPage(res, 'Not found', url.pathname))
          else if (path.extname(url.pathname)) notFoundPage(res, 'Not found', url.pathname)
          else serveViewerIndex(req, res, url)
        }
        if (url.pathname === '/' || url.pathname === '/index.html') serveViewerIndex(req, res, url)
        else viewer(req, res, notViewer)
      } else notFoundPage(res, 'Viewer is not built', 'Run `pnpm build` in the foss-design package.')
    } catch (error) {
      fail(error)
    }
  })

  // Drawings sockets; Vite's HMR socket on the same server answers only its own protocol.
  httpServer.on('upgrade', (req: IncomingMessage, socket, head: Buffer) => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
    if (pathname.startsWith('/api/drawings/')) drawings.upgrade(req, socket, head, listening(), options.host)
    else if (pathname.startsWith('/api/')) socket.destroy()
  })

  // Keep the project model and open viewers in step with the files.
  const pending = new Map<string, () => void>()
  let flushTimer: ReturnType<typeof setTimeout> | undefined
  const queue = (key: string, run: () => void) => {
    pending.set(key, run)
    clearTimeout(flushTimer)
    flushTimer = setTimeout(() => {
      const runs = [...pending.values()]
      pending.clear()
      try {
        for (const job of runs) job()
        entries.sync()
      } catch (error) {
        console.error('[design]', (error as Error).message)
      }
    }, 60)
  }
  // Tailwind scans its sources again only when the system stylesheet is built again, and a file
  // nothing imports yet (a new screen, a new component of the app) changes nothing that stylesheet
  // depends on: every file added to what it scans rebuilds it, in open frames too.
  const scanned = entries.scannedDirs()
  vite.watcher.add(scanned.filter((dir) => !isInside(paths.design, dir)))
  let cssTimer: ReturnType<typeof setTimeout> | undefined
  const rebuildCss = () => {
    clearTimeout(cssTimer)
    cssTimer = setTimeout(() => {
      for (const mod of vite.moduleGraph.getModulesByFile(entries.systemCssFile()) ?? []) void vite.reloadModule(mod)
    }, 80)
  }
  vite.watcher.on('add', (file) => {
    if (file.split(path.sep).includes('node_modules') || isInside(paths.cache, file)) return
    if (scanned.some((dir) => isInside(dir, file))) rebuildCss()
  })
  vite.watcher.on('all', (event, file) => {
    if (publicDir && isInside(publicDir, file)) project.invalidatePublic()
    const rel = toPosix(path.relative(paths.design, file))
    if (rel.startsWith('..') || rel.startsWith('.cache/') || rel.startsWith('node_modules/')) return
    if (rel === 'design.json') {
      queue('config', () => {
        project.invalidateConfig()
        events.send({ type: 'project' })
      })
    } else if (rel.startsWith('system/')) {
      queue('system', () => {
        project.invalidateSystem()
        events.send({ type: 'system' })
        events.send({ type: 'project' })
      })
    } else if (rel.startsWith('canvas/')) {
      const [, id, ...rest] = rel.split('/')
      if (!id) return
      if (rest.join('/') === '.drawings.json') {
        drawings.fileChanged(id)
        return
      }
      const structural = event !== 'change' || rest.join('/') === 'canvas.json'
      if (!structural) return
      queue(`canvas:${id}`, () => {
        project.invalidateCanvas(id)
        events.send({ type: 'canvas', id })
        events.send({ type: 'project' })
      })
    }
  })

  const host = options.host ?? '127.0.0.1'
  const port = await listen(httpServer, options.port ?? project.config().config.port ?? DEFAULT_PORT, host)
  const url = `http://localhost:${port}`
  if (options.record !== false) {
    writeState(paths, {
      pid: process.pid,
      port,
      url,
      root: paths.root,
      version: packageVersion(),
      startedAt: new Date().toISOString(),
      deps,
    })
  }

  let closed = false
  return {
    url,
    port,
    project,
    async close() {
      if (closed) return
      closed = true
      events.close()
      drawings.close()
      await vite.close()
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve())
        httpServer.closeAllConnections()
      })
      if (options.record !== false) clearState(paths, process.pid)
    },
  }
}
