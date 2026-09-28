import { compileRoute, linkPath, matchRoute } from '@shared/routes'
import type { CanvasDoc, RuntimeMessage, Theme, ViewerMessage } from '@shared/types'
import { isSafeHref } from '../components/markdown'
import { toast } from '../ui/toast'
import { readRuntimeMessage } from './messages'
import { STATIC_SITE } from './source'

type Handler = (message: RuntimeMessage) => void

/** Routes runtime messages to whoever listens to the frame that sent them. */
const handlers = new Map<Window, Set<Handler>>()

window.addEventListener('message', (event: MessageEvent) => {
  const listeners = event.source ? handlers.get(event.source as Window) : undefined
  if (!listeners) return
  // Frames run code anyone who can push wrote: a message of the wrong shape goes nowhere.
  const message = readRuntimeMessage(event.data)
  if (!message) return
  for (const handler of listeners) handler(message)
})

export function listenToFrame(frame: HTMLIFrameElement, handler: Handler): () => void {
  let win: Window | null = null
  const detach = () => {
    if (!win) return
    const set = handlers.get(win)
    set?.delete(handler)
    if (!set?.size) handlers.delete(win)
    win = null
  }
  const attach = () => {
    detach()
    win = frame.contentWindow
    if (!win) return
    const set = handlers.get(win) ?? new Set()
    set.add(handler)
    handlers.set(win, set)
  }
  attach()
  frame.addEventListener('load', attach)
  return () => {
    frame.removeEventListener('load', attach)
    detach()
  }
}

type Outgoing = ViewerMessage extends infer M
  ? M extends { source: 'design-viewer' }
    ? Omit<M, 'source'>
    : never
  : never

export function sendToFrame(frame: HTMLIFrameElement | null, message: Outgoing) {
  frame?.contentWindow?.postMessage({ source: 'design-viewer', ...message }, '*')
}

/** Tell a frame it sits on the canvas, so it hands the wheel to the viewer. */
export function claimWheel(frame: HTMLIFrameElement | null) {
  sendToFrame(frame, { type: 'canvas' })
}

/**
 * A wheel the frame had no use for (it reached its edge, or holds nothing that scrolls): scroll
 * whatever scrolls around the frame, as the browser would if the frame's edges passed it on.
 */
export function scrollAround(frame: HTMLIFrameElement, delta: { deltaX: number; deltaY: number }) {
  for (let node = frame.parentElement; node; node = node.parentElement) {
    const style = getComputedStyle(node)
    const scrolls = (overflow: string) => /(auto|scroll|overlay)/.test(overflow)
    const y = scrolls(style.overflowY) && node.scrollHeight > node.clientHeight
    const x = scrolls(style.overflowX) && node.scrollWidth > node.clientWidth
    if (y || x) {
      node.scrollBy({ left: x ? delta.deltaX : 0, top: y ? delta.deltaY : 0, behavior: 'instant' })
      return
    }
  }
  window.scrollBy({ left: delta.deltaX, top: delta.deltaY, behavior: 'instant' })
}

export function sendTheme(frame: HTMLIFrameElement | null, theme: Theme) {
  sendToFrame(frame, { type: 'theme', theme })
}

/** Load the frame again; works whatever origin it is on. */
export function reloadFrame(frame: HTMLIFrameElement | null) {
  if (!frame) return
  const src = frame.src
  frame.src = src
}

/**
 * Where the dev server's frames load from. Browsers give each site its own
 * process, so frames served from the viewer's twin host (localhost ↔ 127.0.0.1,
 * both reach the same server) run their scripts and animations off the viewer's
 * thread: a canvas full of live screens still pans smoothly. Any other host,
 * and static builds, keep frames on the viewer's origin. The dev server keeps
 * its viewer on localhost and gives 127.0.0.1 to frames (server/hosts.ts).
 */
export const FRAME_ORIGIN = (() => {
  if (STATIC_SITE) return ''
  const { protocol, hostname, port } = window.location
  const twin = hostname === 'localhost' ? '127.0.0.1' : hostname === '127.0.0.1' ? 'localhost' : null
  return twin ? `${protocol}//${twin}${port ? `:${port}` : ''}` : ''
})()

/** A frame URL with the theme it should open in. */
export function frameSrc(url: string, theme: Theme, extra?: Record<string, string>): string {
  const [path = '', query = ''] = url.split('?')
  const params = new URLSearchParams(query)
  params.set('theme', theme)
  for (const [key, value] of Object.entries(extra ?? {})) params.set(key, value)
  return `${path.startsWith('/') ? FRAME_ORIGIN : ''}${path}?${params.toString()}`
}

/** Absolute URL for opening a frame in a new tab. */
export function absoluteUrl(url: string): string {
  return new URL(url, document.baseURI).toString()
}

/** A screen a link can lead to: its id and the app routes it shows. */
export interface LinkTarget {
  id: string
  routes?: string[]
}

/**
 * A link, form or history push the runtime kept from leaving its frame. The path goes to the
 * screen whose `route` matches it best (a relative `href` resolves against the route of the
 * screen it is in); without routes, a path whose last part names a screen still opens it. A
 * link to another site opens in a new tab. A push nobody's route matches belongs to the
 * screen's own router; a link or form that leads nowhere stays put with a note.
 */
export function followLink(
  message: Extract<RuntimeMessage, { type: 'link' }>,
  canvas: CanvasDoc | LinkTarget[],
  go: (id: string) => void,
  from?: string,
  /** A link to a path no screen has; a toast says so by default. */
  missing?: (path: string) => void,
) {
  if (message.form) {
    toast('Forms are not sent from here', undefined, 'info')
    return
  }
  if (message.path === null) {
    // The href comes from the frame, whose code anyone who can push wrote: only web and mail
    // links open, since a `javascript:` one would run with the viewer's origin.
    if (!isSafeHref(message.href) || !/^(https?|mailto):/i.test(message.href.trim())) {
      toast('Link not opened', message.href.slice(0, 200), 'info')
      return
    }
    const tab = window.open(message.href, '_blank', 'noopener,noreferrer')
    if (!tab) toast('Link to another site', message.href, 'info')
    return
  }
  const frames: LinkTarget[] = Array.isArray(canvas)
    ? canvas
    : canvas.pages.flatMap((page) =>
        page.sections.flatMap((section) =>
          section.items.filter((item) => item.kind === 'screen' || item.kind === 'url'),
        ),
      )
  const here = frames.find((item) => item.id === from)
  const path = message.raw === undefined ? message.path : linkPath(message.raw, here?.routes?.[0])
  if (path === null) return
  const routed = matchRoute(
    frames.map((item) => ({ routes: (item.routes ?? []).map(compileRoute), value: item.id })),
    path,
  )
  if (routed) {
    if (routed !== from) go(routed)
    return
  }
  const bare = path.split(/[?#]/)[0]!.replace(/\/+$/, '')
  let name = bare.slice(bare.lastIndexOf('/') + 1).replace(/\.html?$/, '')
  try {
    name = decodeURIComponent(name)
  } catch {}
  if (name && name !== from && frames.some((item) => item.id === name)) go(name)
  else if (message.pushed) return
  else if (missing) missing(path)
  else toast('No screen for this link', path, 'info')
}
