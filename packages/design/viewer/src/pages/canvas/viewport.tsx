import type { ImageItem, NoteItem, ScreenItem, Theme, UrlItem } from '@shared/types'
import { type RefObject, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { cn } from '../../lib/cn'
import { useStore } from '../../lib/store'
import { type Camera, type CameraStore, fitRect, intersects, MIN_ZOOM, type Rect } from './camera'
import { type FrameEvents, FrameItem, ImageView, NoteView, SectionHeader } from './items'
import { isFrame, type Layout, type Placed } from './layout'
import { Overlay } from './overlay'
import type { ViewStore } from './view-state'

/** Frames rendered live at once; the rest show snapshots. */
const MAX_LIVE = 12
/** Live frames kept mounted (asleep) after they scroll away, so coming back does not reload them. */
const MAX_KEEP = 20
/** A frame narrower than this on screen stays a snapshot. */
const MIN_LIVE_PX = 110
/** Below this zoom every frame is a snapshot: too small to use, and each live one costs. */
const MIN_LIVE_ZOOM = 0.2
/** Up to this width on screen, in device pixels, a frame shows the small snapshot (320px wide, see core/png.ts). */
const THUMB_MAX_PX = 400
/** A page that does not fit at this zoom opens at its top instead of all at once. */
const OPEN_FIT_MIN = 0.2
/** Frames loading at once: the rest wait their turn, nearest the middle of the screen first. */
const MAX_LOADING = 3
/** A frame that has not reported ready by then stops holding a loading slot. */
const LOAD_TIMEOUT = 8000
/** Grid spacing on screen stays between these, stepping by 4× as the zoom changes. */
const GRID_MIN = 14
const GRID_MAX = 96

/** How a frame runs: live, mounted but asleep behind its snapshot, or not mounted. */
export type FrameMode = 'live' | 'asleep' | 'off'

export interface ViewportApi {
  /** The first view of a page: all of it, or its top when it is too big to see at once. */
  openView(): void
  fitAll(animate?: boolean): void
  fitItem(id: string, animate?: boolean): void
  zoomBy(factor: number): void
  zoomTo(z: number): void
  size(): { w: number; h: number }
}

interface ViewportProps {
  layout: Layout
  theme: Theme
  store: ViewStore
  camera: CameraStore
  events: FrameEvents
  capture: boolean
  apiRef: RefObject<ViewportApi | null>
  onPlay(id: string): void
  onSelect(id: string | null, point?: { x: number; y: number }): void
}

interface Drag {
  id: string | null
  startX: number
  startY: number
  lastX: number
  lastY: number
  moved: boolean
}

export function Viewport({ layout, theme, store, camera, events, capture, apiRef, onPlay, onSelect }: ViewportProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const worldRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<View | null>(null)
  const panning = useStore(store, (state) => state.panning)
  const selected = useStore(store, (state) => state.selected)
  const active = useStore(store, (state) => state.active)
  const frames = useMemo(() => layout.items.filter((placed) => isFrame(placed.item)), [layout])

  // Camera → DOM, without React.
  useLayoutEffect(() => {
    const root = rootRef.current!
    const world = worldRef.current!
    const grid = gridRef.current!
    let settle: ReturnType<typeof setTimeout> | undefined
    let viewTimer: ReturnType<typeof setTimeout> | undefined
    let moving = false
    let gridSize = 0
    const publishView = () => setView({ ...camera.camera, w: root.clientWidth, h: root.clientHeight, moving })
    const apply = (c: Camera) => {
      world.style.transform = `translate3d(${c.x}px, ${c.y}px, 0) scale(${c.z})`
      if (!moving) {
        moving = true
        world.classList.add('moving')
      }
      clearTimeout(settle)
      settle = setTimeout(() => {
        moving = false
        world.classList.remove('moving')
        // Frames held back while the camera moved may load now.
        publishView()
      }, 160)
      const overlay = overlayRef.current
      if (overlay) {
        overlay.style.setProperty('--tx', String(c.x))
        overlay.style.setProperty('--ty', String(c.y))
        overlay.style.setProperty('--z', String(c.z))
      }
      // The dot grid is a layer of its own: panning only moves it, zooming repaints it.
      let size = 24 * c.z
      while (size < GRID_MIN) size *= 4
      while (size > GRID_MAX) size /= 4
      if (size !== gridSize) {
        gridSize = size
        grid.style.backgroundSize = `${size}px ${size}px`
      }
      const shift = (v: number) => ((((v + GRID_MAX) % size) + size) % size) - size
      grid.style.transform = `translate3d(${shift(c.x)}px, ${shift(c.y)}px, 0)`
      const tiny = c.z < 0.09
      if (store.get().zoomTiny !== tiny) store.set((state) => ({ ...state, zoomTiny: tiny }))
      // Far out, section titles are a few pixels tall and run into the frame labels.
      world.classList.toggle('far', c.z < 0.15)
      viewTimer ??= setTimeout(() => {
        viewTimer = undefined
        publishView()
      }, 90)
    }
    apply(camera.camera)
    publishView()
    const off = camera.subscribe(apply)
    // A panel opening on the left moves the viewport's edge: shift the camera so screens stay put.
    let left = root.getBoundingClientRect().left
    const resize = new ResizeObserver(() => {
      const next = root.getBoundingClientRect().left
      if (next !== left) {
        const c = camera.camera
        camera.set({ ...c, x: c.x - (next - left) })
        left = next
      }
      publishView()
    })
    resize.observe(root)
    return () => {
      off()
      resize.disconnect()
      clearTimeout(settle)
      clearTimeout(viewTimer)
    }
  }, [camera, store])

  // Zooming out stops at half of what shows the whole page: past that there is nothing more to see.
  useEffect(() => {
    const root = rootRef.current!
    const update = () => {
      const { w, h } = { w: root.clientWidth, h: root.clientHeight }
      const bounds = layout.bounds
      const fit = bounds.w && w ? Math.min((w - 160) / bounds.w, (h - 160) / Math.max(bounds.h, 1)) : 1
      // Capture shoots the whole page at once, however small that makes it.
      camera.minZoom = capture ? 0.01 : Math.min(0.25, Math.max(MIN_ZOOM, fit * 0.5))
    }
    update()
    const resize = new ResizeObserver(update)
    resize.observe(root)
    return () => resize.disconnect()
  }, [camera, layout.bounds, capture])

  // Imperative controls for the page: fit, zoom, focus.
  useEffect(() => {
    const root = rootRef.current!
    const size = () => ({ w: root.clientWidth, h: root.clientHeight })
    apiRef.current = {
      size,
      openView() {
        const { w, h } = size()
        const bounds = layout.bounds
        if (!bounds.w) return
        const fit = Math.min((w - 160) / bounds.w, (h - 160) / Math.max(bounds.h, 1))
        if (fit >= OPEN_FIT_MIN) return this.fitAll(false)
        // Too big to take in: start at the top left, sized to the first section's width.
        const first = layout.sections[0] ?? bounds
        const z = Math.min(0.5, Math.max(0.25, (w - 160) / Math.max(first.w, 1)))
        camera.set({ z, x: 80 - bounds.x * z, y: 80 - bounds.y * z })
      },
      fitAll(animate = true) {
        const { w, h } = size()
        if (!layout.bounds.w) return
        const target = fitRect(layout.bounds, w, h, 80, 1, camera.minZoom)
        if (animate) camera.animateTo(target)
        else camera.set(target)
      },
      fitItem(id, animate = true) {
        const placed = layout.items.find((p) => p.item.id === id)
        if (!placed) return
        const { w, h } = size()
        const target = fitRect(placed, w, h, 64, 1, camera.minZoom)
        if (animate) camera.animateTo(target)
        else camera.set(target)
      },
      zoomBy(factor) {
        const { w, h } = size()
        const c = camera.camera
        const z = c.z * factor
        const wx = (w / 2 - c.x) / c.z
        const wy = (h / 2 - c.y) / c.z
        camera.animateTo({ z, x: w / 2 - wx * z, y: h / 2 - wy * z }, 180)
      },
      zoomTo(z) {
        const { w, h } = size()
        const c = camera.camera
        const wx = (w / 2 - c.x) / c.z
        const wy = (h / 2 - c.y) / c.z
        camera.animateTo({ z, x: w / 2 - wx * z, y: h / 2 - wy * z }, 220)
      },
    }
  }, [apiRef, camera, layout])

  // Which frames run. Those in view (up to MAX_LIVE, the largest share of the screen first) are
  // live; frames seen recently stay mounted but asleep behind their snapshot, so coming back
  // does not reload them. New frames load a few at a time, and only once the camera rests:
  // a fling across the page loads nothing on the way.
  const keep = useRef<string[]>([])
  const mountedAt = useRef(new Map<string, number>())
  const [recheck, setRecheck] = useState(0)
  const ready = useStore(store, (state) => readyKey(state.frames))
  const modes = useMemo(() => {
    void recheck
    const modes = new Map<string, FrameMode>()
    if (capture) {
      for (const placed of frames) modes.set(placed.item.id, 'live')
      return modes
    }
    if (!view) return modes
    const { x, y, z, w, h } = view
    const screen: Rect = { x: -x / z, y: -y / z, w: w / z, h: h / z }
    const margin: Rect = {
      x: screen.x - screen.w * 0.25,
      y: screen.y - screen.h * 0.25,
      w: screen.w * 1.5,
      h: screen.h * 1.5,
    }
    const cx = screen.x + screen.w / 2
    const cy = screen.y + screen.h / 2
    const overlap = (p: Placed) => {
      const ox = Math.max(0, Math.min(p.x + p.w, screen.x + screen.w) - Math.max(p.x, screen.x))
      const oy = Math.max(0, Math.min(p.y + p.h, screen.y + screen.h) - Math.max(p.y, screen.y))
      return ox * oy
    }
    const distance = (p: Placed) => Math.hypot(p.x + p.w / 2 - cx, p.y + p.h / 2 - cy)
    const visible = frames
      .filter((p) => z >= MIN_LIVE_ZOOM && intersects(p, margin) && p.w * z >= MIN_LIVE_PX)
      .sort((a, b) => overlap(b) - overlap(a) || distance(a) - distance(b))
      .slice(0, MAX_LIVE)
      .map((p) => p.item.id)
    const pinned = [active, selected].filter((id): id is string => !!id)
    const ids = new Set(frames.map((p) => p.item.id))
    const readyIds = new Set(ready.split('\n'))
    const mounted = new Set(keep.current)
    const now = performance.now()
    const loading = (id: string) => !readyIds.has(id) && now - (mountedAt.current.get(id) ?? 0) < LOAD_TIMEOUT
    let slots = MAX_LOADING - [...mounted].filter(loading).length
    const live: string[] = []
    for (const id of new Set([...pinned, ...visible])) {
      if (!ids.has(id)) continue
      if (mounted.has(id)) live.push(id)
      else if (pinned.includes(id) || (!view.moving && slots > 0)) {
        live.push(id)
        mountedAt.current.set(id, now)
        slots--
      }
    }
    const next = [...new Set([...live, ...keep.current])].filter((id) => ids.has(id)).slice(0, MAX_KEEP)
    keep.current = next
    for (const id of mountedAt.current.keys()) if (!next.includes(id)) mountedAt.current.delete(id)
    for (const id of next) modes.set(id, live.includes(id) ? 'live' : 'asleep')
    return modes
  }, [view, frames, active, selected, capture, ready, recheck])

  // A frame that never reports ready gives up its loading slot after a while.
  // biome-ignore lint/correctness/useExhaustiveDependencies: modes changes when frames start loading
  useEffect(() => {
    const now = performance.now()
    const readyIds = new Set(ready.split('\n'))
    const waits = [...mountedAt.current]
      .filter(([id]) => !readyIds.has(id))
      .map(([, at]) => at + LOAD_TIMEOUT - now)
      .filter((wait) => wait > 0)
    if (!waits.length) return
    const timer = setTimeout(() => setRecheck((n) => n + 1), Math.min(...waits) + 20)
    return () => clearTimeout(timer)
  }, [modes, ready])

  // Pointer: drag pans, click selects (and lets the frame take the pointer), two fingers pinch.
  const drag = useRef<Drag | null>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ dist: number; midX: number; midY: number } | null>(null)
  const space = useRef(false)

  const setPanning = (value: boolean) => {
    if (store.get().panning !== value) store.set((state) => ({ ...state, panning: value }))
  }

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTyping(e.target)) {
        space.current = true
        rootRef.current?.classList.add('cursor-grab')
        e.preventDefault()
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        space.current = false
        rootRef.current?.classList.remove('cursor-grab')
      }
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  const idAt = (target: EventTarget | null): string | null => {
    const el = target as HTMLElement | null
    return (
      (el?.closest('[data-shield]') as HTMLElement | null)?.dataset.shield ??
      (el?.closest('[data-label]') as HTMLElement | null)?.dataset.label ??
      (el?.closest('[data-item]') as HTMLElement | null)?.dataset.item ??
      null
    )
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('[data-ui]')) return
    if (e.button !== 0 && e.button !== 1) return
    const root = rootRef.current!
    root.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    camera.interrupt()
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }]
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), midX: (a.x + b.x) / 2, midY: (a.y + b.y) / 2 }
      drag.current = null
      setPanning(true)
      return
    }
    const forcePan = e.button === 1 || space.current
    drag.current = {
      id: forcePan ? null : idAt(e.target),
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      moved: forcePan,
    }
    if (forcePan) setPanning(true)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }]
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      const midX = (a.x + b.x) / 2
      const midY = (a.y + b.y) / 2
      const rect = rootRef.current!.getBoundingClientRect()
      camera.panBy(midX - pinch.current.midX, midY - pinch.current.midY)
      camera.zoomAt(midX - rect.left, midY - rect.top, dist / Math.max(pinch.current.dist, 1))
      pinch.current = { dist, midX, midY }
      return
    }
    const d = drag.current
    if (!d) {
      if (!store.get().panning) {
        const id = idAt(e.target)
        if (store.get().hovered !== id) store.set((state) => ({ ...state, hovered: id }))
      }
      return
    }
    if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 3) {
      d.moved = true
      setPanning(true)
    }
    if (d.moved) camera.panBy(e.clientX - d.lastX, e.clientY - d.lastY)
    d.lastX = e.clientX
    d.lastY = e.clientY
  }

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinch.current = null
    const d = drag.current
    drag.current = null
    if (d && !d.moved) onSelect(d.id, { x: e.clientX, y: e.clientY })
    if (!pointers.current.size) setPanning(false)
  }

  // Wheel: pan, or zoom with ⌘/ctrl and trackpad pinch.
  useEffect(() => {
    const root = rootRef.current!
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest('[data-ui]')) return
      e.preventDefault()
      const rect = root.getBoundingClientRect()
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? rect.height : 1
      if (e.ctrlKey || e.metaKey) {
        const dy = e.deltaY * unit
        const speed = Math.abs(dy) < 40 ? 0.012 : 0.0025
        camera.zoomAt(e.clientX - rect.left, e.clientY - rect.top, Math.exp(-dy * speed))
      } else {
        camera.panBy(-e.deltaX * unit, -e.deltaY * unit)
      }
    }
    root.addEventListener('wheel', onWheel, { passive: false })
    return () => root.removeEventListener('wheel', onWheel)
  }, [camera])

  const pages = layout.sections

  return (
    <div
      ref={rootRef}
      className={cn(
        'canvas-root relative h-full w-full touch-none overflow-hidden select-none',
        panning && 'canvas-panning cursor-grabbing',
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => store.get().hovered && store.set((state) => ({ ...state, hovered: null }))}
      onDoubleClick={(e) => {
        const id = idAt(e.target)
        const placed = id ? layout.items.find((p) => p.item.id === id) : undefined
        if (placed && isFrame(placed.item)) onPlay(placed.item.id)
      }}
    >
      <div ref={gridRef} className="canvas-grid" />
      <div ref={worldRef} className="canvas-world">
        {pages.map((placed) => (
          <SectionHeader
            key={`section:${placed.section.id}`}
            section={placed.section}
            x={placed.x}
            y={placed.y}
            w={placed.w}
            store={store}
          />
        ))}
        {layout.items.map((placed) => {
          const { item } = placed
          if (item.kind === 'screen' || item.kind === 'url')
            return (
              <FrameItem
                key={item.id}
                placed={placed as Placed & { item: ScreenItem | UrlItem }}
                mode={modes.get(item.id) ?? 'off'}
                thumb={!capture && !!view && placed.w * view.z * devicePixelRatio <= THUMB_MAX_PX}
                theme={theme}
                store={store}
                events={events}
                capture={capture}
              />
            )
          if (item.kind === 'note')
            return <NoteView key={item.id} placed={placed as Placed & { item: NoteItem }} store={store} />
          return <ImageView key={item.id} placed={placed as Placed & { item: ImageItem }} store={store} />
        })}
      </div>
      <Overlay layout={layout} view={view} store={store} overlayRef={overlayRef} />
    </div>
  )
}

interface View extends Camera {
  w: number
  h: number
  /** The camera moved in the last moments; new frames wait until it rests. */
  moving: boolean
}

/** The ids of frames that reported ready, as one string so the viewport re-renders only when it changes. */
function readyKey(frames: Record<string, { ready: boolean }>): string {
  return Object.keys(frames)
    .filter((id) => frames[id]!.ready)
    .sort()
    .join('\n')
}

export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return !!el && (el.isContentEditable || /^(input|textarea|select)$/i.test(el.tagName))
}
