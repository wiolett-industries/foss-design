import type { RuntimeMessage, Theme } from '@shared/types'

type Handler = (message: RuntimeMessage) => void

/** Routes runtime messages to the frame that sent them. */
const handlers = new Map<Window, Handler>()

window.addEventListener('message', (event: MessageEvent) => {
  const data = event.data as RuntimeMessage | null
  if (data?.source !== 'design-runtime' || !event.source) return
  handlers.get(event.source as Window)?.(data)
})

export function listenToFrame(frame: HTMLIFrameElement, handler: Handler): () => void {
  let win: Window | null = null
  const attach = () => {
    if (win) handlers.delete(win)
    win = frame.contentWindow
    if (win) handlers.set(win, handler)
  }
  attach()
  frame.addEventListener('load', attach)
  return () => {
    frame.removeEventListener('load', attach)
    if (win) handlers.delete(win)
  }
}

/** Tell a frame it sits on the canvas, so it hands the wheel to the viewer. */
export function claimWheel(frame: HTMLIFrameElement | null) {
  frame?.contentWindow?.postMessage({ source: 'design-viewer', type: 'canvas' }, '*')
}

export function sendTheme(frame: HTMLIFrameElement | null, theme: Theme) {
  frame?.contentWindow?.postMessage({ source: 'design-viewer', type: 'theme', theme }, '*')
}

/** A frame URL with the theme it should open in. */
export function frameSrc(url: string, theme: Theme, extra?: Record<string, string>): string {
  const [path, query = ''] = url.split('?')
  const params = new URLSearchParams(query)
  params.set('theme', theme)
  for (const [key, value] of Object.entries(extra ?? {})) params.set(key, value)
  return `${path}?${params.toString()}`
}

/** Absolute URL for opening a frame in a new tab. */
export function absoluteUrl(url: string): string {
  return new URL(url, document.baseURI).toString()
}
