import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DEFAULT_DEVICE, DEVICES } from '../shared/devices'
import type {
  CanvasDoc,
  CanvasItem,
  CanvasPage,
  CanvasSection,
  CanvasSummary,
  FrameSize,
  Issue,
  Theme,
} from '../shared/types'
import { type DesignPaths, isInside, relToDesign, relToRoot } from './paths'
import {
  CanvasSchema,
  describeZodError,
  ID_PATTERN,
  type ItemInput,
  ItemSchema,
  PageSchema,
  SectionSchema,
} from './schema'
import type { ScreenSource, SnapshotLookup, UrlScheme } from './sources'
import { fileStem, slugify, titleize } from './text'

export interface ResolvedCanvas {
  doc: CanvasDoc
  screens: ScreenSource[]
}

const MODULE_EXT = new Set(['.tsx', '.jsx', '.ts', '.js', '.mjs'])
const HTML_EXT = new Set(['.html', '.htm'])

export function listCanvasIds(paths: DesignPaths): string[] {
  if (!fs.existsSync(paths.canvases)) return []
  return fs
    .readdirSync(paths.canvases, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort()
}

const routesOf = (route: string | string[] | undefined) =>
  route === undefined ? undefined : Array.isArray(route) ? route : [route]

function frameOf(input: { device?: keyof typeof DEVICES; width?: number; height?: number | 'auto' }): FrameSize {
  const custom = input.width !== undefined || input.height !== undefined
  const device = input.device ?? (custom ? undefined : DEFAULT_DEVICE)
  const base = DEVICES[input.device ?? DEFAULT_DEVICE]
  return { width: input.width ?? base.width, height: input.height ?? base.height, device }
}

export function loadCanvas(
  paths: DesignPaths,
  canvasId: string,
  urls: UrlScheme,
  snapshots: SnapshotLookup | null,
): ResolvedCanvas {
  const dir = path.join(paths.canvases, canvasId)
  const file = path.join(dir, 'canvas.json')
  const fileRel = relToRoot(paths, file)
  const issues: Issue[] = []
  const screens: ScreenSource[] = []
  const report = (severity: Issue['severity'], message: string, at?: string) =>
    issues.push({ severity, file: fileRel, message, at })
  const doc: CanvasDoc = { id: canvasId, title: titleize(canvasId), pages: [], issues, updatedAt: 0 }

  if (!ID_PATTERN.test(canvasId)) {
    report('error', `canvas folder "${canvasId}" is not a valid id (letters, digits, "-", "_")`)
    return { doc, screens }
  }
  let source: string
  try {
    source = fs.readFileSync(file, 'utf8')
    doc.updatedAt = fs.statSync(file).mtimeMs
  } catch {
    report('error', 'canvas.json is missing')
    return { doc, screens }
  }
  let json: unknown
  try {
    json = JSON.parse(source)
  } catch (error) {
    report('error', `invalid JSON: ${(error as Error).message}`)
    return { doc, screens }
  }

  const top = CanvasSchema.safeParse(json)
  let rawPages: unknown[] = []
  let systemDefault = true
  if (top.success) {
    doc.title = top.data.title
    doc.description = top.data.description
    doc.theme = top.data.theme
    systemDefault = top.data.system ?? true
    rawPages = top.data.pages
  } else {
    for (const issue of describeZodError(top.error)) report('error', issue.message, issue.at)
    const loose = json as { title?: unknown; pages?: unknown }
    if (typeof loose?.title === 'string') doc.title = loose.title
    if (Array.isArray(loose?.pages)) rawPages = loose.pages
  }

  const itemIds = new Set<string>()
  const pageIds = new Set<string>()

  const claimId = (wanted: string, explicit: boolean, at: string) => {
    if (!itemIds.has(wanted)) {
      itemIds.add(wanted)
      return wanted
    }
    let n = 2
    while (itemIds.has(`${wanted}-${n}`)) n++
    const id = `${wanted}-${n}`
    itemIds.add(id)
    report(
      explicit ? 'error' : 'warning',
      explicit
        ? `duplicate item id "${wanted}"; renamed to "${id}"`
        : `two items would be called "${wanted}"; this one is "${id}" — give it an explicit "id"`,
      at,
    )
    return id
  }

  const resolveItem = (item: ItemInput, at: string): CanvasItem | null => {
    if (item.type === 'screen') {
      const abs = path.resolve(dir, item.src)
      const ext = path.extname(abs).toLowerCase()
      const format = HTML_EXT.has(ext) ? 'html' : MODULE_EXT.has(ext) ? 'module' : null
      if (!format) {
        report('error', `"${item.src}" is not a screen: use .tsx, .jsx or .html`, `${at}.src`)
        return null
      }
      if (!isInside(paths.design, abs)) report('warning', `"${item.src}" is outside .design`, `${at}.src`)
      const missing = !fs.existsSync(abs)
      if (missing) report('error', `file not found: ${item.src}`, `${at}.src`)
      const id = claimId(item.id ?? slugify(fileStem(item.src)), item.id !== undefined, at)
      const title = item.title ?? titleize(fileStem(item.src))
      const snap = snapshots?.(canvasId, id)
      const system = item.system ?? systemDefault
      const theme: Theme | undefined = item.theme
      const frame = frameOf(item)
      const rev = createHash('sha1')
        .update(JSON.stringify([item.src, item.props ?? null, theme ?? null, system, frame.height === 'auto']))
        .digest('hex')
        .slice(0, 10)
      screens.push({
        key: `${canvasId}/${id}`,
        canvas: canvasId,
        id,
        title,
        file: abs,
        format,
        props: item.props ?? {},
        system,
        theme,
        autoHeight: frame.height === 'auto',
      })
      return {
        kind: 'screen',
        id,
        title,
        description: item.description,
        x: item.x,
        y: item.y,
        src: item.src,
        file: relToRoot(paths, abs),
        format,
        url: format === 'module' ? urls.screen(canvasId, id) : urls.html(relToDesign(paths, abs), canvasId, id),
        frame,
        theme,
        routes: routesOf(item.route),
        missing: missing || undefined,
        rev,
        snapshots: snap?.urls,
        thumbs: snap?.thumbs,
        measuredHeight: snap?.height,
      }
    }
    if (item.type === 'url') {
      const id = claimId(item.id ?? slugify(new URL(item.url).hostname), item.id !== undefined, at)
      return {
        kind: 'url',
        id,
        title: item.title ?? item.url.replace(/^https?:\/\//, ''),
        description: item.description,
        x: item.x,
        y: item.y,
        url: item.url,
        routes: routesOf(item.route),
        frame: frameOf(item),
      }
    }
    if (item.type === 'note') {
      const id = claimId(item.id ?? 'note', item.id !== undefined, at)
      return {
        kind: 'note',
        id,
        title: item.title ?? '',
        x: item.x,
        y: item.y,
        text: item.text,
        width: item.width ?? (item.tone === 'plain' ? 560 : 320),
        tone: item.tone ?? 'note',
      }
    }
    const remote = /^https?:\/\//.test(item.src)
    const abs = remote ? '' : path.resolve(dir, item.src)
    const missing = !remote && !fs.existsSync(abs)
    if (missing) report('error', `image not found: ${item.src}`, `${at}.src`)
    const id = claimId(item.id ?? slugify(fileStem(item.src)), item.id !== undefined, at)
    return {
      kind: 'image',
      id,
      title: item.title ?? titleize(fileStem(item.src)),
      description: item.description,
      x: item.x,
      y: item.y,
      url: remote ? item.src : urls.file(relToDesign(paths, abs)),
      width: item.width,
      missing: missing || undefined,
    }
  }

  const resolveItems = (raw: unknown[], at: string): CanvasItem[] => {
    const out: CanvasItem[] = []
    raw.forEach((value, index) => {
      const itemAt = `${at}[${index}]`
      const parsed = ItemSchema.safeParse(value)
      if (!parsed.success) {
        for (const issue of describeZodError(parsed.error, itemAt)) report('error', issue.message, issue.at)
        return
      }
      const item = resolveItem(parsed.data, itemAt)
      if (item) out.push(item)
    })
    return out
  }

  rawPages.forEach((value, pageIndex) => {
    const at = `pages[${pageIndex}]`
    const parsed = PageSchema.safeParse(value)
    if (!parsed.success) {
      for (const issue of describeZodError(parsed.error, at)) report('error', issue.message, issue.at)
      return
    }
    const page = parsed.data
    if (pageIds.has(page.id)) {
      report('error', `duplicate page id "${page.id}"`, `${at}.id`)
      return
    }
    pageIds.add(page.id)
    const sections: CanvasSection[] = []
    if (page.items) {
      sections.push({ id: 'free', items: resolveItems(page.items, `${at}.items`) })
    } else {
      const sectionIds = new Set<string>()
      ;(page.sections ?? []).forEach((rawSection, sectionIndex) => {
        const sectionAt = `${at}.sections[${sectionIndex}]`
        const section = SectionSchema.safeParse(rawSection)
        if (!section.success) {
          for (const issue of describeZodError(section.error, sectionAt)) report('error', issue.message, issue.at)
          return
        }
        let sectionId = section.data.id ?? `section-${sectionIndex + 1}`
        if (sectionIds.has(sectionId)) sectionId = `${sectionId}-${sectionIndex + 1}`
        sectionIds.add(sectionId)
        sections.push({
          id: sectionId,
          title: section.data.title,
          description: section.data.description,
          columns: section.data.columns,
          items: resolveItems(section.data.items, `${sectionAt}.items`),
        })
      })
    }
    const out: CanvasPage = {
      id: page.id,
      title: page.title,
      description: page.description,
      layout: page.items ? 'free' : 'sections',
      sections,
    }
    doc.pages.push(out)
  })

  checkNavigation(doc, screens, issues, fileRel, (file) => relToRoot(paths, file))
  return { doc, screens }
}

/** `go` imported from the runtime: removed in 0.5 in favour of links to screen routes. */
const GO_IMPORT = /import\s*\{[^}]*\bgo\b[^}]*\}\s*from\s*['"]@design\/runtime['"]/
const GO_USE = /\bgo\s*\(/g

export const GO_REMOVED =
  'go() is no longer supported: link to the screen instead (<a href="/verify">, or history.pushState in code) and give that screen a "route" in canvas.json'

/** Lines of a screen file that use the removed `go()`: its calls, or the import when nothing calls it. */
export function legacyGoLines(file: string): number[] {
  let source: string
  try {
    source = fs.readFileSync(file, 'utf8')
  } catch {
    return []
  }
  const imported = GO_IMPORT.exec(source)
  if (!imported) return []
  const lineOf = (index: number) => source.slice(0, index).split('\n').length
  const calls = [...source.matchAll(GO_USE)]
    .map((match) => lineOf(match.index))
    .filter((line) => line !== lineOf(imported.index))
  return calls.length ? [...new Set(calls)] : [lineOf(imported.index)]
}

/** Routes two screens claim (links open the first), and screens still using the removed `go()`. */
function checkNavigation(
  doc: CanvasDoc,
  screens: ScreenSource[],
  issues: Issue[],
  canvasFile: string,
  rel: (file: string) => string,
) {
  const frames = doc.pages.flatMap((page) =>
    page.sections.flatMap((section) =>
      section.items.filter((item) => item.kind === 'screen' || item.kind === 'url').map((item) => ({ page, item })),
    ),
  )
  const claimed = new Map<string, string>()
  for (const { item } of frames) {
    for (const route of item.routes ?? []) {
      const first = claimed.get(route)
      if (first === undefined) claimed.set(route, item.id)
      else if (first !== item.id)
        issues.push({
          severity: 'warning',
          file: canvasFile,
          message: `route "${route}" is on both "${first}" and "${item.id}"; links open "${first}"`,
        })
    }
  }
  for (const file of new Set(screens.map((screen) => screen.file))) {
    for (const line of legacyGoLines(file)) {
      issues.push({ severity: 'error', file: rel(file), at: `line ${line}`, message: GO_REMOVED })
    }
  }
}

export function summarize(canvas: ResolvedCanvas): CanvasSummary {
  const { doc } = canvas
  const screens = doc.pages.flatMap((page) => page.sections.flatMap((section) => section.items))
  const firstScreen = screens.find((item) => item.kind === 'screen' && item.snapshots)
  return {
    id: doc.id,
    title: doc.title,
    description: doc.description,
    pages: doc.pages.length,
    screens: screens.filter((item) => item.kind === 'screen' || item.kind === 'url').length,
    updatedAt: doc.updatedAt,
    issues: doc.issues.filter((issue) => issue.severity === 'error').length,
    cover:
      firstScreen && firstScreen.kind === 'screen'
        ? (firstScreen.snapshots?.light ?? firstScreen.snapshots?.dark)
        : undefined,
  }
}
