/** Contracts shared by the server, the static build and the viewer. */

export type Theme = 'light' | 'dark'

export interface Issue {
  severity: 'error' | 'warning'
  /** Path relative to the project root. */
  file: string
  message: string
  /** Where in the file, such as `pages[0].sections[1].items[2].src`. */
  at?: string
}

export interface ProjectInfo {
  name: string
  root: string
  /** True in a static build: no live reload, no snapshots, hash routing. */
  static: boolean
  version: string
  system: SystemSummary | null
  canvases: CanvasSummary[]
  issues: Issue[]
  /** URL of the project icon (`.design/system/icon.*`), or null. */
  icon?: string | null
}

export interface SystemSummary {
  name: string
  description?: string
  tokens: number
  components: number
  guidelines: number
  issues: number
}

export interface CanvasSummary {
  id: string
  title: string
  description?: string
  pages: number
  screens: number
  updatedAt: number
  issues: number
  /** A snapshot of the first screen, for the canvas card. */
  cover?: string
}

export interface FrameSize {
  width: number
  /** `auto` grows the frame to the screen's content. */
  height: number | 'auto'
  device?: string
}

interface ItemBase {
  id: string
  title: string
  description?: string
  /** Screens and url items: the app URL patterns they stand for (`/databases/:id`). */
  routes?: string[]
  /** Free-layout position on the page, in canvas pixels. */
  x?: number
  y?: number
}

export interface ScreenItem extends ItemBase {
  kind: 'screen'
  /** Source path relative to the canvas folder, as written in canvas.json. */
  src: string
  /** Source path relative to the project root. */
  file: string
  format: 'module' | 'html'
  /** Frame URL without the theme parameter. */
  url: string
  frame: FrameSize
  theme?: Theme
  missing?: boolean
  /** Changes when anything that needs a reload changes: props, theme, stylesheet. */
  rev: string
  snapshots?: Partial<Record<Theme, string>>
  /** The snapshots shrunk to a few hundred pixels wide, for the zoomed-out canvas. */
  thumbs?: Partial<Record<Theme, string>>
  /** Last content height the screen reported, for `auto` frames before they load. */
  measuredHeight?: number
}

export interface UrlItem extends ItemBase {
  kind: 'url'
  url: string
  frame: FrameSize
}

export interface NoteItem extends ItemBase {
  kind: 'note'
  /** Markdown. */
  text: string
  width: number
  tone: 'note' | 'plain'
}

export interface ImageItem extends ItemBase {
  kind: 'image'
  url: string
  width?: number
  missing?: boolean
}

export type CanvasItem = ScreenItem | UrlItem | NoteItem | ImageItem

export interface CanvasSection {
  id: string
  title?: string
  description?: string
  /** Wrap the row after this many items. */
  columns?: number
  items: CanvasItem[]
}

export interface CanvasPage {
  id: string
  title: string
  description?: string
  layout: 'sections' | 'free'
  sections: CanvasSection[]
}

export interface CanvasDoc {
  id: string
  title: string
  description?: string
  theme?: Theme
  /** canvas.json `cover`: the screen whose snapshot pictures the canvas, or an image's URL. */
  cover?: { screen: string } | { url: string }
  pages: CanvasPage[]
  issues: Issue[]
  updatedAt: number
}

export type TokenKind =
  | 'color'
  | 'font'
  | 'text'
  | 'weight'
  | 'leading'
  | 'tracking'
  | 'spacing'
  | 'radius'
  | 'shadow'
  | 'blur'
  | 'ease'
  | 'animation'
  | 'duration'
  | 'breakpoint'
  | 'other'

export interface TokenValue {
  /** As written. */
  raw: string
  /** With `var()` references substituted. */
  value: string
}

export interface Token {
  /** The variable screens use, such as `--ink` or `--color-brand`. */
  name: string
  kind: TokenKind
  group: string
  description?: string
  light?: TokenValue
  dark?: TokenValue
  /** Tailwind theme key, such as `ink` for `--color-ink` (bg-ink, text-ink). */
  utility?: string
  /** Line height paired with a text size (`--text-sm--line-height`). */
  lineHeight?: string
}

export interface ComponentDoc {
  id: string
  title: string
  group: string
  description?: string
  status?: string
  /** Specimen path relative to the project root. */
  specimen: string
  /** Component source paths relative to the project root. */
  sources: string[]
  url: string
}

export interface GuidelineDoc {
  slug: string
  title: string
  order: number
  markdown: string
}

export interface AssetDoc {
  name: string
  /** Path relative to the system folder. */
  path: string
  url: string
  size: number
  kind: 'image' | 'font' | 'other'
}

export interface SystemDoc {
  name: string
  description?: string
  /** Stylesheet URLs (web fonts) the screens load. */
  fonts: string[]
  tokens: Token[]
  components: ComponentDoc[]
  guidelines: GuidelineDoc[]
  assets: AssetDoc[]
  /** Frame URL of the built-in typography specimen. */
  typographyUrl: string | null
  issues: Issue[]
}

/** What the server pushes over /api/events. */
export type DesignEvent =
  | { type: 'project' }
  | { type: 'canvas'; id: string }
  | { type: 'system' }
  | { type: 'snapshot'; canvas: string; id: string; theme: Theme; url: string; height?: number }

/** Top, right, bottom, left. */
export type Box = [top: number, right: number, bottom: number, left: number]

/** An element in an inspected frame; `ref` names it in messages back to the frame. */
export interface Crumb {
  ref: number
  label: string
}

export interface ColorValue {
  /** Readable: hex when the color is sRGB. */
  value: string
  /** As computed, for painting a swatch. */
  css: string
  token?: string
}

/** What the inspector reports about the element picked in a frame. */
export interface ElementInfo {
  ref: number
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
  /** The CSS worth copying, as a block. */
  css: string
}

/**
 * Messages between the viewer and the runtime inside each frame. Frames may
 * sit on another origin than the viewer, so everything goes through postMessage.
 */
export type RuntimeMessage =
  | { source: 'design-runtime'; key: string; type: 'ready' }
  | { source: 'design-runtime'; key: string; type: 'size'; width: number; height: number }
  | { source: 'design-runtime'; key: string; type: 'error'; message: string }
  | { source: 'design-runtime'; key: string; type: 'go'; target: string }
  /**
   * A link or form in the screen would have taken the frame to another page, which the frame's
   * origin does not serve; the runtime kept the frame put. `path` is set for its own origin.
   */
  | {
      source: 'design-runtime'
      key: string
      type: 'link'
      href: string
      path: string | null
      form: boolean
      /** The `href` as written (0.4.3+), resolved by the viewer against the screen's route. */
      raw?: string
      /** Sent by the screen's own `history.pushState`, not a click: the screen already moved. */
      pushed?: boolean
    }
  | {
      source: 'design-runtime'
      key: string
      type: 'wheel'
      deltaX: number
      deltaY: number
      x: number
      y: number
      /** Pinch or ctrl/⌘-wheel: zoom the canvas; otherwise pan it. */
      zoom: boolean
    }
  | { source: 'design-runtime'; key: string; type: 'keydown'; code: string }
  /** ⌘/Ctrl pressed or released in the frame, or a key pressed while one is down. */
  | { source: 'design-runtime'; key: string; type: 'key'; name: string; down: boolean }
  | { source: 'design-runtime'; key: string; type: 'blur' }
  | { source: 'design-runtime'; key: string; type: 'updated' }
  /** The picked element changed, or its styles did; null when nothing is picked. */
  | { source: 'design-runtime'; key: string; type: 'inspect'; info: ElementInfo | null }
  /** Escape while inspecting with nothing picked. */
  | { source: 'design-runtime'; key: string; type: 'inspect-escape' }

export type ViewerMessage =
  | { source: 'design-viewer'; type: 'theme'; theme: Theme }
  /** The frame is on the canvas: pan and zoom with the wheel go to the viewer. */
  | { source: 'design-viewer'; type: 'canvas' }
  /** Inspect mode on or off; `tokens` let the frame name the tokens behind computed styles. */
  | { source: 'design-viewer'; type: 'inspect'; on: boolean; tokens?: Token[] }
  /** Pick an element by the `ref` a previous report gave it, or clear the pick without reporting. */
  | { source: 'design-viewer'; type: 'inspect-select'; ref: number | null }

/** design.json `public` as a frame sees it. */
export interface PublicFolder {
  /** Where the folder's files are, relative to the frame's URL. */
  base: string
  /** Its files, relative to the folder, with forward slashes. */
  files: string[]
}
