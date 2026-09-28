/**
 * The preview server answers loopback names on its own port only: a site that points its own
 * name at 127.0.0.1 (DNS rebinding) would otherwise read the API from the user's browser.
 */
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * Frames load from the viewer's twin host (see viewer/src/lib/frames.ts): the viewer lives on
 * `localhost`, its frames on `127.0.0.1`. Screens are code anyone who can push wrote, so this
 * host serves them what the runtime needs and nothing of the viewer's.
 */
export const FRAME_HOST = '127.0.0.1'
export const VIEWER_HOST = 'localhost'

/** `localhost:5392` → `{ name: 'localhost', port: 5392 }`; null when it is no host. */
export function parseHost(header: string | undefined): { name: string; port: number } | null {
  const match = /^(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::(\d{1,5}))?$/i.exec(header ?? '')
  if (!match) return null
  return { name: match[1]!.toLowerCase(), port: match[2] ? Number(match[2]) : 80 }
}

/** A Host header the server answers: a loopback name (or `extra`, the address it was asked to bind) on its port. */
export function isAllowedHost(header: string | undefined, port: number, extra?: string): boolean {
  const host = parseHost(header)
  if (!host || host.port !== port) return false
  return LOOPBACK.has(host.name) || host.name.endsWith('.localhost') || (!!extra && host.name === extra.toLowerCase())
}

/** What frames may call on their host: taking snapshots (and showing them), and the CLI's health check. */
export function isFrameApi(pathname: string, method: string): boolean {
  if (pathname === '/api/health') return method === 'GET'
  return /^\/api\/snapshots\/[^/]+\/[^/]+$/.test(pathname) && (method === 'GET' || method === 'POST')
}
