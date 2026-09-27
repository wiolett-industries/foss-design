/**
 * Screen routes: the app URL a screen stands for (`/databases/:id`), so a plain link in any
 * screen (`href="/databases/orders-db"`) opens the screen that shows that URL. Patterns work
 * like a router's: `:param` matches one segment, `:param?` an optional one, a trailing `*` the
 * rest of the path.
 */

type Segment = { kind: 'static'; value: string } | { kind: 'param'; optional: boolean } | { kind: 'splat' }

export interface CompiledRoute {
  pattern: string
  segments: Segment[]
}

/** What is wrong with a pattern, or null. */
export function routeError(pattern: string): string | null {
  if (!pattern.startsWith('/')) return `route "${pattern}" must start with "/"`
  if (/[?#]/.test(pattern.replace(/:[A-Za-z_]\w*\?/g, ''))) return `route "${pattern}" has no query or hash part`
  const parts = split(pattern)
  for (const [index, part] of parts.entries()) {
    if (part === '*') {
      if (index !== parts.length - 1) return `route "${pattern}": "*" only ends a route`
    } else if (part.startsWith(':') && !/^:[A-Za-z_]\w*\??$/.test(part)) {
      return `route "${pattern}": "${part}" is not a parameter (use :name or :name?)`
    }
  }
  return null
}

function split(path: string): string[] {
  return path.split('/').filter(Boolean)
}

export function compileRoute(pattern: string): CompiledRoute {
  return {
    pattern,
    segments: split(pattern).map((part): Segment => {
      if (part === '*') return { kind: 'splat' }
      if (part.startsWith(':')) return { kind: 'param', optional: part.endsWith('?') }
      return { kind: 'static', value: part }
    }),
  }
}

function decode(part: string): string {
  try {
    return decodeURIComponent(part)
  } catch {
    return part
  }
}

/** How well a route matches a path (higher is more specific), or null when it does not. */
export function scoreRoute(route: CompiledRoute, path: string): number | null {
  const parts = split(path.split(/[?#]/)[0] ?? '').map(decode)
  const walk = (s: number, p: number): number | null => {
    if (s === route.segments.length) return p === parts.length ? 0 : null
    const segment = route.segments[s]!
    if (segment.kind === 'splat') return 0
    if (segment.kind === 'static') {
      if (parts[p] !== segment.value) return null
      const rest = walk(s + 1, p + 1)
      return rest === null ? null : rest + 4
    }
    if (p < parts.length) {
      const rest = walk(s + 1, p + 1)
      if (rest !== null) return rest + 2
    }
    return segment.optional ? walk(s + 1, p) : null
  }
  return walk(0, 0)
}

export interface Routed<T> {
  routes: CompiledRoute[]
  value: T
}

/** The most specific match for a path; the first one listed wins a tie. */
export function matchRoute<T>(entries: Routed<T>[], path: string): T | null {
  let best: { score: number; value: T } | null = null
  for (const entry of entries) {
    for (const route of entry.routes) {
      const score = scoreRoute(route, path)
      if (score !== null && (!best || score > best.score)) best = { score, value: entry.value }
    }
  }
  return best?.value ?? null
}

/**
 * The app path a link points at, from its `href` as written: an absolute path as it is, a
 * relative one against the route of the screen it is in (or `/`). Null for links that do not
 * lead to another page of the app: `#…`, other schemes, other sites.
 */
export function linkPath(href: string, base = '/'): string | null {
  const raw = href.trim()
  if (!raw || raw.startsWith('#')) return null
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('//')) return null
  const origin = 'http://app.invalid'
  const url = new URL(raw, `${origin}${base.replace(/\/:[^/]+\??|\/\*$/g, '/x')}`)
  return url.pathname + url.search + url.hash
}
