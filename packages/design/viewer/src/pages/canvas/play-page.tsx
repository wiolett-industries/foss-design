import type { CanvasDoc, RuntimeMessage, ScreenItem, Theme, UrlItem } from '@shared/types'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation } from 'wouter'
import { InspectorPanel, useInspection, useModifierHold } from '../../components/inspector'
import { SlidePanel } from '../../components/slide-panel'
import { ThemeMenu } from '../../components/theme-menu'
import { Bar } from '../../components/topbar'
import { useCanvas } from '../../lib/api'
import { absoluteUrl, frameSrc, listenToFrame, reloadFrame, sendTheme } from '../../lib/frames'
import { useTheme } from '../../lib/theme'
import { useViewer } from '../../lib/viewer'
import { IconButton } from '../../ui/button'
import { Segmented } from '../../ui/choice'
import { Icon } from '../../ui/icon'
import { Kbd } from '../../ui/text'
import { Tooltip } from '../../ui/tooltip'
import { NotFound } from '../not-found'
import { InspectToggle } from './canvas-bar'
import { isTyping } from './viewport'

type Frame = ScreenItem | UrlItem

interface Entry {
  item: Frame
  pageId: string
  where: string
}

function framesOf(canvas: CanvasDoc, pageId: string | null): Entry[] {
  const pages = pageId ? canvas.pages.filter((p) => p.id === pageId) : canvas.pages
  return pages.flatMap((page) =>
    page.sections.flatMap((section) =>
      section.items
        .filter((item): item is Frame => item.kind === 'screen' || item.kind === 'url')
        .map((item) => ({
          item,
          pageId: page.id,
          where: [canvas.pages.length > 1 ? page.title : null, section.title].filter(Boolean).join(' · '),
        })),
    ),
  )
}

const playHref = (canvas: string, item: string, page: string) =>
  `/c/${encodeURIComponent(canvas)}/play/${encodeURIComponent(item)}?page=${encodeURIComponent(page)}`

export function PlayPage({ canvasId, itemId }: { canvasId: string; itemId: string }) {
  const { data: canvas, error, isLoading } = useCanvas(canvasId)
  if (error) return <NotFound title="Canvas not found" text={(error as Error).message} />
  if (isLoading || !canvas) return null
  return <Player canvas={canvas} itemId={itemId} />
}

function Player({ canvas, itemId }: { canvas: CanvasDoc; itemId: string }) {
  const [, navigate] = useLocation()
  const { frameSandbox, slots } = useViewer()
  const pageParam =
    new URLSearchParams(window.location.search).get('page') ??
    (window.location.hash.split('?')[1] ? new URLSearchParams(window.location.hash.split('?')[1]).get('page') : null)
  const all = useMemo(() => framesOf(canvas, null), [canvas])
  const current = all.find((entry) => entry.item.id === itemId)
  const pageId = pageParam ?? current?.pageId ?? null
  const list = useMemo(() => (pageId ? framesOf(canvas, pageId) : all), [canvas, pageId, all])
  const index = list.findIndex((entry) => entry.item.id === itemId)
  const appTheme = useTheme()
  const [theme, setTheme] = useState<Theme>(canvas.theme ?? appTheme)
  const [fit, setFit] = useState<'fit' | 'actual'>('fit')
  const stage = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLIFrameElement | null>(null)
  const [frameEl, setFrameEl] = useState<HTMLIFrameElement | null>(null)
  const setFrame = useCallback((el: HTMLIFrameElement | null) => {
    frame.current = el
    setFrameEl(el)
  }, [])
  const [inspectOn, setInspect] = useState(false)
  const [area, setArea] = useState({ w: 0, h: 0 })
  const [errors, setErrors] = useState<string[]>([])
  const back = pageId
    ? `/c/${encodeURIComponent(canvas.id)}/p/${encodeURIComponent(pageId)}`
    : `/c/${encodeURIComponent(canvas.id)}`

  const move = (step: number) => {
    if (!list.length) return
    const next = list[(index + step + list.length) % list.length]!
    navigate(playHref(canvas.id, next.item.id, next.pageId), { replace: true })
  }

  useLayoutEffect(() => {
    const el = stage.current
    if (!el) return
    const observer = new ResizeObserver(() => setArea({ w: el.clientWidth, h: el.clientHeight }))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || document.querySelector('[role="dialog"]')) return
      if (e.key === 'ArrowRight') move(1)
      else if (e.key === 'ArrowLeft') move(-1)
      else if (e.key === 'i' && !e.metaKey && !e.ctrlKey && !e.altKey) setInspect((value) => !value)
      else if (e.key === 'Escape') {
        if (inspection.info) inspection.select(null)
        else if (inspectOn) setInspect(false)
        else navigate(back)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const entry = list[index]
  const item = entry?.item
  const frameTheme = item?.kind === 'screen' ? (item.theme ?? theme) : theme
  const [openTheme] = useState(frameTheme)
  const src = item ? (item.kind === 'screen' ? frameSrc(item.url, openTheme) : item.url) : ''
  const frames = useMemo(() => (frameEl && item?.kind === 'screen' ? [frameEl] : []), [frameEl, item?.kind])
  const holding = useModifierHold(frames)
  const inspect = inspectOn || holding
  const inspection = useInspection(frames, inspect, {
    onEscape: () => setInspect(false),
  })
  const picked = !!inspection.info
  useEffect(() => {
    if (picked) setInspect(true)
  }, [picked])

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-attach when the iframe remounts for a new source
  useEffect(() => {
    const el = frame.current
    if (!el || item?.kind !== 'screen') return
    setErrors([])
    return listenToFrame(el, (message: RuntimeMessage) => {
      if (message.type === 'error')
        setErrors((list) => (list.includes(message.message) ? list : [...list, message.message]))
      else if (message.type === 'updated') setErrors([])
      else if (message.type === 'keydown' && message.code === 'Escape') navigate(back)
      else if (message.type === 'go') {
        const [pagePart, idPart] = message.target.includes('/') ? message.target.split('/') : [null, message.target]
        const target = all.find((e) => e.item.id === idPart && (!pagePart || e.pageId === pagePart))
        if (target) navigate(playHref(canvas.id, target.item.id, target.pageId))
      }
    })
  }, [item, src, all, canvas.id, navigate, back])

  useEffect(() => {
    if (item?.kind === 'screen') sendTheme(frame.current, frameTheme)
  }, [frameTheme, item])

  if (!item) return <NotFound title="Screen not found" text={`No screen "${itemId}" on this canvas.`} />

  const width = item.frame.width
  const height = item.frame.height === 'auto' ? Math.max(area.h - 48, 400) : item.frame.height
  const scale = fit === 'fit' ? Math.min(1, (area.w - 48) / width, (area.h - 48) / height) : 1
  const fits = width <= area.w - 48 && height <= area.h - 48
  // Sandboxed screens are served to frames only; a tab of their own would not load.
  const openUrl = item.kind === 'url' ? item.url : frameSandbox ? null : absoluteUrl(frameSrc(item.url, frameTheme))

  return (
    <div className="flex h-dvh flex-col">
      <Bar>
        {slots.barStart}
        <Tooltip
          content={
            <span className="flex items-center gap-1.5">
              Back to canvas <Kbd>esc</Kbd>
            </span>
          }
        >
          <Link
            href={back}
            className="inline-flex h-ctrl w-ctrl items-center justify-center rounded-[6px] text-muted hover:bg-soft2 hover:text-ink2"
            aria-label="Back to canvas"
          >
            <Icon name="arrow-left" size={16} />
          </Link>
        </Tooltip>
        <div className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-[14px] font-semibold">{item.title}</span>
          <span className="truncate text-[12px] text-muted">
            {[canvas.title, entry.where].filter(Boolean).join(' · ')}
          </span>
        </div>
        <div className="mx-auto flex items-center gap-1">
          <IconButton
            icon="chevron-left"
            label="Previous screen (←)"
            onClick={() => move(-1)}
            disabled={list.length < 2}
          />
          <span className="min-w-[52px] text-center text-[12.5px] text-muted tabular">
            {index + 1} / {list.length}
          </span>
          <IconButton icon="chevron-right" label="Next screen (→)" onClick={() => move(1)} disabled={list.length < 2} />
        </div>
        <div className="flex items-center gap-2">
          {!fits ? (
            <Segmented
              label="Scale"
              value={fit}
              onChange={setFit}
              items={[
                { value: 'fit', label: 'Fit' },
                { value: 'actual', label: '100%' },
              ]}
            />
          ) : null}
          {item.kind === 'screen' && !item.theme ? (
            <Segmented
              label="Screen theme"
              value={theme}
              onChange={setTheme}
              items={[
                { value: 'light', label: <Icon name="sun" size={15} />, title: 'Light' },
                { value: 'dark', label: <Icon name="moon" size={15} />, title: 'Dark' },
              ]}
            />
          ) : null}
          {item.kind === 'screen' ? <InspectToggle on={inspectOn} onChange={setInspect} /> : null}
          <IconButton icon="refresh" label="Reload" onClick={() => reloadFrame(frame.current)} />
          {openUrl ? (
            <a
              href={openUrl}
              target="_blank"
              rel="noreferrer"
              title="Open in a new tab"
              className="inline-flex h-ctrl w-ctrl items-center justify-center rounded-[6px] text-muted hover:bg-soft2 hover:text-ink2"
            >
              <Icon name="external" size={16} />
            </a>
          ) : null}
          <ThemeMenu />
          {slots.barEnd}
        </div>
      </Bar>
      {slots.belowBar}
      <div className="flex min-h-0 grow">
        <div
          ref={stage}
          className={`canvas-dots relative min-w-0 grow ${fit === 'actual' ? 'overflow-auto' : 'overflow-hidden'}`}
        >
          {errors.length ? (
            <div className="absolute inset-x-0 top-0 z-10 flex items-start gap-2 border-b border-rule bg-danger-soft px-4 py-2 font-mono text-[12px] whitespace-pre-wrap text-danger-text">
              <Icon name="alert" size={14} className="mt-px" />
              {errors.join('\n')}
            </div>
          ) : null}
          <div
            className="flex min-h-full min-w-full items-center justify-center p-6"
            style={{ width: fit === 'actual' ? width + 48 : undefined }}
          >
            <div
              className="shrink-0 overflow-hidden bg-surface"
              style={{
                width: width * scale,
                height: height * scale,
                boxShadow: 'var(--shadow-frame), 0 0 0 1px var(--rule)',
              }}
            >
              <iframe
                ref={setFrame}
                key={`${item.id}:${item.kind === 'screen' ? item.rev : item.url}`}
                src={src}
                title={item.title}
                allow="clipboard-read; clipboard-write; fullscreen"
                sandbox={frameSandbox}
                className="block border-0"
                style={{ width, height, transform: `scale(${scale})`, transformOrigin: '0 0', colorScheme: frameTheme }}
                onLoad={() => item.kind === 'screen' && sendTheme(frame.current, frameTheme)}
              />
            </div>
          </div>
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
