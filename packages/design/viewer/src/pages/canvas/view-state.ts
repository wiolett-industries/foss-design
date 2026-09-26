import { Store } from '../../lib/store'
import type { Sizes } from './layout'

export interface FrameStatus {
  ready: boolean
  errors: string[]
}

export interface ViewState {
  selected: string | null
  /** The frame that receives the pointer; the others sit behind a shield. */
  active: string | null
  hovered: string | null
  sizes: Sizes
  frames: Record<string, FrameStatus>
  /** Frames kept alive, most recently wanted first. */
  live: string[]
  panning: boolean
  zoomTiny: boolean
  /** Mounted iframes by item id, for the inspector. */
  frameEls: Record<string, HTMLIFrameElement | null>
  /** Inspect mode: screens take the pointer so the inspector can see it. */
  inspecting: boolean
}

export function createViewState() {
  return new Store<ViewState>({
    selected: null,
    active: null,
    hovered: null,
    sizes: {},
    frames: {},
    live: [],
    panning: false,
    zoomTiny: false,
    frameEls: {},
    inspecting: false,
  })
}

export type ViewStore = ReturnType<typeof createViewState>

export function setSize(store: ViewStore, key: string, size: { w?: number; h: number }) {
  store.set((state) => {
    const prev = state.sizes[key]
    if (prev && Math.abs(prev.h - size.h) < 1 && prev.w === size.w) return state
    return { ...state, sizes: { ...state.sizes, [key]: size } }
  })
}

export function setFrame(store: ViewStore, id: string, patch: Partial<FrameStatus>) {
  store.set((state) => {
    const prev = state.frames[id] ?? { ready: false, errors: [] }
    return { ...state, frames: { ...state.frames, [id]: { ...prev, ...patch } } }
  })
}

export function setFrameEl(store: ViewStore, id: string, el: HTMLIFrameElement | null) {
  store.set((state) => (state.frameEls[id] === el ? state : { ...state, frameEls: { ...state.frameEls, [id]: el } }))
}
