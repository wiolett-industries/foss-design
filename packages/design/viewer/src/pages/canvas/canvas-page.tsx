import * as Popover from '@radix-ui/react-popover'
import type { CanvasDoc, CanvasItem, CanvasPage as Page, Theme } from '@shared/types'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation } from 'wouter'
import { InspectorPanel, useInspection, useModifierHold } from '../../components/inspector'
import { IssueList } from '../../components/issues'
import { SearchButton } from '../../components/search-button'
import { SlidePanel } from '../../components/slide-panel'
import { ThemeMenu } from '../../components/theme-menu'
import { Bar } from '../../components/topbar'
import { Mark } from '../../components/wordmark'
import { useCanvas } from '../../lib/api'
import { copyText } from '../../lib/copy'
import { takeFocus } from '../../lib/focus'
import { absoluteUrl, frameSrc, reloadFrame } from '../../lib/frames'
import { useStore } from '../../lib/store'
import { useTheme } from '../../lib/theme'
import { Button, IconButton } from '../../ui/button'
import { Segmented } from '../../ui/choice'
import { Icon } from '../../ui/icon'
import { Menu, MenuItem, MenuLabel, MenuSeparator } from '../../ui/menu'
import { Notice } from '../../ui/page'
import { Kbd } from '../../ui/text'
import { Tooltip } from '../../ui/tooltip'
import { NotFound } from '../not-found'
import { CameraStore } from './camera'
import type { FrameEvents } from './items'
import { frameOrder, isFrame, layoutPage } from './layout'
import { pageHref, Sidebar } from './sidebar'
import { createViewState, type ViewStore } from './view-state'
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
  useEffect(() => {
    const frame = inspection.frame
    if (!frame) return
    const id = Object.entries(store.get().frameEls).find(([, el]) => el === frame)?.[0]
    if (id && store.get().selected !== id) store.set((state) => ({ ...state, selected: id }))
  }, [inspection.frame, store])
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
      onEscape() {
        store.set((state) => ({ ...state, active: null }))
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
        else if (state.active) store.set((s) => ({ ...s, active: null }))
        else if (state.selected) store.set((s) => ({ ...s, selected: null }))
      } else if (e.key === 'i' && !mod && !e.altKey) setInspect((value) => !value)
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
  }, [store, order, layout, play, canvas, page, navigate, inspectOn, inspection])

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
        onPlay={() => {
          const id = store.get().selected
          const target = (id && order.find((p) => p.item.id === id)) || order[0]
          if (target) play(target.item.id)
        }}
        canPlay={order.length > 0}
      />
      <div className="flex min-h-0 grow">
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
              onSelect={select}
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

function CanvasBar({
  canvas,
  page,
  theme,
  onTheme,
  sidebar,
  onSidebar,
  onPlay,
  canPlay,
  inspect,
  onInspect,
}: {
  canvas: CanvasDoc
  page: Page | undefined
  theme: Theme
  onTheme(theme: Theme): void
  sidebar: boolean
  onSidebar(value: boolean): void
  onPlay(): void
  canPlay: boolean
  inspect: boolean
  onInspect(value: boolean): void
}) {
  const [, navigate] = useLocation()
  return (
    <Bar>
      <Tooltip content="All canvases">
        <Link href="/" className="flex items-center" aria-label="All canvases">
          <Mark />
        </Link>
      </Tooltip>
      <IconButton
        icon="panel-left"
        label={sidebar ? 'Hide sidebar (⌘\\)' : 'Show sidebar (⌘\\)'}
        onClick={() => onSidebar(!sidebar)}
      />
      <div className="flex min-w-0 items-center gap-1.5 text-[14px]">
        <span className="truncate font-semibold">{canvas.title}</span>
        {page && canvas.pages.length > 1 ? (
          <>
            <Icon name="chevron-right" size={14} className="shrink-0 text-muted" />
            <Menu
              width={240}
              trigger={
                <button
                  type="button"
                  className="flex h-ctrl cursor-pointer items-center gap-1 rounded-[6px] border-0 bg-transparent px-2 text-[14px] text-ink2 hover:bg-soft2"
                >
                  <span className="truncate">{page.title}</span>
                  <Icon name="chevron-down" size={14} className="text-muted" />
                </button>
              }
            >
              <MenuLabel>Pages</MenuLabel>
              {canvas.pages.map((p) => (
                <MenuItem key={p.id} active={p.id === page.id} onSelect={() => navigate(pageHref(canvas, p))}>
                  <Icon name="file" size={15} className="text-muted" />
                  {p.title}
                </MenuItem>
              ))}
            </Menu>
          </>
        ) : null}
      </div>
      <div className="ml-auto flex items-center gap-2">
        <Segmented
          label="Screen theme"
          value={theme}
          onChange={onTheme}
          items={[
            { value: 'light', label: <Icon name="sun" size={15} />, title: 'Light screens' },
            { value: 'dark', label: <Icon name="moon" size={15} />, title: 'Dark screens' },
          ]}
        />
        <InspectToggle on={inspect} onChange={onInspect} />
        <Button kind="secondary" icon="play" onClick={onPlay} disabled={!canPlay}>
          Play
        </Button>
        <SearchButton width={200} label="Search" />
        <ThemeMenu />
      </div>
    </Bar>
  )
}

function SelectionBar({
  canvas,
  store,
  layoutItems,
  theme,
  onPlay,
  inspect,
}: {
  canvas: CanvasDoc
  store: ViewStore
  layoutItems: CanvasItem[]
  theme: Theme
  onPlay(id: string): void
  inspect: boolean
}) {
  const selected = useStore(store, (state) => state.selected)
  const active = useStore(store, (state) => state.active)
  const status = useStore(store, (state) => (selected ? state.frames[selected] : undefined))
  const item = layoutItems.find((i) => i.id === selected)
  if (!item) return null
  const frame = item.kind === 'screen' || item.kind === 'url'
  const openUrl =
    item.kind === 'screen'
      ? absoluteUrl(frameSrc(item.url, item.theme ?? theme))
      : item.kind === 'url'
        ? item.url
        : null
  const reload = () =>
    reloadFrame(document.querySelector<HTMLIFrameElement>(`[data-item="${CSS.escape(item.id)}"] iframe`))
  const errors = status?.errors ?? []
  return (
    <div data-ui className="pointer-events-none absolute inset-x-0 bottom-5 z-20 flex justify-center px-4">
      <div className="pointer-events-auto flex max-w-full flex-col overflow-hidden rounded-[10px] border border-rule bg-surface shadow-pop animate-[q-pop_120ms_ease-out]">
        {errors.length ? (
          <div className="flex max-h-40 items-start gap-2 overflow-y-auto border-b border-rule bg-danger-soft px-3.5 py-2 font-mono text-[12px] whitespace-pre-wrap text-danger-text">
            <Icon name="alert" size={14} className="mt-px" />
            <span className="min-w-0">{errors.join('\n')}</span>
          </div>
        ) : null}
        <div className="flex h-[44px] items-center gap-1 pr-1.5 pl-3.5">
          <div className="flex min-w-0 items-center gap-2 pr-2">
            <span className="truncate text-[13.5px] font-medium">{item.title || item.id}</span>
            {frame && active === item.id ? (
              <span className="flex shrink-0 items-center gap-1.5 text-[12px] text-muted">
                <Icon name="pointer" size={13} /> {inspect ? 'Inspecting' : 'Interacting'} <Kbd>esc</Kbd>
              </span>
            ) : frame ? (
              <span className="shrink-0 text-[12px] text-muted">
                {inspect ? 'Click an element to inspect it' : 'Click the screen to interact'}
              </span>
            ) : null}
          </div>
          {frame ? (
            <Tooltip
              content={
                <span className="flex items-center gap-1.5">
                  Play <Kbd>↵</Kbd>
                </span>
              }
            >
              <IconButton icon="play" label="Play" onClick={() => onPlay(item.id)} />
            </Tooltip>
          ) : null}
          {openUrl ? (
            <Tooltip content="Open in a new tab">
              <a
                href={openUrl}
                target="_blank"
                rel="noreferrer"
                aria-label="Open in a new tab"
                className="inline-flex h-ctrl w-ctrl items-center justify-center rounded-[6px] text-muted hover:bg-soft2 hover:text-ink2"
              >
                <Icon name="external" size={16} />
              </a>
            </Tooltip>
          ) : null}
          {frame ? (
            <Tooltip content="Reload">
              <IconButton icon="refresh" label="Reload" onClick={reload} />
            </Tooltip>
          ) : null}
          {item.kind === 'screen' ? (
            <Tooltip content="Copy source path">
              <IconButton
                icon="copy"
                label="Copy source path"
                onClick={() => void copyText(item.file, 'Path copied')}
              />
            </Tooltip>
          ) : null}
          <Tooltip
            content={
              <span className="flex items-center gap-1.5">
                Zoom to <Kbd>⇧2</Kbd>
              </span>
            }
          >
            <IconButton
              icon="fit"
              label="Zoom to"
              onClick={() =>
                window.dispatchEvent(new CustomEvent('design:focus', { detail: { canvas: canvas.id, item: item.id } }))
              }
            />
          </Tooltip>
        </div>
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
          className="z-50 max-h-[50vh] w-[460px] max-w-[calc(100vw-24px)] overflow-y-auto rounded-[10px] border border-rule bg-surface shadow-pop outline-none data-[state=open]:animate-[q-pop_120ms_ease-out]"
        >
          <IssueList issues={canvas.issues} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

/** The inspect mode switch: a button that stays pressed while on. */
export function InspectToggle({ on, onChange }: { on: boolean; onChange(value: boolean): void }) {
  return (
    <Tooltip
      content={
        <span className="flex items-center gap-1.5">
          Inspect elements <Kbd>I</Kbd>
        </span>
      }
    >
      <button
        type="button"
        aria-pressed={on}
        onClick={() => onChange(!on)}
        className={
          on
            ? 'inline-flex h-ctrl cursor-pointer items-center gap-1.5 rounded-[6px] border border-action-line bg-action-soft px-ctrl text-ctrl font-medium text-action'
            : 'inline-flex h-ctrl cursor-pointer items-center gap-1.5 rounded-[6px] border border-rule-strong bg-surface px-ctrl text-ctrl font-medium text-ink hover:bg-soft'
        }
      >
        <Icon name="pointer" size={15} />
        Inspect
      </button>
    </Tooltip>
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
