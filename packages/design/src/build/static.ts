import fs from 'node:fs'
import path from 'node:path'
import { build } from 'vite'
import type { ResolvedCanvas } from '../core/canvas'
import { type DesignPaths, PKG } from '../core/paths'
import { ensureThumb } from '../core/png'
import { DesignProject } from '../core/project'
import { type ScreenSource, type SnapshotLookup, STATIC_URLS } from '../core/sources'
import { SYSTEM_CANVAS } from '../core/system'
import { toPosix } from '../core/text'
import { Entries, HTML_BOOT } from '../server/entries'
import { type FrameHead, injectIntoHtml, moduleShell, optsOutOfSystem } from '../server/html'
import { linkShippedPackages } from '../server/links'
import { baseConfig } from '../server/vite'
import type { Theme } from '../shared/types'

export interface SiteResult {
  out: string
  canvases: string[]
  frames: number
  /** Errors in the built canvases and the system; missing screens are left out of the site. */
  errors: number
  /** The copied viewer references assets by absolute path, so the site only works at the root of a host. */
  absoluteAssets: boolean
}

export interface BuildOptions {
  /** Canvas ids to build; every canvas when left out, none for an empty list. */
  canvases?: string[]
  /** Build the design system specimens and write `api/system.json` and `api/sources.json`. Default true. */
  includeSystem?: boolean
  /** Copy the static viewer (`index.html` and its assets) into the site. Default true. */
  includeViewer?: boolean
}

const THEMES: Theme[] = ['light', 'dark']
/** What HTML screens keep next to them in the site: data files, images, plain scripts. Sources are bundled instead. */
const SOURCE_EXT = new Set(['.ts', '.tsx', '.jsx', '.mts', '.cts', '.html', '.htm', '.md', '.map'])
/** Tags whose `src`/`href` Vite bundles; plain `<script src>` is left for the copied siblings. */
const BUNDLED_REF = /<(script|link|img|source|video|audio|image|use|input)\b[^>]*>/gi

const encodePath = (rel: string) => rel.split('/').map(encodeURIComponent).join('/')

function relUrl(fromDir: string, file: string): string {
  const rel = toPosix(path.relative(fromDir, file))
  return rel.startsWith('.') ? rel : `./${rel}`
}

/** Snapshots from `.design/.cache/snapshots`, addressed inside the site under `_snap/`. */
function staticSnapshots(paths: DesignPaths) {
  const copies = new Map<string, string>()
  const metaCache = new Map<string, Record<string, Partial<Record<Theme, number>> & { height?: number }>>()
  const meta = (canvas: string) => {
    let data = metaCache.get(canvas)
    if (!data) {
      try {
        data = JSON.parse(fs.readFileSync(path.join(paths.snapshots, canvas, 'meta.json'), 'utf8'))
      } catch {}
      data ??= {}
      metaCache.set(canvas, data)
    }
    return data
  }
  const lookup: SnapshotLookup = (canvas, id) => {
    const entry = meta(canvas)[id]
    if (!entry) return null
    const urls: Partial<Record<Theme, string>> = {}
    const thumbs: Partial<Record<Theme, string>> = {}
    for (const theme of THEMES) {
      const file = path.join(paths.snapshots, canvas, `${id}.${theme}.png`)
      if (!entry[theme] || !fs.existsSync(file)) continue
      const rel = `_snap/${canvas}/${id}.${theme}.png`
      copies.set(file, rel)
      urls[theme] = `${encodePath(rel)}?v=${entry[theme]}`
      const thumb = ensureThumb(file)
      const thumbRel = thumb === file ? rel : `_snap/${canvas}/${id}.${theme}.thumb.png`
      copies.set(thumb, thumbRel)
      thumbs[theme] = `${encodePath(thumbRel)}?v=${entry[theme]}`
    }
    return { urls, thumbs, height: entry.height }
  }
  return { lookup, copies }
}

/**
 * Point the refs Vite bundles at the original files, so an HTML screen staged
 * elsewhere still finds its scripts, styles and images (including `../` ones).
 */
function rewriteRefs(html: string, originalDir: string, stagedDir: string): string {
  return html.replace(BUNDLED_REF, (tag, name: string) => {
    const lower = name.toLowerCase()
    if (lower === 'script' && !/\btype\s*=\s*["']?module/i.test(tag)) return tag
    if (lower === 'link' && !/\brel\s*=\s*["']?(?:stylesheet|icon|apple-touch-icon|modulepreload)/i.test(tag))
      return tag
    return tag.replace(
      /(\s(?:src|href|poster)\s*=\s*)(["'])([^"']*)\2/gi,
      (whole, attr: string, quote: string, value: string) => {
        if (!value || /^(?:[a-z][a-z0-9+.-]*:|\/|#|\{)/i.test(value)) return whole
        const [pathname = '', suffix = ''] = /^([^?#]*)(.*)$/.exec(value)!.slice(1)
        const target = path.resolve(originalDir, decodeURIComponent(pathname))
        if (!fs.existsSync(target)) return whole
        return `${attr}${quote}${relUrl(stagedDir, target)}${suffix}${quote}`
      },
    )
  })
}

function copyTree(from: string, to: string, filter: (file: string) => boolean) {
  if (!fs.existsSync(from)) return
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
    const source = path.join(from, entry.name)
    const target = path.join(to, entry.name)
    if (entry.isDirectory()) copyTree(source, target, filter)
    else if (filter(source) && !fs.existsSync(target)) {
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.copyFileSync(source, target)
    }
  }
}

function writeJson(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(value))
}

/**
 * Build every frame of the chosen canvases and (unless left out) of the design
 * system into `out`, with the JSON the viewer reads in static mode, and copy
 * the static viewer in. A cloud unit build leaves the viewer out and builds
 * either the system alone or one canvas without the system.
 */
export async function buildSite(paths: DesignPaths, out: string, options: BuildOptions = {}): Promise<SiteResult> {
  const snapshots = staticSnapshots(paths)
  const project = new DesignProject(paths, STATIC_URLS, snapshots.lookup)
  const known = project.canvasIds()
  const only = options.canvases
  const unknown = (only ?? []).filter((id) => !known.includes(id))
  if (unknown.length) throw new Error(`No canvas ${unknown.map((id) => `"${id}"`).join(', ')}`)
  const canvasIds = only ?? known
  const canvases = canvasIds.map((id) => project.canvas(id)).filter((c): c is ResolvedCanvas => c !== null)
  // Canvas frames use the system's fonts and stylesheet either way; `system` is what the site documents.
  const loadedSystem = project.system()
  const system = options.includeSystem === false ? null : loadedSystem

  const entries = new Entries(project)
  entries.sync()
  linkShippedPackages(paths, project.appDir())
  const publicDir = project.publicDir()
  const publicFiles = project.publicFiles()

  // Stage one HTML page per frame at the path it will have in the site.
  const staging = path.join(paths.cache, 'build', 'src')
  fs.rmSync(staging, { recursive: true, force: true })
  const fonts = loadedSystem?.doc.fonts ?? []
  const sources: ScreenSource[] = [...(system?.specimens ?? []), ...canvases.flatMap((canvas) => canvas.screens)]
  const inputs: string[] = []
  const htmlScreens: { source: ScreenSource; dir: string }[] = []
  for (const source of sources) {
    // A missing file is already an error in canvas.json; the rest of the site still builds.
    if (!source.builtin && !fs.existsSync(source.file)) continue
    const siteDir = path.join('_s', source.canvas, source.id)
    const dir = path.join(staging, siteDir)
    const file = path.join(dir, 'index.html')
    fs.mkdirSync(dir, { recursive: true })
    const canvasTheme = source.canvas === SYSTEM_CANVAS ? undefined : project.canvas(source.canvas)?.doc.theme
    const head: FrameHead = {
      source,
      theme: canvasTheme ?? 'light',
      fonts,
      snapshots: false,
      autoHeight: source.autoHeight ?? false,
      // The public folder lands at the site root, which frames reach through `../`.
      public: publicFiles.length ? { base: `${toPosix(path.relative(dir, staging))}/`, files: publicFiles } : undefined,
    }
    if (source.format === 'module') {
      fs.writeFileSync(file, moduleShell(head, relUrl(dir, entries.entryFile(source))))
    } else {
      const raw = rewriteRefs(fs.readFileSync(source.file, 'utf8'), path.dirname(source.file), dir)
      const withSystem = source.system && !optsOutOfSystem(raw)
      const html = injectIntoHtml(raw, {
        ...head,
        systemCss: withSystem ? relUrl(dir, entries.systemCssFile()) : undefined,
        boot: relUrl(dir, path.join(entries.dir, HTML_BOOT)),
      })
      fs.writeFileSync(file, html)
      htmlScreens.push({ source, dir: siteDir })
    }
    inputs.push(file)
  }

  fs.mkdirSync(out, { recursive: true })
  if (inputs.length) {
    const base = baseConfig(project)
    await build({
      ...base,
      root: staging,
      base: './',
      logLevel: 'warn',
      build: {
        outDir: out,
        emptyOutDir: true,
        assetsDir: '_assets',
        target: 'es2022',
        reportCompressedSize: false,
        chunkSizeWarningLimit: 8000,
        // Copied below, without dot-files and links out of the folder, and after the site's own files.
        copyPublicDir: false,
        rolldownOptions: { input: inputs },
      },
    })
  } else {
    fs.rmSync(out, { recursive: true, force: true })
    fs.mkdirSync(out, { recursive: true })
  }

  // Files HTML screens reach at run time (fetch, plain scripts) stay next to them.
  for (const { source, dir } of htmlScreens) {
    copyTree(
      path.dirname(source.file),
      path.join(out, dir),
      (file) => !SOURCE_EXT.has(path.extname(file).toLowerCase()),
    )
  }

  // Images on the canvases and system assets, under `_f/`.
  const files = new Set<string>()
  for (const canvas of canvases) {
    for (const page of canvas.doc.pages)
      for (const section of page.sections)
        for (const item of section.items) if (item.kind === 'image' && item.url.startsWith('_f/')) files.add(item.url)
  }
  for (const asset of system?.doc.assets ?? []) files.add(asset.url)
  // The project icon goes with every build: the viewer shows it whatever the unit.
  const icon = project.iconUrl()
  if (icon) files.add(icon.split('?')[0]!)
  for (const url of files) {
    const rel = url.slice('_f/'.length).split('/').map(decodeURIComponent).join('/')
    const from = path.join(paths.design, rel)
    if (!fs.existsSync(from)) continue
    const to = path.join(out, '_f', rel)
    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.copyFileSync(from, to)
  }

  // Loading the project info resolves every canvas; only the built ones keep their snapshots.
  const info = project.info(true)
  const snapshotDirs = canvasIds.map((id) => `_snap/${id}/`)
  for (const [from, rel] of snapshots.copies) {
    if (!snapshotDirs.some((dir) => rel.startsWith(dir))) continue
    const to = path.join(out, rel)
    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.copyFileSync(from, to)
  }

  // What the viewer fetches in static mode.
  if (!system) info.system = null
  info.canvases = info.canvases.filter((canvas) => canvasIds.includes(canvas.id))
  writeJson(path.join(out, 'api', 'project.json'), info)
  for (const canvas of canvases) writeJson(path.join(out, 'api', 'canvas', `${canvas.doc.id}.json`), canvas.doc)
  if (system) {
    writeJson(path.join(out, 'api', 'system.json'), system.doc)
    const texts: Record<string, string> = {}
    for (const component of system.doc.components) {
      for (const rel of [component.specimen, ...component.sources]) {
        const file = path.join(paths.root, rel)
        if (!(rel in texts) && fs.existsSync(file)) texts[rel] = fs.readFileSync(file, 'utf8')
      }
    }
    writeJson(path.join(out, 'api', 'sources.json'), texts)
  }

  fs.rmSync(staging, { recursive: true, force: true })
  const errors = [
    ...(only ? [] : project.config().issues),
    ...(system?.doc.issues ?? []),
    ...canvases.flatMap((canvas) => canvas.doc.issues),
  ].filter((issue) => issue.severity === 'error').length
  const { absoluteAssets } = options.includeViewer === false ? { absoluteAssets: false } : copyViewer(PKG.viewer, out)
  // The public folder at the site root, in every unit build: a push uploads it with the build,
  // so it counts toward the cloud storage like any other file. Paths the site uses itself win.
  if (publicDir) {
    for (const rel of publicFiles) {
      const to = path.join(out, rel)
      if (fs.existsSync(to)) continue
      fs.mkdirSync(path.dirname(to), { recursive: true })
      fs.copyFileSync(path.join(publicDir, rel), to)
    }
  }
  return { out, canvases: canvasIds, frames: inputs.length, errors, absoluteAssets }
}

/** Copy the built viewer into the site and switch it to static mode. */
export function copyViewer(viewerDir: string, out: string): { absoluteAssets: boolean } {
  copyTree(viewerDir, out, () => true)
  const index = path.join(out, 'index.html')
  const html = fs.readFileSync(index, 'utf8')
  const flag = '<script>window.__DESIGN_STATIC__=true</script>'
  const head = /<head(\s[^>]*)?>/i.exec(html)
  fs.writeFileSync(
    index,
    head ? html.slice(0, head.index + head[0].length) + flag + html.slice(head.index + head[0].length) : flag + html,
  )
  return { absoluteAssets: /(?:src|href)=["']\/(?!\/)/.test(html) }
}
