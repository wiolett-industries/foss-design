/**
 * Runs inside every frame. Screens may import it as `@design/runtime`:
 *
 *   import { holdReady, useTheme, useScreen } from '@design/runtime'
 */
// First: every frame's own storage, before any module that reads it (storage.ts).
import './storage'
import { Component, type ComponentType, type ReactNode, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import type { PublicFolder, ViewerMessage } from '../shared/types'
import { FrameInspector } from './inspect'
import { servePublicFolder } from './public'

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
  /** design.json `public`: root paths such as `/logo.png` load from there. */
  public?: PublicFolder
}

export interface HotContext {
  on(event: string, cb: (payload: unknown) => void): void
}

declare global {
  interface Window {
    __DESIGN__?: FrameConfig
    __DESIGN_READY__?: boolean
    /** Holds from `holdReady()` not released yet; `design check` names them when a frame never gets ready. */
    __DESIGN_HOLDS__?: number
    __DESIGN_ERRORS__?: string[]
  }
}

const config: FrameConfig = window.__DESIGN__ ?? { key: '', canvas: '', id: '', props: {} }
const embedded = window.parent !== window
const query = new URLSearchParams(window.location.search)
const capture = query.has('capture')
/** The frame's own URL: a screen may move the address to the app's, and a reload must still find the screen. */
const frameUrl = location.pathname + location.search + location.hash
// Before any screen code runs: the screen's first render may already point at `/logo.png`.
servePublicFolder(config.public)

let theme: Theme = config.theme ?? (query.get('theme') === 'dark' ? 'dark' : 'light')
const themeListeners = new Set<() => void>()

/**
 * A frame's `prefers-color-scheme` is the system's, whatever theme the viewer shows it in, so a
 * screen whose dark mode is a media query (Tailwind's default `dark:`, `@media (prefers-color-scheme:
 * dark)` in the app's tokens, `matchMedia` in a theme provider) would ignore the viewer's switch. In
 * a frame the viewer's theme stands in for the system's: those queries answer by it.
 */
const SCHEME = /\(\s*prefers-color-scheme\s*:\s*(dark|light)\s*\)/gi
const hasScheme = (text: string) => /prefers-color-scheme/i.test(text)
const themed = (text: string) =>
  text.replace(SCHEME, (_, wanted: string) =>
    wanted.toLowerCase() === theme ? '(min-width: 0px)' : '(max-width: 0px)',
  )

/** Media lists as the stylesheet wrote them, before they were made to answer by the theme. */
const writtenMedia = new WeakMap<MediaList, string>()

function themeMediaList(media: MediaList) {
  const written = writtenMedia.get(media) ?? media.mediaText
  if (!hasScheme(written)) return
  writtenMedia.set(media, written)
  const next = themed(written)
  if (media.mediaText !== next) media.mediaText = next
}

function themeRules(rules: CSSRuleList) {
  for (const rule of Array.from(rules)) {
    if (rule instanceof CSSMediaRule) themeMediaList(rule.media)
    const inner = (rule as CSSGroupingRule).cssRules
    if (inner?.length) themeRules(inner)
  }
}

/** Every stylesheet's colour-scheme queries, answered by the theme. */
function themeStylesheets() {
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      themeMediaList(sheet.media)
      themeRules(sheet.cssRules)
    } catch {}
  }
}

const nativeMatchMedia = window.matchMedia.bind(window)
const schemeQueries = new Set<ThemeQuery>()

/** `matchMedia` for a colour-scheme query: matches by the theme, and changes with it. */
class ThemeQuery extends EventTarget {
  onchange: ((this: MediaQueryList, event: MediaQueryListEvent) => unknown) | null = null
  private last: boolean
  constructor(readonly media: string) {
    super()
    this.last = this.matches
    schemeQueries.add(this)
  }
  get matches() {
    return nativeMatchMedia(themed(this.media)).matches
  }
  addListener(listener: ((event: MediaQueryListEvent) => void) | null) {
    if (listener) this.addEventListener('change', listener as EventListener)
  }
  removeListener(listener: ((event: MediaQueryListEvent) => void) | null) {
    if (listener) this.removeEventListener('change', listener as EventListener)
  }
  update() {
    const matches = this.matches
    if (matches === this.last) return
    this.last = matches
    const event = new MediaQueryListEvent('change', { matches, media: this.media })
    this.onchange?.call(this as unknown as MediaQueryList, event)
    this.dispatchEvent(event)
  }
}

window.matchMedia = (query: string) =>
  hasScheme(query) ? (new ThemeQuery(query) as unknown as MediaQueryList) : nativeMatchMedia(query)

function applyTheme(next: Theme) {
  theme = next
  const root = document.documentElement
  // Every form the style guide reads as dark (system.ts), so the app's own one switches too.
  root.dataset.theme = next
  root.dataset.mode = next
  root.dataset.colorScheme = next
  root.classList.toggle('dark', next === 'dark')
  root.classList.toggle('theme-dark', next === 'dark')
  root.style.colorScheme = next
  themeStylesheets()
  for (const query of schemeQueries) query.update()
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
 * Removed in 0.5: screens move like the app does, through links. Give the target screen a
 * `route` in canvas.json and link to it (`<a href="/verify">`, or `history.pushState` in code).
 * Kept only to fail with that advice instead of a missing export.
 */
export function go(target: string): never {
  const message = `go("${target}") is no longer supported: link to the screen instead (<a href="/…">, or history.pushState in code) and give it a "route" in canvas.json`
  recordError(message)
  throw new Error(message)
}

/** Where this screen sits and the props canvas.json gave it. */
export function useScreen(): { canvas: string; id: string; props: Record<string, unknown> } {
  return { canvas: config.canvas, id: config.id, props: config.props }
}

const px = (value: string) => Number.parseFloat(value) || 0

/**
 * Boxes whose height follows what holds them rather than what is in them: `#root` at
 * `height: 100%`, a `min-h-screen` shell, a `flex-1` column in one. Their bottom is the frame's
 * whatever they hold, so the frame would keep the height it started with; the content inside
 * them is measured instead. Worked out once per box and its classes and style.
 */
const follows = new WeakMap<Element, { key: string; value: boolean }>()
const styleKey = (el: Element) => `${el.getAttribute('class') ?? ''}|${el.getAttribute('style') ?? ''}`
/** The following boxes of the last measure: their children are watched for size, as they keep theirs. */
let stretched: Element[] = []

function measured(el: Element): boolean {
  if (el instanceof HTMLScriptElement || el instanceof HTMLStyleElement || el instanceof HTMLLinkElement) return false
  const style = getComputedStyle(el)
  return style.display !== 'none' && style.display !== 'contents' && style.position !== 'fixed'
}

const VIEWPORT_UNIT = /\d(?:[dsl]?vh|vb)\b/

/** Whether a rule this frame can read gives `el` a height in viewport units (`h-screen`, `100dvh`). */
function viewportHeight(el: Element): boolean {
  if (el instanceof HTMLElement && VIEWPORT_UNIT.test(`${el.style.height} ${el.style.minHeight}`)) return true
  const walk = (rules: CSSRuleList): boolean => {
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSStyleRule) {
        const s = rule.style
        if (VIEWPORT_UNIT.test(`${s.height} ${s.minHeight} ${s.blockSize} ${s.minBlockSize}`)) {
          try {
            if (el.matches(rule.selectorText)) return true
          } catch {}
        }
      }
      const inner = (rule as CSSGroupingRule).cssRules
      if (inner?.length && walk(inner)) return true
    }
    return false
  }
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList
    try {
      rules = sheet.cssRules
    } catch {
      continue
    }
    if (walk(rules)) return true
  }
  return false
}

const GROWN = ['transition', 'height', 'min-height', 'max-height'] as const

/**
 * Makes `boxes` `height` px tall for a moment and gives back the undo, which puts their style back
 * with transitions still off, so nothing animates between the two.
 */
function grow(boxes: HTMLElement[], height: number): () => void {
  const saved = boxes.map((el) => ({
    had: el.hasAttribute('style'),
    values: GROWN.map((name) => [el.style.getPropertyValue(name), el.style.getPropertyPriority(name)] as const),
  }))
  for (const el of boxes) {
    el.style.setProperty('transition', 'none', 'important')
    el.style.setProperty('height', `${height}px`, 'important')
    el.style.setProperty('min-height', `${height}px`, 'important')
    el.style.setProperty('max-height', 'none', 'important')
  }
  const put = (el: HTMLElement, index: number, at: number) => {
    const [value, priority] = saved[index]!.values[at]!
    if (value) el.style.setProperty(GROWN[at]!, value, priority)
    else el.style.removeProperty(GROWN[at]!)
  }
  return () => {
    boxes.forEach((el, index) => {
      for (let at = 1; at < GROWN.length; at++) put(el, index, at)
    })
    void document.documentElement.offsetHeight
    boxes.forEach((el, index) => {
      put(el, index, 0)
      if (!saved[index]!.had && el.getAttribute('style') === '') el.removeAttribute('style')
    })
  }
}

/**
 * Which of `boxes`, each as tall as the room `holders` give it, follow that room: they grow when
 * the holders are made taller for a moment, or take their height from the viewport.
 */
function decide(holders: HTMLElement[], boxes: Element[]) {
  const open = boxes.filter((el) => follows.get(el)?.key !== styleKey(el))
  if (!open.length) return
  const keys = open.map(styleKey)
  const before = open.map((el) => el.getBoundingClientRect().height)
  const tallest = Math.max(window.innerHeight, ...holders.map((el) => el.getBoundingClientRect().height))
  const undo = grow(holders, tallest + 997)
  const after = open.map((el) => el.getBoundingClientRect().height)
  undo()
  open.forEach((el, index) => {
    const grew = after[index]! - before[index]! > 1
    const value = grew || Math.abs(px(getComputedStyle(el).minHeight) - window.innerHeight) < 1 || viewportHeight(el)
    follows.set(el, { key: keys[index]!, value })
  })
}

/** Children of `el` as tall as `room`: the ones that may follow it. */
const filling = (el: Element, room: number) =>
  Array.from(el.children).filter(
    (child) => measured(child) && Math.abs(child.getBoundingClientRect().height - room) < 1,
  )

/**
 * Where the content of `el` ends, in page coordinates: its bottom margin edge, or, for a box that
 * follows the `room` it fills, where it would end holding just its content (the content's own
 * height plus padding and border, wherever the content sits inside it).
 */
function contentBottom(el: Element, room: number, depth: number): number {
  const style = getComputedStyle(el)
  const rect = el.getBoundingClientRect()
  const margin = px(style.marginBottom)
  const top = rect.top + window.scrollY
  const stretch = depth < 8 && Math.abs(rect.height - room) < 1 && follows.get(el)?.value === true
  if (!stretch || !(el instanceof HTMLElement)) return top + rect.height + margin
  stretched.push(el)
  const edgeTop = px(style.borderTopWidth) + px(style.paddingTop)
  const edgeBottom = px(style.borderBottomWidth) + px(style.paddingBottom)
  const space = rect.height - edgeTop - edgeBottom
  decide([el], filling(el, space))
  const contentTop = top + edgeTop
  let first = Number.POSITIVE_INFINITY
  let last = Number.NEGATIVE_INFINITY
  for (const node of Array.from(el.childNodes)) {
    let from: number
    let to: number
    if (node instanceof Element) {
      if (!measured(node)) continue
      from = node.getBoundingClientRect().top + window.scrollY - px(getComputedStyle(node).marginTop)
      to = contentBottom(node, space, depth + 1)
    } else if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
      const range = document.createRange()
      range.selectNode(node)
      const box = range.getBoundingClientRect()
      from = box.top + window.scrollY
      to = box.bottom + window.scrollY
    } else continue
    first = Math.min(first, from)
    last = Math.max(last, to)
  }
  // Content placed lower (centered, at the end) gives the room above it back; a margin that
  // collapses out of the box does not count twice.
  const content = Number.isFinite(first) ? last - Math.max(first, contentTop) : 0
  return contentTop + Math.max(0, content) + edgeBottom + margin
}

function contentHeight(): number {
  const body = document.body
  if (!body) return 0
  const bodyStyle = getComputedStyle(body)
  stretched = []
  decide([document.documentElement, body], filling(body, window.innerHeight))
  let bottom = 0
  for (const child of Array.from(body.children)) {
    if (!measured(child)) continue
    bottom = Math.max(bottom, contentBottom(child, window.innerHeight, 0))
  }
  const extra = px(bodyStyle.paddingBottom) + px(bodyStyle.marginBottom)
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
  const resize = new ResizeObserver(() => queue())
  // A following box keeps its size while what is in it grows: its children are watched as well.
  const observed = new Set<Element>()
  const observe = () => {
    const want = new Set<Element>([document.documentElement, document.body, ...Array.from(document.body.children)])
    for (const box of stretched) for (const child of Array.from(box.children)) want.add(child)
    for (const el of observed)
      if (!want.has(el)) {
        resize.unobserve(el)
        observed.delete(el)
      }
    for (const el of want)
      if (!observed.has(el)) {
        resize.observe(el)
        observed.add(el)
      }
  }
  const queue = () => {
    if (queued) return
    queued = true
    requestAnimationFrame(() => {
      queued = false
      reportSize()
      observe()
    })
  }
  observe()
  new MutationObserver(() => {
    observe()
    queue()
  }).observe(document.body, { childList: true })
  window.addEventListener('load', queue)
  queue()
}

/**
 * Someone clicked or typed in the frame (a person, or a test driving Chrome): what it shows now
 * is their state, not the screen's, so no snapshot is taken until the frame loads again. Events
 * a screen dispatches itself (user-event opening a dialog on load) are not trusted and do not count.
 */
let touched = false
let inspecting = false

/** The page painted; the frame is ready once every `holdReady()` is released too. */
let loaded = false
let signalled = false
let holds = 0

let snapshotTimer: ReturnType<typeof setTimeout> | undefined
function scheduleSnapshot() {
  // Theme switches and hot updates ask too; a frame not ready yet would snapshot its loading state.
  if (!config.snapshots || !embedded || capture || touched || !signalled) return
  clearTimeout(snapshotTimer)
  snapshotTimer = setTimeout(() => {
    const run = () => void takeSnapshot()
    if ('requestIdleCallback' in window) window.requestIdleCallback(run, { timeout: 4000 })
    else run()
  }, 1800)
}

async function takeSnapshot() {
  if (touched) return
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
    if (!blob || touched) return
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

/**
 * A screen's links and forms would take the frame to another page, and the frame's origin
 * serves screens only: the viewer would show an error page in the screen's place. Once the
 * screen's own handlers had their say (a router that handled the click prevents the default),
 * the frame stays put and the viewer hears where the link pointed, and opens the screen whose
 * `route` matches. Links within the page (`#section`) still scroll. A router in the screen moves
 * with `history.pushState`; the viewer hears those too and opens another screen when one has
 * that route, and otherwise the screen's router carries on.
 */
function keepLinksInFrame() {
  const report = (target: URL, form: boolean, raw: string, pushed = false) =>
    post({
      type: 'link',
      href: target.href,
      path: target.origin === location.origin ? target.pathname + target.search + target.hash : null,
      form,
      raw,
      pushed,
    })
  const onClick = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button > 1) return
    const link = (event.target as Element | null)?.closest?.('a[href], area[href]') as HTMLAnchorElement | null
    if (!link || link.hasAttribute('download')) return
    const target = new URL(link.href, location.href)
    if (target.protocol !== 'http:' && target.protocol !== 'https:') return
    const samePage =
      target.origin === location.origin && target.pathname === location.pathname && target.search === location.search
    if (samePage && target.hash) return
    event.preventDefault()
    report(target, false, link.getAttribute('href') ?? '')
  }
  window.addEventListener('click', onClick)
  window.addEventListener('auxclick', onClick)
  window.addEventListener('submit', (event) => {
    const form = event.target as HTMLFormElement
    // method="dialog" only closes its dialog.
    if (event.defaultPrevented || form.method === 'dialog') return
    event.preventDefault()
    const action = form.getAttribute('action') ?? ''
    report(new URL(action || location.href, location.href), true, action)
  })
  // Where the Navigation API exists it also catches what no listener sees, such as
  // `location.href = "/verify"`: a document navigation away from the screen.
  const navigation = (window as { navigation?: EventTarget }).navigation
  navigation?.addEventListener('navigate', (event) => {
    const nav = event as Event & {
      destination: { url: string; sameDocument: boolean }
      cancelable: boolean
      downloadRequest: string | null
      navigationType: string
    }
    // Same-document moves (pushState, #hash) are the screen's own; reloads come from the viewer.
    if (!nav.cancelable || nav.destination.sameDocument || nav.downloadRequest !== null) return
    if (nav.navigationType === 'reload') return
    const target = new URL(nav.destination.url)
    if (target.pathname === location.pathname && target.search === location.search) return
    event.preventDefault()
    report(
      target,
      false,
      target.origin === location.origin ? target.pathname + target.search + target.hash : target.href,
    )
  })
  for (const name of ['pushState', 'replaceState'] as const) {
    const original = history[name].bind(history)
    history[name] = (data: unknown, unused: string, url?: string | URL | null) => {
      original(data, unused, url)
      // Until the frame is ready the screen is setting itself up (its router opening the route,
      // redirects, steps opening a dialog): those moves stay in the frame.
      if (url === undefined || url === null || !signalled) return
      const raw = String(url)
      report(new URL(raw, location.href), false, raw, true)
    }
  }
}

/** Ready once the page painted and every hold is released: the viewer shows the frame, checks look at it, and it snapshots. */
function signalReady() {
  if (signalled || !loaded || holds > 0) return
  signalled = true
  window.__DESIGN_READY__ = true
  post({ type: 'ready' })
  scheduleSnapshot()
}

/**
 * Keep the frame from counting as ready until the returned function is called: for screens
 * that load for a while (a whole app on fixtures) or set up their state after loading (open a
 * dialog). Call it while the screen loads, at the top of its module or in its first render.
 * `design check --render` waits for the release and reports a hold never released.
 */
export function holdReady(): () => void {
  holds++
  window.__DESIGN_HOLDS__ = holds
  let released = false
  return () => {
    if (released) return
    released = true
    holds--
    window.__DESIGN_HOLDS__ = holds
    // Let the state the screen just set paint first.
    requestAnimationFrame(() => requestAnimationFrame(signalReady))
  }
}

let booted = false
let hmrBound = false
/** Set when the frame sits on the canvas: only then does the wheel belong to the viewer. */
let canvasHost = false
/** Set when the viewer asked where the pointer is (a full-window screen's corner controls). */
let pointerHost = false

/** Wire the frame to the viewer. `mount` calls it; HTML screens get it injected. */
export function boot() {
  if (booted) return
  booted = true
  applyTheme(theme)
  // Stylesheets that come later (a lazy chunk's, a hot update's) answer by the theme too.
  let restyle = 0
  new MutationObserver(() => {
    cancelAnimationFrame(restyle)
    themeStylesheets()
    restyle = requestAnimationFrame(themeStylesheets)
  }).observe(document.head, { childList: true, subtree: true, characterData: true })
  document.addEventListener(
    'load',
    (event) => {
      if (event.target instanceof HTMLLinkElement) themeStylesheets()
    },
    true,
  )
  // In the viewer a frame's edges do not rubber-band; `:where` leaves the screen's own CSS in charge.
  if (embedded) {
    const style = document.createElement('style')
    style.textContent = ':where(html, body) { overscroll-behavior: none; }'
    document.head.prepend(style)
  }

  let inspector: FrameInspector | null = null
  window.addEventListener('message', (event: MessageEvent) => {
    const data = event.data as ViewerMessage | null
    if (data?.source !== 'design-viewer' || event.source !== window.parent) return
    if (data.type === 'canvas') canvasHost = true
    else if (data.type === 'pointer') pointerHost = true
    else if (data.type === 'theme' && data.theme && !config.theme) {
      applyTheme(data.theme)
      scheduleSnapshot()
    } else if (data.type === 'inspect') {
      inspector ??= new FrameInspector(post)
      if (data.tokens) inspector.setTokens(data.tokens)
      inspecting = !!data.on
      if (data.on) inspector.enable()
      else inspector.disable()
    } else if (data.type === 'inspect-select') inspector?.select(data.ref)
  })

  window.addEventListener(
    'wheel',
    (event) => {
      if (!embedded) return
      const zoom = event.ctrlKey || event.metaKey
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1
      if (!canvasHost) {
        // Elsewhere (a system specimen in a scrolling page) a wheel with nothing left to scroll in
        // here goes on to the page around the frame, which the frame's own edges no longer pass to.
        if (!zoom && !canScroll(event.target, event.deltaX, event.deltaY))
          post({
            type: 'wheel',
            deltaX: event.deltaX * unit,
            deltaY: event.deltaY * unit,
            x: event.clientX,
            y: event.clientY,
            zoom,
          })
        return
      }
      // Pinch always zooms the canvas; a plain wheel pans it unless something under the pointer scrolls.
      if (!zoom && canScroll(event.target, event.deltaX, event.deltaY)) return
      event.preventDefault()
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
  // Moves go out at most once a frame; presses and leaving right away.
  let moved: { x: number; y: number } | null = null
  const pointer = (x: number, y: number, down: boolean) => {
    if (!pointerHost || !embedded) return
    if (down || x < 0) {
      post({ type: 'pointer', x, y, down })
      return
    }
    if (!moved)
      requestAnimationFrame(() => {
        if (moved) post({ type: 'pointer', x: moved.x, y: moved.y, down: false })
        moved = null
      })
    moved = { x, y }
  }
  window.addEventListener('pointermove', (event) => pointer(event.clientX, event.clientY, false), {
    capture: true,
    passive: true,
  })
  window.addEventListener('pointerdown', (event) => pointer(event.clientX, event.clientY, true), true)
  document.addEventListener('pointerout', (event) => {
    if (!event.relatedTarget) {
      moved = null
      pointer(-1, -1, false)
    }
  })
  // Holding ⌘/Ctrl inspects in the viewer, which cannot see keys pressed in here.
  const isModifier = (name: string) => name === 'Meta' || name === 'Control'
  const touch = (event: Event) => {
    if (!event.isTrusted || inspecting) return
    touched = true
    clearTimeout(snapshotTimer)
  }
  window.addEventListener('pointerdown', touch, true)
  window.addEventListener(
    'keydown',
    (event) => {
      if (!isModifier(event.key) && event.key !== 'Shift' && event.key !== 'Alt') touch(event)
    },
    true,
  )
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
  if (embedded) keepLinksInFrame()
  window.addEventListener('blur', () => post({ type: 'blur' }))
  window.addEventListener('error', (event) => recordError(event.message || 'Script error'))
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason as { message?: string } | undefined
    recordError(String(reason?.message ?? reason ?? 'Unhandled rejection'))
  })

  const ready = () => {
    loaded = true
    signalReady()
  }
  const whenBodyReady = () => {
    if (embedded) watchSize()
    // The page's other module scripts (a screen's whole app) run before `load`, so a hold one of
    // them takes while it starts still counts.
    const loaded =
      document.readyState === 'complete'
        ? Promise.resolve()
        : new Promise<void>((resolve) => window.addEventListener('load', () => resolve(), { once: true }))
    void loaded.then(() => document.fonts?.ready).then(() => requestAnimationFrame(() => requestAnimationFrame(ready)))
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
  hot.on('vite:beforeFullReload', () => {
    History.prototype.replaceState.call(history, history.state, '', frameUrl)
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
