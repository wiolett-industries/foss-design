import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import sirv from 'sirv'
import { buildSite } from '../build/static'
import type { DesignPaths } from '../core/paths'

export interface ServedBuild {
  /** `http://127.0.0.1:<port>`, the root of the built site. */
  base: string
  /** A JSON file of the build (`api/canvas/<id>.json`, `api/system.json`), or null. */
  read<T>(rel: string): T | null
  close(): Promise<void>
}

/**
 * Build screens as `design push` does into `.design/.cache/<name>` and serve the result as files:
 * a frame then loads its few production bundles instead of the dev server's module graph, the way
 * the cloud serves it. `design check --built` and snapshots use it.
 */
export async function serveBuild(
  paths: DesignPaths,
  name: string,
  options: { canvases?: string[]; includeSystem: boolean },
): Promise<ServedBuild> {
  const out = path.join(paths.cache, name)
  fs.rmSync(out, { recursive: true, force: true })
  await buildSite(paths, out, {
    canvases: options.canvases,
    includeSystem: options.includeSystem,
    includeViewer: false,
  })
  const files = sirv(out, { dev: true })
  const server = http.createServer((req, res) => {
    // Segment by segment, as the cloud's content host does: sirv leaves `%40` (from `@system`) encoded.
    const url = new URL(req.url ?? '/', 'http://localhost')
    const segments = url.pathname.split('/').map((segment) => {
      try {
        return decodeURIComponent(segment)
      } catch {
        return segment
      }
    })
    req.url = segments.join('/') + url.search
    files(req, res, () => {
      res.statusCode = 404
      res.end('Not found')
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    base: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    read<T>(rel: string) {
      try {
        return JSON.parse(fs.readFileSync(path.join(out, rel), 'utf8')) as T
      } catch {
        return null
      }
    },
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}
