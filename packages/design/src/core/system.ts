import fs from 'node:fs'
import path from 'node:path'
import type { AssetDoc, ComponentDoc, GuidelineDoc, Issue, SystemDoc, SystemSummary } from '../shared/types'
import { onlyIcon } from './icon'
import { type DesignPaths, relToDesign, relToRoot } from './paths'
import { describeZodError, type SystemConfig, SystemConfigSchema } from './schema'
import type { ScreenSource, UrlScheme } from './sources'
import { firstHeading, parseDocTags, parseFrontmatter, slugify, titleize } from './text'
import { parseTokens, readStylesheets } from './tokens'

export const SYSTEM_CANVAS = '@system'
export const TYPOGRAPHY_ID = '@typography'

export interface ResolvedSystem {
  doc: SystemDoc
  config: SystemConfig | null
  /** Stylesheet the screens import: the custom one from system.json, or null for Tailwind + tokens.css. */
  stylesheet: string | null
  /** tokens.css, when it exists. */
  tokensFile: string | null
  specimens: ScreenSource[]
}

const SPECIMEN_EXT = new Set(['.tsx', '.jsx', '.html'])
const COMPONENT_EXT = ['.tsx', '.jsx', '.ts', '.js', '.vue', '.svelte', '.html']
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg', '.ico'])
const FONT_EXT = new Set(['.woff', '.woff2', '.ttf', '.otf'])

function listFiles(dir: string, deep = false): string[] {
  if (!fs.existsSync(dir)) return []
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (deep) out.push(...listFiles(full, true))
    } else out.push(full)
  }
  return out.sort()
}

/** A component file next to the specimen's name: `components/button.tsx` or `components/button/index.tsx`. */
function guessSources(componentsDir: string, stem: string): string[] {
  if (!fs.existsSync(componentsDir)) return []
  const wanted = slugify(stem)
  for (const file of listFiles(componentsDir)) {
    const ext = path.extname(file)
    if (COMPONENT_EXT.includes(ext) && slugify(path.basename(file, ext)) === wanted) return [file]
  }
  for (const entry of fs.readdirSync(componentsDir, { withFileTypes: true })) {
    if (entry.isDirectory() && slugify(entry.name) === wanted) {
      const files = listFiles(path.join(componentsDir, entry.name)).filter((f) =>
        COMPONENT_EXT.includes(path.extname(f)),
      )
      if (files.length) return files
    }
  }
  return []
}

export function loadSystem(paths: DesignPaths, urls: UrlScheme): ResolvedSystem | null {
  // A folder holding only the project icon is no design system.
  if (!fs.existsSync(paths.system) || onlyIcon(paths.system)) return null
  const issues: Issue[] = []
  const configFile = path.join(paths.system, 'system.json')
  const report = (severity: Issue['severity'], file: string, message: string, at?: string) =>
    issues.push({ severity, file: relToRoot(paths, file), message, at })

  let config: SystemConfig | null = null
  if (fs.existsSync(configFile)) {
    try {
      const parsed = SystemConfigSchema.safeParse(JSON.parse(fs.readFileSync(configFile, 'utf8')))
      if (parsed.success) config = parsed.data
      else for (const issue of describeZodError(parsed.error)) report('error', configFile, issue.message, issue.at)
    } catch (error) {
      report('error', configFile, `invalid JSON: ${(error as Error).message}`)
    }
  } else {
    report('warning', configFile, 'system.json is missing; run `design system init` or add { "name": "…" }')
  }

  // Stylesheet and tokens.
  const tokensFile = path.join(paths.system, 'tokens.css')
  let stylesheet: string | null = null
  if (config?.stylesheet) {
    stylesheet = path.resolve(paths.system, config.stylesheet)
    if (!fs.existsSync(stylesheet)) {
      report('error', configFile, `stylesheet not found: ${config.stylesheet}`, 'stylesheet')
      stylesheet = null
    }
  }
  const tokenEntry = stylesheet ?? (fs.existsSync(tokensFile) ? tokensFile : null)
  const tokens = tokenEntry ? parseTokens(readStylesheets(tokenEntry)) : []
  if (!tokenEntry) report('warning', tokensFile, 'no tokens.css: screens get the default Tailwind theme')

  // Components: every specimen file is a page.
  const specimensDir = path.join(paths.system, 'specimens')
  const componentsDir = path.join(paths.system, 'components')
  const components: ComponentDoc[] = []
  const specimens: ScreenSource[] = []
  const usedIds = new Set<string>()
  for (const file of listFiles(specimensDir)) {
    const ext = path.extname(file).toLowerCase()
    if (!SPECIMEN_EXT.has(ext)) continue
    const stem = path.basename(file, ext)
    let id = slugify(stem)
    if (usedIds.has(id)) id = `${id}-${usedIds.size + 1}`
    usedIds.add(id)
    const tags = parseDocTags(fs.readFileSync(file, 'utf8'))
    const sources = (tags.source ?? [])
      .flatMap((value) => value.split(/[\s,]+/))
      .filter(Boolean)
      .map((value) => path.resolve(path.dirname(file), value))
    for (const source of sources) {
      if (!fs.existsSync(source)) report('warning', file, `@source not found: ${path.relative(paths.system, source)}`)
    }
    const found = sources.filter((source) => fs.existsSync(source))
    const title = tags.title?.[0] || titleize(stem)
    const format = ext === '.html' ? 'html' : 'module'
    components.push({
      id,
      title,
      group: tags.group?.[0] || 'Components',
      description: tags.description?.[0] || undefined,
      status: tags.status?.[0] || undefined,
      specimen: relToRoot(paths, file),
      sources: (found.length ? found : guessSources(componentsDir, stem)).map((source) => relToRoot(paths, source)),
      url:
        format === 'module' ? urls.screen(SYSTEM_CANVAS, id) : urls.html(relToDesign(paths, file), SYSTEM_CANVAS, id),
    })
    specimens.push({
      key: `${SYSTEM_CANVAS}/${id}`,
      canvas: SYSTEM_CANVAS,
      id,
      title,
      file,
      format,
      props: {},
      system: true,
      autoHeight: true,
    })
  }

  // Guidelines.
  const guidelines: GuidelineDoc[] = []
  for (const file of listFiles(path.join(paths.system, 'guidelines'))) {
    if (path.extname(file).toLowerCase() !== '.md') continue
    const stem = path.basename(file, '.md')
    const { data, body } = parseFrontmatter(fs.readFileSync(file, 'utf8'))
    const prefix = /^(\d+)[-_. ]+(.*)$/.exec(stem)
    const order = data.order !== undefined ? Number(data.order) : prefix ? Number(prefix[1]) : 1000
    guidelines.push({
      slug: slugify(prefix ? prefix[2]! : stem),
      title: data.title || firstHeading(body) || titleize(prefix ? prefix[2]! : stem),
      order: Number.isFinite(order) ? order : 1000,
      markdown: body,
    })
  }
  guidelines.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title))

  // Assets.
  const assets: AssetDoc[] = []
  const assetsDir = path.join(paths.system, 'assets')
  for (const file of listFiles(assetsDir, true)) {
    const ext = path.extname(file).toLowerCase()
    assets.push({
      name: path.basename(file),
      path: path.relative(paths.system, file).split(path.sep).join('/'),
      url: urls.file(relToDesign(paths, file)),
      size: fs.statSync(file).size,
      kind: IMAGE_EXT.has(ext) ? 'image' : FONT_EXT.has(ext) ? 'font' : 'other',
    })
  }

  const hasType = tokens.some((token) => token.kind === 'font' || token.kind === 'text')
  if (hasType) {
    specimens.push({
      key: `${SYSTEM_CANVAS}/${TYPOGRAPHY_ID}`,
      canvas: SYSTEM_CANVAS,
      id: TYPOGRAPHY_ID,
      title: 'Typography',
      file: '',
      format: 'module',
      props: {
        tokens: tokens.filter((token) => ['font', 'text', 'weight', 'leading', 'tracking'].includes(token.kind)),
        sample: config?.sample,
      },
      system: true,
      autoHeight: true,
      builtin: 'typography',
    })
  }

  return {
    doc: {
      name: config?.name ?? 'Design system',
      description: config?.description,
      fonts: config?.fonts ?? [],
      tokens,
      components,
      guidelines,
      assets,
      typographyUrl: hasType ? urls.screen(SYSTEM_CANVAS, TYPOGRAPHY_ID) : null,
      issues,
    },
    config,
    stylesheet,
    tokensFile: fs.existsSync(tokensFile) ? tokensFile : null,
    specimens,
  }
}

export function summarizeSystem(system: ResolvedSystem): SystemSummary {
  return {
    name: system.doc.name,
    description: system.doc.description,
    tokens: system.doc.tokens.length,
    components: system.doc.components.length,
    guidelines: system.doc.guidelines.length,
    issues: system.doc.issues.filter((issue) => issue.severity === 'error').length,
  }
}
