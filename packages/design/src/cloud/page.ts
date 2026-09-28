import fs from 'node:fs'
import path from 'node:path'
import { CliError } from '../cli/log'
import { PKG } from '../core/paths'
import { hashBuffer, type Manifest } from './units'

/** A page's name in its project (`page/<slug>`): what `--name` takes, and what a file name becomes. */
export const PAGE_SLUG = /^[a-z0-9][a-z0-9_-]{0,99}$/
/** The file a page opens with. */
export const PAGE_ENTRY = 'index.html'
const HTML = /\.html?$/i
const MAX_TITLE = 200

export interface PageBundle {
  /** Path in the page → the bytes that go up (HTML with the page script in it). */
  files: Map<string, Buffer>
  manifest: Manifest
  /** `<title>` of index.html, or null. */
  title: string | null
  bytes: number
  warnings: string[]
}

/** A slug from a file or folder name: `Q3 Report.html` → `q3-report`. */
export function slugFor(target: string): string {
  const base = path.basename(path.resolve(target)).replace(HTML, '')
  const slug = base
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, 100)
    .replace(/[-_]+$/, '')
  return slug || 'page'
}

let script: string | null = null

/** The page script (`dist/runtime/page.js`) as an inline `<script>`. */
function pageScript(): string {
  if (script === null) {
    let code: string
    try {
      code = fs.readFileSync(PKG.pageRuntime, 'utf8').trim()
    } catch {
      throw new CliError(`${PKG.pageRuntime} is missing; this foss-design install is incomplete.`)
    }
    // Inline, the code must not end its own element.
    script = `<script data-foss-design>${code.replace(/<\/script/gi, '<\\/script')}</script>`
  }
  return script
}

/** `html` with the page script first thing in its head (or where a head would start). */
export function withPageScript(html: string): string {
  const tag = pageScript()
  const at = (pattern: RegExp) => {
    const match = pattern.exec(html)
    return match ? match.index + match[0].length : -1
  }
  let index = at(/<head(?:\s[^>]*)?>/i)
  if (index < 0) index = at(/<html(?:\s[^>]*)?>/i)
  if (index < 0) index = at(/<!doctype[^>]*>/i)
  if (index < 0) index = 0
  return html.slice(0, index) + tag + html.slice(index)
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

/** The text of `<title>`, entities decoded and spaces collapsed; null without one. */
export function htmlTitle(html: string): string | null {
  const raw = /<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/i.exec(html)?.[1]
  if (raw === undefined) return null
  const text = raw
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
      if (body[0] !== '#') return ENTITIES[body.toLowerCase()] ?? whole
      const code = body[1] === 'x' || body[1] === 'X' ? Number.parseInt(body.slice(2), 16) : Number(body.slice(1))
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ' '
    })
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TITLE)
  return text || null
}

/** Files next to a single HTML file that it loads by a relative path: they would not go up with it. */
function siblingsLoaded(file: string, html: string): string[] {
  const dir = path.dirname(file)
  const found = new Set<string>()
  for (const match of html.matchAll(/\b(?:src|href|poster)\s*=\s*["']([^"'#?]+)/gi)) {
    const ref = match[1]!.trim()
    if (!ref || /^[a-z][a-z0-9+.-]*:/i.test(ref) || ref.startsWith('/') || ref.startsWith('//')) continue
    let rel: string
    try {
      rel = decodeURIComponent(ref)
    } catch {
      continue
    }
    const full = path.resolve(dir, rel)
    if (full !== file && fs.existsSync(full) && fs.statSync(full).isFile()) found.add(rel)
  }
  return [...found]
}

/** Files under `dir` (relative, POSIX), without dot-files, `node_modules` and links out of `dir`. */
function walk(dir: string, root: string, out: string[], skipped: string[]) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
    const full = path.join(dir, entry.name)
    const rel = path.relative(root, full).split(path.sep).join('/')
    if (entry.isSymbolicLink()) {
      // A linked file goes up as its content when it points inside the folder; linked folders are not followed.
      try {
        const target = fs.realpathSync(full)
        if (target.startsWith(fs.realpathSync(root) + path.sep) && fs.statSync(target).isFile()) out.push(rel)
        else skipped.push(rel)
      } catch {
        skipped.push(rel)
      }
    } else if (entry.isDirectory()) walk(full, root, out, skipped)
    else if (entry.isFile()) out.push(rel)
  }
}

/**
 * What `design page <target>` uploads: an HTML file as the page's `index.html`, or a folder with an
 * `index.html` and everything in it. Every HTML file gets the page script; the rest goes as it is.
 */
export function readPage(target: string): PageBundle {
  const full = path.resolve(target)
  let stat: fs.Stats
  try {
    stat = fs.statSync(full)
  } catch {
    throw new CliError(`${target} does not exist`)
  }
  const files = new Map<string, Buffer>()
  const warnings: string[] = []
  const add = (rel: string, file: string) => {
    const data = fs.readFileSync(file)
    files.set(rel, HTML.test(rel) ? Buffer.from(withPageScript(data.toString('utf8'))) : data)
  }
  let entryHtml: string
  if (stat.isDirectory()) {
    const list: string[] = []
    const skipped: string[] = []
    walk(full, full, list, skipped)
    if (!list.includes(PAGE_ENTRY)) {
      const pages = list.filter((rel) => HTML.test(rel) && !rel.includes('/'))
      throw new CliError(
        `${target} has no ${PAGE_ENTRY}, which a page opens with.` +
          (pages.length === 1 ? ` Rename ${pages[0]} to ${PAGE_ENTRY}, or pass that file alone.` : ''),
      )
    }
    for (const rel of list) add(rel, path.join(full, rel))
    if (skipped.length) warnings.push(`Not uploaded, they link outside ${target}: ${skipped.slice(0, 5).join(', ')}`)
    entryHtml = fs.readFileSync(path.join(full, PAGE_ENTRY), 'utf8')
  } else {
    if (!HTML.test(full))
      throw new CliError(`${target} is not an HTML file; pass an .html file or a folder with ${PAGE_ENTRY}`)
    entryHtml = fs.readFileSync(full, 'utf8')
    add(PAGE_ENTRY, full)
    const loaded = siblingsLoaded(full, entryHtml)
    if (loaded.length)
      warnings.push(
        `${path.basename(full)} loads ${loaded.slice(0, 3).join(', ')}${loaded.length > 3 ? ` and ${loaded.length - 3} more` : ''} next to it, which a single file does not take along: pass the folder (with the page as ${PAGE_ENTRY}) instead.`,
      )
  }
  const manifest: Manifest = {}
  let bytes = 0
  for (const [rel, data] of files) {
    manifest[rel] = { hash: hashBuffer(data), size: data.length }
    bytes += data.length
  }
  return { files, manifest, title: htmlTitle(entryHtml), bytes, warnings }
}
