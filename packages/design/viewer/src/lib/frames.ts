import type { RuntimeMessage, Theme, ViewerMessage } from '@shared/types'
import { STATIC } from './api'

type Handler = (message: RuntimeMessage) => void

/** Routes runtime messages to whoever listens to the frame that sent them. */
const handlers = new Map<Window, Set<Handler>>()

window.addEventListener('message', (event: MessageEvent) => {
  const data = event.data as RuntimeMessage | null
  if (data?.source !== 'design-runtime' || !event.source) return
  for (const handler of handlers.get(event.source as Window) ?? []) handler(data)
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
 * and static builds, keep frames on the viewer's origin.
 */
export const FRAME_ORIGIN = (() => {
  if (STATIC) return ''
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
