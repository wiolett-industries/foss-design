import type { CanvasSection, ImageItem, NoteItem, RuntimeMessage, ScreenItem, Theme, UrlItem } from '@shared/types'
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Markdown } from '../../components/markdown'
import { cn } from '../../lib/cn'
import { claimWheel, frameSrc, listenToFrame, sendTheme } from '../../lib/frames'
import { useStore } from '../../lib/store'
import { useViewer } from '../../lib/viewer'
import { Icon } from '../../ui/icon'
import type { Placed } from './layout'
import { setFrame, setFrameEl, setSize, type ViewStore } from './view-state'
import type { FrameMode } from './viewport'

export interface FrameEvents {
  onGo(from: string, target: string): void
  onWheel(
    frame: HTMLIFrameElement,
    message: { deltaX: number; deltaY: number; x: number; y: number; zoom: boolean },
  ): void
  onEscape(): void
}

function useMeasure(store: ViewStore, key: string, enabled = true) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !enabled) return
    const observer = new ResizeObserver(() => setSize(store, key, { h: el.offsetHeight }))
    observer.observe(el)
    return () => observer.disconnect()
  }, [store, key, enabled])
  return ref
}

function deviceIcon(width: number) {
  return width < 600 ? 'smartphone' : width < 1100 ? 'tablet' : 'monitor'
}

/** A screen or an external page on the canvas: live frame, snapshot or placeholder. */
export const FrameItem = memo(function FrameItem({
  placed,
  mode,
  thumb,
  theme,
  store,
  events,
  capture,
}: {
  placed: Placed & { item: ScreenItem | UrlItem }
  mode: FrameMode
  /** Small on screen: show the small snapshot. */
  thumb: boolean
  theme: Theme
  store: ViewStore
  events: FrameEvents
  capture: boolean
}) {
  const { item, x, y, w, h } = placed
  const ref = useRef<HTMLIFrameElement | null>(null)
  const { frameSandbox } = useViewer()
  const setRef = useCallback(
    (el: HTMLIFrameElement | null) => {
      ref.current = el
      setFrameEl(store, item.id, el)
    },
    [store, item.id],
  )
  const status = useStore(store, (state) => state.frames[item.id])
  const active = useStore(store, (state) => state.active === item.id)
  const inspecting = useStore(store, (state) => state.inspecting && item.kind === 'screen')
  const auto = item.frame.height === 'auto'
  const frameTheme = item.kind === 'screen' ? (item.theme ?? theme) : theme
  const rev = item.kind === 'screen' ? item.rev : item.url
  // The theme a frame opens with is fixed per mount; later changes are sent to it.
  const [openTheme] = useState(frameTheme)
  const src = item.kind === 'screen' ? frameSrc(item.url, openTheme, capture ? { capture: '1' } : undefined) : item.url
  const ready = !!status?.ready
  const off = mode === 'off'
  const mounted = !off && !(item.kind === 'screen' && item.missing)

  useEffect(() => {
    if (off) setFrame(store, item.id, { ready: false })
  }, [off, store, item.id])

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-attach when the iframe remounts for a new source
  useEffect(() => {
    const frame = ref.current
    if (!frame || off || item.kind !== 'screen') return
    return listenToFrame(frame, (message: RuntimeMessage) => {
      switch (message.type) {
        case 'ready':
          setFrame(store, item.id, { ready: true })
          claimWheel(frame)
          break
        case 'size':
          if (auto) setSize(store, item.id, { h: Math.max(200, message.height) })
          break
        case 'error': {
          const current = store.get().frames[item.id]?.errors ?? []
          if (!current.includes(message.message)) setFrame(store, item.id, { errors: [...current, message.message] })
          break
        }
        case 'updated':
          setFrame(store, item.id, { errors: [] })
          break
        case 'go':
          events.onGo(item.id, message.target)
          break
        case 'wheel':
          events.onWheel(frame, message)
          break
        case 'keydown':
          if (message.code === 'Escape') events.onEscape()
          break
      }
    })
  }, [off, item.id, item.kind, auto, store, events, src, rev])

  useEffect(() => {
    if (item.kind === 'screen') sendTheme(ref.current, frameTheme)
  }, [frameTheme, item.kind])

  const other = frameTheme === 'dark' ? 'light' : 'dark'
  const pick = (set?: Partial<Record<Theme, string>>) => set?.[frameTheme] ?? set?.[other]
  const full = item.kind === 'screen' ? pick(item.snapshots) : undefined
  const snapshot = thumb && item.kind === 'screen' ? (pick(item.thumbs) ?? full) : full
  // Asleep: still mounted, so it keeps its state, but hidden behind its snapshot and skipped by
  // rendering, which also stops its animations. Without a snapshot it stays in view as it is.
  const asleep = mode === 'asleep' && ready && !!snapshot

  return (
    <div
      data-item={item.id}
      className="absolute overflow-hidden bg-surface"
      style={{ left: x, top: y, width: w, height: h, boxShadow: 'var(--shadow-frame), 0 0 0 1px var(--rule)' }}
    >
      {(!ready || asleep) && snapshot ? (
        <img
          src={snapshot}
          alt=""
          draggable={false}
          loading="lazy"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover object-top select-none"
        />
      ) : null}
      {!ready && !snapshot ? <Placeholder item={item} loading={mounted} /> : null}
      {mounted ? (
        <div className="absolute inset-0" style={{ contentVisibility: asleep ? 'hidden' : 'visible' }}>
          <iframe
            ref={setRef}
            key={rev}
            src={src}
            title={item.title}
            allow="clipboard-read; clipboard-write; fullscreen"
            sandbox={frameSandbox}
            className={cn(
              'absolute top-0 left-0 block border-0 transition-opacity duration-200',
              ready ? 'opacity-100' : 'opacity-0',
            )}
            style={{ width: w, height: h, colorScheme: frameTheme }}
            onLoad={() => {
              if (item.kind === 'url') setFrame(store, item.id, { ready: true })
              else {
                sendTheme(ref.current, frameTheme)
                claimWheel(ref.current)
              }
            }}
          />
        </div>
      ) : null}
      {active || inspecting ? null : <div data-shield={item.id} className="absolute inset-0" />}
    </div>
  )
})

function Placeholder({ item, loading }: { item: ScreenItem | UrlItem; loading: boolean }) {
  const missing = item.kind === 'screen' && item.missing
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-soft text-muted">
      <Icon
        name={missing ? 'alert' : item.kind === 'url' ? 'globe' : deviceIcon(item.frame.width)}
        size={Math.max(24, Math.min(96, item.frame.width / 12))}
        strokeWidth={1.25}
        className={missing ? 'text-danger-text' : undefined}
      />
      <div className="max-w-[80%] truncate text-center" style={{ fontSize: Math.max(14, item.frame.width / 40) }}>
        {missing ? `Missing file: ${item.kind === 'screen' ? item.src : ''}` : loading ? 'Loading…' : item.title}
      </div>
    </div>
  )
}

export const NoteView = memo(function NoteView({
  placed,
  store,
}: {
  placed: Placed & { item: NoteItem }
  store: ViewStore
}) {
  const { item, x, y, w } = placed
  const ref = useMeasure(store, item.id)
  const plain = item.tone === 'plain'
  return (
    <div
      ref={ref}
      data-item={item.id}
      className={cn('absolute', plain ? '' : 'rounded-[10px] border border-note-line bg-note px-6 py-5 shadow-frame')}
      style={{ left: x, top: y, width: w }}
    >
      {item.title ? (
        <div className="mb-2 font-semibold text-ink" style={{ fontSize: plain ? 26 : 19 }}>
          {item.title}
        </div>
      ) : null}
      <Markdown text={item.text} className={plain ? 'prose-plain' : 'prose-note'} />
    </div>
  )
})

export const ImageView = memo(function ImageView({
  placed,
  store,
}: {
  placed: Placed & { item: ImageItem }
  store: ViewStore
}) {
  const { item, x, y, w, h } = placed
  return (
    <div
      data-item={item.id}
      className="absolute overflow-hidden rounded-[6px] bg-surface"
      style={{ left: x, top: y, width: w, height: h, boxShadow: '0 0 0 1px var(--rule)' }}
    >
      {item.missing ? (
        <div className="flex h-full items-center justify-center gap-2 text-danger-text">
          <Icon name="alert" size={20} /> Missing image
        </div>
      ) : (
        <img
          src={item.url}
          alt={item.title}
          draggable={false}
          className="block h-full w-full object-contain select-none"
          onLoad={(event) => {
            const img = event.currentTarget
            setSize(store, item.id, { w: img.naturalWidth, h: img.naturalHeight })
          }}
        />
      )}
    </div>
  )
})

export const SectionHeader = memo(function SectionHeader({
  section,
  x,
  y,
  w,
  store,
}: {
  section: CanvasSection
  x: number
  y: number
  w: number
  store: ViewStore
}) {
  const ref = useMeasure(store, `section:${section.id}`)
  if (!section.title && !section.description) return null
  return (
    <div
      ref={ref}
      className="canvas-section absolute"
      style={{ left: x, top: y, width: Math.min(Math.max(w, 720), 1400) }}
    >
      {section.title ? (
        <div className="text-[40px] leading-[1.15] font-semibold tracking-[-0.015em] text-ink">{section.title}</div>
      ) : null}
      {section.description ? (
        <div className="mt-3 max-w-[1100px]">
          <Markdown text={section.description} className="prose-plain" />
        </div>
      ) : null}
    </div>
  )
})
