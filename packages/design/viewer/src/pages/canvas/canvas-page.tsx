import * as Popover from '@radix-ui/react-popover'
import type { CanvasDoc, CanvasItem, CanvasPage as Page, Theme } from '@shared/types'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'wouter'
import { InspectorPanel, useInspection, useModifierHold } from '../../components/inspector'
import { IssueList } from '../../components/issues'
import { SlidePanel } from '../../components/slide-panel'
import { useCanvas } from '../../lib/api'
import { takeFocus } from '../../lib/focus'
import { followLink } from '../../lib/frames'
import { useStore } from '../../lib/store'
import { useTheme } from '../../lib/theme'
import { IconButton } from '../../ui/button'
import { Icon } from '../../ui/icon'
import { keepOpenForFrames, Menu, MenuItem, MenuSeparator } from '../../ui/menu'
import { Notice } from '../../ui/page'
import { NotFound } from '../not-found'
import { CameraStore } from './camera'
import { CanvasBar, SelectionBar } from './canvas-bar'
import type { FrameEvents } from './items'
import { frameOrder, isFrame, layoutPage } from './layout'
import { pageHref, Sidebar } from './sidebar'
import { createViewState } from './view-state'
import { isTyping, Viewport, type ViewportApi } from './viewport'

const query = new URLSearchParams(window.location.search)
const CAPTURE = query.has('capture')

const cameraKey = (canvas: string, page: string) => `foss-design.camera.${canvas}.${page}`

function loadCamera(key: string) {
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) ?? 'null')
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y) && Number.isFinite(saved.z)) return saved
  } catch {}
  return null
}

/** Screens theme: follows the app until the user picks one for the screens. */
function useScreenTheme(canvas: CanvasDoc | undefined): [Theme, (theme: Theme) => void] {
  const appTheme = useTheme()
  const forced = query.get('theme')
  const [picked, setPicked] = useState<Theme | null>(forced === 'dark' || forced === 'light' ? forced : null)
  return [picked ?? canvas?.theme ?? appTheme, setPicked]
}

export function CanvasPage({ canvasId, pageId }: { canvasId: string; pageId?: string }) {
  const { data: canvas, error, isLoading } = useCanvas(canvasId)
  if (error) return <NotFound title="Canvas not found" text={(error as Error).message} />
  if (isLoading || !canvas) return <div className="canvas-dots grow" />
  const wanted = pageId ?? query.get('page') ?? undefined
  const page = canvas.pages.find((p) => p.id === wanted) ?? canvas.pages[0]
  return <CanvasView key={`${canvas.id}/${page?.id ?? ''}`} canvas={canvas} page={page} />
}

function CanvasView({ canvas, page }: { canvas: CanvasDoc; page: Page | undefined }) {
  const [, navigate] = useLocation()
  const store = useMemo(() => createViewState(), [])
  const camera = useMemo(() => new CameraStore(), [])
  const apiRef = useRef<ViewportApi | null>(null)
  const [theme, setTheme] = useScreenTheme(canvas)
  const [sidebar, setSidebar] = useState(() => !CAPTURE && window.innerWidth > 900)
  const [inspectOn, setInspect] = useState(false)
  const sizes = useStore(store, (state) => state.sizes)
  const layout = useMemo(
    () => (page ? layoutPage(page, sizes) : { items: [], sections: [], bounds: { x: 0, y: 0, w: 0, h: 0 } }),
    [page, sizes],
  )
  // Inspect: toggled with the button or I, or while ⌘/Ctrl is held; covers every live screen.
  const frameEls = useStore(store, (state) => state.frameEls)
  const screenFrames = useScreenFrames(frameEls, layout)
  const holding = useModifierHold(screenFrames)
  const inspect = inspectOn || holding
  useEffect(() => {
    store.set((state) => (state.inspecting === inspect ? state : { ...state, inspecting: inspect, active: null }))
  }, [inspect, store])
  const inspection = useInspection(screenFrames, inspect, { onEscape: () => setInspect(false) })
  // Holding ⌘/Ctrl only highlights; picking an element switches Inspect on for good.
  const picked = !!inspection.info
  useEffect(() => {
    if (picked) setInspect(true)
  }, [picked])
  // Every pick selects its screen: the same screen again too, after a click beside it let go of it.
  const pickedInfo = inspection.info
  useEffect(() => {
    const frame = inspection.frame
    if (!frame || !pickedInfo) return
    const id = Object.entries(store.get().frameEls).find(([, el]) => el === frame)?.[0]
    if (id && store.get().selected !== id) store.set((state) => ({ ...state, selected: id }))
  }, [inspection.frame, pickedInfo, store])
  const order = useMemo(() => frameOrder(layout), [layout])
  const key = cameraKey(canvas.id, page?.id ?? '')

  // First view: the saved camera, or everything fitted.
  const placed = useRef(false)
  useEffect(() => {
    if (placed.current || !layout.bounds.w) return
    placed.current = true
    const focus = takeFocus(canvas.id)
    const saved = CAPTURE ? null : loadCamera(key)
    if (focus) {
      store.set((state) => ({ ...state, selected: focus }))
      requestAnimationFrame(() => apiRef.current?.fitItem(focus, false))
    } else if (saved && saved.z >= camera.minZoom) camera.set(saved)
    else requestAnimationFrame(() => (CAPTURE ? apiRef.current?.fitAll(false) : apiRef.current?.openView()))
  }, [layout, camera, key, canvas.id, store])

  useEffect(() => {
    if (CAPTURE) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const off = camera.subscribe((c) => {
      clearTimeout(timer)
      timer = setTimeout(() => sessionStorage.setItem(key, JSON.stringify(c)), 250)
    })
    return () => {
      off()
      clearTimeout(timer)
    }
  }, [camera, key])

  const select = useCallback(
    (id: string | null) => {
      const item = id ? layout.items.find((p) => p.item.id === id)?.item : undefined
      store.set((state) => ({
        ...state,
        selected: item ? item.id : null,
        active: item && isFrame(item) ? item.id : null,
        hovered: null,
      }))
    },
    [layout, store],
  )

  const focusItem = useCallback(
    (id: string) => {
      select(id)
      apiRef.current?.fitItem(id)
    },
    [select],
  )

  const play = useCallback(
    (id: string) =>
      navigate(
        `/c/${encodeURIComponent(canvas.id)}/play/${encodeURIComponent(id)}${page ? `?page=${encodeURIComponent(page.id)}` : ''}`,
      ),
    [canvas.id, page, navigate],
  )
  // Play in the bar and P: the selected screen, else the first one.
  const playFromBar = useCallback(() => {
    const id = store.get().selected
    const target = (id && order.find((p) => p.item.id === id)) || order[0]
    if (target) play(target.item.id)
  }, [store, order, play])

  // Focus requests from ⌘K while this page is open.
  useEffect(() => {
    const onFocus = (event: Event) => {
      const detail = (event as CustomEvent<{ canvas: string; item: string }>).detail
      if (detail.canvas !== canvas.id) return
      if (layout.items.some((p) => p.item.id === detail.item)) {
        takeFocus(canvas.id)
        focusItem(detail.item)
      }
    }
    window.addEventListener('design:focus', onFocus)
    return () => window.removeEventListener('design:focus', onFocus)
  }, [canvas.id, layout, focusItem])

  const events: FrameEvents = useMemo(
    () => ({
      onGo(_from, target) {
        const [pagePart, itemPart] = target.includes('/') ? target.split('/') : [null, target]
        const pages = pagePart
          ? canvas.pages.filter((p) => p.id === pagePart)
          : [page!, ...canvas.pages.filter((p) => p !== page)]
        for (const candidate of pages) {
          if (!candidate) continue
          const found = candidate.sections.some((s) => s.items.some((i) => i.id === itemPart))
          if (!found) continue
          if (candidate === page) focusItem(itemPart!)
          else {
            navigate(pageHref(canvas, candidate))
            window.dispatchEvent(new CustomEvent('design:focus', { detail: { canvas: canvas.id, item: itemPart } }))
          }
          return
        }
        console.warn(`[design] go("${target}"): no such screen`)
      },
      onLink(from, message) {
        followLink(message, canvas, (id) => this.onGo(from, id), from)
      },
      onWheel(frame, message) {
        const root = frame.closest('.canvas-root') as HTMLElement | null
        if (!root) return
        const rootRect = root.getBoundingClientRect()
        const rect = frame.getBoundingClientRect()
        const z = camera.camera.z
        if (message.zoom) {
          const speed = Math.abs(message.deltaY) < 40 ? 0.012 : 0.0025
          camera.zoomAt(
            rect.left - rootRect.left + message.x * z,
            rect.top - rootRect.top + message.y * z,
            Math.exp(-message.deltaY * speed),
          )
        } else camera.panBy(-message.deltaX, -message.deltaY)
      },
      // Esc leaves the screen and lets go of it at once: no stop at "selected, not active".
      onEscape() {
        store.set((state) => ({ ...state, active: null, selected: null }))
      },
    }),
    [canvas, page, camera, store, focusItem, navigate],
  )

  // Capture mode for `design shot --overview`: every frame live, then signal.
  useEffect(() => {
    if (!CAPTURE) return
    const started = Date.now()
    const timer = setInterval(() => {
      const frames = store.get().frames
      const done = order.every((p) => frames[p.item.id]?.ready || (p.item.kind === 'screen' && p.item.missing))
      if (done || Date.now() - started > 60000) {
        clearInterval(timer)
        apiRef.current?.fitAll(false)
        requestAnimationFrame(() => requestAnimationFrame(() => (window.__DESIGN_CANVAS_READY__ = true)))
      }
    }, 250)
    return () => clearInterval(timer)
  }, [order, store])

  // Keyboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || document.querySelector('[role="dialog"]')) return
      const api = apiRef.current
      const state = store.get()
      const mod = e.metaKey || e.ctrlKey
      if (e.key === 'Escape') {
        if (inspection.info) inspection.select(null)
        else if (inspectOn) setInspect(false)
        else if (state.active || state.selected) store.set((s) => ({ ...s, active: null, selected: null }))
      } else if (e.key === 'i' && !mod && !e.altKey) setInspect((value) => !value)
      else if (e.key === 'p' && !mod && !e.altKey) playFromBar()
      else if (e.shiftKey && e.code === 'Digit1') api?.fitAll()
      else if (e.shiftKey && e.code === 'Digit2' && state.selected) api?.fitItem(state.selected)
      else if (e.shiftKey && e.code === 'Digit0') api?.zoomTo(1)
      else if ((e.key === '=' || e.key === '+') && !e.altKey) {
        e.preventDefault()
        api?.zoomBy(1.4)
      } else if (e.key === '-' && !e.altKey) {
        e.preventDefault()
        api?.zoomBy(1 / 1.4)
      } else if (mod && e.key === '0') {
        e.preventDefault()
        api?.zoomTo(1)
      } else if (mod && e.key === '\\') {
        e.preventDefault()
        setSidebar((value) => !value)
      } else if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(e.key) && order.length) {
        e.preventDefault()
        const index = order.findIndex((p) => p.item.id === state.selected)
        const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1
        const next = order[index === -1 ? 0 : (index + step + order.length) % order.length]!
        store.set((s) => ({ ...s, selected: next.item.id, active: null }))
        api?.fitItem(next.item.id)
      } else if (e.key === 'Enter' && state.selected) {
        const item = layout.items.find((p) => p.item.id === state.selected)?.item
        if (item && isFrame(item)) play(item.id)
      } else if (e.key === ']' || e.key === '[') {
        const index = page ? canvas.pages.indexOf(page) : -1
        const next = canvas.pages[index + (e.key === ']' ? 1 : -1)]
        if (next) navigate(pageHref(canvas, next))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [store, order, layout, play, playFromBar, canvas, page, navigate, inspectOn, inspection])

  if (CAPTURE) {
    return (
      <div className="flex h-dvh">
        <Viewport
          layout={layout}
          theme={theme}
          store={store}
          camera={camera}
          events={events}
          capture
          apiRef={apiRef}
          onPlay={() => {}}
          onSelect={() => {}}
        />
      </div>
    )
  }

  return (
    <div className="flex h-dvh flex-col">
      <CanvasBar
        canvas={canvas}
        page={page}
        theme={theme}
        onTheme={setTheme}
        sidebar={sidebar}
        onSidebar={setSidebar}
        inspect={inspectOn}
        onInspect={setInspect}
        onPlay={playFromBar}
        canPlay={order.length > 0}
      />
      <div className="flex min-h-0 grow basis-0">
        <SlidePanel open={sidebar && !!page} side="left" width={264}>
          {page ? <Sidebar canvas={canvas} page={page} store={store} onPick={focusItem} /> : null}
        </SlidePanel>
        <div className="relative min-w-0 grow">
          {page && layout.items.length ? (
            <Viewport
              layout={layout}
              theme={theme}
              store={store}
              camera={camera}
              events={events}
              capture={false}
              apiRef={apiRef}
              onPlay={play}
              onSelect={(id) => {
                // A click beside every item lets go of the selection and switches Inspect off.
                if (!id) {
                  inspection.select(null)
                  setInspect(false)
                }
                select(id)
              }}
            />
          ) : (
            <div className="canvas-dots flex h-full">
              <Notice
                title={page ? 'This page is empty' : 'This canvas has no pages'}
                text={
                  <>
                    Add sections and screens to{' '}
                    <code className="font-mono text-[13px]">.design/canvas/{canvas.id}/canvas.json</code>.
                  </>
                }
              />
            </div>
          )}
          <SelectionBar
            canvas={canvas}
            store={store}
            layoutItems={layout.items.map((p) => p.item)}
            theme={theme}
            onPlay={play}
            inspect={inspect}
          />
          <ZoomControls camera={camera} apiRef={apiRef} />
          {canvas.issues.length ? <IssuesButton canvas={canvas} /> : null}
        </div>
        <SlidePanel open={inspectOn} side="right" width={320}>
          <InspectorPanel
            info={inspection.info}
            active
            onSelect={(el) => inspection.select(el)}
            onClose={() => {
              setInspect(false)
              inspection.select(null)
            }}
          />
        </SlidePanel>
      </div>
    </div>
  )
}

function ZoomLabel({ camera }: { camera: CameraStore }) {
  const [zoom, setZoom] = useState(camera.camera.z)
  useEffect(() => {
    let frame = 0
    return camera.subscribe((c) => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => setZoom(c.z))
    })
  }, [camera])
  return <>{Math.round(zoom * 100)}%</>
}

function ZoomControls({ camera, apiRef }: { camera: CameraStore; apiRef: React.RefObject<ViewportApi | null> }) {
  return (
    <div
      data-ui
      className="absolute right-4 bottom-5 z-20 flex h-[46px] items-center gap-0.5 rounded-[10px] border border-rule bg-surface px-1.5 shadow-pop"
    >
      <IconButton icon="zoom-out" label="Zoom out (−)" onClick={() => apiRef.current?.zoomBy(1 / 1.4)} />
      <Menu
        side="top"
        align="end"
        width={210}
        trigger={
          <button
            type="button"
            className="h-ctrl min-w-[56px] cursor-pointer rounded-[6px] border-0 bg-transparent px-1.5 text-[12.5px] font-medium text-ink2 tabular hover:bg-soft2"
          >
            <ZoomLabel camera={camera} />
          </button>
        }
      >
        <MenuItem onSelect={() => apiRef.current?.fitAll()} hint="⇧1">
          Zoom to fit
        </MenuItem>
        <MenuItem onSelect={() => apiRef.current?.zoomTo(1)} hint="⇧0">
          100%
        </MenuItem>
        <MenuSeparator />
        {[0.25, 0.5, 2].map((z) => (
          <MenuItem key={z} onSelect={() => apiRef.current?.zoomTo(z)}>
            {z * 100}%
          </MenuItem>
        ))}
      </Menu>
      <IconButton icon="zoom-in" label="Zoom in (+)" onClick={() => apiRef.current?.zoomBy(1.4)} />
      <div className="mx-0.5 h-5 w-px bg-rule" />
      <IconButton icon="fit" label="Zoom to fit (⇧1)" onClick={() => apiRef.current?.fitAll()} />
    </div>
  )
}

function IssuesButton({ canvas }: { canvas: CanvasDoc }): ReactNode {
  const errors = canvas.issues.filter((issue) => issue.severity === 'error').length
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          data-ui
          className="absolute bottom-5 left-4 z-20 flex h-[46px] cursor-pointer items-center gap-2 rounded-[10px] border border-rule bg-surface px-3.5 text-[13px] font-medium shadow-pop hover:bg-soft"
        >
          <Icon name="alert" size={15} className={errors ? 'text-danger-text' : 'text-action'} />
          {canvas.issues.length} {canvas.issues.length === 1 ? 'problem' : 'problems'} in canvas.json
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={8}
          collisionPadding={12}
          onFocusOutside={keepOpenForFrames}
          className="z-50 max-h-[50vh] w-[460px] max-w-[calc(100vw-24px)] overflow-y-auto rounded-[10px] border border-rule bg-surface shadow-pop outline-none data-[state=open]:animate-[q-pop_120ms_ease-out]"
        >
          <IssueList issues={canvas.issues} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

/** Mounted screen frames on the page, as a list that keeps its identity while its members do. */
function useScreenFrames(
  frameEls: Record<string, HTMLIFrameElement | null>,
  layout: { items: { item: CanvasItem }[] },
): HTMLIFrameElement[] {
  const previous = useRef<HTMLIFrameElement[]>([])
  return useMemo(() => {
    const screens = new Set(layout.items.filter((p) => p.item.kind === 'screen').map((p) => p.item.id))
    const next = Object.entries(frameEls)
      .filter((entry): entry is [string, HTMLIFrameElement] => !!entry[1] && screens.has(entry[0]))
      .map(([, el]) => el)
    const same = next.length === previous.current.length && next.every((el, i) => el === previous.current[i])
    if (!same) previous.current = next
    return previous.current
  }, [frameEls, layout])
}
