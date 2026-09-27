import type { CanvasDoc, RuntimeMessage, Theme } from '@shared/types'
import { AnimatePresence, motion } from 'motion/react'
import {
  type ReactNode,
  type TouchEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Link, useLocation } from 'wouter'
import { Mark } from '../../components/wordmark'
import { useCanvas } from '../../lib/api'
import { cn } from '../../lib/cn'
import { followLink, frameSrc, listenToFrame, reloadFrame, sendTheme } from '../../lib/frames'
import { setThemePref, useTheme } from '../../lib/theme'
import { useViewer } from '../../lib/viewer'
import { IconButton } from '../../ui/button'
import { Icon, type IconName } from '../../ui/icon'
import { Menu, MenuItem, MenuLabel, MenuSeparator } from '../../ui/menu'
import { Sheet } from '../../ui/sheet'
import { NotFound } from '../not-found'
import { useOpenUrl } from './full-page'
import { type Entry, framesOf, playHref } from './play-page'

/** Room around the screen on the stage, per side. */
const GUTTER = 12

/**
 * A canvas on a phone: no board to pan, one screen at a time as in play mode. The screen fills
 * the width and scrolls; the bottom bar steps through every screen of the canvas and opens the
 * list of them. Serves `/c/:canvas`, its pages and `/c/:canvas/play/:item` under 768px.
 */
export function PhoneCanvas({ canvasId, pageId, itemId }: { canvasId: string; pageId?: string; itemId?: string }) {
  const { data: canvas, error, isLoading } = useCanvas(canvasId)
  if (error) return <NotFound title="Canvas not found" text={(error as Error).message} />
  if (isLoading || !canvas) return <div className="canvas-dots h-dvh" />
  return <PhoneViewer canvas={canvas} pageId={pageId} itemId={itemId} />
}

function PhoneViewer({ canvas, pageId, itemId }: { canvas: CanvasDoc; pageId?: string; itemId?: string }) {
  const [, navigate] = useLocation()
  const { frameSandbox, slots, scope } = useViewer()
  const appTheme = useTheme()
  const all = useMemo(() => framesOf(canvas, null), [canvas])
  const index = Math.max(
    0,
    itemId
      ? all.findIndex((entry) => entry.item.id === itemId)
      : pageId
        ? all.findIndex((entry) => entry.pageId === pageId)
        : 0,
  )
  const entry = all[index]
  const item = entry?.item
  const [theme, setTheme] = useState<Theme>(canvas.theme ?? appTheme)
  const [listOpen, setListOpen] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const [stageWidth, setStageWidth] = useState(0)
  const [autoHeight, setAutoHeight] = useState<number | null>(null)
  const [direction, setDirection] = useState(0)
  // Screens wider than the phone fit its width, or show at 100% and scroll both ways.
  const [actual, setActual] = useState(false)
  const stage = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLIFrameElement | null>(null)
  const [frameEl, setFrameEl] = useState<HTMLIFrameElement | null>(null)
  // Only a new frame counts: the one sliding out unmounts after the next one mounted.
  const setFrame = useCallback((el: HTMLIFrameElement | null) => {
    if (!el) return
    frame.current = el
    setFrameEl(el)
  }, [])

  const show = useCallback(
    (target: Entry, step = 0) => {
      setDirection(step)
      navigate(playHref(canvas.id, target.item.id, target.pageId), { replace: true })
    },
    [canvas.id, navigate],
  )
  const move = (step: number) => {
    if (all.length < 2) return
    show(all[(index + step + all.length) % all.length]!, step)
  }
  const goTo = (id: string) => {
    const target = all.find((e) => e.item.id === id)
    if (target) show(target, all.indexOf(target) > index ? 1 : -1)
  }

  useLayoutEffect(() => {
    const el = stage.current
    if (!el) return
    const observer = new ResizeObserver(() => setStageWidth(el.clientWidth))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const frameTheme = item?.kind === 'screen' ? (item.theme ?? theme) : theme
  const [openTheme] = useState(frameTheme)
  const src = item ? (item.kind === 'screen' ? frameSrc(item.url, openTheme) : item.url) : ''
  const openUrl = useOpenUrl(canvas.id, item, frameTheme)

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-attach when the iframe remounts for a new source
  useEffect(() => {
    setErrors([])
    setAutoHeight(item?.kind === 'screen' ? (item.measuredHeight ?? null) : null)
    stage.current?.scrollTo({ top: 0 })
    const el = frame.current
    if (!el || item?.kind !== 'screen') return
    return listenToFrame(el, (message: RuntimeMessage) => {
      if (message.type === 'size') setAutoHeight(message.height)
      else if (message.type === 'error')
        setErrors((list) => (list.includes(message.message) ? list : [...list, message.message]))
      else if (message.type === 'updated') setErrors([])
      else if (message.type === 'go')
        goTo(message.target.includes('/') ? message.target.split('/')[1]! : message.target)
      else if (message.type === 'link') followLink(message, canvas, goTo)
    })
  }, [frameEl, src])

  useEffect(() => {
    if (item?.kind === 'screen') sendTheme(frame.current, frameTheme)
  }, [frameTheme, item])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"]')) return
      if (event.key === 'ArrowRight') move(1)
      else if (event.key === 'ArrowLeft') move(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // A horizontal swipe on the stage around the screen steps through them; inside the screen
  // the touches belong to it.
  const swipe = useRef<{ x: number; y: number } | null>(null)
  const onTouchStart = (event: TouchEvent) => {
    const touch = event.touches[0]
    swipe.current = touch ? { x: touch.clientX, y: touch.clientY } : null
  }
  const onTouchEnd = (event: TouchEvent) => {
    const start = swipe.current
    const touch = event.changedTouches[0]
    swipe.current = null
    if (!start || !touch) return
    const dx = touch.clientX - start.x
    const dy = touch.clientY - start.y
    if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy) * 1.5) move(dx < 0 ? 1 : -1)
  }

  if (!item || !entry) {
    return (
      <div className="flex h-dvh flex-col">
        <PhoneBar canvas={canvas} title={canvas.title} sub={null} />
        <NotFound title="No screens here" text="This canvas has no screens to show yet." />
      </div>
    )
  }

  const width = item.frame.width
  const fitScale = stageWidth ? Math.min(1, (stageWidth - GUTTER * 2) / width) : 0
  const wide = fitScale > 0 && fitScale < 0.8
  const scale = wide && actual ? 1 : fitScale
  const height = item.frame.height === 'auto' ? Math.max(autoHeight ?? 0, 480) : item.frame.height
  const canTheme = item.kind === 'screen' && !item.theme

  return (
    <div className="flex h-dvh flex-col">
      <PhoneBar
        canvas={canvas}
        title={item.title || item.id}
        sub={[canvas.title, entry.where].filter(Boolean).join(' · ')}
        back={scope ? undefined : '/'}
        end={
          <>
            {wide ? (
              <IconButton
                icon={actual ? 'zoom-out' : 'zoom-in'}
                label={actual ? 'Fit to width' : 'Actual size'}
                onClick={() => setActual((value) => !value)}
              />
            ) : null}
            <Menu align="end" width={220} trigger={<IconButton icon="more" label="Screen options" />}>
              {canTheme ? (
                <>
                  <MenuLabel>Screen theme</MenuLabel>
                  <ThemeItem value="light" current={theme} onPick={setTheme} />
                  <ThemeItem value="dark" current={theme} onPick={setTheme} />
                  <MenuSeparator />
                </>
              ) : null}
              <MenuItem onSelect={() => reloadFrame(frame.current)}>
                <Icon name="refresh" size={15} className="text-ink2" />
                Reload screen
              </MenuItem>
              {openUrl ? (
                <MenuItem onSelect={() => window.open(openUrl, '_blank', 'noopener')}>
                  <Icon name="external" size={15} className="text-ink2" />
                  Open in a new tab
                </MenuItem>
              ) : null}
              <MenuItem onSelect={() => setThemePref(appTheme === 'dark' ? 'light' : 'dark')}>
                <Icon name={appTheme === 'dark' ? 'sun' : 'moon'} size={15} className="text-ink2" />
                {appTheme === 'dark' ? 'Light appearance' : 'Dark appearance'}
              </MenuItem>
            </Menu>
            {slots.barEnd}
          </>
        }
      />
      {slots.belowBar ? <div className="shrink-0">{slots.belowBar}</div> : null}
      <div
        ref={stage}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        className={cn(
          'canvas-dots relative min-h-0 grow overflow-y-auto overscroll-contain',
          wide && actual ? 'overflow-x-auto' : 'overflow-x-hidden',
        )}
      >
        {errors.length ? (
          <div className="sticky top-0 z-10 flex items-start gap-2 border-b border-rule bg-danger-soft px-4 py-2 font-mono text-[12px] whitespace-pre-wrap text-danger-text">
            <Icon name="alert" size={14} className="mt-px shrink-0" />
            <span className="min-w-0 break-words">{errors.join('\n')}</span>
          </div>
        ) : null}
        <AnimatePresence initial={false} mode="popLayout" custom={direction}>
          <motion.div
            key={item.id}
            custom={direction}
            initial={{ opacity: 0, x: direction * 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: direction * -40, transition: { duration: 0.12 } }}
            transition={{ type: 'spring', stiffness: 420, damping: 38 }}
            className={cn('flex', wide && actual ? 'w-max' : 'justify-center')}
            style={{ padding: GUTTER }}
          >
            {scale ? (
              <div
                className="shrink-0 overflow-hidden rounded-[6px] bg-surface"
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
                  style={{
                    width,
                    height,
                    transform: `scale(${scale})`,
                    transformOrigin: '0 0',
                    colorScheme: frameTheme,
                  }}
                  onLoad={() => item.kind === 'screen' && sendTheme(frame.current, frameTheme)}
                />
              </div>
            ) : null}
          </motion.div>
        </AnimatePresence>
      </div>
      <nav
        aria-label="Screens"
        className="flex shrink-0 items-center gap-1 border-t border-rule bg-surface px-2 pt-1.5 pb-[max(6px,env(safe-area-inset-bottom))]"
      >
        <IconButton icon="chevron-left" label="Previous screen" onClick={() => move(-1)} disabled={all.length < 2} />
        <button
          type="button"
          onClick={() => setListOpen(true)}
          className="flex h-10 min-w-0 grow cursor-pointer items-center justify-center gap-2 rounded-[8px] border-0 bg-transparent px-3 text-[13.5px] text-ink active:bg-soft2"
        >
          <Icon name="list" size={15} className="shrink-0 text-muted" />
          <span className="tabular shrink-0 text-muted">
            {index + 1} / {all.length}
          </span>
          <span className="min-w-0 truncate font-medium">{item.title || item.id}</span>
        </button>
        <IconButton icon="chevron-right" label="Next screen" onClick={() => move(1)} disabled={all.length < 2} />
      </nav>
      <Sheet open={listOpen} onOpenChange={setListOpen} title={canvas.title}>
        <ScreenList
          canvas={canvas}
          current={item.id}
          onPick={(id) => {
            setListOpen(false)
            goTo(id)
          }}
        />
      </Sheet>
    </div>
  )
}

function ThemeItem({ value, current, onPick }: { value: Theme; current: Theme; onPick: (theme: Theme) => void }) {
  return (
    <MenuItem active={current === value} onSelect={() => onPick(value)}>
      <Icon name={value === 'dark' ? 'moon' : 'sun'} size={15} className="text-ink2" />
      {value === 'dark' ? 'Dark' : 'Light'}
      {current === value ? <Icon name="check" size={15} className="ml-auto text-ink2" /> : null}
    </MenuItem>
  )
}

/** The phone's top bar: a way back, the screen and where it sits, and the screen's actions. */
function PhoneBar({
  canvas,
  title,
  sub,
  back,
  end,
}: {
  canvas: CanvasDoc
  title: string
  sub: string | null
  back?: string
  end?: ReactNode
}) {
  const { slots } = useViewer()
  return (
    <header className="flex h-[52px] shrink-0 items-center gap-2 border-b border-rule bg-surface pr-2 pl-2 pt-[env(safe-area-inset-top)]">
      {slots.barStart}
      {back ? (
        <Link
          href={back}
          aria-label={`All canvases, leaving ${canvas.title}`}
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-[8px] text-ink2 active:bg-soft2"
        >
          <Icon name="arrow-left" size={18} />
        </Link>
      ) : (
        <span className="flex size-10 shrink-0 items-center justify-center">
          <Mark />
        </span>
      )}
      <div className="flex min-w-0 grow flex-col leading-tight">
        <span className="truncate text-[14.5px] font-semibold">{title}</span>
        {sub ? <span className="truncate text-[12px] text-muted">{sub}</span> : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">{end}</div>
    </header>
  )
}

const KIND_ICON = (entry: Entry): IconName =>
  entry.item.kind === 'url'
    ? 'globe'
    : entry.item.frame.device === 'phone'
      ? 'smartphone'
      : entry.item.frame.device === 'tablet'
        ? 'tablet'
        : 'monitor'

/** Every screen of the canvas by page and section, the current one marked. */
function ScreenList({ canvas, current, onPick }: { canvas: CanvasDoc; current: string; onPick: (id: string) => void }) {
  const activeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'center' })
  }, [])
  const multi = canvas.pages.length > 1
  return (
    <div className="flex flex-col pb-2">
      {canvas.pages.map((page) => {
        const entries = framesOf(canvas, page.id)
        if (!entries.length) return null
        return (
          <section key={page.id} className="flex flex-col">
            {multi ? (
              <h3 className="sticky top-0 z-[1] m-0 border-b border-rule bg-soft px-4 py-2 text-[12px] font-semibold text-ink2">
                {page.title}
              </h3>
            ) : null}
            {page.sections.map((section) => {
              const items = entries.filter((entry) => section.items.includes(entry.item))
              if (!items.length) return null
              return (
                <div key={section.id} className="flex flex-col">
                  {section.title ? <div className="px-4 pt-3 pb-1 text-[12px] text-muted">{section.title}</div> : null}
                  {items.map((entry) => {
                    const on = entry.item.id === current
                    return (
                      <button
                        key={entry.item.id}
                        ref={on ? activeRef : undefined}
                        type="button"
                        aria-current={on ? 'true' : undefined}
                        onClick={() => onPick(entry.item.id)}
                        className={cn(
                          'flex min-h-[48px] cursor-pointer items-center gap-3 border-0 bg-transparent px-4 text-left text-[14px] active:bg-soft2',
                          on ? 'font-medium text-ink' : 'text-ink2',
                        )}
                      >
                        <span
                          className={cn(
                            'flex size-8 shrink-0 items-center justify-center rounded-[8px]',
                            on ? 'bg-action-soft text-action' : 'bg-soft2 text-muted',
                          )}
                        >
                          <Icon name={KIND_ICON(entry)} size={15} />
                        </span>
                        <span className="min-w-0 grow truncate">{entry.item.title || entry.item.id}</span>
                        {on ? <Icon name="check" size={16} className="shrink-0 text-action" /> : null}
                      </button>
                    )
                  })}
                </div>
              )
            })}
          </section>
        )
      })}
    </div>
  )
}
