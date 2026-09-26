/**
 * Runs inside every frame. Screens may import it as `@design/runtime`:
 *
 *   import { go, useTheme, useScreen } from '@design/runtime'
 */
import { Component, type ComponentType, type ReactNode, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import type { ViewerMessage } from '../shared/types'
import { FrameInspector } from './inspect'

export { TypographySpecimen } from './typography'

export type Theme = 'light' | 'dark'

interface FrameConfig {
  /** `canvas/id`. */
  key: string
  canvas: string
  id: string
  title?: string
  props: Record<string, unknown>
  /** Set when canvas.json pins the theme; the viewer's toggle is then ignored. */
  theme?: Theme
  /** The dev server stores snapshots of the frame for the zoomed-out canvas. */
  snapshots?: boolean
  /** Auto-height frames report their content height instead of the viewport. */
  autoHeight?: boolean
}

export interface HotContext {
  on(event: string, cb: (payload: unknown) => void): void
}

declare global {
  interface Window {
    __DESIGN__?: FrameConfig
    __DESIGN_READY__?: boolean
    __DESIGN_ERRORS__?: string[]
  }
}

const config: FrameConfig = window.__DESIGN__ ?? { key: '', canvas: '', id: '', props: {} }
const embedded = window.parent !== window
const query = new URLSearchParams(window.location.search)
const capture = query.has('capture')

let theme: Theme = config.theme ?? (query.get('theme') === 'dark' ? 'dark' : 'light')
const themeListeners = new Set<() => void>()

function applyTheme(next: Theme) {
  theme = next
  const root = document.documentElement
  root.dataset.theme = next
  root.classList.toggle('dark', next === 'dark')
  root.style.colorScheme = next
  for (const listener of themeListeners) listener()
}

function post(message: Record<string, unknown>) {
  if (embedded) window.parent.postMessage({ source: 'design-runtime', key: config.key, ...message }, '*')
}

function recordError(message: string) {
  window.__DESIGN_ERRORS__ = [...(window.__DESIGN_ERRORS__ ?? []), message]
  post({ type: 'error', message })
}

/** The theme the viewer shows this screen in. */
export function useTheme(): Theme {
  return useSyncExternalStore(
    (listener) => {
      themeListeners.add(listener)
      return () => themeListeners.delete(listener)
    },
    () => theme,
    () => theme,
  )
}

/**
 * Move to another screen: on the canvas the viewer brings it into view, in
 * play mode it opens it. `target` is a screen id, or `page/id` on another page.
 */
export function go(target: string) {
  if (embedded) post({ type: 'go', target })
  else console.info(`[design] go("${target}") works inside the canvas viewer`)
}

/** Where this screen sits and the props canvas.json gave it. */
export function useScreen(): { canvas: string; id: string; props: Record<string, unknown> } {
  return { canvas: config.canvas, id: config.id, props: config.props }
}

function contentHeight(): number {
  const body = document.body
  if (!body) return 0
  const bodyStyle = getComputedStyle(body)
  let bottom = 0
  for (const child of Array.from(body.children)) {
    if (child instanceof HTMLScriptElement || child instanceof HTMLStyleElement || child instanceof HTMLLinkElement)
      continue
    const style = getComputedStyle(child)
    if (style.display === 'none' || style.position === 'fixed') continue
    const rect = child.getBoundingClientRect()
    bottom = Math.max(bottom, rect.bottom + Number.parseFloat(style.marginBottom || '0') + window.scrollY)
  }
  const extra = Number.parseFloat(bodyStyle.paddingBottom || '0') + Number.parseFloat(bodyStyle.marginBottom || '0')
  return Math.min(Math.ceil(bottom + extra), 40000)
}

/** Whether the wheel would scroll something under the pointer, in the direction it moves. */
function canScroll(target: EventTarget | null, dx: number, dy: number): boolean {
  const vertical = Math.abs(dy) >= Math.abs(dx)
  const delta = vertical ? dy : dx
  for (let node = target instanceof Element ? target : null; node; node = node.parentElement) {
    const style = getComputedStyle(node)
    const overflow = vertical ? style.overflowY : style.overflowX
    const root = node === document.documentElement || node === document.body
    if (!root && !/(auto|scroll|overlay)/.test(overflow)) continue
    const el = root ? (document.scrollingElement ?? document.documentElement) : node
    const max = vertical ? el.scrollHeight - el.clientHeight : el.scrollWidth - el.clientWidth
    if (max <= 1) {
      if (root) break
      continue
    }
    const pos = vertical ? el.scrollTop : el.scrollLeft
    if ((delta > 0 && pos < max - 1) || (delta < 0 && pos > 0)) return true
    if (root) break
  }
  return false
}

let lastSize = { width: 0, height: 0 }
function reportSize() {
  const size = { width: window.innerWidth, height: contentHeight() }
  if (Math.abs(size.height - lastSize.height) < 1 && size.width === lastSize.width) return
  lastSize = size
  post({ type: 'size', ...size })
}

function watchSize() {
  let queued = false
  const queue = () => {
    if (queued) return
    queued = true
    requestAnimationFrame(() => {
      queued = false
      reportSize()
    })
  }
  const resize = new ResizeObserver(queue)
  const observeChildren = () => {
    resize.disconnect()
    resize.observe(document.documentElement)
    resize.observe(document.body)
    for (const child of Array.from(document.body.children)) resize.observe(child)
  }
  observeChildren()
  new MutationObserver(() => {
    observeChildren()
    queue()
  }).observe(document.body, { childList: true })
  window.addEventListener('load', queue)
  queue()
}

let snapshotTimer: ReturnType<typeof setTimeout> | undefined
function scheduleSnapshot() {
  if (!config.snapshots || !embedded || capture) return
  clearTimeout(snapshotTimer)
  snapshotTimer = setTimeout(() => {
    const run = () => void takeSnapshot()
    if ('requestIdleCallback' in window) window.requestIdleCallback(run, { timeout: 4000 })
    else run()
  }, 1800)
}

async function takeSnapshot() {
  try {
    const { domToBlob } = await import('modern-screenshot')
    const width = window.innerWidth
    const height = config.autoHeight ? contentHeight() || window.innerHeight : window.innerHeight
    const blob = await domToBlob(document.documentElement, {
      width,
      height,
      scale: Math.min(1, 900 / Math.max(width, 1)),
      type: 'image/png',
      backgroundColor: getComputedStyle(document.body).backgroundColor,
    })
    if (!blob) return
    const [canvas, id] = [config.canvas, config.id].map(encodeURIComponent)
    await fetch(`/api/snapshots/${canvas}/${id}?theme=${theme}&height=${config.autoHeight ? height : ''}`, {
      method: 'POST',
      headers: { 'content-type': 'image/png' },
      body: blob,
    })
  } catch {
    // A snapshot is a nicety: the canvas falls back to a placeholder.
  }
}

let booted = false
let hmrBound = false
/** Set when the frame sits on the canvas: only then does the wheel belong to the viewer. */
let canvasHost = false

/** Wire the frame to the viewer. `mount` calls it; HTML screens get it injected. */
export function boot() {
  if (booted) return
  booted = true
  applyTheme(theme)

  let inspector: FrameInspector | null = null
  window.addEventListener('message', (event: MessageEvent) => {
    const data = event.data as ViewerMessage | null
    if (data?.source !== 'design-viewer' || event.source !== window.parent) return
    if (data.type === 'canvas') canvasHost = true
    else if (data.type === 'theme' && data.theme && !config.theme) {
      applyTheme(data.theme)
      scheduleSnapshot()
    } else if (data.type === 'inspect') {
      inspector ??= new FrameInspector(post)
      if (data.tokens) inspector.setTokens(data.tokens)
      if (data.on) inspector.enable()
      else inspector.disable()
    } else if (data.type === 'inspect-select') inspector?.select(data.ref)
  })

  window.addEventListener(
    'wheel',
    (event) => {
      if (!embedded || !canvasHost) return
      const zoom = event.ctrlKey || event.metaKey
      // Pinch always zooms the canvas; a plain wheel pans it unless something under the pointer scrolls.
      if (!zoom && canScroll(event.target, event.deltaX, event.deltaY)) return
      event.preventDefault()
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1
      post({
        type: 'wheel',
        deltaX: event.deltaX * unit,
        deltaY: event.deltaY * unit,
        x: event.clientX,
        y: event.clientY,
        zoom,
      })
    },
    { passive: false },
  )
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !event.defaultPrevented) post({ type: 'keydown', code: 'Escape' })
  })
  // Holding ⌘/Ctrl inspects in the viewer, which cannot see keys pressed in here.
  const isModifier = (name: string) => name === 'Meta' || name === 'Control'
  window.addEventListener(
    'keydown',
    (event) => {
      if (isModifier(event.key) || event.metaKey || event.ctrlKey) post({ type: 'key', name: event.key, down: true })
    },
    true,
  )
  window.addEventListener(
    'keyup',
    (event) => {
      if (isModifier(event.key)) post({ type: 'key', name: event.key, down: false })
    },
    true,
  )
  window.addEventListener('blur', () => post({ type: 'blur' }))
  window.addEventListener('error', (event) => recordError(event.message || 'Script error'))
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason as { message?: string } | undefined
    recordError(String(reason?.message ?? reason ?? 'Unhandled rejection'))
  })

  const ready = () => {
    window.__DESIGN_READY__ = true
    post({ type: 'ready' })
    scheduleSnapshot()
  }
  const whenBodyReady = () => {
    if (embedded) watchSize()
    const fonts = document.fonts?.ready ?? Promise.resolve()
    void fonts.then(() => requestAnimationFrame(() => requestAnimationFrame(ready)))
  }
  if (document.body) whenBodyReady()
  else document.addEventListener('DOMContentLoaded', whenBodyReady, { once: true })
}

/**
 * Follow the dev server's hot updates. The runtime may be pre-bundled (no hot
 * context of its own), so each generated entry hands over its `import.meta.hot`.
 */
export function hmr(hot: HotContext | undefined) {
  if (!hot || hmrBound) return
  hmrBound = true
  hot.on('vite:afterUpdate', () => {
    post({ type: 'updated' })
    scheduleSnapshot()
  })
  hot.on('vite:error', (payload) => {
    const err = (payload as { err?: { message?: string } }).err
    recordError(err?.message ?? 'Build error')
  })
}

class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  override componentDidCatch(error: Error) {
    recordError(error.message)
  }

  override render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div
        style={{
          boxSizing: 'border-box',
          minHeight: '100vh',
          padding: 24,
          background: '#fce8e6',
          color: '#7a1a12',
          font: '13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace',
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 8 }}>This screen crashed while rendering</div>
        <div style={{ whiteSpace: 'pre-wrap' }}>{error.message}</div>
        {error.stack ? (
          <pre style={{ marginTop: 12, whiteSpace: 'pre-wrap', opacity: 0.75, fontSize: 12 }}>{error.stack}</pre>
        ) : null}
      </div>
    )
  }
}

/** Render a screen component with the props canvas.json gave it. */
export function mount(Screen: ComponentType<Record<string, unknown>>) {
  boot()
  let host = document.getElementById('root')
  if (!host) {
    host = document.createElement('div')
    host.id = 'root'
    document.body.appendChild(host)
  }
  createRoot(host).render(
    <Boundary>
      <Screen {...config.props} />
    </Boundary>,
  )
}
