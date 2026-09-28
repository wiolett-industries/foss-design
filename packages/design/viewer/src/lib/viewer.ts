import { createContext, type ReactNode, useContext } from 'react'
import type { ViewerSource } from './source'

/** Places where an app that embeds the viewer adds its own controls. */
export interface ViewerSlots {
  /** At the start of every top bar. */
  barStart?: ReactNode
  /**
   * In place of the project wordmark on the home bar and the mark on the canvas bar: a project
   * switcher. Links in it resolve against the viewer's base, so `/` is the project's home.
   */
  brand?: ReactNode
  /**
   * At the end of every top bar. On a phone the bar's own appearance menu gives way to it: offer
   * light and dark in it, as an account menu does.
   */
  barEnd?: ReactNode
  /** Full width under every top bar, above the page: a notice strip. */
  belowBar?: ReactNode
  /** Next to the project title on the home page. */
  homeActions?: ReactNode
  /** Under the project title on the home page, in place of the path and version. */
  homeSub?: ReactNode
  /** At the end of each canvas row on the home page. */
  canvasRowActions?: (canvasId: string) => ReactNode
  /** A strip under the canvas list on the home page: how canvases get there. */
  canvasesFoot?: ReactNode
  /** Under the canvas list on the home page, in its column: archived canvases, say. */
  canvasesAfter?: ReactNode
  /** Below the panels of the home page, full width. */
  homeAfter?: ReactNode
  /**
   * On a screen's full-window page, the corner plate with the way out: `note` is a muted line under it
   * (whose content the screen is), `actions` sit next to the way out, and with `badge` the plate folds
   * into that badge instead of fading out (pages anyone can open).
   */
  fullPlate?: { note?: ReactNode; actions?: ReactNode; badge?: ReactNode }
}

/** Single-canvas mode: only this canvas is reachable, without the design system or other canvases. */
export interface ViewerScope {
  canvas: string
}

/** Query keys of one source, so viewers of different projects can share a QueryClient. */
export function viewerKeys(id: string) {
  return {
    all: ['design', id] as const,
    project: ['design', id, 'project'] as const,
    canvas: (canvas: string) => ['design', id, 'canvas', canvas] as const,
    system: ['design', id, 'system'] as const,
    sources: ['design', id, 'source'] as const,
    source: (unit: string, path: string) => ['design', id, 'source', unit, path] as const,
  }
}

export type ViewerKeys = ReturnType<typeof viewerKeys>

export interface Viewer {
  source: ViewerSource
  keys: ViewerKeys
  frameSandbox?: string
  slots: ViewerSlots
  scope: ViewerScope | null
}

const ids = new WeakMap<ViewerSource, string>()
let lastId = 0

/** A stable id per source object. */
export function sourceId(source: ViewerSource): string {
  let id = ids.get(source)
  if (!id) {
    lastId += 1
    id = String(lastId)
    ids.set(source, id)
  }
  return id
}

export const ViewerContext = createContext<Viewer | null>(null)

export function useViewer(): Viewer {
  const viewer = useContext(ViewerContext)
  if (!viewer) throw new Error('foss-design: this component renders inside <DesignViewer>')
  return viewer
}

/** Whether a route parameter names the canvas `id`, encoded or not. */
export function sameId(param: string, id: string): boolean {
  if (param === id) return true
  try {
    return decodeURIComponent(param) === id
  } catch {
    return false
  }
}
