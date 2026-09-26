import fs from 'node:fs'
import path from 'node:path'
import postcss, { type AtRule, type ChildNode, type Container, type Declaration, type Rule } from 'postcss'
import type { Token, TokenKind } from '../shared/types'

type Scope = 'root' | 'dark' | 'theme'

interface RawDecl {
  name: string
  value: string
  scope: Scope
  group?: string
  description?: string
}

/** Tailwind theme namespaces, longest prefix first. */
const NAMESPACES: [prefix: string, kind: TokenKind][] = [
  ['--color-', 'color'],
  ['--font-weight-', 'weight'],
  ['--font-', 'font'],
  ['--text-shadow-', 'shadow'],
  ['--text-', 'text'],
  ['--leading-', 'leading'],
  ['--tracking-', 'tracking'],
  ['--spacing-', 'spacing'],
  ['--radius-', 'radius'],
  ['--inset-shadow-', 'shadow'],
  ['--drop-shadow-', 'shadow'],
  ['--shadow-', 'shadow'],
  ['--blur-', 'blur'],
  ['--ease-', 'ease'],
  ['--animate-', 'animation'],
  ['--duration-', 'duration'],
  ['--breakpoint-', 'breakpoint'],
  ['--container-', 'breakpoint'],
]

const DEFAULT_GROUP: Record<TokenKind, string> = {
  color: 'Colors',
  font: 'Font families',
  text: 'Type scale',
  weight: 'Font weights',
  leading: 'Line heights',
  tracking: 'Letter spacing',
  spacing: 'Spacing',
  radius: 'Radii',
  shadow: 'Shadows',
  blur: 'Blur',
  ease: 'Easing',
  animation: 'Animations',
  duration: 'Durations',
  breakpoint: 'Breakpoints',
  other: 'Other',
}

const COLOR_FN = /^(?:#[0-9a-f]{3,8}\b|(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark)\()/i
const COLOR_NAMES = new Set([
  'transparent',
  'currentcolor',
  'black',
  'white',
  'red',
  'green',
  'blue',
  'gray',
  'grey',
  'orange',
  'yellow',
  'purple',
  'pink',
  'teal',
  'navy',
  'silver',
])

export function isColor(value: string): boolean {
  const v = value.trim()
  return COLOR_FN.test(v) || COLOR_NAMES.has(v.toLowerCase())
}

function namespaceOf(name: string): { kind: TokenKind; key: string } | null {
  if (name === '--spacing') return { kind: 'spacing', key: '' }
  for (const [prefix, kind] of NAMESPACES) if (name.startsWith(prefix)) return { kind, key: name.slice(prefix.length) }
  return null
}

function inferKind(name: string, value: string): TokenKind {
  const n = name.toLowerCase()
  if (isColor(value)) return 'color'
  if (/shadow/.test(n)) return 'shadow'
  if (/radius|rounded/.test(n)) return 'radius'
  if (/ease|easing/.test(n) || /^cubic-bezier\(|^steps\(/.test(value.trim())) return 'ease'
  if (/duration/.test(n) || /^-?[\d.]+m?s$/.test(value.trim())) return 'duration'
  if (/font|family/.test(n) && /["',]/.test(value)) return 'font'
  if (/space|spacing|gap|gutter/.test(n)) return 'spacing'
  return 'other'
}

function isDarkSelector(selector: string): boolean {
  return /\[data-(?:theme|mode|color-scheme)=["']?dark["']?\]|\.dark\b|:is\(\.dark|\.theme-dark\b/.test(selector)
}

function isRootSelector(selector: string): boolean {
  return /(^|[\s,])(:root|html|:host|\*)(?=$|[\s,:[.])/.test(selector) || /^\s*:root/.test(selector)
}

function insideDarkMedia(node: ChildNode): boolean {
  let parent = node.parent
  while (parent && parent.type !== 'root') {
    if (parent.type === 'atrule') {
      const at = parent as AtRule
      if (at.name === 'media' && /prefers-color-scheme\s*:\s*dark/.test(at.params)) return true
    }
    parent = parent.parent as Container | undefined
  }
  return false
}

function scopeOf(container: Container): Scope | null {
  if (container.type === 'atrule') {
    const at = container as AtRule
    return at.name === 'theme' ? 'theme' : null
  }
  if (container.type !== 'rule') return null
  const rule = container as Rule
  if (isDarkSelector(rule.selector) || insideDarkMedia(rule)) return 'dark'
  if (isRootSelector(rule.selector)) return 'root'
  return null
}

function commentText(node: ChildNode): string | null {
  return node.type === 'comment' ? node.text.trim() : null
}

/** Declarations of custom properties in `:root`-like rules, dark rules and `@theme` blocks, with their comments. */
function collect(css: string, from: string): RawDecl[] {
  const root = postcss.parse(css, { from })
  const out: RawDecl[] = []
  const visit = (container: Container) => {
    const scope = scopeOf(container)
    if (scope) {
      let group: string | undefined
      let pending: string | undefined
      const nodes = container.nodes ?? []
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i]!
        const text = commentText(node)
        if (text !== null) {
          const marker = /^@group\s+(.+)$/.exec(text)
          if (marker) {
            group = marker[1]!.trim()
            pending = undefined
            continue
          }
          const prev = nodes[i - 1]
          // A comment on the same line as the declaration before it describes that declaration.
          if (prev?.type === 'decl' && !/\n/.test(node.raws.before ?? '')) {
            const last = out[out.length - 1]
            if (last && last.name === (prev as Declaration).prop && !last.description) last.description = text
            continue
          }
          pending = text
          continue
        }
        if (node.type === 'decl') {
          const decl = node as Declaration
          if (decl.prop.startsWith('--') && !decl.prop.includes('*') && decl.value.trim() !== 'initial') {
            out.push({ name: decl.prop, value: decl.value.trim(), scope, group, description: pending })
          }
          pending = undefined
          continue
        }
        pending = undefined
      }
    }
    for (const node of container.nodes ?? []) {
      if (node.type === 'rule' || node.type === 'atrule') visit(node as Container)
    }
  }
  visit(root)
  return out
}

/** CSS files to read: the entry and the local files it imports, depth first. */
export function readStylesheets(entry: string): { file: string; css: string }[] {
  const seen = new Set<string>()
  const files: { file: string; css: string }[] = []
  const walk = (file: string) => {
    if (seen.has(file) || !fs.existsSync(file)) return
    seen.add(file)
    const css = fs.readFileSync(file, 'utf8')
    const imports = [...css.matchAll(/@import\s+(?:url\()?\s*["']([^"']+)["']/g)].map((m) => m[1]!)
    for (const spec of imports) {
      if (spec.startsWith('./') || spec.startsWith('../')) walk(path.resolve(path.dirname(file), spec))
    }
    files.push({ file, css })
  }
  walk(entry)
  return files
}

/** Position of the parenthesis closing the one opened just before `start`. */
function closingParen(text: string, start: number): number {
  let depth = 1
  for (let i = start; i < text.length; i++) {
    if (text[i] === '(') depth++
    else if (text[i] === ')' && --depth === 0) return i
  }
  return -1
}

/** Substitute `var(--x, fallback)` from `scope`, recursively. */
export function resolveValue(value: string, scope: Map<string, string>, depth = 0): string {
  if (depth > 12 || !value.includes('var(')) return value
  let out = ''
  let i = 0
  for (;;) {
    const at = value.indexOf('var(', i)
    if (at === -1) break
    const end = closingParen(value, at + 4)
    if (end === -1) break
    const inner = value.slice(at + 4, end)
    let comma = -1
    let level = 0
    for (let j = 0; j < inner.length; j++) {
      if (inner[j] === '(') level++
      else if (inner[j] === ')') level--
      else if (inner[j] === ',' && level === 0) {
        comma = j
        break
      }
    }
    const name = (comma === -1 ? inner : inner.slice(0, comma)).trim()
    const fallback = comma === -1 ? undefined : inner.slice(comma + 1).trim()
    const found = scope.get(name)
    const replacement =
      found !== undefined
        ? resolveValue(found, scope, depth + 1)
        : fallback !== undefined
          ? resolveValue(fallback, scope, depth + 1)
          : value.slice(at, end + 1)
    out += value.slice(i, at) + replacement
    i = end + 1
  }
  return out + value.slice(i)
}

/** `var(--x)` or `var(--x, …)` as the whole value → `--x`. */
function directRef(value: string): string | null {
  const match = /^var\(\s*(--[\w-]+)\s*(?:,[\s\S]*)?\)$/.exec(value.trim())
  return match ? match[1]! : null
}

export function parseTokens(files: { file: string; css: string }[]): Token[] {
  const decls = files.flatMap(({ file, css }) => {
    try {
      return collect(css, file)
    } catch {
      return []
    }
  })
  const rootVars = new Map<string, RawDecl>()
  const darkVars = new Map<string, RawDecl>()
  const themeVars = new Map<string, RawDecl>()
  for (const decl of decls) {
    const map = decl.scope === 'root' ? rootVars : decl.scope === 'dark' ? darkVars : themeVars
    const prev = map.get(decl.name)
    map.set(decl.name, {
      ...decl,
      group: decl.group ?? prev?.group,
      description: decl.description ?? prev?.description,
    })
  }

  const light = new Map<string, string>()
  for (const [name, decl] of themeVars) light.set(name, decl.value)
  for (const [name, decl] of rootVars) light.set(name, decl.value)
  const dark = new Map(light)
  for (const [name, decl] of darkVars) dark.set(name, decl.value)

  const value = (raw: string, scope: Map<string, string>) => ({ raw, value: resolveValue(raw, scope) })
  const darkOf = (name: string, raw: string, lightValue: string) => {
    const own = darkVars.get(name)
    const resolved = value(own?.value ?? raw, dark)
    return resolved.value !== lightValue ? resolved : undefined
  }

  const tokens = new Map<string, Token>()
  const consumed = new Set<string>()
  const lineHeights = new Map<string, string>()

  for (const [name, decl] of themeVars) {
    const companion = /^(--text-[\w-]+?)--line-height$/.exec(name)
    if (companion) {
      lineHeights.set(companion[1]!, resolveValue(decl.value, light))
      continue
    }
    if (/--(?:letter-spacing|font-weight|font-feature-settings|font-variation-settings)$/.test(name)) continue
    const ns = namespaceOf(name)
    const ref = directRef(decl.value)
    const source = ref && rootVars.has(ref) ? rootVars.get(ref)! : null
    const tokenName = source ? ref! : name
    if (tokens.has(tokenName)) continue
    if (source) consumed.add(ref!)
    const raw = source ? source.value : decl.value
    const lightValue = value(raw, light)
    const kind = ns?.kind ?? inferKind(tokenName, lightValue.value)
    tokens.set(tokenName, {
      name: tokenName,
      kind,
      group: source?.group ?? decl.group ?? DEFAULT_GROUP[kind],
      description: source?.description ?? decl.description,
      light: lightValue,
      dark: darkOf(tokenName, raw, lightValue.value),
      utility: ns ? ns.key : undefined,
    })
  }

  for (const [name, decl] of rootVars) {
    if (consumed.has(name) || tokens.has(name)) continue
    const lightValue = value(decl.value, light)
    const kind = namespaceOf(name)?.kind ?? inferKind(name, lightValue.value)
    tokens.set(name, {
      name,
      kind,
      group: decl.group ?? (kind === 'other' ? 'Variables' : DEFAULT_GROUP[kind]),
      description: decl.description,
      light: lightValue,
      dark: darkOf(name, decl.value, lightValue.value),
    })
  }

  for (const [name, lineHeight] of lineHeights) {
    const token = tokens.get(name)
    if (token) token.lineHeight = lineHeight
  }
  return [...tokens.values()]
}
