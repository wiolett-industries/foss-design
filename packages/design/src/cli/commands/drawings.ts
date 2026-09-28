import http from 'node:http'
import type { DesignPaths } from '../../core/paths'
import { DesignProject } from '../../core/project'
import { DEV_URLS } from '../../core/sources'
import { liveServer } from '../../server/state'
import { type Drawing, type DrawingKey, drawingGroups, markupKey, parseDrawings } from '../../shared/drawings'
import { bold, CliError, dim, print } from '../log'
import { ensureServer } from './preview'

type CloudState = 'unlinked' | 'connecting' | 'synced' | 'offline'

/**
 * The preview server's drawings API. The server keeps them (and, when `.design` is linked, syncs
 * them with the cloud), so the CLI reads and erases through it. It answers the viewer's host only.
 */
function call(port: number, method: string, path: string): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method, path, headers: { host: `localhost:${port}` }, timeout: 30_000 },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => {
          let body: unknown = null
          try {
            body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
          } catch {}
          resolve({ status: res.statusCode ?? 0, body })
        })
      },
    )
    req.on('timeout', () => req.destroy(new Error('the preview server did not answer')))
    req.on('error', reject)
    req.end()
  })
}

/** The running preview server's port, starting one when there is none. */
export async function previewPort(paths: DesignPaths, quiet = false): Promise<number> {
  const wasRunning = await liveServer(paths)
  const server = await ensureServer(paths, {})
  if (!wasRunning && !quiet) print(dim(`Started the preview server at ${server.url} (\`design stop\` stops it).`))
  return server.port
}

export async function readDrawings(
  port: number,
  canvas: string,
): Promise<{ drawings: Record<DrawingKey, Drawing>; cloud: CloudState }> {
  const { status, body } = await call(port, 'GET', `/api/drawings/${encodeURIComponent(canvas)}`)
  if (status !== 200) throw new CliError((body as { error?: string } | null)?.error ?? `No canvas "${canvas}"`)
  const data = body as { drawings?: unknown; cloud?: CloudState }
  return { drawings: parseDrawings(data.drawings), cloud: data.cloud ?? 'unlinked' }
}

/** Drawings with strokes on them, by the page or screen id after the prefix. */
export function drawn(drawings: Record<DrawingKey, Drawing>, prefix: 'board' | 'markup'): Map<string, Drawing> {
  const found = new Map<string, Drawing>()
  for (const [key, drawing] of Object.entries(drawings))
    if (key.startsWith(`${prefix}:`) && drawing.strokes.length) found.set(key.slice(prefix.length + 1), drawing)
  return found
}

const texts = (drawing: Drawing) =>
  drawing.strokes.flatMap((stroke) => (stroke.kind === 'text' && stroke.text ? [stroke.text] : []))

/** `design drawings [<canvas>[/<screen>]] [--clear] [--json]`. */
export async function runDrawings(
  paths: DesignPaths,
  target: string | undefined,
  options: { json: boolean; clear: boolean },
) {
  const project = new DesignProject(paths, DEV_URLS)
  const [canvasId, screenId] = (target ?? '').split('/')
  const known = project.canvasIds()
  if (canvasId && !known.includes(canvasId))
    throw new CliError(`No canvas "${canvasId}". Canvases: ${known.join(', ') || 'none yet'}`)
  if (options.clear && !screenId) throw new CliError('Usage: design drawings <canvas>/<screen> --clear')
  const port = await previewPort(paths, options.json)

  if (options.clear) {
    const { status, body } = await call(
      port,
      'DELETE',
      `/api/drawings/${encodeURIComponent(canvasId!)}/${encodeURIComponent(markupKey(screenId!))}`,
    )
    if (status !== 200) throw new CliError((body as { error?: string } | null)?.error ?? `Could not erase (${status})`)
    const erased = (body as { erased?: number }).erased ?? 0
    if (options.json) print(JSON.stringify({ canvas: canvasId, screen: screenId, erased }))
    else
      print(
        erased
          ? `Erased the markup on ${canvasId}/${screenId} (${erased} strokes).`
          : `No markup on ${canvasId}/${screenId}.`,
      )
    return
  }

  const report = []
  for (const id of canvasId ? [canvasId] : known) {
    const { drawings, cloud } = await readDrawings(port, id)
    const doc = project.canvas(id)?.doc
    const pageTitle = (page: string) => doc?.pages.find((p) => p.id === page)?.title
    const itemTitle = (item: string) =>
      doc?.pages.flatMap((p) => p.sections.flatMap((s) => s.items)).find((i) => i.id === item)?.title
    const boards = [...drawn(drawings, 'board')].map(([page, drawing]) => ({
      page,
      title: pageTitle(page),
      strokes: drawing.strokes.length,
      groups: drawingGroups(drawing.strokes).length,
      texts: texts(drawing),
    }))
    const markup = [...drawn(drawings, 'markup')]
      .filter(([screen]) => !screenId || screen === screenId)
      .map(([screen, drawing]) => ({
        screen,
        title: itemTitle(screen),
        strokes: drawing.strokes.length,
        texts: texts(drawing),
      }))
    report.push({ canvas: id, cloud, boards: screenId ? [] : boards, markup })
  }

  if (options.json) {
    print(JSON.stringify({ canvases: report }, null, 2))
    return
  }
  const quote = (text: string) => `“${text.replace(/\s*\n\s*/g, ' / ').slice(0, 120)}”`
  let any = false
  for (const entry of report) {
    if (!entry.boards.length && !entry.markup.length) continue
    any = true
    const cloud =
      entry.cloud === 'synced'
        ? dim(' · in step with the cloud')
        : entry.cloud === 'unlinked'
          ? ''
          : dim(' · the cloud did not answer: drawings on this machine only')
    print(`${bold(entry.canvas)}${cloud}`)
    for (const board of entry.boards)
      print(
        `  board   ${board.page}${board.title ? dim(` (${board.title})`) : ''} · ${board.strokes} strokes${board.groups > 1 ? ` in ${board.groups} groups` : ''}${board.texts.length ? ` · ${board.texts.map(quote).join(', ')}` : ''}`,
      )
    for (const mark of entry.markup)
      print(
        `  markup  ${mark.screen}${mark.title ? dim(` (${mark.title})`) : ''} · ${mark.strokes} strokes${mark.texts.length ? ` · ${mark.texts.map(quote).join(', ')}` : ''}`,
      )
  }
  if (!any) print(canvasId ? `No drawings on ${target}.` : 'No drawings yet.')
  else print(dim('Pictures: design shot <canvas> --board | design shot <canvas>[/<screen>] --markup'))
}
