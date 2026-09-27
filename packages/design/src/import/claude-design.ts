import fs from 'node:fs'
import path from 'node:path'
import { ID_PATTERN } from '../core/schema'
import { attr, decodeEntities, type Element, findElement, type MarkupNode, parseMarkup } from './markup'

/**
 * A Claude Design project (`canvas.json` v3 and `*.dc.html` templates) turned once into a
 * foss-design canvas of plain React screens: each template becomes a `.jsx` module, its logic
 * class stays as written, and `screens/dc.jsx` (the canvas's own file) gives it props, state
 * and the viewer's theme. Nothing of the format is left for foss-design to support afterwards.
 */

interface DcBoard {
  x?: number
  y?: number
  w?: number
  h?: number
  title?: string
  page?: string
}
interface DcNote {
  text?: string
  kind?: string
  x?: number
  y?: number
  w?: number
  maxW?: number
  page?: string
}
interface DcCanvas {
  title?: string
  boards?: Record<string, DcBoard>
  notes?: Record<string, DcNote>
  pages?: { id: string; name?: string }[]
  order?: string[]
}

export interface ImportResult {
  canvas: Record<string, unknown>
  /** File name in `screens/` → content. */
  files: Map<string, string>
  screens: number
  notes: number
  /** Problems worth a look, each once with the files it came from. */
  warnings: Map<string, Set<string>>
}

const EXT = '.dc.html'
const kebab = (name: string) =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()

/** A valid JS identifier made from a template name, for imports and component names. */
const identifier = (name: string) => {
  const clean = name.replace(/[^\w$]/g, '_')
  return /^[A-Za-z_$]/.test(clean) ? clean : `_${clean}`
}

const KEYWORDS = new Set(
  (
    'break case catch class const continue debugger default delete do else export extends false finally for function ' +
    'if import in instanceof new null return super switch this throw true try typeof var void while with yield let ' +
    'static await async of undefined NaN Infinity arguments eval ' +
    'Math JSON Number String Boolean Object Array Date Intl RegExp Error Map Set Symbol Promise BigInt console ' +
    'window document globalThis location navigator parseInt parseFloat isNaN isFinite encodeURIComponent ' +
    'decodeURIComponent encodeURI decodeURI setTimeout clearTimeout setInterval clearInterval'
  ).split(' '),
)

/** Names an expression reads from its scope (a rough pass: what follows no `.`, outside strings). */
function freeNames(expression: string, into: Set<string>) {
  const code = expression
    .replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g, '""')
    .replace(/`(?:\\.|\$\{([^}]*)\}|[^`\\])*`/g, (whole) =>
      [...whole.matchAll(/\$\{([^}]*)\}/g)].map((match) => ` ${match[1]} `).join(''),
    )
  for (const match of code.matchAll(/(?<![.\w$])[A-Za-z_$][\w$]*/g)) {
    const name = match[0]
    const after = code.slice(match.index! + name.length)
    // An object key (`{ a: 1 }`) or an arrow parameter is no read from the scope.
    if (/^\s*:(?!:)/.test(after) && /[{,]\s*$/.test(code.slice(0, match.index))) continue
    if (!KEYWORDS.has(name)) into.add(name)
  }
}

const WHOLE = /^\s*\{\{([\s\S]+?)\}\}\s*$/
const PARTS = /\{\{([\s\S]+?)\}\}/g

const RENAME: Record<string, string> = {
  class: 'className',
  for: 'htmlFor',
  tabindex: 'tabIndex',
  readonly: 'readOnly',
  maxlength: 'maxLength',
  minlength: 'minLength',
  colspan: 'colSpan',
  rowspan: 'rowSpan',
  autocomplete: 'autoComplete',
  autocapitalize: 'autoCapitalize',
  autocorrect: 'autoCorrect',
  autosave: 'autoSave',
  enterkeyhint: 'enterKeyHint',
  accesskey: 'accessKey',
  charset: 'charSet',
  formaction: 'formAction',
  formmethod: 'formMethod',
  formnovalidate: 'formNoValidate',
  formtarget: 'formTarget',
  hreflang: 'hrefLang',
  itemprop: 'itemProp',
  itemscope: 'itemScope',
  itemtype: 'itemType',
  marginheight: 'marginHeight',
  marginwidth: 'marginWidth',
  mediagroup: 'mediaGroup',
  nomodule: 'noModule',
  radiogroup: 'radioGroup',
  srcdoc: 'srcDoc',
  srclang: 'srcLang',
  popovertarget: 'popoverTarget',
  popovertargetaction: 'popoverTargetAction',
  autofocus: 'autoFocus',
  autoplay: 'autoPlay',
  crossorigin: 'crossOrigin',
  srcset: 'srcSet',
  enctype: 'encType',
  novalidate: 'noValidate',
  contenteditable: 'contentEditable',
  spellcheck: 'spellCheck',
  datetime: 'dateTime',
  allowfullscreen: 'allowFullScreen',
  frameborder: 'frameBorder',
  cellpadding: 'cellPadding',
  cellspacing: 'cellSpacing',
  inputmode: 'inputMode',
  usemap: 'useMap',
  referrerpolicy: 'referrerPolicy',
  playsinline: 'playsInline',
  viewbox: 'viewBox',
  'accept-charset': 'acceptCharset',
  'http-equiv': 'httpEquiv',
  'xlink:href': 'xlinkHref',
  'xmlns:xlink': 'xmlnsXlink',
  'xml:space': 'xmlSpace',
  'xml:lang': 'xmlLang',
}
const BOOLEAN = new Set([
  'checked',
  'disabled',
  'selected',
  'readonly',
  'hidden',
  'open',
  'required',
  'multiple',
  'autofocus',
  'novalidate',
  'playsinline',
  'muted',
  'loop',
  'autoplay',
  'controls',
  'default',
  'reversed',
  'allowfullscreen',
  'async',
  'defer',
  'inert',
])
/** Elements where text between children is not allowed (React warns) and never shows. */
const NO_TEXT = new Set(['table', 'thead', 'tbody', 'tfoot', 'tr', 'colgroup', 'select', 'optgroup', 'datalist'])

function propName(name: string): string | null {
  const lower = name.toLowerCase()
  if (RENAME[lower]) return RENAME[lower]
  if (/^on[A-Z]/.test(name)) return name
  if (lower.startsWith('aria-') || lower.startsWith('data-')) return lower
  if (!/^[A-Za-z][\w:-]*$/.test(name)) return null
  return name.includes('-') ? name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()) : name
}

const str = (value: string) => JSON.stringify(value)

/** `text {{a}} more` as a JS template literal, or a plain string when nothing is interpolated. */
function interpolated(raw: string, reads: Set<string>): string {
  if (!raw.includes('{{')) return str(decodeEntities(raw))
  let out = '`'
  let last = 0
  for (const match of raw.matchAll(PARTS)) {
    out += decodeEntities(raw.slice(last, match.index)).replace(/[`\\]|\$\{/g, (c) => `\\${c}`)
    freeNames(match[1]!, reads)
    out += '${dc.text(' + match[1]!.trim() + ')}'
    last = match.index! + match[0].length
  }
  return `${out + decodeEntities(raw.slice(last)).replace(/[`\\]|\$\{/g, (c) => `\\${c}`)}\``
}

interface FileContext {
  name: string
  reads: Set<string>
  imports: Set<string>
  known: Set<string>
  routes: Map<string, string>
  warn: (message: string) => void
}

function linkTarget(value: string, ctx: FileContext): string | null {
  const match = /^(?:\.\/)?([^/?#]+)\.dc\.html(#.*)?$/.exec(value)
  if (!match) return null
  const route = ctx.routes.get(match[1]!)
  if (route) return route
  ctx.warn(`links to ${match[1]}${EXT}, which is no board; the link goes nowhere (#)`)
  return '#'
}

function attrsJsx(element: Element, ctx: FileContext, extra: string[] = []): string {
  const tag = element.tag.toLowerCase()
  const handled = new Set(element.attrs.map(([name]) => name))
  const hasHandler = [...handled].some((name) => /^on(Change|Input)$/.test(name))
  const out: string[] = [...extra]
  for (const [name, raw] of element.attrs) {
    const lower = name.toLowerCase()
    if (lower.startsWith('hint-') || lower === 'xmlns') continue
    let prop = propName(name)
    if (!prop) {
      ctx.warn(`dropped the attribute "${name}"`)
      continue
    }
    // Uncontrolled form fields: React warns about `value`/`checked` without a change handler.
    if (!hasHandler && (tag === 'input' || tag === 'textarea') && (prop === 'value' || prop === 'checked'))
      prop = prop === 'value' ? 'defaultValue' : 'defaultChecked'
    if (tag === 'option' && prop === 'selected') continue
    if (raw === null) {
      out.push(BOOLEAN.has(lower) ? prop : `${prop}=""`)
      continue
    }
    const whole = WHOLE.exec(raw)
    if (prop === 'style') {
      const body = interpolated(raw, ctx.reads)
      out.push(`style={dc.css(${body})}`)
      continue
    }
    if (whole) {
      const expression = whole[1]!.trim()
      freeNames(expression, ctx.reads)
      if (/^on[A-Z]/.test(prop)) out.push(`${prop}={${expression}}`)
      else if (BOOLEAN.has(lower)) out.push(`${prop}={dc.flag(${expression})}`)
      else out.push(`${prop}={dc.value(${expression})}`)
      continue
    }
    if (/^on[a-z]/.test(name)) {
      ctx.warn(`dropped the inline handler ${name}="…"; handlers come from renderVals()`)
      continue
    }
    if (BOOLEAN.has(lower)) {
      out.push(prop)
      continue
    }
    if (lower === 'href' && !raw.includes('{{')) {
      const target = linkTarget(raw, ctx)
      if (target !== null) {
        out.push(`href=${str(target)}`)
        continue
      }
    }
    if (raw.includes('/_blob/'))
      ctx.warn('uses an uploaded Claude Design asset (/_blob/…) that the export does not contain')
    out.push(`${prop}={${interpolated(raw, ctx.reads)}}`)
  }
  return out.length ? ` ${out.join(' ')}` : ''
}

function selectedOption(select: Element): string | null {
  const option = findElement(select, (el) => el.tag.toLowerCase() === 'option' && attr(el, 'selected') !== undefined)
  if (!option) return null
  const value = attr(option, 'value')
  if (value !== undefined && value !== null) return value
  return option.children
    .map((child) => (child.type === 'text' ? child.text : ''))
    .join('')
    .trim()
}

function childrenJsx(nodes: MarkupNode[], ctx: FileContext, parent: string): string {
  const out: string[] = []
  for (const node of nodes) {
    if (node.type === 'text') {
      // Blank text between elements is one space in HTML; tables and selects allow none.
      if (!node.text.trim()) {
        if (node.text && !NO_TEXT.has(parent)) out.push('{" "}')
        continue
      }
      if (NO_TEXT.has(parent)) continue
      let last = 0
      for (const match of node.text.matchAll(PARTS)) {
        const before = node.text.slice(last, match.index)
        if (before) out.push(`{${str(decodeEntities(before))}}`)
        freeNames(match[1]!, ctx.reads)
        out.push(`{dc.text(${match[1]!.trim()})}`)
        last = match.index! + match[0].length
      }
      const rest = node.text.slice(last)
      if (rest) out.push(`{${str(decodeEntities(rest))}}`)
      continue
    }
    out.push(elementJsx(node, ctx))
  }
  // Leading and trailing blanks inside an element never show.
  while (out[0] === '{" "}') out.shift()
  while (out[out.length - 1] === '{" "}') out.pop()
  return out.join('')
}

function elementJsx(element: Element, ctx: FileContext): string {
  const tag = element.tag
  const lower = tag.toLowerCase()
  if (lower === 'sc-for') {
    const list = attr(element, 'list') ?? '[]'
    const as = attr(element, 'as') || 'item'
    const expression = (WHOLE.exec(list)?.[1] ?? list).trim()
    freeNames(expression, ctx.reads)
    const body = childrenJsx(element.children, ctx, lower)
    return `{dc.list(${expression}).map((${identifier(as)}, index) => (<dc.Fragment key={index}>${body}</dc.Fragment>))}`
  }
  if (lower === 'sc-if') {
    const value = attr(element, 'value') ?? 'false'
    const expression = (WHOLE.exec(value)?.[1] ?? value).trim()
    freeNames(expression, ctx.reads)
    return `{dc.flag(${expression}) ? (<>${childrenJsx(element.children, ctx, lower)}</>) : null}`
  }
  if (lower === 'dc-import') {
    const name = attr(element, 'name') ?? ''
    if (!ctx.known.has(name)) {
      ctx.warn(`imports ${name}${EXT}, which is not in the export`)
      return ''
    }
    const component = `DC_${identifier(name)}`
    ctx.imports.add(name)
    const props = element.attrs
      .filter(([key]) => key !== 'name' && !key.startsWith('hint-'))
      .map(([key, raw]) => {
        if (raw === null) return `${str(key)}: true`
        const whole = WHOLE.exec(raw)
        if (whole) {
          freeNames(whole[1]!, ctx.reads)
          return `${str(key)}: (${whole[1]!.trim()})`
        }
        return `${str(key)}: ${interpolated(raw, ctx.reads)}`
      })
    return `<${component} {...{${props.join(', ')}}} />`
  }
  if (lower === 'script') {
    ctx.warn('dropped a <script> inside the template')
    return ''
  }
  if (lower === 'title' || lower === 'helmet') return ''
  if (lower === 'style') {
    const css = element.children.map((child) => (child.type === 'text' ? child.text : '')).join('')
    return `<style>{${interpolated(css, ctx.reads)}}</style>`
  }
  if (lower === 'textarea') {
    const text = element.children.map((child) => (child.type === 'text' ? child.text : '')).join('')
    const extra = text ? [`defaultValue={${interpolated(text, ctx.reads)}}`] : []
    return `<textarea${attrsJsx(element, ctx, extra)} />`
  }
  const extra: string[] = []
  if (lower === 'select') {
    const selected = selectedOption(element)
    if (selected !== null && attr(element, 'value') === undefined)
      extra.push(`defaultValue={${interpolated(selected, ctx.reads)}}`)
  }
  const attrs = attrsJsx(element, ctx, extra)
  const children = childrenJsx(element.children, ctx, lower)
  return children ? `<${tag}${attrs}>${children}</${tag}>` : `<${tag}${attrs} />`
}

/** One `.dc.html` as a React module. */
function convertFile(name: string, source: string, ctx: Omit<FileContext, 'name' | 'reads' | 'imports'>): string {
  const document = parseMarkup(source)
  const root = findElement(document, (el) => el.tag.toLowerCase() === 'x-dc')
  const script = findElement(
    document,
    (el) => el.tag.toLowerCase() === 'script' && attr(el, 'data-dc-script') !== undefined,
  )
  const file: FileContext = { ...ctx, name, reads: new Set(), imports: new Set() }
  if (!root) throw new Error('no <x-dc> element')
  const helmet = /<helmet>([\s\S]*?)<\/helmet>/i.exec(source)?.[1]?.trim() ?? ''
  const body = childrenJsx(root.children, file, 'x-dc')
  let spec: unknown = {}
  const rawSpec = script ? attr(script, 'data-props') : null
  if (rawSpec) {
    try {
      spec = JSON.parse(decodeEntities(rawSpec))
    } catch {
      file.warn('has data-props that are not JSON; the props keep no defaults')
    }
  }
  const code = script?.children.map((child) => (child.type === 'text' ? child.text : '')).join('') ?? ''
  const className = /class\s+([A-Za-z_$][\w$]*)\s+extends\s+DCLogic/.exec(code)?.[1]
  const logic = className
    ? `const __Logic = (() => {\n${code.trim()}\nreturn ${className}\n})()`
    : 'const __Logic = null'
  const reads = [...file.reads].filter((read) => !read.startsWith('__') && read !== 'dc').sort()
  const lines = [
    `// Imported from Claude Design (${name}${EXT}).`,
    `import * as dc from './dc'`,
    ...[...file.imports].sort().map((dep) => `import DC_${identifier(dep)} from './${dep}'`),
    `const DCLogic = dc.DCLogic`,
    '',
    helmet ? `dc.head(${str(helmet)})\n` : '',
    `const __spec = ${JSON.stringify(spec)}`,
    '',
    logic,
    '',
    `export default function ${identifier(name)}(__props) {`,
    `  const __scope = dc.useLogic(__Logic, __spec, __props)`,
    reads.length ? `  const { ${reads.join(', ')} } = __scope` : '',
    `  return (<>${body}</>)`,
    '}',
    '',
  ]
  return lines.filter((line, index) => line !== '' || lines[index - 1] !== '').join('\n')
}

/** The canvas's own helpers: props with their defaults, state, and the viewer's theme. */
export const DC_HELPERS = `// Imported from Claude Design: what the converted screens need. This file is the canvas's own.
import { Fragment, useReducer, useRef } from 'react'
import { useTheme } from '@design/runtime'

export { Fragment }

/** The base of each screen's logic class: props, state and setState, as Claude Design had them. */
export class DCLogic {
  constructor(props) {
    this.props = props
    this.state = {}
  }
  setState(patch) {
    const next = typeof patch === 'function' ? patch(this.state, this.props) : patch
    this.state = { ...this.state, ...next }
    this.__update?.()
  }
  renderVals() {
    return {}
  }
}

const themed = (spec) => Array.isArray(spec?.theme?.options) && spec.theme.options.includes('dark')

function convert(field, value) {
  if (!field || typeof value !== 'string') return value
  if (field.editor === 'int' || field.editor === 'number') return Number(value)
  if (field.editor === 'bool' || field.editor === 'boolean') return value === 'true' || value === ''
  return value
}

/** Props (defaults, then what the canvas or a parent passed), the logic's values, for the template. */
export function useLogic(Logic, spec, given) {
  const theme = useTheme()
  const [, update] = useReducer((n) => n + 1, 0)
  const props = {}
  for (const [key, field] of Object.entries(spec ?? {}))
    if (!key.startsWith('$') && field && typeof field === 'object' && 'default' in field) props[key] = field.default
  for (const [key, value] of Object.entries(given ?? {})) props[key] = convert(spec?.[key], value)
  // A theme prop follows the viewer's light/dark switch unless the canvas pins it.
  if (themed(spec) && given?.theme === undefined) props.theme = theme
  const logic = useRef(null)
  if (Logic && !logic.current) logic.current = new Logic(props)
  let vals = {}
  if (logic.current) {
    logic.current.props = props
    logic.current.__update = update
    vals = logic.current.renderVals?.() ?? {}
  }
  return { props, ...props, ...vals }
}

const heads = new Set()
/** The template's <helmet>: fonts and styles, added to the page once. */
export function head(html) {
  if (heads.has(html) || typeof document === 'undefined') return
  heads.add(html)
  document.head.insertAdjacentHTML('beforeend', html)
}

/** An inline style string as a React style object. */
export function css(text) {
  const style = {}
  let depth = 0
  let quote = ''
  let start = 0
  const declarations = []
  for (let i = 0; i <= text.length; i++) {
    const c = text[i]
    if (quote) {
      if (c === quote) quote = ''
    } else if (c === '"' || c === "'") quote = c
    else if (c === '(') depth++
    else if (c === ')') depth--
    else if ((c === ';' && depth === 0) || i === text.length) {
      declarations.push(text.slice(start, i))
      start = i + 1
    }
  }
  for (const declaration of declarations) {
    const colon = declaration.indexOf(':')
    if (colon === -1) continue
    const name = declaration.slice(0, colon).trim()
    const value = declaration.slice(colon + 1).trim()
    if (!name || !value) continue
    const key = name.startsWith('--') ? name : name.toLowerCase().replace(/^-ms-/, 'ms-').replace(/-([a-z])/g, (_, c) => c.toUpperCase())
    style[key] = value
  }
  return style
}

/** A template value in text: nothing for null, undefined and false. */
export const text = (value) => (value == null || value === false ? '' : value)
/** An attribute value: left out for null, undefined and false. */
export const value = (v) => (v == null || v === false ? undefined : v)
/** A boolean attribute or condition. */
export const flag = (v) => v === true || v === 'true' || (!!v && v !== 'false')
/** What a loop runs over. */
export const list = (v) => (Array.isArray(v) ? v : v == null ? [] : Array.from(v))
`

function boardId(file: string, used: Set<string>): string {
  let base = kebab(file.slice(0, -EXT.length)) || 'screen'
  if (!ID_PATTERN.test(base)) base = `s-${base}`
  let id = base
  for (let n = 2; used.has(id); n++) id = `${base}-${n}`
  used.add(id)
  return id
}

export function importClaudeDesign(dir: string, options: { title?: string } = {}): ImportResult {
  const canvasFile = path.join(dir, 'canvas.json')
  if (!fs.existsSync(canvasFile))
    throw new Error(`No canvas.json in ${dir}: point at the exported Claude Design project folder`)
  const source = JSON.parse(fs.readFileSync(canvasFile, 'utf8')) as DcCanvas
  const templates = fs.readdirSync(dir).filter((file) => file.endsWith(EXT))
  if (!templates.length) throw new Error(`No ${EXT} files in ${dir}`)
  const known = new Set(templates.map((file) => file.slice(0, -EXT.length)))
  const warnings = new Map<string, Set<string>>()

  // Boards, in the project's order, with a route each so links between them work.
  const boards = source.boards ?? {}
  const order = [...(source.order ?? []).filter((file) => file in boards), ...Object.keys(boards)]
  const used = new Set<string>()
  const ids = new Map<string, string>()
  const routes = new Map<string, string>()
  for (const file of new Set(order)) {
    if (!known.has(file.slice(0, -EXT.length))) continue
    const id = boardId(file, used)
    ids.set(file, id)
    routes.set(file.slice(0, -EXT.length), `/${id}`)
  }

  const files = new Map<string, string>()
  files.set('dc.jsx', DC_HELPERS)
  for (const file of templates) {
    const name = file.slice(0, -EXT.length)
    const warn = (message: string) => {
      const set = warnings.get(message) ?? new Set<string>()
      set.add(file)
      warnings.set(message, set)
    }
    try {
      files.set(
        `${name}.jsx`,
        convertFile(name, fs.readFileSync(path.join(dir, file), 'utf8'), { known, routes, warn }),
      )
    } catch (error) {
      warn(`could not be converted: ${(error as Error).message}`)
    }
  }

  const pageList = source.pages?.length ? source.pages : [{ id: 'main', name: source.title ?? 'Main' }]
  const pages = pageList.map((page, index) => ({
    id: ID_PATTERN.test(page.id) ? page.id : `page-${index + 1}`,
    title: page.name || page.id,
    items: [] as Record<string, unknown>[],
  }))
  const pageOf = (id: string | undefined) =>
    pages[
      Math.max(
        0,
        pageList.findIndex((page) => page.id === id),
      )
    ]!
  let notes = 0
  for (const [key, note] of Object.entries(source.notes ?? {})) {
    if (!note.text) continue
    const heading =
      note.kind === 'title1' ? '# ' : note.kind === 'title2' ? '## ' : note.kind === 'title3' ? '### ' : ''
    pageOf(note.page).items.push({
      id: `note-${boardId(`${key}${EXT}`, used)}`,
      type: 'note',
      tone: heading ? 'plain' : 'note',
      text: `${heading}${note.text}`,
      width: Math.round(Math.min(Math.max(note.maxW ?? note.w ?? 480, 80), 4000)),
      x: note.x ?? 0,
      y: note.y ?? 0,
    })
    notes++
  }
  let screens = 0
  for (const [file, id] of ids) {
    const board = boards[file]!
    if (!files.has(`${file.slice(0, -EXT.length)}.jsx`)) continue
    pageOf(board.page).items.push({
      id,
      src: `screens/${file.slice(0, -EXT.length)}.jsx`,
      title: board.title || file.slice(0, -EXT.length),
      route: routes.get(file.slice(0, -EXT.length)),
      width: Math.round(Math.min(Math.max(board.w ?? 1440, 80), 8000)),
      height: Math.round(Math.min(Math.max(board.h ?? 900, 80), 40000)),
      x: board.x ?? 0,
      y: board.y ?? 0,
    })
    screens++
  }

  const canvas = {
    title: options.title ?? source.title ?? path.basename(path.resolve(dir)),
    description: 'Imported from Claude Design.',
    // The templates bring their own styles; the design system's reset would restyle them.
    system: false,
    pages: pages.filter((page) => page.items.length),
  }
  return { canvas, files, screens, notes, warnings }
}
