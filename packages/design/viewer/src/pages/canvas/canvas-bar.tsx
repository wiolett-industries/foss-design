import type { CanvasDoc, CanvasItem, CanvasPage as Page, Theme } from '@shared/types'
import { AnimatePresence, motion } from 'motion/react'
import { type ReactNode, useRef } from 'react'
import { Link, useLocation } from 'wouter'
import { SearchButton } from '../../components/search-button'
import { ThemeMenu } from '../../components/theme-menu'
import { Bar, BarCompactProvider, useFitBar } from '../../components/topbar'
import { Mark } from '../../components/wordmark'
import { cn } from '../../lib/cn'
import { copyText } from '../../lib/copy'
import { reloadFrame } from '../../lib/frames'
import { useStore } from '../../lib/store'
import { useViewer } from '../../lib/viewer'
import { Button, IconButton } from '../../ui/button'
import { Segmented } from '../../ui/choice'
import { Icon } from '../../ui/icon'
import { Menu, MenuItem, MenuLabel } from '../../ui/menu'
import { Kbd } from '../../ui/text'
import { Tooltip } from '../../ui/tooltip'
import { useOpenUrl } from './full-page'
import { pageHref } from './sidebar'
import type { ViewStore } from './view-state'

/** The canvas page's top bar: the canvas and its pages, screen theme, inspect and play. */
export function CanvasBar({
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
  const { slots, scope } = useViewer()
  const titleRef = useRef<HTMLDivElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  // Short of room, the buttons turn into square icons with tooltips (slots follow via useBarCompact).
  const compact = useFitBar(titleRef, endRef, [canvas.title, page?.title, canvas.pages.length])
  return (
    <BarCompactProvider value={compact}>
      <Bar>
        {slots.barStart}
        {slots.brand ? (
          slots.brand
        ) : scope ? (
          <Mark />
        ) : (
          <Tooltip content="All canvases">
            <Link href="/" className="flex items-center" aria-label="All canvases">
              <Mark />
            </Link>
          </Tooltip>
        )}
        <IconButton
          icon="panel-left"
          label={sidebar ? 'Hide sidebar (⌘\\)' : 'Show sidebar (⌘\\)'}
          onClick={() => onSidebar(!sidebar)}
        />
        <div ref={titleRef} className="flex min-w-0 items-center gap-1.5 text-[14px]">
          <span data-fit className="truncate font-semibold">
            {canvas.title}
          </span>
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
                    <span data-fit className="truncate">
                      {page.title}
                    </span>
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
        <div ref={endRef} className="ml-auto flex shrink-0 items-center gap-2">
          <Segmented
            label="Screen theme"
            value={theme}
            onChange={onTheme}
            items={[
              { value: 'light', label: <Icon name="sun" size={15} />, title: 'Light screens' },
              { value: 'dark', label: <Icon name="moon" size={15} />, title: 'Dark screens' },
            ]}
          />
          <InspectToggle on={inspect} onChange={onInspect} compact={compact} />
          <Tooltip
            content={
              <span className="flex items-center gap-1.5">
                Play <Kbd>P</Kbd>
              </span>
            }
          >
            <Button
              kind="secondary"
              icon="play"
              onClick={onPlay}
              disabled={!canPlay}
              aria-label="Play"
              className={compact ? 'w-ctrl px-0' : undefined}
            >
              {compact ? null : 'Play'}
            </Button>
          </Tooltip>
          <SearchButton width={180} label="Search" compact={compact} />
          <ThemeMenu />
          {slots.barEnd}
        </div>
      </Bar>
      {slots.belowBar ? <div className="shrink-0">{slots.belowBar}</div> : null}
    </BarCompactProvider>
  )
}

/**
 * The strip along the canvas's bottom edge that holds a bar: centred while there is room, moved aside
 * when there is not, and never under the controls in the corners, whose widths come in as
 * `--dock-left` and `--dock-right` (see useDock).
 */
export function BottomDock({ children }: { children: ReactNode }) {
  return (
    <div
      data-ui
      className="pointer-events-none absolute inset-x-4 bottom-5 z-20 grid grid-cols-[minmax(var(--dock-left,0px),1fr)_minmax(0,auto)_minmax(var(--dock-right,0px),1fr)]"
    >
      <div className="col-start-2 flex min-w-0 justify-center">{children}</div>
    </div>
  )
}

/** The selected item's name and actions, floating over the bottom of the canvas; it eases in and out. */
export function SelectionBar({
  canvas,
  store,
  layoutItems,
  theme,
  onPlay,
  inspect,
  onMarkup,
}: {
  canvas: CanvasDoc
  store: ViewStore
  layoutItems: CanvasItem[]
  theme: Theme
  onPlay(id: string): void
  inspect: boolean
  /** Mark up a screen; without it, where no one may draw, there is no such button. */
  onMarkup?: (id: string) => void
}) {
  const selected = useStore(store, (state) => state.selected)
  const item = layoutItems.find((i) => i.id === selected)
  return (
    <BottomDock>
      <AnimatePresence>
        {item ? (
          <SelectedBar
            key="bar"
            canvas={canvas}
            store={store}
            item={item}
            theme={theme}
            onPlay={onPlay}
            inspect={inspect}
            onMarkup={onMarkup}
          />
        ) : null}
      </AnimatePresence>
    </BottomDock>
  )
}

function SelectedBar({
  canvas,
  store,
  item,
  theme,
  onPlay,
  inspect,
  onMarkup,
}: {
  canvas: CanvasDoc
  store: ViewStore
  item: CanvasItem
  theme: Theme
  onPlay(id: string): void
  inspect: boolean
  onMarkup?: (id: string) => void
}) {
  const { slots } = useViewer()
  const status = useStore(store, (state) => state.frames[item.id])
  const openUrl = useOpenUrl(canvas.id, item.kind === 'screen' || item.kind === 'url' ? item : undefined, theme)
  const frame = item.kind === 'screen' || item.kind === 'url'
  const reload = () =>
    reloadFrame(document.querySelector<HTMLIFrameElement>(`[data-item="${CSS.escape(item.id)}"] iframe`))
  const errors = status?.errors ?? []
  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 10, scale: 0.98, transition: { duration: 0.14, ease: 'easeIn' } }}
      transition={{ type: 'spring', duration: 0.26, bounce: 0.12 }}
      className="relative flex w-fit max-w-full min-w-0 flex-col"
    >
      {/* Tabs slide out from behind the bar's top edge, each as wide as its text and 20px short of
            the bar's ends at most, the bar's border staying under them: the frame's error, first
            line only (all of them on hover), and while Inspect is on (or ⌘/Ctrl held) how it works.
            Both at once stack, the error on the bar. */}
      <div className="pointer-events-none absolute inset-x-5 bottom-full flex flex-col items-center">
        <AnimatePresence initial={false}>
          {frame && inspect ? (
            <motion.div
              key="inspect"
              layout="position"
              initial={{ y: '100%', opacity: 0 }}
              animate={{ y: 0, opacity: 0.9 }}
              exit={{ y: '100%', opacity: 0 }}
              transition={{ type: 'spring', duration: 0.28, bounce: 0.15 }}
              className="flex h-[22px] max-w-full min-w-0 items-center rounded-t-[7px] border border-b-0 border-rule bg-surface/80 px-3 text-[11.5px] whitespace-nowrap text-muted backdrop-blur-md"
            >
              <span className="truncate">Click an element to inspect it</span>
            </motion.div>
          ) : null}
          {errors.length ? (
            <motion.div
              key="error"
              layout="position"
              initial={{ y: '100%', opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: '100%', opacity: 0 }}
              transition={{ type: 'spring', duration: 0.28, bounce: 0.15 }}
              className="pointer-events-auto flex max-w-full min-w-0"
            >
              <Tooltip
                content={
                  <span className="block max-h-60 max-w-[560px] overflow-y-auto font-mono text-[11.5px] whitespace-pre-wrap">
                    {errors.join('\n\n')}
                  </span>
                }
              >
                <div className="flex h-[22px] min-w-0 items-center gap-1.5 rounded-t-[7px] border border-b-0 border-danger/25 bg-danger-soft px-2.5 font-mono text-[11px] whitespace-nowrap text-danger-text">
                  <Icon name="alert" size={12} className="shrink-0" />
                  <span className="truncate">{errors[0]!.split('\n')[0]}</span>
                  {errors.length > 1 ? <span className="shrink-0 opacity-70">+{errors.length - 1}</span> : null}
                </div>
              </Tooltip>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
      {/* Positioned, so it paints over the tabs, which slide out from under it. */}
      <div className="pointer-events-auto relative flex max-w-full flex-col overflow-hidden rounded-[10px] border border-rule bg-surface shadow-pop">
        <div className="flex h-[44px] items-center gap-1 pr-1.5 pl-3.5 [&>:not(:first-child)]:shrink-0">
          <span className="min-w-0 truncate pr-2 text-[13.5px] font-medium">{item.title || item.id}</span>
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
          {item.kind === 'screen' && onMarkup ? (
            <Tooltip content="Mark up">
              <IconButton icon="edit" label="Mark up" onClick={() => onMarkup(item.id)} />
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
          {slots.selectionActions?.(canvas.id, item)}
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
    </motion.div>
  )
}

/** The inspect mode switch: a button that stays pressed while on. */
export function InspectToggle({
  on,
  onChange,
  compact = false,
}: {
  on: boolean
  onChange(value: boolean): void
  /** A square icon; the tooltip names it. */
  compact?: boolean
}) {
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
        aria-label="Inspect elements"
        onClick={() => onChange(!on)}
        className={cn(
          'inline-flex h-ctrl shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-[6px] border text-ctrl font-medium',
          compact ? 'w-ctrl px-0' : 'px-ctrl',
          on ? 'border-action-line bg-action-soft text-action' : 'border-rule-strong bg-surface text-ink hover:bg-soft',
        )}
      >
        <Icon name="pointer" size={15} />
        {compact ? null : 'Inspect'}
      </button>
    </Tooltip>
  )
}
