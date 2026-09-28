import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { createIdResolver, type Environment, type Plugin, type ResolvedConfig } from 'vite'
import { isInside } from '../core/paths'
import { toPosix } from '../core/text'

/**
 * Stylesheet directives that load code in Node: Tailwind's `@plugin` and `@config`, Less's
 * `@plugin`, Stylus's `use()`. Code under `.design` can come from a teammate through `design
 * pull`, and a stylesheet naming it would run it on this machine, so such a target is refused.
 * Packages and the app's own files stay allowed. The stylesheets a file imports are checked too,
 * since Tailwind inlines them without handing them to Vite.
 */
const LOADS_CODE = /@(plugin|config)\b([^;{}]*)|\buse\(\s*(["'])(.*?)\3/gi
const IMPORTS = /@(import|reference|require)\b([^;{}]*)/gi
const STYLESHEET = /\.(css|less|styl|stylus)$/i
/** Modules Tailwind and Vite leave as they are (`?raw`, `?url`, workers). */
const UNTOUCHED = /[?&](?:worker|sharedworker|raw|url)\b/
const JS_EXT = ['', '.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '/index.js', '/index.mjs', '/index.cjs', '/index.ts']
const STYLE_EXT = ['', '.css', '.less', '.styl', '/index.css', '/index.styl']

type Resolve = (spec: string, importer: string) => Promise<string | null>

/** The file a module id names: `a.css?direct` → `a.css`, an HTML `<style>` → its page. */
const idFile = (id: string) => id.replace(/[?#].*$/, '')

function isStylesheetId(id: string): boolean {
  if (UNTOUCHED.test(id) || id.startsWith('\0') || id.includes('/.vite/')) return false
  return STYLESHEET.test(idFile(id)) || /&lang\.(css|less|styl)/.test(id) || /[?&]index=\d+\.css$/.test(id)
}

const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?(\*\/|$)/g, '')

/** What a directive's parameters may name: Tailwind takes them less their first and last character. */
function targets(params: string): string[] {
  const out = new Set<string>()
  for (const text of [params.trim(), stripComments(params).trim()]) {
    if (!text) continue
    out.add(text.slice(1, -1))
    out.add(text.slice(1, -1).trim())
    const quoted = /(["'])(.*?)\1/.exec(text)?.[2]
    if (quoted) out.add(quoted)
    const url = /^url\(\s*(["']?)(.*?)\1\s*\)/.exec(text)?.[2]
    if (url) out.add(url)
    // Stylus and Less also take an unquoted path.
    const bare = /^[^\s"'()]+/.exec(text)?.[0]
    if (bare) out.add(bare)
  }
  out.delete('')
  return [...out]
}

const isPathLike = (spec: string) => spec.startsWith('.') || path.isAbsolute(spec)

function existing(base: string, exts: string[]): string | null {
  for (const ext of exts) {
    const file = base + ext
    try {
      if (fs.statSync(file).isFile()) return fs.realpathSync(file)
    } catch {}
  }
  return null
}

export function designCodeGuard(design: string): Plugin {
  let config: ResolvedConfig | null = null
  /** Inside `.design` and not in a `node_modules` folder, which `design pull` never writes. */
  const pulled = (file: string) => isInside(design, file) && !toPosix(file).split('/').includes('node_modules')
  const shown = (file: string) => toPosix(path.relative(path.dirname(design), file))

  // The resolvers Tailwind uses: Vite's, with the project's aliases, for scripts and for stylesheets.
  const resolvers = (environment: Environment) => {
    const resolveWith = (options: Parameters<typeof createIdResolver>[1], accept: (file: string) => boolean) => {
      const resolveId = config ? createIdResolver(config, options) : null
      return async (spec: string, importer: string): Promise<string | null> => {
        if (!resolveId) return null
        const from = path.join(path.dirname(importer), '__placeholder__.ts')
        for (const aliasOnly of [true, false]) {
          try {
            let found = await resolveId(environment, spec, from, aliasOnly)
            if (found && found !== spec) {
              if (found.startsWith('.')) found = path.resolve(path.dirname(importer), found)
              found = idFile(found)
              if (path.isAbsolute(found) && accept(found)) return found
            }
          } catch {}
        }
        return null
      }
    }
    const style = resolveWith(
      {
        ...config?.resolve,
        extensions: ['.css'],
        mainFields: ['style'],
        conditions: ['style', 'development|production'],
        tryIndex: false,
        preferRelative: true,
      },
      (file) => file.endsWith('.css'),
    )
    const script = resolveWith({ ...config?.resolve }, (file) => !file.endsWith('.css'))
    return { style, script }
  }

  /** Every file `spec` could name from `importer`, by any resolution a loader might use. */
  const candidates = async (spec: string, importer: string, resolve: Resolve, exts: string[]) => {
    const found = new Set<string>()
    const local = path.resolve(path.dirname(importer), spec)
    if (isPathLike(spec)) found.add(local)
    const file = existing(local, exts)
    if (file) found.add(file)
    const viaVite = await resolve(spec, importer)
    if (viaVite) found.add(viaVite)
    if (!isPathLike(spec)) {
      try {
        found.add(createRequire(importer).resolve(spec))
      } catch {}
    }
    return [...found]
  }

  const check = async (environment: Environment, file: string, code: string, seen: Set<string>) => {
    const { style, script } = resolvers(environment)
    for (const match of code.matchAll(LOADS_CODE)) {
      const directive = match[1] ? `@${match[1]}` : 'use()'
      const specs = match[1] ? targets(match[2] ?? '') : [match[4] ?? '']
      for (const spec of specs) {
        for (const target of await candidates(spec, file, script, JS_EXT)) {
          if (!pulled(target)) continue
          throw new Error(
            `${shown(file)}: \`${match[0].trim()}\` loads ${shown(target)}, which is refused. ${directive} runs ` +
              'its code in Node on this machine, and code under .design can come from a teammate through ' +
              '`design pull`. Put the plugin in the app’s own source (outside .design) or name an installed package.',
          )
        }
      }
    }
    for (const match of code.matchAll(IMPORTS)) {
      for (const spec of targets(match[2] ?? '')) {
        if (/^(data:|https?:|\/\/)/i.test(spec)) continue
        for (const target of await candidates(spec, file, style, STYLE_EXT)) {
          if (seen.has(target) || !STYLESHEET.test(target) || toPosix(target).includes('/node_modules/')) continue
          seen.add(target)
          let text: string
          try {
            text = fs.readFileSync(target, 'utf8')
          } catch {
            continue
          }
          await check(environment, target, text, seen)
        }
      }
    }
  }

  return {
    name: 'design:code-guard',
    enforce: 'pre',
    configResolved(resolved) {
      config = resolved
    },
    async transform(code, id) {
      if (!isStylesheetId(id)) return null
      const file = path.resolve(idFile(id))
      await check(this.environment, file, code, new Set([file]))
      return null
    },
  }
}
