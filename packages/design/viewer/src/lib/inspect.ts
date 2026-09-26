import type { Token } from '@shared/types'

/**
 * Element inspection inside a frame. Frames are served from the viewer's own
 * origin, so the viewer reads their DOM directly; nothing runs in the screen.
 */

export type Box = [top: number, right: number, bottom: number, left: number]

export interface Crumb {
  el: Element
  label: string
}

export interface ColorValue {
  /** Readable: hex when the color is sRGB. */
  value: string
  /** As computed, for painting a swatch. */
  css: string
  token?: string
}

export interface ElementInfo {
  el: Element
  tag: string
  label: string
  text?: string
  classes: string[]
  attributes: [string, string][]
  component?: { owners: string[]; file?: string }
  rect: { x: number; y: number; w: number; h: number }
  margin: Box
  border: Box
  padding: Box
  layout: [string, string][]
  typography?: {
    family: string
    familyToken?: string
    size: string
    sizeToken?: string
    weight: string
    lineHeight: string
    letterSpacing: string
    color: ColorValue
    align: string
    transform?: string
  }
  appearance: {
    background?: ColorValue
    backgroundImage?: string
    border?: { width: string; style: string; color: ColorValue }
    radius?: { value: string; token?: string }
    shadow?: { value: string; token?: string }
    opacity?: string
  }
  path: Crumb[]
  children: Crumb[]
}

const OVERLAY_TAG = 'design-inspect'

export function isOverlay(el: Element | null): boolean {
  return !!el && el.tagName.toLowerCase() === OVERLAY_TAG
}

function px(value: string): number {
  return Number.parseFloat(value) || 0
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

/** `div.flex.gap-2` — tag with an id or the first classes. */
export function shortLabel(el: Element): string {
  const tag = el.tagName.toLowerCase()
  if (el.id) return `${tag}#${el.id}`
  const classes = classList(el).slice(0, 2)
  return classes.length ? `${tag}.${classes.join('.')}` : tag
}

function classList(el: Element): string[] {
  const value = el.getAttribute('class')
  return value ? value.split(/\s+/).filter(Boolean) : []
}

function toHex(color: string): string {
  const match = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(color)
  if (!match) return color
  const [r, g, b] = [match[1], match[2], match[3]].map((v) => Number(v).toString(16).padStart(2, '0'))
  const alpha = match[4] !== undefined ? Number(match[4]) : 1
  if (alpha === 0) return 'transparent'
  return alpha < 1 ? `#${r}${g}${b} · ${Math.round(alpha * 100)}%` : `#${r}${g}${b}`
}

function isTransparent(color: string): boolean {
  return color === 'transparent' || /^rgba\(\d+,\s*\d+,\s*\d+,\s*0\)$/.test(color)
}

/** Token values as the frame computes them, so a computed style can be traced back to its token. */
export class TokenIndex {
  private maps = new Map<string, Map<string, { name: string; utility?: string }[]>>()

  constructor(doc: Document, tokens: Token[]) {
    const dark = doc.documentElement.dataset.theme === 'dark'
    const probe = doc.createElement('span')
    probe.style.display = 'none'
    ;(doc.body ?? doc.documentElement).appendChild(probe)
    const view = doc.defaultView!
    const add = (kind: string, property: string, raw: string, token: Token) => {
      probe.style.setProperty(property, raw)
      const computed = view.getComputedStyle(probe).getPropertyValue(property)
      probe.style.removeProperty(property)
      if (!computed) return
      const map = this.maps.get(kind) ?? new Map()
      map.set(computed, [...(map.get(computed) ?? []), { name: token.name, utility: token.utility }])
      this.maps.set(kind, map)
    }
    for (const token of tokens) {
      const value = (dark ? (token.dark ?? token.light) : token.light)?.value
      if (!value || value.includes('var(')) continue
      if (token.kind === 'color') add('color', 'color', value, token)
      else if (token.kind === 'radius') add('radius', 'border-top-left-radius', value, token)
      else if (token.kind === 'shadow') add('shadow', 'box-shadow', value, token)
      else if (token.kind === 'font') add('font', 'font-family', value, token)
      else if (token.kind === 'text') add('text', 'font-size', value, token)
    }
    probe.remove()
  }

  /** The token behind a computed value; when several share it, the one whose utility the element uses. */
  find(
    kind: 'color' | 'radius' | 'shadow' | 'font' | 'text',
    computed: string,
    classes: string[] = [],
  ): string | undefined {
    const candidates = this.maps.get(kind)?.get(computed)
    if (!candidates?.length) return undefined
    const used = candidates.find(
      (token) => token.utility && classes.some((name) => name.split(':').at(-1)!.endsWith(`-${token.utility}`)),
    )
    return (used ?? candidates[0])!.name
  }
}

interface Fiber {
  type: unknown
  return: Fiber | null
  _debugOwner?: Fiber | null
  _debugStack?: { stack?: string }
}

const HIDDEN_OWNERS = new Set([
  'Boundary',
  'MotionComponent',
  'MotionDOMComponent',
  'PresenceChild',
  'PopChild',
  'PopChildMeasure',
  'AnimatePresence',
  'LayoutGroup',
])

function fiberOf(el: Element): Fiber | null {
  const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'))
  return key ? ((el as unknown as Record<string, Fiber>)[key] ?? null) : null
}

interface NamedType {
  displayName?: string
  name?: string
  render?: { name?: string }
  type?: unknown
}

function fiberName(fiber: Fiber): string | null {
  const raw = fiber.type
  if (!raw || typeof raw === 'string') return null
  const type = raw as NamedType
  if (typeof raw === 'function') return type.displayName || type.name || null
  if (type.displayName) return type.displayName
  if (type.render) return type.render.name || null
  if (type.type && typeof type.type === 'function') return (type.type as { name?: string }).name || null
  return null
}

/** Components that rendered this element, nearest first, and the file its JSX came from (dev builds). */
function componentOf(el: Element): ElementInfo['component'] {
  const fiber = fiberOf(el)
  if (!fiber) return undefined
  const owners: string[] = []
  let owner = fiber._debugOwner ?? null
  while (owner && owners.length < 5) {
    const name = fiberName(owner)
    if (name && !HIDDEN_OWNERS.has(name) && owners.at(-1) !== name) owners.push(name)
    owner = owner._debugOwner ?? null
  }
  if (!owners.length) {
    for (let node = fiber.return; node && owners.length < 5; node = node.return) {
      const name = fiberName(node)
      if (name && !HIDDEN_OWNERS.has(name) && owners.at(-1) !== name) owners.push(name)
    }
  }
  let file: string | undefined
  const stack = fiber._debugStack?.stack ?? ''
  for (const line of stack.split('\n')) {
    const match = /\/_fs\/([^?:)\s]+\.(?:tsx|jsx|ts|js|mjs|html))/.exec(line)
    if (!match || /node_modules|(^|\/)\.cache\/|@fs\//.test(match[1]!)) continue
    file = `.design/${decodeURIComponent(match[1]!)}`
    break
  }
  return owners.length || file ? { owners, file } : undefined
}

function hasOwnText(el: Element): boolean {
  for (const node of Array.from(el.childNodes)) if (node.nodeType === 3 && node.textContent?.trim()) return true
  return false
}

const LAYOUT_KEYS: [string, string][] = [
  ['display', 'Display'],
  ['position', 'Position'],
  ['flex-direction', 'Direction'],
  ['flex-wrap', 'Wrap'],
  ['justify-content', 'Justify'],
  ['align-items', 'Align'],
  ['gap', 'Gap'],
  ['grid-template-columns', 'Columns'],
  ['grid-template-rows', 'Rows'],
  ['overflow', 'Overflow'],
  ['z-index', 'Z-index'],
]

export function describe(el: Element, tokens: TokenIndex | null): ElementInfo {
  const view = el.ownerDocument.defaultView!
  const style = view.getComputedStyle(el)
  const rect = el.getBoundingClientRect()
  const box = (prefix: string, suffix = ''): Box => [
    round(px(style.getPropertyValue(`${prefix}-top${suffix}`))),
    round(px(style.getPropertyValue(`${prefix}-right${suffix}`))),
    round(px(style.getPropertyValue(`${prefix}-bottom${suffix}`))),
    round(px(style.getPropertyValue(`${prefix}-left${suffix}`))),
  ]
  const classes = classList(el)
  const color = (value: string): ColorValue => ({
    value: toHex(value),
    css: value,
    token: tokens?.find('color', value, classes),
  })

  const display = style.display
  const flex = display.includes('flex')
  const grid = display.includes('grid')
  const layout: [string, string][] = []
  for (const [key, label] of LAYOUT_KEYS) {
    const value = style.getPropertyValue(key)
    if (!value) continue
    if (['flex-direction', 'flex-wrap'].includes(key) && !flex) continue
    if (['justify-content', 'align-items', 'gap'].includes(key) && !flex && !grid) continue
    if (key.startsWith('grid-template') && (!grid || value === 'none')) continue
    if (key === 'position' && value === 'static') continue
    if (key === 'flex-wrap' && value === 'nowrap') continue
    if (key === 'overflow' && value === 'visible') continue
    if (key === 'z-index' && value === 'auto') continue
    if (key === 'justify-content' && value === 'normal') continue
    if (key === 'align-items' && value === 'normal') continue
    if (key === 'gap' && value === 'normal') continue
    layout.push([label, value])
  }

  const text = hasOwnText(el) || ['INPUT', 'TEXTAREA', 'BUTTON', 'SELECT'].includes(el.tagName)
  const borderWidth = px(style.borderTopWidth)
  const radius = style.borderTopLeftRadius
  const shadow = style.boxShadow

  const path: Crumb[] = []
  for (let node = el.parentElement; node && node !== el.ownerDocument.documentElement; node = node.parentElement) {
    if (node.id === 'root' || node === el.ownerDocument.body) break
    path.unshift({ el: node, label: shortLabel(node) })
  }

  return {
    el,
    tag: el.tagName.toLowerCase(),
    label: shortLabel(el),
    text: hasOwnText(el) ? (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 120) : undefined,
    classes: classList(el),
    attributes: ['href', 'src', 'alt', 'type', 'role', 'aria-label', 'placeholder', 'name', 'for']
      .map((name) => [name, el.getAttribute(name)] as [string, string | null])
      .filter((pair): pair is [string, string] => pair[1] !== null && pair[1] !== ''),
    component: componentOf(el),
    rect: {
      x: round(rect.left + view.scrollX),
      y: round(rect.top + view.scrollY),
      w: round(rect.width),
      h: round(rect.height),
    },
    margin: box('margin'),
    border: box('border', '-width'),
    padding: box('padding'),
    layout,
    typography: text
      ? {
          family: style.fontFamily,
          familyToken: tokens?.find('font', style.fontFamily, classes),
          size: style.fontSize,
          sizeToken: tokens?.find('text', style.fontSize, classes),
          weight: style.fontWeight,
          lineHeight: style.lineHeight,
          letterSpacing: style.letterSpacing,
          color: color(style.color),
          align: style.textAlign,
          transform: style.textTransform !== 'none' ? style.textTransform : undefined,
        }
      : undefined,
    appearance: {
      background: isTransparent(style.backgroundColor) ? undefined : color(style.backgroundColor),
      backgroundImage: style.backgroundImage !== 'none' ? style.backgroundImage : undefined,
      border:
        borderWidth > 0 && style.borderTopStyle !== 'none'
          ? { width: style.borderTopWidth, style: style.borderTopStyle, color: color(style.borderTopColor) }
          : undefined,
      radius: px(radius) > 0 ? { value: radius, token: tokens?.find('radius', radius, classes) } : undefined,
      shadow: shadow !== 'none' ? { value: shadow, token: tokens?.find('shadow', shadow, classes) } : undefined,
      opacity: style.opacity !== '1' ? style.opacity : undefined,
    },
    path,
    children: Array.from(el.children)
      .filter((child) => !isOverlay(child) && !['SCRIPT', 'STYLE'].includes(child.tagName))
      .slice(0, 40)
      .map((child) => ({ el: child, label: shortLabel(child) })),
  }
}

/** CSS worth copying for an element, as a block. */
export function cssText(info: ElementInfo): string {
  const style = info.el.ownerDocument.defaultView!.getComputedStyle(info.el)
  const keys = [
    'display',
    'flex-direction',
    'justify-content',
    'align-items',
    'gap',
    'grid-template-columns',
    'width',
    'height',
    'padding',
    'margin',
    'font-family',
    'font-size',
    'font-weight',
    'line-height',
    'letter-spacing',
    'color',
    'background-color',
    'border',
    'border-radius',
    'box-shadow',
    'opacity',
  ]
  const lines = keys
    .map((key) => [key, style.getPropertyValue(key)] as const)
    .filter(
      ([key, value]) =>
        value && !['normal', 'none', '0px', 'auto'].includes(value) && !(key === 'opacity' && value === '1'),
    )
    .map(([key, value]) => `  ${key}: ${value};`)
  return `${info.label} {\n${lines.join('\n')}\n}`
}

const OVERLAY_CSS = `
:host { all: initial; }
.m, .p, .c, .sel, .tag, .stag { position: fixed; pointer-events: none; box-sizing: border-box; display: none; }
.m { border-style: solid; border-color: rgba(246, 178, 107, 0.45); }
.p { border-style: solid; border-color: rgba(147, 196, 125, 0.5); }
.c { background: rgba(111, 168, 220, 0.4); }
.sel { outline: 2px solid #f0a040; outline-offset: -1px; }
.tag, .stag { font: 500 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace; color: #fff; background: #1b1f24;
  padding: 4px 6px; border-radius: 4px; white-space: nowrap; }
.stag { background: #a55700; }
`

/** Hover and selection boxes drawn inside the frame, isolated in a shadow root. */
class Overlay {
  private host: HTMLElement
  private parts: Record<'m' | 'p' | 'c' | 'sel' | 'tag' | 'stag', HTMLElement>

  constructor(private doc: Document) {
    this.host = doc.createElement(OVERLAY_TAG)
    this.host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;display:block'
    const root = this.host.attachShadow({ mode: 'open' })
    root.innerHTML = `<style>${OVERLAY_CSS}</style><div class="m"></div><div class="p"></div><div class="c"></div><div class="sel"></div><div class="tag"></div><div class="stag"></div>`
    const get = (name: string) => root.querySelector(`.${name}`) as HTMLElement
    this.parts = { m: get('m'), p: get('p'), c: get('c'), sel: get('sel'), tag: get('tag'), stag: get('stag') }
    doc.documentElement.appendChild(this.host)
  }

  private place(el: HTMLElement, x: number, y: number, w: number, h: number) {
    el.style.display = 'block'
    el.style.left = `${x}px`
    el.style.top = `${y}px`
    el.style.width = `${Math.max(0, w)}px`
    el.style.height = `${Math.max(0, h)}px`
  }

  private hide(...names: (keyof Overlay['parts'])[]) {
    for (const name of names) this.parts[name].style.display = 'none'
  }

  private label(el: HTMLElement, text: string, rect: DOMRect) {
    el.textContent = text
    el.style.display = 'block'
    const above = rect.top > 24
    el.style.left = `${Math.max(2, rect.left)}px`
    el.style.top = `${above ? rect.top - 22 : rect.bottom + 4}px`
  }

  hover(target: Element | null) {
    if (!target) return this.hide('m', 'p', 'c', 'tag')
    const view = this.doc.defaultView!
    const style = view.getComputedStyle(target)
    const r = target.getBoundingClientRect()
    const [mt, mr, mb, ml] = ['Top', 'Right', 'Bottom', 'Left'].map((side) =>
      px(style.getPropertyValue(`margin-${side.toLowerCase()}`)),
    )
    const [bt, br, bb, bl] = ['top', 'right', 'bottom', 'left'].map((side) =>
      px(style.getPropertyValue(`border-${side}-width`)),
    )
    const [pt, pr, pb, pl] = ['top', 'right', 'bottom', 'left'].map((side) =>
      px(style.getPropertyValue(`padding-${side}`)),
    )
    this.place(this.parts.m, r.left - ml!, r.top - mt!, r.width + ml! + mr!, r.height + mt! + mb!)
    this.parts.m.style.borderWidth = `${mt}px ${mr}px ${mb}px ${ml}px`
    this.place(this.parts.p, r.left + bl!, r.top + bt!, r.width - bl! - br!, r.height - bt! - bb!)
    this.parts.p.style.borderWidth = `${pt}px ${pr}px ${pb}px ${pl}px`
    this.place(
      this.parts.c,
      r.left + bl! + pl!,
      r.top + bt! + pt!,
      r.width - bl! - br! - pl! - pr!,
      r.height - bt! - bb! - pt! - pb!,
    )
    this.label(this.parts.tag, `${shortLabel(target)}  ${round(r.width)} × ${round(r.height)}`, r)
  }

  select(target: Element | null) {
    if (!target) return this.hide('sel', 'stag')
    const r = target.getBoundingClientRect()
    this.place(this.parts.sel, r.left, r.top, r.width, r.height)
    this.label(this.parts.stag, `${round(r.width)} × ${round(r.height)}`, r)
  }

  destroy() {
    this.host.remove()
  }
}

export interface InspectorHandle {
  /** Outline `el` in this frame; `notify: false` changes only the outline. */
  select(el: Element | null, notify?: boolean): void
  detach(): void
}

/**
 * Take over pointer input in a frame: hovering highlights, clicking selects
 * (the screen does not see the click), Escape clears the selection.
 */
export function attachInspector(
  frame: HTMLIFrameElement,
  handlers: { onSelect(el: Element | null): void; onEscape(): void },
): InspectorHandle | null {
  let doc: Document | null = null
  try {
    doc = frame.contentDocument
  } catch {
    return null
  }
  if (!doc?.documentElement) return null
  const overlay = new Overlay(doc)
  let hovered: Element | null = null
  let selected: Element | null = null
  let frameId = 0

  const valid = (el: EventTarget | null): Element | null => {
    const node = el as Element | null
    if (node?.nodeType !== 1 || isOverlay(node)) return null
    if (node === doc!.documentElement || node === doc!.body) return null
    return node
  }

  const tick = () => {
    if (selected && !selected.isConnected) {
      selected = null
      handlers.onSelect(null)
    }
    overlay.hover(hovered && hovered !== selected ? hovered : null)
    overlay.select(selected)
    frameId = frame.contentWindow!.requestAnimationFrame(tick)
  }
  frameId = frame.contentWindow!.requestAnimationFrame(tick)

  const setSelected = (el: Element | null, notify = true) => {
    selected = el
    if (notify) handlers.onSelect(el)
  }

  const onMove = (event: Event) => {
    hovered = valid((event as PointerEvent).target)
  }
  const onLeave = (event: Event) => {
    if (!(event as MouseEvent).relatedTarget) hovered = null
  }
  const swallow = (event: Event) => {
    event.preventDefault()
    event.stopImmediatePropagation()
  }
  const onClick = (event: Event) => {
    swallow(event)
    setSelected(valid(event.target))
  }
  // macOS turns Ctrl+click into a context menu, with no click: treat it as one.
  const onContextMenu = (event: Event) => {
    swallow(event)
    if ((event as MouseEvent).ctrlKey) setSelected(valid(event.target))
  }
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return
    event.stopImmediatePropagation()
    if (selected) setSelected(null)
    else handlers.onEscape()
  }

  const opts = { capture: true }
  doc.addEventListener('pointermove', onMove, opts)
  doc.addEventListener('mouseout', onLeave, opts)
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'dblclick', 'submit'])
    doc.addEventListener(type, swallow, opts)
  doc.addEventListener('click', onClick, opts)
  doc.addEventListener('contextmenu', onContextMenu, opts)
  doc.addEventListener('keydown', onKey, opts)
  doc.documentElement.style.setProperty('cursor', 'crosshair', 'important')

  return {
    select: setSelected,
    detach() {
      frame.contentWindow?.cancelAnimationFrame(frameId)
      doc!.removeEventListener('pointermove', onMove, opts)
      doc!.removeEventListener('mouseout', onLeave, opts)
      for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'dblclick', 'submit'])
        doc!.removeEventListener(type, swallow, opts)
      doc!.removeEventListener('click', onClick, opts)
      doc!.removeEventListener('contextmenu', onContextMenu, opts)
      doc!.removeEventListener('keydown', onKey, opts)
      doc!.documentElement.style.removeProperty('cursor')
      overlay.destroy()
    },
  }
}
