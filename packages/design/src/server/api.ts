import fs from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import { isInside, packageVersion } from '../core/paths'
import type { DesignProject } from '../core/project'
import type { Theme } from '../shared/types'
import type { EventHub } from './events'
import type { SnapshotStore } from './snapshots'

export function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

function readBody(req: IncomingMessage, limit = 25 * 1024 * 1024): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('body too large'))
        req.destroy()
      } else chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

export interface ApiContext {
  project: DesignProject
  events: EventHub
  snapshots: SnapshotStore
}

/** `/api/*`. Returns false for paths it does not know. */
export async function handleApi(
  ctx: ApiContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  const { project, events, snapshots } = ctx
  const route = url.pathname.slice('/api'.length)
  const method = req.method ?? 'GET'

  if (route === '/health') {
    sendJson(res, 200, { ok: true, root: project.paths.root, version: packageVersion(), pid: process.pid })
    return true
  }
  if (route === '/events') {
    events.attach(req, res)
    return true
  }
  if (route === '/project') {
    sendJson(res, 200, project.info(false))
    return true
  }
  if (route === '/system') {
    const system = project.system()
    if (!system) sendJson(res, 404, { error: 'This project has no design system yet (.design/system).' })
    else sendJson(res, 200, system.doc)
    return true
  }
  const canvasMatch = /^\/canvas\/([^/]+)$/.exec(route)
  if (canvasMatch) {
    const canvas = project.canvas(decodeURIComponent(canvasMatch[1]!))
    if (!canvas) sendJson(res, 404, { error: `No canvas "${decodeURIComponent(canvasMatch[1]!)}"` })
    else sendJson(res, 200, canvas.doc)
    return true
  }
  if (route === '/source') {
    const rel = url.searchParams.get('path') ?? ''
    const file = path.resolve(project.paths.root, rel)
    if (!rel || !isInside(project.paths.root, file) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      sendJson(res, 404, { error: 'not found' })
      return true
    }
    if (fs.statSync(file).size > 2 * 1024 * 1024) {
      sendJson(res, 413, { error: 'file too large to show' })
      return true
    }
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
    res.end(fs.readFileSync(file, 'utf8'))
    return true
  }
  const snapshotPost = /^\/snapshots\/([^/]+)\/([^/]+)$/.exec(route)
  if (snapshotPost && method === 'POST') {
    const canvas = decodeURIComponent(snapshotPost[1]!)
    const id = decodeURIComponent(snapshotPost[2]!)
    const theme: Theme = url.searchParams.get('theme') === 'dark' ? 'dark' : 'light'
    const heightParam = Number(url.searchParams.get('height'))
    const height = Number.isFinite(heightParam) && heightParam > 0 ? Math.round(heightParam) : undefined
    try {
      const body = await readBody(req)
      if (body.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('not a PNG')
      const { url: snapshotUrl } = snapshots.save(canvas, id, theme, body, height)
      project.invalidateCanvas(canvas)
      events.send({ type: 'snapshot', canvas, id, theme, url: snapshotUrl, height })
      sendJson(res, 200, { url: snapshotUrl })
    } catch (error) {
      sendJson(res, 400, { error: (error as Error).message })
    }
    return true
  }
  if (snapshotPost && method === 'GET') {
    const file = snapshots.file(decodeURIComponent(snapshotPost[1]!), decodeURIComponent(snapshotPost[2]!))
    if (!file) {
      res.writeHead(404)
      res.end()
      return true
    }
    res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=31536000, immutable' })
    fs.createReadStream(file).pipe(res)
    return true
  }
  return false
}
