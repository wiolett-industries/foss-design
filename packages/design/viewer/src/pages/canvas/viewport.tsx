import type { ImageItem, NoteItem, ScreenItem, Theme, UrlItem } from '@shared/types'
import { type RefObject, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { cn } from '../../lib/cn'
import { useStore } from '../../lib/store'
import { type Camera, type CameraStore, fitRect, intersects, type Rect } from './camera'
import { type FrameEvents, FrameItem, ImageView, NoteView, SectionHeader } from './items'
import { isFrame, type Layout, type Placed } from './layout'
import { Overlay } from './overlay'
import type { ViewStore } from './view-state'

/** Frames rendered live at once; the rest show snapshots. */
const MAX_LIVE = 12
/** Live frames kept mounted after they scroll away, so coming back does not reload them. */
const MAX_KEEP = 20
/** A frame narrower than this on screen stays a snapshot. */
const MIN_LIVE_PX = 110

export interface ViewportApi {
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
  const overlayRef = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<(Camera & { w: number; h: number }) | null>(null)
  const panning = useStore(store, (state) => state.panning)
  const selected = useStore(store, (state) => state.selected)
  const active = useStore(store, (state) => state.active)
  const frames = useMemo(() => layout.items.filter((placed) => isFrame(placed.item)), [layout])

  // Camera → DOM, without React.
  useLayoutEffect(() => {
    const root = rootRef.current!
    const world = worldRef.current!
    let settle: ReturnType<typeof setTimeout> | undefined
    let viewTimer: ReturnType<typeof setTimeout> | undefined
    const publishView = () => setView({ ...camera.camera, w: root.clientWidth, h: root.clientHeight })
    const apply = (c: Camera) => {
      world.style.transform = `translate3d(${c.x}px, ${c.y}px, 0) scale(${c.z})`
      world.classList.add('moving')
      clearTimeout(settle)
      settle = setTimeout(() => world.classList.remove('moving'), 160)
      const overlay = overlayRef.current
      if (overlay) {
        overlay.style.setProperty('--tx', String(c.x))
        overlay.style.setProperty('--ty', String(c.y))
        overlay.style.setProperty('--z', String(c.z))
      }
      let grid = 24 * c.z
      while (grid < 14) grid *= 4
      while (grid > 96) grid /= 4
      root.style.backgroundSize = `${grid}px ${grid}px`
      root.style.backgroundPosition = `${c.x}px ${c.y}px`
      const tiny = c.z < 0.09
      if (store.get().zoomTiny !== tiny) store.set((state) => ({ ...state, zoomTiny: tiny }))
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

  // Imperative controls for the page: fit, zoom, focus.
  useEffect(() => {
    const root = rootRef.current!
    const size = () => ({ w: root.clientWidth, h: root.clientHeight })
    apiRef.current = {
      size,
      fitAll(animate = true) {
        const { w, h } = size()
        if (!layout.bounds.w) return
        const target = fitRect(layout.bounds, w, h, 80, 1)
        if (animate) camera.animateTo(target)
        else camera.set(target)
      },
      fitItem(id, animate = true) {
        const placed = layout.items.find((p) => p.item.id === id)
        if (!placed) return
        const { w, h } = size()
        const target = fitRect(placed, w, h, 64, 1)
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

  // Which frames run live.
  const keep = useRef<string[]>([])
  const live = useMemo(() => {
    if (capture) return new Set(frames.map((placed) => placed.item.id))
    if (!view) return new Set<string>()
    const { x, y, z, w, h } = view
    const screen: Rect = { x: -x / z, y: -y / z, w: w / z, h: h / z }
    const margin: Rect = {
      x: screen.x - screen.w * 0.25,
      y: screen.y - screen.h * 0.25,
      w: screen.w * 1.5,
      h: screen.h * 1.5,
    }
    const overlap = (p: Placed) => {
      const ox = Math.max(0, Math.min(p.x + p.w, screen.x + screen.w) - Math.max(p.x, screen.x))
      const oy = Math.max(0, Math.min(p.y + p.h, screen.y + screen.h) - Math.max(p.y, screen.y))
      return ox * oy
    }
    const visible = frames
      .filter((p) => intersects(p, margin) && p.w * z >= MIN_LIVE_PX)
      .sort((a, b) => overlap(b) - overlap(a))
      .slice(0, MAX_LIVE)
      .map((p) => p.item.id)
    const pinned = [active, selected].filter((id): id is string => !!id)
    const ids = new Set(frames.map((p) => p.item.id))
    const next = [...new Set([...pinned, ...visible, ...keep.current])].filter((id) => ids.has(id)).slice(0, MAX_KEEP)
    keep.current = next
    return new Set(next)
  }, [view, frames, active, selected, capture])

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
        'canvas-dots relative h-full w-full touch-none overflow-hidden select-none',
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
                live={live.has(item.id)}
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
      <Overlay layout={layout} store={store} overlayRef={overlayRef} />
    </div>
  )
}

export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return !!el && (el.isContentEditable || /^(input|textarea|select)$/i.test(el.tagName))
}
