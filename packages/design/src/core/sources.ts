import type { Theme } from '../shared/types'

/** A frame the server renders: a canvas screen, a system specimen or a built-in page. */
export interface ScreenSource {
  /** `canvas/id`, unique across the project. */
  key: string
  canvas: string
  id: string
  title: string
  /** Absolute source path; empty for built-ins. */
  file: string
  format: 'module' | 'html'
  props: Record<string, unknown>
  /** Inject the design system stylesheet. */
  system: boolean
  theme?: Theme
  /** The frame grows to the content height. */
  autoHeight?: boolean
  builtin?: 'typography'
}

/** How frames and files are addressed: by the dev server, or inside a static build. */
export interface UrlScheme {
  screen(canvas: string, id: string): string
  html(relToDesign: string, canvas: string, id: string): string
  file(relToDesign: string): string
}

const encodePath = (rel: string) => rel.split('/').map(encodeURIComponent).join('/')

export const DEV_URLS: UrlScheme = {
  screen: (canvas, id) => `/_s/${encodeURIComponent(canvas)}/${encodeURIComponent(id)}`,
  html: (rel, canvas, id) => `/_fs/${encodePath(rel)}?__design=${encodeURIComponent(`${canvas}/${id}`)}`,
  file: (rel) => `/_fs/${encodePath(rel)}`,
}

/** Relative to the site root, so a build works under any path. */
export const STATIC_URLS: UrlScheme = {
  screen: (canvas, id) => `_s/${encodeURIComponent(canvas)}/${encodeURIComponent(id)}/`,
  html: (_rel, canvas, id) => `_s/${encodeURIComponent(canvas)}/${encodeURIComponent(id)}/`,
  file: (rel) => `_f/${encodePath(rel)}`,
}

export interface SnapshotInfo {
  urls: Partial<Record<Theme, string>>
  /** Small versions of the same snapshots, for frames seen from far away. */
  thumbs?: Partial<Record<Theme, string>>
  height?: number
}

export type SnapshotLookup = (canvas: string, id: string) => SnapshotInfo | null
