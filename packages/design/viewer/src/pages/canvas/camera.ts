/** Screen = world × z + (x, y). */
export interface Camera {
  x: number
  y: number
  z: number
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** The farthest out the camera goes; past it a page is specks, and every one of them still costs. */
export const MIN_ZOOM = 0.1
export const MAX_ZOOM = 8

const clampZoom = (z: number, min = MIN_ZOOM) => Math.min(MAX_ZOOM, Math.max(min, z))

type Listener = (camera: Camera) => void

/** The canvas camera. Lives outside React so panning never re-renders the tree. */
export class CameraStore {
  camera: Camera = { x: 0, y: 0, z: 1 }
  /** How far out the camera may go; the viewport sets it from the size of the page. */
  minZoom = MIN_ZOOM
  private listeners = new Set<Listener>()
  private animation = 0

  subscribe(listener: Listener) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  set(next: Camera) {
    this.camera = { x: next.x, y: next.y, z: clampZoom(next.z, this.minZoom) }
    for (const listener of this.listeners) listener(this.camera)
  }

  /** Stop any animation: the user took over. */
  interrupt() {
    cancelAnimationFrame(this.animation)
    this.animation = 0
  }

  panBy(dx: number, dy: number) {
    this.interrupt()
    const { x, y, z } = this.camera
    this.set({ x: x + dx, y: y + dy, z })
  }

  /** Zoom by `factor` keeping the screen point (sx, sy) in place. */
  zoomAt(sx: number, sy: number, factor: number) {
    this.interrupt()
    const { x, y, z } = this.camera
    const next = clampZoom(z * factor, this.minZoom)
    const wx = (sx - x) / z
    const wy = (sy - y) / z
    this.set({ x: sx - wx * next, y: sy - wy * next, z: next })
  }

  animateTo(target: Camera, duration = 320) {
    this.interrupt()
    const from = { ...this.camera }
    const to = { ...target, z: clampZoom(target.z, this.minZoom) }
    if (duration <= 0 || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.set(to)
      return
    }
    const start = performance.now()
    // Interpolate zoom geometrically so the motion feels even at every scale.
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const e = 1 - (1 - t) ** 3
      const z = from.z * (to.z / from.z) ** e
      // Keep the world point under the viewport moving in a straight line.
      const k = from.z === to.z ? e : (z - from.z) / (to.z - from.z)
      this.set({ x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k, z })
      if (t < 1) this.animation = requestAnimationFrame(step)
      else this.animation = 0
    }
    this.animation = requestAnimationFrame(step)
  }

  toWorld(sx: number, sy: number) {
    const { x, y, z } = this.camera
    return { x: (sx - x) / z, y: (sy - y) / z }
  }
}

/** A camera saved in the session under `key`, or null. */
export function loadCamera(key: string): Camera | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) ?? 'null')
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y) && Number.isFinite(saved.z)) return saved
  } catch {}
  return null
}

/**
 * The camera that shows `rect` inside a viewport of `w`×`h` with `pad` screen pixels around it.
 * When `rect` does not fit even at `minZoom`, it lines up with the top (and the left, if it is too wide).
 */
export function fitRect(rect: Rect, w: number, h: number, pad = 72, maxZoom = 1, minZoom = MIN_ZOOM): Camera {
  const fit = Math.min((w - pad * 2) / Math.max(rect.w, 1), (h - pad * 2) / Math.max(rect.h, 1), maxZoom)
  const z = clampZoom(fit, minZoom)
  const place = (start: number, size: number, room: number) =>
    size * z <= room - pad * 2 ? room / 2 - (start + size / 2) * z : pad - start * z
  return { z, x: place(rect.x, rect.w, w), y: place(rect.y, rect.h, h) }
}

/** Grid spacing on screen stays between these, stepping by 4× as the zoom changes. */
const GRID_MIN = 14
const GRID_MAX = 96

/**
 * Keeps a `.canvas-grid` layer in step with a camera. The dot grid is a layer of its own: panning
 * only moves it, zooming repaints it.
 */
export function gridMover(grid: HTMLElement) {
  let gridSize = 0
  return (c: Camera) => {
    let size = 24 * c.z
    while (size < GRID_MIN) size *= 4
    while (size > GRID_MAX) size /= 4
    if (size !== gridSize) {
      gridSize = size
      grid.style.backgroundSize = `${size}px ${size}px`
    }
    const shift = (v: number) => ((((v + GRID_MAX) % size) + size) % size) - size
    grid.style.transform = `translate3d(${shift(c.x)}px, ${shift(c.y)}px, 0)`
  }
}

export function intersects(a: Rect, b: Rect) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}
