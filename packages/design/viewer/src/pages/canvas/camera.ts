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

export const MIN_ZOOM = 0.02
export const MAX_ZOOM = 8

const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))

type Listener = (camera: Camera) => void

/** The canvas camera. Lives outside React so panning never re-renders the tree. */
export class CameraStore {
  camera: Camera = { x: 0, y: 0, z: 1 }
  private listeners = new Set<Listener>()
  private animation = 0

  subscribe(listener: Listener) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  set(next: Camera) {
    this.camera = { x: next.x, y: next.y, z: clampZoom(next.z) }
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
    const next = clampZoom(z * factor)
    const wx = (sx - x) / z
    const wy = (sy - y) / z
    this.set({ x: sx - wx * next, y: sy - wy * next, z: next })
  }

  animateTo(target: Camera, duration = 320) {
    this.interrupt()
    const from = { ...this.camera }
    const to = { ...target, z: clampZoom(target.z) }
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

/** The camera that shows `rect` inside a viewport of `w`×`h` with `pad` screen pixels around it. */
export function fitRect(rect: Rect, w: number, h: number, pad = 72, maxZoom = 1): Camera {
  const z = clampZoom(Math.min((w - pad * 2) / Math.max(rect.w, 1), (h - pad * 2) / Math.max(rect.h, 1), maxZoom))
  return { z, x: w / 2 - (rect.x + rect.w / 2) * z, y: h / 2 - (rect.y + rect.h / 2) * z }
}

export function intersects(a: Rect, b: Rect) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}
